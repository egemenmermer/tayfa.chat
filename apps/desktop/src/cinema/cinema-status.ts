import { useEffect } from 'react';
import { create } from 'zustand';
import type { CinemaStatus } from '../../../../packages/community-cinema/src/types';
import { useCommunity } from '../community';
import { cinemaErrorText, getCinemaBridge } from './cinema-bridge';

interface Entry {
  status: CinemaStatus | null;
  error: string | null;
  loading: boolean;
  fetchedAt: number;
}
interface StatusStore {
  entries: Record<string, Entry>;
  put(communityId: string, entry: Partial<Entry>): void;
}

const blank: Entry = { status: null, error: null, loading: false, fetchedAt: 0 };
const useStatusStore = create<StatusStore>((set) => ({
  entries: {},
  put: (communityId, entry) =>
    set((state) => ({
      entries: {
        ...state.entries,
        [communityId]: { ...(state.entries[communityId] ?? blank), ...entry },
      },
    })),
}));

const inflight = new Map<string, Promise<CinemaStatus | null>>();
const cacheKey = (communityId: string) => {
  const { serverUrl, user } = useCommunity.getState();
  return JSON.stringify([serverUrl, user?.id ?? null, communityId]);
};

/** Reads the community's cinema status once; concurrent callers share the request. */
export function refreshCinemaStatus(
  communityId: string,
  maxAgeMs = 0,
): Promise<CinemaStatus | null> {
  const key = cacheKey(communityId);
  const bridge = getCinemaBridge();
  const store = useStatusStore.getState();
  if (!bridge) {
    store.put(key, { status: null, error: null, loading: false, fetchedAt: Date.now() });
    return Promise.resolve(null);
  }
  const cached = store.entries[key];
  if (maxAgeMs > 0 && cached?.fetchedAt && Date.now() - cached.fetchedAt < maxAgeMs)
    return Promise.resolve(cached.status);
  const running = inflight.get(key);
  if (running) return running;
  store.put(key, { loading: true });
  const requestedAt = Date.now();
  const task = bridge
    .status(communityId)
    .then((status) => {
      useStatusStore
        .getState()
        .put(key, { status, error: null, loading: false, fetchedAt: requestedAt });
      return status;
    })
    .catch((error) => {
      useStatusStore.getState().put(key, {
        error: cinemaErrorText(error),
        loading: false,
        fetchedAt: requestedAt,
      });
      return null;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}

/** Applies a status a mutation returned, so every view updates at once. */
export function acceptCinemaStatus(status: CinemaStatus) {
  useStatusStore.getState().put(cacheKey(status.communityId), {
    status,
    error: null,
    loading: false,
    fetchedAt: Date.now(),
  });
}

/**
 * The active community's cinema: its hall channel, whether a source is connected and whether
 * the current user owns it. Refreshes on mount, every `everyMs` (faster while importing).
 */
export function useCommunityCinema(everyMs = 60_000) {
  const communityId = useCommunity((s) => s.activeSpaceId);
  const account = useCommunity((s) => JSON.stringify([s.serverUrl, s.user?.id ?? null]));
  const key = communityId ? cacheKey(communityId) : null;
  const entry = useStatusStore((s) => (key ? s.entries[key] : undefined)) ?? blank;
  const importing = !!entry.status?.importing && !entry.status.importing.finishedAt;
  useEffect(() => {
    if (!communityId) return;
    const interval = importing ? 2000 : everyMs;
    const poll = () =>
      void refreshCinemaStatus(
        communityId,
        document.hidden ? Math.max(interval, 60_000) : interval,
      );
    const visible = () => {
      if (!document.hidden) poll();
    };
    poll();
    const timer = setInterval(poll, interval);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [communityId, account, everyMs, importing]);
  return {
    communityId,
    hallId: entry.status?.hallChannelId ?? null,
    status: entry.status,
    error: entry.error,
    loading: entry.loading && !entry.status,
    available: !!getCinemaBridge(),
    refresh: () => (communityId ? refreshCinemaStatus(communityId) : Promise.resolve(null)),
  };
}
