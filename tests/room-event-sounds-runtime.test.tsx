// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useRooms } from '../apps/desktop/src/store';
import { useCommunity } from '../apps/desktop/src/community';
import { useVoiceContext } from '../apps/desktop/src/realtime';
import { setPersonalSoundMuted } from '../apps/desktop/src/personal-sound-mutes';
import {
  encodePersonalSoundWav,
  toBase64,
} from '../packages/shared-contracts/src/personal-sound-audio';
const f = vi.hoisted(() => ({
  snapshot: { status: 'not-configured', roomId: null, deafened: false, participants: [] } as any,
  listeners: new Set<() => void>(),
  play: vi.fn(),
  sink: vi.fn(),
  pause: vi.fn(),
  audios: [] as {
    src: string;
    volume: number;
    paused: boolean;
    ended?: boolean;
    onended: (() => void) | null;
  }[],
  urls: 0,
  revoked: [] as string[],
}));
vi.mock('../apps/desktop/src/runtime-sources', () => ({
  mediaProvider: () => ({
    snapshot: () => f.snapshot,
    subscribeState: (fn: () => void) => {
      f.listeners.add(fn);
      return () => f.listeners.delete(fn);
    },
  }),
}));
vi.mock('../apps/desktop/src/realtime', async () => {
  const { create } = await import('zustand');
  return { useVoiceContext: create(() => ({ channelId: null, busy: false })) };
});
import { RoomEventSounds } from '../apps/desktop/src/room-event-sounds';
const prefs = useRooms.getState().preferences,
  community = useCommunity.getState();
const clip = toBase64(encodePersonalSoundWav(new Float32Array(960).fill(0.1)));
const read = vi.fn<(channelId: string, userId: string, soundId: string) => Promise<string>>();
beforeEach(() => {
  localStorage.clear();
  f.play.mockClear();
  f.sink.mockClear();
  f.pause.mockClear();
  f.listeners.clear();
  f.audios = [];
  f.revoked = [];
  read.mockReset().mockResolvedValue(clip);
  f.snapshot = { status: 'not-configured', roomId: null, deafened: false, participants: [] };
  vi.stubGlobal(
    'Audio',
    class {
      volume = 0;
      paused = true;
      onended = null;
      setSinkId = f.sink;
      constructor(public src = '') {
        f.audios.push(this);
      }
      async play() {
        this.paused = false;
        f.play();
      }
      pause() {
        this.paused = true;
        f.pause();
      }
    },
  );
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL() {
        return `blob:local-${++f.urls}`;
      }
      static revokeObjectURL(url: string) {
        f.revoked.push(url);
      }
    },
  );
  useCommunity.setState({
    user: { id: 'self', username: 'Self', displayName: 'Self', avatar: null },
    serverUrl: 'https://test',
  });
  useRooms.setState({ preferences: { ...prefs, roomEventSounds: true, outputId: 'headphones' } });
  useVoiceContext.setState({ channelId: 'room', busy: false });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useRooms.setState({ preferences: prefs });
  useCommunity.setState(community);
});
async function connect() {
  await act(async () => {
    f.snapshot = {
      status: 'connected',
      roomId: 'room',
      deafened: false,
      participants: [
        { id: 'self', local: true },
        { id: 'friend', local: false },
      ],
    };
    for (const fn of f.listeners) fn();
  });
}
it('routes local cue to chosen output, coalesces initial events and cleans subscriptions', async () => {
  const view = render(<RoomEventSounds />);
  await connect();
  await waitFor(() => expect(f.play).toHaveBeenCalledTimes(1));
  expect(f.sink).toHaveBeenCalledWith('headphones');
  await act(async () => {
    for (const fn of f.listeners) {
      fn();
      fn();
    }
  });
  expect(f.play).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(f.listeners.size).toBe(0);
  expect(f.pause).toHaveBeenCalled();
});
it('disabled preference produces no local audio', async () => {
  useRooms.getState().setPreference('roomEventSounds', false);
  render(<RoomEventSounds />);
  await connect();
  expect(f.play).not.toHaveBeenCalled();
  expect(f.sink).not.toHaveBeenCalled();
});
it('deafened participant movements never play or publish cues', async () => {
  render(<RoomEventSounds />);
  await connect();
  f.play.mockClear();
  await act(async () => {
    f.snapshot = {
      ...f.snapshot,
      deafened: true,
      participants: [...f.snapshot.participants, { id: 'new', local: false }],
    };
    for (const fn of f.listeners) fn();
  });
  expect(f.play).not.toHaveBeenCalled();
  expect(f.pause).toHaveBeenCalled();
});

