import { useEffect, useState } from 'react';
import type { DesktopBridge } from '@rooms/contracts';
import { useRealtime } from './realtime';
import { useCommunity } from './community';
type Directory = Awaited<ReturnType<NonNullable<DesktopBridge['media']['directory']>>>['rooms'];
/** Read-only SFU presence: never creates a grant, subscribes to audio or joins a room. */
export function useVoiceDirectory(channelIds: string[]) {
  const realtime = useRealtime();
  const userId = useCommunity((s) => s.user?.id),
    server = useCommunity((s) => s.serverUrl);
  const ids = [...new Set(channelIds)].sort().slice(0, 32).join(',');
  const scope = `${server}:${userId}:${ids}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; rooms: Directory; error: boolean }>({
    scope: '',
    rooms: [],
    error: false,
  });
  useEffect(() => {
    if (!userId || !ids || !window.rooms?.media.directory) return;
    // Fixtures must not query live services with synthetic IDs.
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture')) return;
    let active = true,
      running = false,
      epoch = 0,
      timer: ReturnType<typeof setTimeout>;
    const invalidate = (event: Event) => {
      const denied = new Set(
        (event as CustomEvent<{ channelIds: string[] }>).detail?.channelIds ?? [],
      );
      epoch++;
      setSnapshot((current) => ({
        ...current,
        rooms: current.rooms.filter((room) => !denied.has(room.channelId)),
      }));
    };
    window.addEventListener('rooms:channel-access-invalidated', invalidate);
    const read = async () => {
      if (!active || running) return;
      running = true;
      const requestEpoch = epoch;
      try {
        const result = await window.rooms!.media.directory!(ids.split(','));
        if (active && requestEpoch === epoch)
          setSnapshot({ scope, rooms: result.rooms, error: false });
      } catch {
        if (active && requestEpoch === epoch) setSnapshot({ scope, rooms: [], error: true });
      } finally {
        running = false;
        if (active) timer = setTimeout(() => void read(), document.hidden ? 30_000 : 5000);
      }
    };
    const visible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void read();
      }
    };
    document.addEventListener('visibilitychange', visible);
    void read();
    return () => {
      active = false;
      clearTimeout(timer);
      window.removeEventListener('rooms:channel-access-invalidated', invalidate);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [scope, userId, ids]);
  return snapshot.scope === scope
    ? {
        ...snapshot,
        rooms: snapshot.rooms.map((room) => ({
          ...room,
          participants: room.participants.filter(
            (person) =>
              person.id !== userId ||
              (room.channelId === realtime.channelId &&
                ['connected', 'reconnecting'].includes(realtime.status)),
          ),
        })),
        loading: false,
      }
    : { scope, rooms: [] as Directory, error: false, loading: true };
}
