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
import { migratePreferences, normalizeScreenQuality, useRooms } from '../apps/desktop/src/store';

it('remembers the viewer stream quality and keeps only valid choices', () => {
  expect(useRooms.getState().preferences.screenQuality).toBe('source');
  setScreenQuality(720);
  expect(f.quality).toHaveBeenCalledWith(720);
  expect(useRooms.getState().preferences.screenQuality).toBe(720);
  setScreenQuality('auto');
  expect(useRooms.getState().preferences.screenQuality).toBe('auto');
  expect(normalizeScreenQuality(1080)).toBe(1080);
  for (const bad of ['720', 0, -1, 12.5, 99999, null, 'high'])
    expect(normalizeScreenQuality(bad)).toBe('source');
  expect(normalizeScreenQuality('auto')).toBe('auto');
  expect(normalizeScreenQuality('source')).toBe('source');
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
  expect(prefs.screenQuality).toBe('source');
  expect(prefs.memberPanel).toBe(true);
});

it('an rc.36 install that stored the old Otomatik default moves to Kaynak (H10)', async () => {
  localStorage.setItem(
    'rooms-local-v1',
    JSON.stringify({
      state: { preferences: { screenQuality: 'auto', voiceCues: false } },
      version: 1,
    }),
  );
  await useRooms.persist.rehydrate();
  expect(useRooms.getState().preferences.screenQuality).toBe('source');
  expect(useRooms.getState().preferences.voiceCues).toBe(false);
  // A line cap survives, and from version 2 on Otomatik is a real choice that stays.
  expect(migratePreferences({ preferences: { screenQuality: 720 } }, 1)).toEqual({
    preferences: { screenQuality: 720 },
  });
  localStorage.setItem(
    'rooms-local-v1',
    JSON.stringify({ state: { preferences: { screenQuality: 'auto' } }, version: 2 }),
  );
  await useRooms.persist.rehydrate();
  expect(useRooms.getState().preferences.screenQuality).toBe('auto');
});