// Personal sounds run on the policy clock, so these tests drive time explicitly.
const tick = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
async function roster(people: { id: string; local?: boolean; sounds?: object }[], extra = {}) {
  await act(async () => {
    f.snapshot = {
      ...f.snapshot,
      status: 'connected',
      roomId: 'room',
      participants: people.map((p) => ({ local: false, ...p })),
      ...extra,
    };
    for (const fn of f.listeners) fn();
  });
  await tick();
}
const self = { id: 'self', local: true };
const played = () => f.audios.filter((a) => !a.paused).map((a) => a.volume);
async function start(bridge = true) {
  vi.useFakeTimers();
  if (bridge) vi.stubGlobal('rooms', { personalSounds: { read } });
  render(<RoomEventSounds />);
  await roster([self, { id: 'friend' }]);
  expect(played()).toEqual([0.55]);
  await tick(1000);
}
it('plays a joiner’s own sound at the personal gain and the listener’s effects level', async () => {
  useRooms.getState().setPreference('soundEffectsLevel', 0.5);
  vi.useFakeTimers();
  vi.stubGlobal('rooms', { personalSounds: { read } });
  render(<RoomEventSounds />);
  await roster([self, { id: 'friend' }]);
  expect(played()).toEqual([0.275]);
  await tick(1000);
  await roster([self, { id: 'friend' }, { id: 'ada', sounds: { enter: 'p.fanfar' } }]);
  expect(read).toHaveBeenCalledWith('room', 'ada', 'p.fanfar');
  expect(played()).toEqual([0.275, 0.225]);
  expect(f.audios[1].src).toMatch(/^blob:local-/);
  expect(f.sink).toHaveBeenLastCalledWith('headphones');
});
it('uses the classic cue for a muted person and when personal sounds are off', async () => {
  await start();
  act(() => setPersonalSoundMuted('ada', true));
  await roster([self, { id: 'friend' }, { id: 'ada', sounds: { enter: 'p.fanfar' } }]);
  expect(played()).toEqual([0.55, 0.55]);
  await tick(1000);
  act(() => useRooms.getState().setPreference('personalSounds', false));
  await roster([
    self,
    { id: 'friend' },
    { id: 'ada', sounds: { enter: 'p.fanfar' } },
    { id: 'bo', sounds: { enter: 'p.kapi' } },
  ]);
  expect(played()).toEqual([0.55, 0.55, 0.55]);
  expect(read).not.toHaveBeenCalled();
});
it('plays nothing, not even a personal sound, while deafened', async () => {
  await start();
  await roster([self, { id: 'friend' }, { id: 'ada', sounds: { enter: 'p.fanfar' } }], {
    deafened: true,
  });
  await tick(2000);
  expect(played()).toEqual([]);
  expect(read).not.toHaveBeenCalled();
});
it('keeps classic cues without the desktop bridge', async () => {
  await start(false);
  await roster([self, { id: 'friend' }, { id: 'ada', sounds: { enter: 'p.fanfar' } }]);
  expect(played()).toEqual([0.55, 0.55]);
});
it('replaces a clip that misses the deadline with the classic cue and never plays it late', async () => {
  let deliver!: (value: string) => void;
  read.mockImplementationOnce(() => new Promise((resolve) => (deliver = resolve)));
  await start();
  await roster([self, { id: 'friend' }, { id: 'ada', sounds: { enter: 'p.fanfar' } }]);
  await tick(1499);
  expect(played()).toEqual([0.55]);
  await tick(1);
  expect(played()).toEqual([0.55, 0.55]);
  deliver(clip);
  await tick(5000);
  expect(played()).toEqual([0.55, 0.55]);
});
it('falls back at once when a sound fails and does not ask again for a minute', async () => {
  read.mockRejectedValue(new Error('PERSONAL_SOUND_NOT_FOUND'));
  await start();
  await roster([self, { id: 'friend' }, { id: 'ada', sounds: { enter: 'p.fanfar' } }]);
  expect(played()).toEqual([0.55, 0.55]);
  await tick(6000);
  await roster([
    self,
    { id: 'friend' },
    { id: 'ada', sounds: { enter: 'p.fanfar' } },
    { id: 'bo', sounds: { enter: 'p.fanfar' } },
  ]);
  expect(played()).toHaveLength(3);
  expect(read).toHaveBeenCalledTimes(1);
  await tick(60_000);
  await roster([
    self,
    { id: 'friend' },
    { id: 'ada', sounds: { enter: 'p.fanfar' } },
    { id: 'bo', sounds: { enter: 'p.fanfar' } },
    { id: 'cy', sounds: { enter: 'p.fanfar' } },
  ]);
  expect(read).toHaveBeenCalledTimes(2);
});
it('warms up leave sounds so a departure plays its old attribute without waiting', async () => {
  await start();
  await roster([self, { id: 'friend', sounds: { leave: 'p.kapanis' } }, { id: 'ada' }]);
  await tick(1000);
  expect(read).toHaveBeenCalledWith('room', 'friend', 'p.kapanis');
  read.mockClear();
  await roster([self, { id: 'ada' }]);
  await tick(1499);
  expect(played()).toEqual([0.55, 0.55]);
  await tick(1);
  expect(played()).toEqual([0.55, 0.55, 0.45]);
  expect(read).not.toHaveBeenCalled();
});
it('skips muted people when warming up', async () => {
  act(() => setPersonalSoundMuted('friend', true));
  await start();
  await roster([self, { id: 'friend', sounds: { leave: 'p.kapanis' } }]);
  await tick(2000);
  expect(read).not.toHaveBeenCalled();
});
it('turning personal sounds off stops only personal playback', async () => {
  await start();
  await roster([self, { id: 'friend' }, { id: 'ada', sounds: { enter: 'p.fanfar' } }]);
  expect(played()).toEqual([0.55, 0.45]);
  act(() => useRooms.getState().setPreference('personalSounds', false));
  await tick();
  expect(played()).toEqual([0.55]);
});
it('an account change stops playback and revokes the previous account’s clips', async () => {
  await start();
  await roster([self, { id: 'friend' }, { id: 'ada', sounds: { enter: 'p.fanfar' } }]);
  const url = f.audios[1].src;
  expect(f.revoked).not.toContain(url);
  act(() =>
    useCommunity.setState({
      user: { id: 'other', username: 'Other', displayName: 'Other', avatar: null },
    }),
  );
  await tick();
  expect(f.revoked).toContain(url);
  expect(f.audios.slice(0, 2).map((a) => a.paused)).toEqual([true, true]);
});
it('leaving the room stops a personal clip and still plays the own leave cue', async () => {
  await start();
  await roster([self, { id: 'friend' }, { id: 'ada', sounds: { enter: 'p.fanfar' } }]);
  expect(played()).toEqual([0.55, 0.45]);
  await act(async () => {
    f.snapshot = { ...f.snapshot, status: 'not-configured', roomId: null, participants: [] };
    for (const fn of f.listeners) fn();
  });
  await tick();
  expect(played()).toEqual([0.55]);
  expect(f.audios.at(-1)?.paused).toBe(false);
});
/** The clip reaches its end the way a media element reports it. */
const finish = (audio: (typeof f.audios)[number]) => {
  audio.paused = true;
  audio.ended = true;
  audio.onended?.();
};
const later = (ms: number | null) => () =>
  new Promise<string>((resolve) => {
    if (ms !== null) setTimeout(() => resolve(clip), ms);
  });
