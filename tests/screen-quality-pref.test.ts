// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ quality: vi.fn() }));
vi.mock('../apps/desktop/src/runtime-sources', () => ({
  mediaBridge: () => ({}),
  mediaProvider: () => ({
    snapshot: () => ({ status: 'connected' }),
    subscribeState: () => () => {},
    setScreenQuality: f.quality,
  }),
}));
import { setScreenQuality } from '../apps/desktop/src/realtime';
import { normalizeScreenQuality, useRooms } from '../apps/desktop/src/store';

it('remembers the viewer stream quality and keeps only valid choices', () => {
  expect(useRooms.getState().preferences.screenQuality).toBe('auto');
  setScreenQuality(720);
  expect(f.quality).toHaveBeenCalledWith(720);
  expect(useRooms.getState().preferences.screenQuality).toBe(720);
  setScreenQuality('auto');
  expect(useRooms.getState().preferences.screenQuality).toBe('auto');
  expect(normalizeScreenQuality(1080)).toBe(1080);
  for (const bad of ['720', 0, -1, 12.5, 99999, null, 'high'])
    expect(normalizeScreenQuality(bad)).toBe('auto');
  useRooms.getState().setPreferences({ ...useRooms.getState().preferences, screenQuality: 1440 });
  expect(useRooms.getState().preferences.screenQuality).toBe(1440);
});

it('an rc.35 install without the new keys rehydrates with their defaults', async () => {
  localStorage.setItem(
    'rooms-local-v1',
    JSON.stringify({
      state: { preferences: { roomEventSounds: false, showFriends: false } },
      version: 1,
    }),
  );
  await useRooms.persist.rehydrate();
  const prefs = useRooms.getState().preferences;
  expect(prefs.roomEventSounds).toBe(false);
  expect(prefs.voiceCues).toBe(true);
  expect(prefs.screenQuality).toBe('auto');
  expect(prefs.memberPanel).toBe(true);
});
