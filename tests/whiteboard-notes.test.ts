import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createActivityServer } from '../apps/services/activities/server';
import { MemoryActivityRepository } from '../apps/services/activities/repository';
import { applyCommand, emptyRoom } from '../apps/services/activities/engine';
import { decodeStoredRoom, encodeStoredRoom } from '../apps/services/activities/storage-codec';
import { commandSchema } from '../packages/activity-protocol/src/index';
import { whiteboardSvg } from '../apps/desktop/electron/whiteboard-export';
import {
  NOTE_HEIGHT,
  NOTE_WIDTH,
  placeNote,
  wrapNoteText,
} from '../apps/desktop/src/whiteboard-notes';

const note = (id: string, text = 'Buy milk', x = 40, y = 50) => ({
  type: 'whiteboard.put' as const,
  element: { id, kind: 'note' as const, points: [[x, y]], text, color: '#F7D774', width: 1 },
});
const stroke = (id: string) => ({
  type: 'whiteboard.put' as const,
  element: { id, kind: 'stroke' as const, points: [[1, 1]], color: '#aabbcc', width: 2 },
});

async function harness() {
  const app = await createActivityServer({
    repository: new MemoryActivityRepository(),
    authorize: async (token) => ({
      userId: token,
      displayName: token,
      // `admin` stands for a community admin; everyone else is a plain member.
      canControl: token === 'admin',
      canCreate: true,
    }),
  });
  const revisions = new Map<string, number>();
  const send = async (user: string, command: unknown) => {
    const response = await app.inject({
      method: 'POST',
      url: '/v1/rooms/r/activity/commands',
      headers: { authorization: `Bearer ${user}` },
      payload: {
        protocolVersion: 1,
        commandId: randomUUID(),
        expectedRevision: revisions.get('r') ?? 0,
        command,
      },
    });
    const body = response.json() as {
      error?: string;
      room?: { revision: number; whiteboard: { id: string }[] };
    };
    if (response.statusCode === 200 && body.room) revisions.set('r', body.room.revision);
    return { status: response.statusCode, body };
  };
  const board = async () => {
    const response = await app.inject({
      url: '/v1/rooms/r/activity',
      headers: { authorization: 'Bearer admin' },
    });
    return (response.json() as { room: { whiteboard: Record<string, unknown>[] } }).room.whiteboard;
  };
  for (const user of ['admin', 'alice', 'bob']) await send(user, { type: 'join' });
  return { app, send, board };
}