it('a big room warms a bounded set once, and a departure outside it gets the whole hold', async () => {
  vi.useFakeTimers();
  vi.stubGlobal('rooms', { personalSounds: { read } });
  render(<RoomEventSounds />);
  const people = Array.from({ length: 25 }, (_, i) => ({
    id: `p${i}`,
    sounds: { leave: `p.s${i}` },
  }));
  // Speaking and quality updates resend the same roster all the time.
  for (let s = 0; s < 120; s++) {
    await roster([self, ...people]);
    await tick(1000);
  }
  expect(read).toHaveBeenCalledTimes(16);
  read.mockImplementationOnce(later(2000));
  await roster([self, ...people.filter((p) => p.id !== 'p20')]);
  expect(read).toHaveBeenCalledTimes(17);
  expect(read).toHaveBeenLastCalledWith('room', 'p20', 'p.s20');
  await tick(1999);
  expect(played()).toEqual([0.55]);
  await tick(1);
  expect(played()).toEqual([0.55, 0.45]);
});
it('a late clip still playing turns the next personal sound into the classic cue', async () => {
  await start();
  read.mockImplementationOnce(later(1450));
  const ada = { id: 'ada', sounds: { enter: 'p.fanfar' } };
  await roster([self, { id: 'friend' }, ada]);
  await tick(1450);
  expect(played()).toEqual([0.55, 0.45]);
  // The room window has passed, but a 4 s clip that started late is still playing.
  await tick(3550);
  await roster([self, { id: 'friend' }, ada, { id: 'bo', sounds: { enter: 'p.portal' } }]);
  expect(played()).toEqual([0.55, 0.45, 0.55]);
  finish(f.audios[1]);
  await tick(5000);
  await roster([
    self,
    { id: 'friend' },
    ada,
    { id: 'bo', sounds: { enter: 'p.portal' } },
    { id: 'cy', sounds: { enter: 'p.kapi' } },
  ]);
  expect(played()).toEqual([0.55, 0.55, 0.45]);
});
it.each([
  ['a pending clip', 1000],
  ['its classic stand-in', null],
])('%s never plays after the listener is disconnected', async (_, ms) => {
  await start();
  read.mockImplementationOnce(later(ms));
  await roster([self, { id: 'friend' }, { id: 'ada', sounds: { enter: 'p.fanfar' } }]);
  await tick(300);
  // LiveKit Disconnected (kick or network loss) keeps the room id with an empty roster.
  await roster([], { status: 'error' });
  const before = f.audios.length;
  await tick(5000);
  expect(f.audios.length).toBe(before);
  expect(played()).toEqual([]);
});
it('a listener reconnect inside the hold still plays the departure', async () => {
  await start();
  await roster([self, { id: 'friend' }, { id: 'ada', sounds: { leave: 'p.kapanis' } }]);
  await tick(20_000);
  await roster([self, { id: 'friend' }]);
  await tick(500);
  await roster([self, { id: 'friend' }], { status: 'reconnecting' });
  await tick(300);
  await roster([self, { id: 'friend' }]);
  await tick(699);
  expect(played()).toEqual([0.55, 0.55]);
  await tick(1);
  expect(played()).toEqual([0.55, 0.55, 0.45]);
});
it('a departure stays silent when the person is back in the reconnect baseline', async () => {
  await start();
  const ada = { id: 'ada', sounds: { leave: 'p.kapanis' } };
  await roster([self, { id: 'friend' }, ada]);
  await tick(20_000);
  await roster([self, { id: 'friend' }]);
  await tick(500);
  await roster([self], { status: 'reconnecting' });
  await tick(300);
  await roster([self, { id: 'friend' }, ada]);
  await tick(5000);
  expect(played()).toEqual([0.55, 0.55]);
  // She never left: her real departure later is neither a short stay nor a rejoin.
  await roster([self, { id: 'friend' }]);
  await tick(1500);
  expect(played()).toEqual([0.55, 0.55, 0.45]);
});
it('cooldowns survive a reconnect', async () => {
  await start();
  const ada = { id: 'ada', sounds: { enter: 'p.fanfar' } };
  await roster([self, { id: 'friend' }, ada]);
  expect(played()).toEqual([0.55, 0.45]);
  finish(f.audios[1]);
  await tick(6000);
  await roster([self, { id: 'friend' }, ada], { status: 'reconnecting' });
  await tick(300);
  await roster([self, { id: 'friend' }, ada]);
  await tick(14_000);
  await roster([self, { id: 'friend' }]);
  await tick(40_000);
  // Past the rejoin window but inside the two-minute cooldown of her first entrance.
  await roster([self, { id: 'friend' }, ada]);
  expect(played()).toEqual([0.55, 0.55, 0.55]);
});
it('a classic stand-in and a classic cue inside the coalescing window play once', async () => {
  read.mockImplementationOnce(later(null));
  await start();
  const ada = { id: 'ada', sounds: { enter: 'p.fanfar' } };
  await roster([self, { id: 'friend' }, ada]);
  await tick(1500);
  expect(played()).toEqual([0.55, 0.55]);
  await tick(100);
  await roster([self, { id: 'friend' }, ada, { id: 'bo' }]);
  expect(played()).toEqual([0.55, 0.55]);
  await tick(400);
  await roster([self, { id: 'friend' }, ada, { id: 'bo' }, { id: 'cy' }]);
  expect(played()).toEqual([0.55, 0.55, 0.55]);
});

it('plays the stream cue when someone in the room starts or stops sharing, on its own switch', async () => {
  const { voiceCueSource } = await import('../apps/desktop/src/voice-cues');
  render(<RoomEventSounds />);
  await connect();
  await waitFor(() => expect(f.play).toHaveBeenCalledTimes(1));
  const share = async (screen: boolean) =>
    act(async () => {
      f.snapshot = {
        ...f.snapshot,
        participants: [
          { id: 'self', local: true },
          { id: 'friend', local: false, screen },
        ],
      };
      for (const fn of f.listeners) fn();
    });
  // Room join and leave sounds off: streams keep their own switch.
  useRooms.setState({
    preferences: { ...useRooms.getState().preferences, roomEventSounds: false },
  });
  await share(true);
  await waitFor(() => expect(f.play).toHaveBeenCalledTimes(2));
  expect(f.audios.at(-1)?.src).toBe(voiceCueSource('stream-start'));
  useRooms.setState({ preferences: { ...useRooms.getState().preferences, voiceCues: false } });
  await share(false);
  await act(async () => {});
  expect(f.play).toHaveBeenCalledTimes(2);
});
