// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({ deafened: false, play: vi.fn(), audios: [] as { src: string }[] }));
vi.mock('../apps/desktop/src/runtime-sources', () => ({
  mediaProvider: () => ({ snapshot: () => ({ deafened: f.deafened }) }),
}));
import {
  StreamCueTracker,
  ViewerCueTracker,
  playVoiceCue,
  voiceCueAudible,
  voiceCueSource,
} from '../apps/desktop/src/voice-cues';
import { useRooms } from '../apps/desktop/src/store';
import { useCommunity } from '../apps/desktop/src/community';

const prefs = useRooms.getState().preferences,
  community = useCommunity.getState();
beforeEach(() => {
  f.deafened = false;
  f.play.mockClear();
  f.audios = [];
  vi.stubGlobal(
    'Audio',
    class {
      volume = 0;
      constructor(public src = '') {
        f.audios.push(this);
      }
      async play() {
        f.play();
      }
    },
  );
  useCommunity.setState({
    user: { id: 'self', username: 'Self', displayName: 'Self', avatar: null },
  });
  useRooms.setState({ preferences: { ...prefs, voiceCues: true, soundEffectsLevel: 1 } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  useRooms.setState({ preferences: prefs });
  useCommunity.setState(community);
});

const person = (id: string, screen = false, local = false) => ({ id, screen, local });

it('cues a stream that starts or stops in the same room, never a baseline', () => {
  const tracker = new StreamCueTracker();
  // Joining a room where someone already shares is a baseline.
  expect(tracker.update('room', [person('self', false, true), person('ece', true)])).toEqual([]);
  expect(tracker.update('room', [person('self', false, true), person('ece', false)])).toEqual([
    { kind: 'stream-stop', actor: 'ece', local: false },
  ]);
  expect(tracker.update('room', [person('self', true, true), person('ece', false)])).toEqual([
    { kind: 'stream-start', actor: 'self', local: true },
  ]);
  // A newcomer who already shares, and a sharer who leaves, get the room's enter and leave cues.
  expect(tracker.update('room', [person('self', true, true), person('can', true)])).toEqual([]);
  // A music bot's share is never a person's stream.
  expect(
    tracker.update('room', [
      person('self', true, true),
      person('can', true),
      person('rooms-music-1'),
    ]),
  ).toEqual([]);
  expect(
    tracker.update('room', [
      person('self', true, true),
      person('can', true),
      person('rooms-music-1', true),
    ]),
  ).toEqual([]);
});

it('starts over after a disconnect or a room switch', () => {
  const tracker = new StreamCueTracker();
  tracker.update('room', [person('ece')]);
  expect(tracker.update(null, [person('ece', true)])).toEqual([]);
  expect(tracker.update('room', [person('ece', true)])).toEqual([]);
  expect(tracker.update('other', [person('ece', false)])).toEqual([]);
  expect(tracker.update('other', [person('ece', true)])).toEqual([
    { kind: 'stream-start', actor: 'ece', local: false },
  ]);
});

it('own toggles confirm even while deafened; stream cues follow deafen and the switch', () => {
  f.deafened = true;
  expect(voiceCueAudible('deafen-on')).toBe(true);
  expect(voiceCueAudible('mic-off')).toBe(true);
  expect(voiceCueAudible('stream-start')).toBe(false);
  expect(voiceCueAudible('viewer-join')).toBe(false);
  f.deafened = false;
  expect(voiceCueAudible('viewer-join')).toBe(true);
  expect(voiceCueAudible('stream-start')).toBe(true);
  useRooms.setState({ preferences: { ...prefs, voiceCues: false } });
  expect(voiceCueAudible('mic-on')).toBe(false);
  useRooms.setState({ preferences: { ...prefs, voiceCues: true, soundEffectsLevel: 0 } });
  expect(voiceCueAudible('mic-on')).toBe(false);
  useRooms.setState({ preferences: { ...prefs, voiceCues: true } });
  useCommunity.setState({ user: null });
  expect(voiceCueAudible('mic-on')).toBe(false);
});

it('plays each cue as its own short clip and collapses quick repeats', async () => {
  playVoiceCue('mic-on');
  playVoiceCue('mic-on');
  playVoiceCue('mic-off');
  await Promise.resolve();
  expect(f.play).toHaveBeenCalledTimes(2);
  expect(f.audios[0].src).toBe(voiceCueSource('mic-on'));
  expect(f.audios[1].src).toBe(voiceCueSource('mic-off'));
  expect(voiceCueSource('mic-on')).not.toBe(voiceCueSource('mic-off'));
});

it('cues viewers who start or stop watching your own share, never a baseline (H03)', () => {
  const tracker = new ViewerCueTracker();
  const me = (screen: boolean) => ({ id: 'me', local: true, screen, watching: null });
  const ece = (watching: string | null) => ({ id: 'ece', local: false, screen: false, watching });
  const can = (watching: string | null) => ({ id: 'can', local: false, screen: false, watching });
  // Not sharing: nothing to watch.
  expect(tracker.update('room', [me(false), ece('me')])).toEqual([]);
  // Starting a share is a baseline, even if someone already points at you.
  expect(tracker.update('room', [me(true), ece('me'), can(null)])).toEqual([]);
  expect(tracker.update('room', [me(true), ece('me'), can('me')])).toEqual([
    { kind: 'viewer-join', viewer: 'can' },
  ]);
  // Watching someone else, or leaving the room, ends watching you.
  expect(tracker.update('room', [me(true), ece('other'), can('me')])).toEqual([
    { kind: 'viewer-leave', viewer: 'ece' },
  ]);
  expect(tracker.update('room', [me(true)])).toEqual([{ kind: 'viewer-leave', viewer: 'can' }]);
  // Music bots and other rooms never count; a disconnect starts over.
  expect(
    tracker.update('room', [
      me(true),
      { id: 'rooms-music-1', local: false, screen: false, watching: 'me' },
    ]),
  ).toEqual([]);
  expect(tracker.update(null, [me(true), ece('me')])).toEqual([]);
  expect(tracker.update('room', [me(true), ece('me')])).toEqual([]);
});
