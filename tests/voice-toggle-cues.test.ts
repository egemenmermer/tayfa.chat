// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
const f = vi.hoisted(() => ({
  state: { status: 'connected', muted: false, deafened: false } as Record<string, unknown>,
  mute: vi.fn(async () => {}),
  deafen: vi.fn(async () => {}),
  cue: vi.fn(),
}));
vi.mock('../apps/desktop/src/runtime-sources', () => ({
  mediaBridge: () => ({}),
  mediaProvider: () => ({
    snapshot: () => f.state,
    subscribeState: () => () => {},
    mute: f.mute,
    deafen: f.deafen,
  }),
}));
vi.mock('../apps/desktop/src/voice-cues', () => ({ playVoiceCue: f.cue }));
import { toggleDeafen, toggleMic } from '../apps/desktop/src/realtime';

beforeEach(() => {
  window.rooms = {} as any;
  f.state = { status: 'connected', muted: false, deafened: false };
  vi.clearAllMocks();
});

it('confirms microphone and deafen toggles with their own cue', async () => {
  await toggleMic();
  expect(f.mute).toHaveBeenCalledWith(true);
  expect(f.cue).toHaveBeenLastCalledWith('mic-off');
  f.state = { ...f.state, muted: true };
  await toggleMic();
  expect(f.cue).toHaveBeenLastCalledWith('mic-on');
  await toggleDeafen();
  expect(f.cue).toHaveBeenLastCalledWith('deafen-on');
  f.state = { ...f.state, deafened: true };
  await toggleDeafen();
  expect(f.cue).toHaveBeenLastCalledWith('deafen-off');
  expect(f.cue).toHaveBeenCalledTimes(4);
});

it('plays nothing when the toggle failed', async () => {
  f.mute.mockRejectedValueOnce(new Error('no device'));
  await expect(toggleMic()).rejects.toThrow('no device');
  expect(f.cue).not.toHaveBeenCalled();
});