describe('whiteboard sticky notes', () => {
  it('creates, moves, edits and deletes a note for its author, and keeps the author', async () => {
    const { app, send, board } = await harness();
    try {
      expect((await send('alice', note('n1'))).status).toBe(200);
      expect((await send('alice', note('n1', 'Buy oat milk', 700, 400))).status).toBe(200);
      expect(await board()).toEqual([
        expect.objectContaining({
          id: 'n1',
          kind: 'note',
          text: 'Buy oat milk',
          points: [[700, 400]],
          authorId: 'alice',
        }),
      ]);
      expect((await send('alice', { type: 'whiteboard.remove', elementId: 'n1' })).status).toBe(
        200,
      );
      expect(await board()).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it('lets only the author or a community admin change a note; strokes stay author-only', async () => {
    const { app, send, board } = await harness();
    try {
      await send('alice', note('n1'));
      await send('alice', stroke('s1'));
      // Another member may neither move nor delete it.
      expect((await send('bob', note('n1', 'hijack'))).body.error).toBe(
        'WHITEBOARD_AUTHOR_REQUIRED',
      );
      expect((await send('bob', { type: 'whiteboard.remove', elementId: 'n1' })).status).toBe(403);
      // An admin can edit and move it, and the original author is kept.
      expect((await send('admin', note('n1', 'Moderated', 10, 10))).status).toBe(200);
      expect((await board()).find((item) => item.id === 'n1')).toMatchObject({
        text: 'Moderated',
        authorId: 'alice',
      });
      // ...but not a stroke, and an admin cannot turn a stroke into a note or back.
      expect((await send('admin', { type: 'whiteboard.remove', elementId: 's1' })).status).toBe(
        403,
      );
      expect((await send('alice', note('s1'))).body.error).toBe('WHITEBOARD_KIND_IMMUTABLE');
      expect((await send('admin', { type: 'whiteboard.remove', elementId: 'n1' })).status).toBe(
        200,
      );
    } finally {
      await app.close();
    }
  });

  it('caps the number of notes', async () => {
    const { app, send } = await harness();
    try {
      for (let i = 0; i < 60; i++) expect((await send('alice', note(`n${i}`))).status).toBe(200);
      expect((await send('alice', note('overflow'))).body.error).toBe('WHITEBOARD_NOTES_FULL');
      // Editing an existing note is still allowed at the cap.
      expect((await send('alice', note('n0', 'edited'))).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it('clears strokes and notes for everyone, for admins only', async () => {
    const { app, send, board } = await harness();
    try {
      await send('alice', note('n1'));
      await send('bob', stroke('s1'));
      const denied = await send('alice', { type: 'whiteboard.clear' });
      expect(denied.status).toBe(403);
      expect(denied.body.error).toBe('WHITEBOARD_CLEAR_DENIED');
      expect(await board()).toHaveLength(2);
      expect((await send('admin', { type: 'whiteboard.clear' })).status).toBe(200);
      expect(await board()).toEqual([]);
      // Clearing an empty board is harmless.
      expect((await send('admin', { type: 'whiteboard.clear' })).status).toBe(200);
    } finally {
      await app.close();
    }
  });
});

describe('whiteboard notes and older clients', () => {
  it('validates the note command shape strictly', () => {
    const parse = (command: unknown) =>
      commandSchema.safeParse({
        protocolVersion: 1,
        commandId: randomUUID(),
        expectedRevision: 0,
        command,
      }).success;
    expect(parse(note('n1'))).toBe(true);
    expect(parse({ type: 'whiteboard.clear' })).toBe(true);
    expect(parse({ type: 'whiteboard.clear', everyone: true })).toBe(false);
    // A note is anchored by exactly one point; the shape older clients draw as nothing.
    expect(
      parse({
        ...note('n1'),
        element: {
          ...note('n1').element,
          points: [
            [1, 1],
            [2, 2],
          ],
        },
      }),
    ).toBe(false);
    expect(parse({ ...note('n1'), element: { ...note('n1').element, kind: 'sticker' } })).toBe(
      false,
    );
  });

  it('stores boards with notes and still reads boards written before notes existed', () => {
    const room = emptyRoom('r', 1000);
    const identity = { userId: 'alice', displayName: 'Alice', canControl: false, canCreate: true };
    for (const command of [{ type: 'join' as const }, note('n1'), stroke('s1')])
      applyCommand(
        room,
        identity,
        {
          protocolVersion: 1,
          commandId: randomUUID(),
          expectedRevision: room.snapshot.revision,
          command,
        },
        1000,
      );
    const decoded = decodeStoredRoom(JSON.parse(encodeStoredRoom(room)), 'r');
    expect(decoded.snapshot.whiteboard.map((item) => item.kind)).toEqual(['note', 'stroke']);
    expect(decoded.snapshot.whiteboard[0]).toMatchObject({ text: 'Buy milk', authorId: 'alice' });
  });

  it('draws a note in the PNG export and keeps the body escaped', () => {
    const svg = whiteboardSvg([{ ...note('n1', '<b>hi</b> & bye').element, authorId: 'alice' }]);
    expect(svg).toContain(`width="${NOTE_WIDTH}" height="${NOTE_HEIGHT}"`);
    expect(svg).toContain('&lt;b&gt;hi&lt;/b&gt;');
    expect(svg).not.toContain('<b>');
    expect(svg).not.toContain('alice');
  });
});

describe('note layout helpers', () => {
  it('keeps notes on the board and snaps them flush to an edge', () => {
    expect(placeNote(-50, -50)).toEqual([0, 0]);
    expect(placeNote(5000, 5000)).toEqual([1000 - NOTE_WIDTH, 620 - NOTE_HEIGHT]);
    expect(placeNote(6, 400)).toEqual([0, 400]);
    expect(placeNote(1000 - NOTE_WIDTH - 4, 100)).toEqual([1000 - NOTE_WIDTH, 100]);
    expect(placeNote(300.04, 200.06, true)).toEqual([300, 200.1]);
    expect(placeNote(Number.NaN, 100)[0]).toBe(0);
    // While dragging a note follows the pointer without snapping.
    expect(placeNote(5, 5, false)).toEqual([5, 5]);
  });

  it('wraps long text into a bounded number of lines', () => {
    expect(wrapNoteText('short note')).toEqual(['short note']);
    expect(wrapNoteText('a\nb')).toEqual(['a', 'b']);
    const lines = wrapNoteText('x'.repeat(500));
    expect(lines.length).toBeLessThanOrEqual(7);
    expect(lines.at(-1)!.endsWith('…')).toBe(true);
    for (const line of wrapNoteText('lorem ipsum dolor sit amet consectetur adipiscing elit sed'))
      expect(line.length).toBeLessThanOrEqual(20);
  });
});
