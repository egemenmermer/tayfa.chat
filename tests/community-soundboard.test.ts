import { expect, it } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerSoundboard, soundDuration } from '../apps/services/access/soundboard';
function audio() {
  const b = Buffer.alloc(44 + 9600);
  b.write('RIFF');
  b.writeUInt32LE(b.length - 8, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(48000, 24);
  b.writeUInt32LE(96000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(b.length - 44, 40);
  return b;
}
const scope = 'DEMO-room';
it('shares uploaded sounds between real HTTP clients, survives service recreation and isolates another community', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rooms-soundboard-'));
  const open = async () => {
    const server = Fastify();
    server.setErrorHandler((e, _r, reply) =>
      reply
        .code((e as any).status ?? (e as any).statusCode ?? 400)
        .send({ error: (e as any).code ?? 'INVALID' }),
    );
    registerSoundboard(server, {
      directory,
      authorize: async (token) => {
        if (token === 'outsider') throw Object.assign(Error(), { status: 403, code: 'DENIED' });
        return {
          communityId: token === 'other' ? 'DEMO-other' : 'DEMO-community',
          userId: token,
          canUpload: true,
          canManage: token === 'admin',
        };
      },
    });
    const base = await server.listen({ host: '127.0.0.1', port: 0 });
    return { server, base };
  };
  let app = await open();
  const request = (base: string, token: string, method: string, path = '', body?: unknown) =>
    fetch(`${base}/v1/soundboard/${scope}${path}`, {
      method,
      headers: { Authorization: token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const sent = await request(app.base, 'alice', 'POST', '', {
      name: 'DEMO sound',
      audio: audio().toString('base64'),
    });
    expect(sent.status).toBe(200);
    const entry = await sent.json();
    const list = await (await request(app.base, 'bob', 'GET')).json();
    expect(list.clips.map((c: any) => c.id)).toEqual([entry.id]);
    const received = await request(app.base, 'bob', 'GET', '/' + entry.id);
    expect(Buffer.from(await received.arrayBuffer())).toEqual(audio());
    expect((await request(app.base, 'other', 'GET', '/' + entry.id)).status).toBe(404);
    expect((await request(app.base, 'outsider', 'GET')).status).toBe(403);
    expect((await request(app.base, 'bob', 'DELETE', '/' + entry.id)).status).toBe(403);
    await app.server.close();
    app = await open();
    expect((await (await request(app.base, 'bob', 'GET')).json()).clips[0].id).toBe(entry.id);
    expect((await request(app.base, 'alice', 'DELETE', '/' + entry.id)).status).toBe(200);
    expect((await (await request(app.base, 'bob', 'GET')).json()).clips).toEqual([]);
  } finally {
    await app.server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
it('validates canonical bounded PCM instead of trusting declared extensions or durations', () => {
  expect(soundDuration(audio())).toBe(0.1);
  expect(() => soundDuration(Buffer.from('not audio'))).toThrow();
  const bad = audio();
  bad.writeUInt32LE(44100, 24);
  expect(() => soundDuration(bad)).toThrow();
});

it('renames a sound for its owner or a manager only and keeps the stored emoji word', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'rooms-soundboard-'));
  const server = Fastify();
  server.setErrorHandler((e, _r, reply) =>
    reply
      .code((e as any).status ?? (e as any).statusCode ?? 400)
      .send({ error: (e as any).code ?? 'INVALID' }),
  );
  registerSoundboard(server, {
    directory,
    authorize: async (token) => ({
      communityId: 'DEMO-community',
      userId: token,
      canUpload: true,
      canManage: token === 'admin',
    }),
  });
  const base = await server.listen({ host: '127.0.0.1', port: 0 });
  const call = (token: string, method: string, path = '', body?: unknown) =>
    fetch(`${base}/v1/soundboard/${scope}${path}`, {
      method,
      headers: { Authorization: token, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  try {
    const sent = await (
      await call('alice', 'POST', '', { name: 'Air horn', audio: audio().toString('base64') })
    ).json();
    const path = `/${sent.id}`;
    const renamed = await call('alice', 'PATCH', path, { name: '🎉 Air horn' });
    expect(renamed.status).toBe(200);
    expect(await renamed.json()).toMatchObject({
      id: sent.id,
      name: '🎉 Air horn',
      ownerId: 'alice',
    });
    expect((await call('bob', 'PATCH', path, { name: 'x' })).status).toBe(403);
    expect((await call('admin', 'PATCH', path, { name: '🔥 Air horn' })).status).toBe(200);
    expect((await call('alice', 'PATCH', path, { name: ' ' })).status).toBe(400);
    expect((await call('alice', 'PATCH', path, { name: 'x', ownerId: 'bob' })).status).toBe(400);
    expect(
      (await call('alice', 'PATCH', `/${'0'.repeat(8)}-0000-4000-8000-000000000000`, { name: 'x' }))
        .status,
    ).toBe(404);
    const catalog = await (await call('alice', 'GET')).json();
    expect(catalog.clips).toEqual([expect.objectContaining({ id: sent.id, name: '🔥 Air horn' })]);
  } finally {
    await server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
