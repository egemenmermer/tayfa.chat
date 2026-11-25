import { createHash } from 'node:crypto';
import { StoatClient, StoatError } from '@rooms/stoat';
import { StoatAuthorizationReader } from '../access/stoat-authorization';
import { identityCache } from '../shared/identity-cache';
import {
  stoatChannelPermissions,
  stoatCommunityAdmin,
  StoatPermissions,
  type StoatChannel,
  type StoatMember,
  type StoatServer,
} from '../access/stoat-permissions';

export type CinemaIdentity = { userId: string; displayName: string };

export interface CinemaAuthority {
  /** Current member of the community; `isOwner` (owner or owner-equivalent admin) gates account changes. */
  community(token: string, communityId: string): Promise<CinemaIdentity & { isOwner: boolean }>;
  /** Someone who can see the channel; returns the community it belongs to. */
  channel(
    token: string,
    channelId: string,
  ): Promise<CinemaIdentity & { communityId: string; isOwner: boolean }>;
  close(): Promise<void>;
}

/** Same checks as Access and Activities: upstream REST for the user, the read-only Mongo reader for membership. */
export function stoatAuthority(options: { stoatUrl: string; mongoUrl?: string }): CinemaAuthority {
  const reader = options.mongoUrl ? new StoatAuthorizationReader(options.mongoUrl) : null;
  const client = (token: string) =>
    new StoatClient(options.stoatUrl, token, {
      trustedInternalOrigin: true,
      apiRoot: !new URL(options.stoatUrl).pathname.startsWith('/api'),
    });
  // Status and relay requests repeat; Stoat's `/users/@me` limit is shared by the whole container.
  const identify = identityCache((token: string) => client(token).getCurrentUser());
  return {
    async community(token, communityId) {
      const stoat = client(token);
      const user = await identify(token);
      const context = reader ? await reader.community(communityId, user.id) : null;
      const server = (context?.server ??
        (await stoat.getServer(communityId))) as unknown as StoatServer;
      const member = (context?.member ??
        (await stoat.getMember(communityId, user.id))) as unknown as StoatMember;
      return {
        userId: user.id,
        displayName: user.displayName,
        isOwner: stoatCommunityAdmin(server, member, user.id),
      };
    },
    async channel(token, channelId) {
      const stoat = client(token);
      const user = await identify(token);
      const context = reader ? await reader.read(channelId, user.id) : null;
      const channel = (context?.channel ??
        (await stoat.getChannel(channelId))) as unknown as StoatChannel;
      if (typeof channel.server !== 'string') throw new StoatError(403, 'ROOM_ACCESS_DENIED');
      const [server, member] = context
        ? [context.server, context.member]
        : await Promise.all([
            stoat.getServer(channel.server),
            stoat.getMember(channel.server, user.id),
          ]);
      const permissions = stoatChannelPermissions(
        server as unknown as StoatServer,
        channel,
        member as unknown as StoatMember,
        user.id,
      );
      if (!(permissions & StoatPermissions.VIEW_CHANNEL))
        throw new StoatError(403, 'ROOM_ACCESS_DENIED');
      return {
        userId: user.id,
        displayName: user.displayName,
        communityId: channel.server,
        isOwner: stoatCommunityAdmin(
          server as unknown as StoatServer,
          member as unknown as StoatMember,
          user.id,
        ),
      };
    },
    async close() {
      await reader?.close();
    },
  };
}

/**
 * Remembers successful answers for a short time. Browsing loads dozens of posters and
 * guide rows per second; without this every one costs Stoat REST calls on the member's
 * own rate limit. Failures are never cached, so a revoked member is refused at once
 * when the entry expires (at most `ttlMs`).
 */
export function cachedAuthority(
  inner: CinemaAuthority,
  ttlMs = 20_000,
  max = 2000,
): CinemaAuthority {
  const entries = new Map<string, { at: number; value: Promise<unknown> }>();
  const remember = <T>(key: string, load: () => Promise<T>): Promise<T> => {
    const now = Date.now();
    const hit = entries.get(key);
    if (hit && now - hit.at < ttlMs) return hit.value as Promise<T>;
    const value = load();
    entries.delete(key);
    entries.set(key, { at: now, value });
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    while (entries.size > max) entries.delete(entries.keys().next().value!);
    return value;
  };
  const key = (token: string, kind: string, id: string) =>
    `${createHash('sha256').update(token).digest('base64url')}:${kind}:${id}`;
  return {
    community: (token, communityId) =>
      remember(key(token, 'community', communityId), () => inner.community(token, communityId)),
    channel: (token, channelId) =>
      remember(key(token, 'channel', channelId), () => inner.channel(token, channelId)),
    close: () => inner.close(),
  };
}
