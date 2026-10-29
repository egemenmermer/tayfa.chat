import type { FastifyInstance } from 'fastify';
import { mkdir, readFile, writeFile, rename, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { StoatError } from '@rooms/stoat';
const identifier = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  clipId = z.string().uuid();
const clip = z
  .object({
    id: clipId,
    name: z.string().min(1).max(40),
    durationSec: z.number().positive().max(8),
    ownerId: identifier,
  })
  .strict();
const catalog = z.object({ version: z.literal(1), clips: z.array(clip).max(32) }).strict();
type Member = { communityId: string; userId: string; canUpload: boolean; canManage: boolean };
/** Canonical PCM WAV only; no decoder/network execution on the access service. */
export function soundDuration(bytes: Buffer) {
  if (
    bytes.length < 44 ||
    bytes.length > 2_000_000 ||
    bytes.toString('ascii', 0, 4) !== 'RIFF' ||
    bytes.readUInt32LE(4) !== bytes.length - 8 ||
    bytes.toString('ascii', 8, 12) !== 'WAVE' ||
    bytes.toString('ascii', 12, 16) !== 'fmt ' ||
    bytes.readUInt32LE(16) !== 16 ||
    bytes.readUInt16LE(20) !== 1 ||
    ![1, 2].includes(bytes.readUInt16LE(22)) ||
    bytes.readUInt32LE(24) !== 48000 ||
    bytes.readUInt16LE(34) !== 16 ||
    bytes.toString('ascii', 36, 40) !== 'data' ||
    bytes.readUInt32LE(40) !== bytes.length - 44
  )
    throw new StoatError(400, 'SOUNDBOARD_INVALID_AUDIO');
  const channels = bytes.readUInt16LE(22),
    block = channels * 2;
  if (
    bytes.readUInt16LE(32) !== block ||
    bytes.readUInt32LE(28) !== 48000 * block ||
    (bytes.length - 44) % block
  )
    throw new StoatError(400, 'SOUNDBOARD_INVALID_AUDIO');
  const duration = (bytes.length - 44) / (48000 * block);
  if (duration <= 0 || duration > 8) throw new StoatError(400, 'SOUNDBOARD_INVALID_AUDIO');
  return duration;
}
export function registerSoundboard(
  server: FastifyInstance,
  options: { directory?: string; authorize(token: string, channelId: string): Promise<Member> },
) {
  const locks = new Map<string, Promise<unknown>>();
  const member = async (request: { headers: { authorization?: string }; params: unknown }) => {
    if (!options.directory) throw new StoatError(501, 'SOUNDBOARD_NOT_CONFIGURED');
    const channelId = identifier.parse((request.params as { channelId: string }).channelId),
      token = request.headers.authorization?.replace(/^Bearer /, '');
    if (!token || token.length > 8192) throw new StoatError(401, 'AUTH_REQUIRED');
    const value = await options.authorize(token, channelId);
    identifier.parse(value.communityId);
    return value;
  };
  const folder = (community: string) => join(options.directory!, community);
  const load = async (community: string) => {
    try {
      return catalog.parse(
        JSON.parse(await readFile(join(folder(community), 'catalog.json'), 'utf8')),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { version: 1 as const, clips: [] as z.infer<typeof clip>[] };
      throw new StoatError(503, 'SOUNDBOARD_STORAGE_UNAVAILABLE');
    }
  };
  const quota = async () => {
    let total = 0;
    let directories;
    try {
      directories = await readdir(options.directory!, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw error;
    }
    if (directories.length > 256) throw new StoatError(409, 'SOUNDBOARD_STORAGE_LIMIT');
    for (const entry of directories)
      if (entry.isDirectory() && identifier.safeParse(entry.name).success)
        total += (await load(entry.name)).clips.length;
    if (total >= 256) throw new StoatError(409, 'SOUNDBOARD_STORAGE_LIMIT');
  };
  const save = async (community: string, value: z.infer<typeof catalog>) => {
    await mkdir(folder(community), { recursive: true, mode: 0o700 });
    const temp = join(folder(community), `catalog.${randomUUID()}.tmp`);
    try {
      await writeFile(temp, JSON.stringify(catalog.parse(value)), { mode: 0o600 });
      await rename(temp, join(folder(community), 'catalog.json'));
    } finally {
      await unlink(temp).catch(() => {});
    }
  };
  const locked = async <T>(community: string, work: () => Promise<T>) => {
    const task = (locks.get(community) ?? Promise.resolve()).catch(() => {}).then(work);
    locks.set(community, task);
    try {
      return await task;
    } finally {
      if (locks.get(community) === task) locks.delete(community);
    }
  };
  server.get('/v1/soundboard/:channelId', async (request) => {
    const m = await member(request);
    const value = await locked(m.communityId, () => load(m.communityId));
    return {
      communityId: m.communityId,
      clips: value.clips,
      canUpload: m.canUpload,
      canManage: m.canManage,
    };
  });
  server.post(
    '/v1/soundboard/:channelId',
    { bodyLimit: 2_800_000, config: { rateLimit: { max: 12, timeWindow: '1 minute' } } },
    async (request) => {
      const m = await member(request);
      if (!m.canUpload) throw new StoatError(403, 'SOUNDBOARD_UPLOAD_DENIED');
      const body = z
          .object({
            name: z.string().trim().min(1).max(40),
            audio: z
              .string()
              .max(2_666_672)
              .regex(/^[A-Za-z0-9+/]*={0,2}$/),
          })
          .strict()
          .parse(request.body),
        bytes = Buffer.from(body.audio, 'base64');
      if (bytes.toString('base64') !== body.audio)
        throw new StoatError(400, 'SOUNDBOARD_INVALID_AUDIO');
      const durationSec = soundDuration(bytes);
      return locked('\0uploads', async () =>
        locked(m.communityId, async () => {
          await quota();
          const value = await load(m.communityId);
          if (value.clips.length >= 32) throw new StoatError(409, 'SOUNDBOARD_FULL');
          const entry = { id: randomUUID(), name: body.name, durationSec, ownerId: m.userId };
          await mkdir(folder(m.communityId), { recursive: true, mode: 0o700 });
          const file = join(folder(m.communityId), `${entry.id}.wav`);
          await writeFile(file, bytes, { flag: 'wx', mode: 0o600 });
          try {
            const current = await options.authorize(
              request.headers.authorization!.replace(/^Bearer /, ''),
              identifier.parse((request.params as { channelId: string }).channelId),
            );
            if (
              current.communityId !== m.communityId ||
              current.userId !== m.userId ||
              !current.canUpload
            )
              throw new StoatError(403, 'SOUNDBOARD_UPLOAD_DENIED');
            await save(m.communityId, { version: 1, clips: [...value.clips, entry] });
          } catch (error) {
            await unlink(file).catch(() => {});
            throw error;
          }
          return entry;
        }),
      );
    },
  );
  server.get('/v1/soundboard/:channelId/:clipId', async (request, reply) => {
    const m = await member(request),
      id = clipId.parse((request.params as { clipId: string }).clipId);
    return locked(m.communityId, async () => {
      const value = await load(m.communityId);
      if (!value.clips.some((c) => c.id === id)) throw new StoatError(404, 'SOUNDBOARD_NOT_FOUND');
      const bytes = await readFile(join(folder(m.communityId), `${id}.wav`));
      soundDuration(bytes);
      return reply.type('audio/wav').header('Cache-Control', 'no-store').send(bytes);
    });
  });
  // Renames a sound (its emoji is the first word of the name). Same rights as removing it.
  server.patch('/v1/soundboard/:channelId/:clipId', async (request) => {
    const m = await member(request),
      id = clipId.parse((request.params as { clipId: string }).clipId),
      body = z
        .object({ name: z.string().trim().min(1).max(40) })
        .strict()
        .parse(request.body);
    return locked(m.communityId, async () => {
      const value = await load(m.communityId),
        entry = value.clips.find((c) => c.id === id);
      if (!entry) throw new StoatError(404, 'SOUNDBOARD_NOT_FOUND');
      if (entry.ownerId !== m.userId && !m.canManage)
        throw new StoatError(403, 'SOUNDBOARD_DELETE_DENIED');
      const renamed = { ...entry, name: body.name };
      await save(m.communityId, {
        version: 1,
        clips: value.clips.map((c) => (c.id === id ? renamed : c)),
      });
      return renamed;
    });
  });
  server.delete('/v1/soundboard/:channelId/:clipId', async (request) => {
    const m = await member(request),
      id = clipId.parse((request.params as { clipId: string }).clipId);
    return locked(m.communityId, async () => {
      const value = await load(m.communityId),
        entry = value.clips.find((c) => c.id === id);
      if (!entry) throw new StoatError(404, 'SOUNDBOARD_NOT_FOUND');
      if (entry.ownerId !== m.userId && !m.canManage)
        throw new StoatError(403, 'SOUNDBOARD_DELETE_DENIED');
      await save(m.communityId, { version: 1, clips: value.clips.filter((c) => c.id !== id) });
      await unlink(join(folder(m.communityId), `${id}.wav`));
      return { deleted: true };
    });
  });
}
