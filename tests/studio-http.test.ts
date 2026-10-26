import { describe, expect, it, vi } from 'vitest';
import { createProject } from '@rooms/studio';
import { StoatError } from '@rooms/stoat';
import { createStudioHttp, type StudioServiceSession } from '../apps/desktop/electron/studio-http';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const doc = createProject({
  id: 'p1',
  roomId: 'room1',
  name: 'Demo',
  createdBy: 'alice',
  createdAt: 1,
});
const syncAnswer = {
  protocolVersion: 1,
  serverTimeMs: 5,
  seq: 0,
  presence: [],
  access: { canEdit: true, canDelete: false },
  snapshot: doc,
};

function setup(answer: (url: string, init: RequestInit) => Promise<Response> | Response) {
  const calls: { url: string; init: RequestInit }[] = [];
  let sessionController = new AbortController();
  let current: string | null = 'token-1';
  const session = (): StudioServiceSession => {
    const token = current;
    if (!token) throw new StoatError(401, 'SIGN_IN_REQUIRED');
    return {
      origin: 'https://chat.example',
      token,
      signal: sessionController.signal,
      assertSession: () => {
        if (current !== token) throw new StoatError(401, 'SESSION_CHANGED');
      },
    };
  };
  const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init: init! });
    return answer(String(url), init!);
  }) as unknown as typeof fetch;
  const http = createStudioHttp(session, fetcher);
  return {
    ...http,
    calls,
    signOut() {
      current = null;
    },
    switchAccount() {
      current = 'token-2';
      sessionController.abort();
      sessionController = new AbortController();
    },
  };
}
/** A fetch that only ends when its signal aborts. */
const hanging = (_url: string, init: RequestInit) =>
  new Promise<Response>((_resolve, reject) =>
    init.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
  );

describe('Studio main-process bridge', () => {
  it('sends the bearer from main and validates the sync answer', async () => {
    const { bridge, calls } = setup(() => json(syncAnswer));
    const result = await bridge.sync('room1', 'p1', 0, 0);
    expect(result.snapshot?.id).toBe('p1');
    expect(calls[0].url).toBe(
      'https://chat.example/rooms-activities/v1/rooms/room1/studio/projects/p1?afterSeq=0&waitMs=0',
    );
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer token-1');
    expect(calls[0].init.redirect).toBe('error');
  });

  it('rejects bad input before anything is sent', async () => {
    const { bridge, calls } = setup(() => json(syncAnswer));
    await expect(bridge.sync('room1', '../p1', 0, 0)).rejects.toThrow('STUDIO_INVALID_INPUT');
    await expect(bridge.sync('room1', 'p1', -1, 0)).rejects.toThrow('STUDIO_INVALID_INPUT');
    await expect(bridge.sync('room1', 'p1', 0, 60_000)).rejects.toThrow('STUDIO_INVALID_INPUT');
    await expect(
      bridge.ops('room1', 'p1', { batchId: 'not-a-uuid', ops: [{ op: 'track.delete', id: 't' }] }),
    ).rejects.toThrow('STUDIO_INVALID_INPUT');
    await expect(
      bridge.ops('room1', 'p1', {
        batchId: crypto.randomUUID(),
        ops: Array.from({ length: 201 }, () => ({ op: 'track.delete' as const, id: 't' })),
      }),
    ).rejects.toThrow('STUDIO_INVALID_INPUT');
    await expect(bridge.presence('room1', 'p1', { view: 'Mixer!' } as never)).rejects.toThrow(
      'STUDIO_INVALID_INPUT',
    );
    await expect(bridge.create('room1', { name: '' })).rejects.toThrow('STUDIO_INVALID_INPUT');
    expect(calls).toHaveLength(0);
  });

  it('posts a valid batch with the protocol version', async () => {
    const { bridge, calls } = setup(() =>
      json({ protocolVersion: 1, seq: 3, applied: [0], skipped: [] }),
    );
    const batchId = crypto.randomUUID();
    await bridge.ops('room1', 'p1', { batchId, ops: [{ op: 'track.delete', id: 't1' }] });
    expect(calls[0].init.method).toBe('POST');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({
      protocolVersion: 1,
      batchId,
      ops: [{ op: 'track.delete', id: 't1' }],
    });
  });

  it('passes public error codes and maps bare proxy answers', async () => {
    const answers = [
      json({ error: 'STUDIO_BATCH_CONFLICT' }, 409),
      new Response('Not Found', { status: 404 }),
      json({ statusCode: 404, error: 'Not Found', message: 'Route GET:/v1/… not found' }, 404),
      new Response('<html>', { status: 413 }),
      new Response('Bad gateway', { status: 502 }),
      json({ error: 'not a code <script>' }, 403),
    ];
    const { bridge } = setup(() => answers.shift()!);
    const batch = { batchId: crypto.randomUUID(), ops: [{ op: 'track.delete' as const, id: 't' }] };
    await expect(bridge.ops('room1', 'p1', batch)).rejects.toThrow('STUDIO_BATCH_CONFLICT');
    await expect(bridge.list('room1')).rejects.toThrow('STUDIO_UNAVAILABLE');
    await expect(bridge.list('room1')).rejects.toThrow('STUDIO_UNAVAILABLE');
    await expect(bridge.ops('room1', 'p1', batch)).rejects.toThrow('PAYLOAD_TOO_LARGE');
    await expect(bridge.list('room1')).rejects.toThrow('ACTIVITY_SERVICE_UNAVAILABLE');
    await expect(bridge.list('room1')).rejects.toThrow(/^ROOM_ACCESS_DENIED$/);
  });

  it('refuses a malformed answer instead of passing it to the renderer', async () => {
    const { bridge } = setup(() => json({ ...syncAnswer, snapshot: { ...doc, tempo: 999 } }));
    await expect(bridge.sync('room1', 'p1', 0, 0)).rejects.toThrow('INVALID_ACTIVITY_RESPONSE');
  });

  it('turns a network failure into a retryable code', async () => {
    const { bridge } = setup(() => {
      throw new TypeError('fetch failed');
    });
    await expect(bridge.list('room1')).rejects.toThrow('ACTIVITY_SERVICE_UNAVAILABLE');
  });

  it('ends the previous long poll of a project when a new one starts', async () => {
    const { bridge, abortAll } = setup(hanging);
    const first = bridge.sync('room1', 'p1', 4, 25_000);
    const second = bridge.sync('room1', 'p1', 4, 25_000);
    await expect(first).rejects.toThrow('REQUEST_CANCELLED');
    const other = bridge.sync('room1', 'p2', 0, 25_000);
    await Promise.resolve();
    // A different project is not affected.
    let settled = false;
    void second.catch(() => (settled = true));
    void other.catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);
    abortAll();
  });

  it('aborts long polls when the account changes or the window closes', async () => {
    const http = setup(hanging);
    const poll = http.bridge.sync('room1', 'p1', 4, 25_000);
    http.switchAccount();
    // The code itself is the message: only `message` crosses IPC.
    await expect(poll).rejects.toThrow(/^SESSION_CHANGED$/);
    const next = http.bridge.sync('room1', 'p1', 4, 25_000);
    http.abortAll();
    await expect(next).rejects.toThrow('REQUEST_CANCELLED');
    http.signOut();
    await expect(http.bridge.list('room1')).rejects.toThrow(/^SIGN_IN_REQUIRED$/);
  });
});
