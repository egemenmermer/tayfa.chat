import { registerYouTubePlayer } from './youtube-player';
import { Pool } from 'pg';
import { StoatAuthorizationReader } from '../access/stoat-authorization';
import { createActivityServer } from './server';
import { FileActivityRepository } from './repository';
import { PostgresActivityRepository } from './postgres';
import { FileStudioStore, PostgresStudioStore } from './studio';
import { join } from 'node:path';
import { StoatClient, StoatError } from '@rooms/stoat';
import {
  stoatChannelPermissions,
  StoatPermissions,
  type StoatServer,
  type StoatChannel,
  type StoatMember,
} from '../access/stoat-permissions';
async function main() {
  const pool = process.env.ROOMS_ACTIVITY_DATABASE_URL
    ? new Pool({ connectionString: process.env.ROOMS_ACTIVITY_DATABASE_URL })
    : null;
  const repository = pool
    ? new PostgresActivityRepository(pool)
    : await FileActivityRepository.open(process.env.ROOMS_ACTIVITY_DATA ?? '.local/activities');
  if (repository instanceof PostgresActivityRepository) await repository.initialize();
  const studio = pool
    ? new PostgresStudioStore(pool)
    : new FileStudioStore(join(process.env.ROOMS_ACTIVITY_DATA ?? '.local/activities', 'studio'));
  if (studio instanceof PostgresStudioStore) await studio.initialize();
  const reader = process.env.ROOMS_SOCIAL_READ_MONGO_URL
    ? new StoatAuthorizationReader(process.env.ROOMS_SOCIAL_READ_MONGO_URL)
    : null;
  const server = await createActivityServer({
    repository,
    studio,
    authorize: async (token, roomId) => {
      const client = new StoatClient(
        process.env.STOAT_INTERNAL_URL ?? 'http://127.0.0.1:3021/api',
        token,
        {
          trustedInternalOrigin: true,
          apiRoot: !new URL(
            process.env.STOAT_INTERNAL_URL ?? 'http://127.0.0.1:3021/api',
          ).pathname.startsWith('/api'),
        },
      );
      const user = await client.getCurrentUser();
      const context = reader ? await reader.read(roomId, user.id) : null;
      const channel = context?.channel ?? (await client.getChannel(roomId));
      if (typeof channel.server !== 'string') throw new StoatError(403, 'ROOM_ACCESS_DENIED');
      const [server, member] = context
        ? [context.server, context.member]
        : await Promise.all([
            client.getServer(channel.server),
            client.getMember(channel.server, user.id),
          ]);
      const permissions = stoatChannelPermissions(
        server as StoatServer,
        channel as StoatChannel,
        member as StoatMember,
        user.id,
      );
      if (!(permissions & StoatPermissions.VIEW_CHANNEL))
        throw new StoatError(403, 'ROOM_ACCESS_DENIED');
      return {
        userId: user.id,
        displayName: user.displayName,
        canControl: !!(permissions & (1n << 22n)),
        canCreate: !!(permissions & (1n << 22n)),
      };
    },
  });
  server.addHook('onClose', async () => {
    await reader?.close();
  });
  registerYouTubePlayer(server);
  await server.listen({
    host: process.env.SERVICE_HOST ?? '127.0.0.1',
    port: Number(process.env.ACTIVITY_PORT ?? 3031),
  });
  console.log('ROOMS Activity service listening. Logs exclude credentials.');
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, () => void server.close().then(() => pool?.end()));
}
void main().catch(() => {
  console.error('ROOMS Activity startup failed. Check upstream and database configuration.');
  process.exitCode = 1;
});
