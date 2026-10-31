import type { QueryClient } from '@tanstack/react-query';
import type { SocialMember } from '@rooms/social';
import { queryClient } from './query-client';

/** The panel treats a list younger than this as current: reopening it does not refetch. */
export const ROOM_MEMBERS_STALE_MS = 30000;

export const roomMembersKey = (
  serverUrl: string | null | undefined,
  userId: string | null | undefined,
  spaceId: string | null | undefined,
) => ['room-members', serverUrl ?? '', userId ?? '', spaceId ?? ''] as const;

/** One community-wide member fetch shared by the panel, its prefetch and background refreshes. */
export function roomMembersQuery(
  serverUrl: string | null | undefined,
  userId: string | null | undefined,
  spaceId: string,
  load: (spaceId: string) => Promise<SocialMember[]> = (id) => window.rooms!.social.members(id),
) {
  return {
    queryKey: roomMembersKey(serverUrl, userId, spaceId),
    queryFn: () => load(spaceId),
    staleTime: ROOM_MEMBERS_STALE_MS,
    retry: false,
  };
}

/** Warms the cache before the panel opens (toolbar hover/focus); skipped while the cache is fresh. */
export function prefetchRoomMembers(
  serverUrl: string | null | undefined,
  userId: string | null | undefined,
  spaceId: string | null | undefined,
  client: QueryClient = queryClient,
) {
  if (!userId || !spaceId || !window.rooms?.social.members) return;
  void client.prefetchQuery(roomMembersQuery(serverUrl, userId, spaceId));
}

/**
 * The full account of a community member (username and tag) from the shared member list.
 * Voice participants only carry an id and a display name, which is not enough to send a
 * friend request. Null when the list cannot be read or the id is not a member.
 */
export async function memberAccount(
  serverUrl: string | null | undefined,
  userId: string | null | undefined,
  spaceId: string | null | undefined,
  memberId: string,
  client: QueryClient = queryClient,
  load?: (spaceId: string) => Promise<SocialMember[]>,
) {
  if (!userId || !spaceId || (!load && !window.rooms?.social.members)) return null;
  try {
    const members = await client.fetchQuery(roomMembersQuery(serverUrl, userId, spaceId, load));
    return members.find((member) => member.user.id === memberId)?.user ?? null;
  } catch {
    return null;
  }
}
