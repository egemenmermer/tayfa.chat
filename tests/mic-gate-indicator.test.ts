// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import {
  ConnectionState,
  LocalAudioTrack,
  RoomEvent,
  createLocalAudioTrack,
  type Room,
} from 'livekit-client';
import type { MicGateReport, MicGateSettings } from '../packages/media-providers/src/mic-gate';
type Callbacks = {
  gate?(report: MicGateReport | null): void;
  level?(report: MicGateReport): void;
  playing?(value: boolean): void;
};
const mixers = vi.hoisted(
  () =>
    [] as {
      callbacks: Callbacks;
      audio: { gate?: MicGateSettings; leveler?: boolean };
      playing: boolean;
      setGate: ReturnType<typeof vi.fn>;
      setLeveler: ReturnType<typeof vi.fn>;
    }[],
);
vi.mock('livekit-client', async (original) => ({
  ...(await original<typeof import('livekit-client')>()),
  createLocalAudioTrack: vi.fn(),
}));
vi.mock('../packages/media-providers/src/soundboard', () => ({
  SoundboardMixer: vi.fn(
    class {
      processedTrack = { readyState: 'live' };
      playing = false;
      setNoiseSuppression = vi.fn(async () => {});
      setInputLevel = vi.fn();
      setGate = vi.fn();
      setLeveler = vi.fn();
      destroy = vi.fn(async () => {});
      stop = vi.fn();
      play = vi.fn(async () => {});
      constructor(
        _noise: boolean,
        _mode: string,
        public callbacks: Callbacks,
        public audio = {},
      ) {
        mixers.push(this as never);
      }
    },
  ),
}));
import { LiveKitMediaProvider } from '../packages/media-providers/src/index';

afterEach(() => {
  vi.unstubAllGlobals();
  mixers.length = 0;
});
function fixture() {
  vi.stubGlobal(
    'AudioContext',
    class {
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
    },
  );
  const capture = { readyState: 'live', stop: vi.fn(), addEventListener: vi.fn() };
  const track = Object.assign(Object.create(LocalAudioTrack.prototype), {
    stop: vi.fn(),
    setAudioContext: vi.fn(),
    setProcessor: vi.fn(async () => {}),
    applyConstraints: vi.fn(async () => {}),
    mute: vi.fn(async () => {}),
    unmute: vi.fn(async () => {}),
  });
  Object.defineProperty(track, 'mediaStreamTrack', { value: capture, configurable: true });
  vi.mocked(createLocalAudioTrack).mockReset().mockResolvedValue(track);
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const emit = (event: string, ...args: unknown[]) =>
    listeners.get(event)?.forEach((cb) => cb(...args));
  const local = {
    identity: 'alice',
    name: 'Alice',
    isMicrophoneEnabled: false,
    isCameraEnabled: false,
    isScreenShareEnabled: false,
    isSpeaking: false,
    connectionQuality: 'excellent',
    trackPublications: new Map(),
    getTrackPublication: vi.fn(),
    setMicrophoneEnabled: vi.fn(async (enabled: boolean) => {
      local.isMicrophoneEnabled = enabled;
    }),
    publishTrack: vi.fn(async (published: LocalAudioTrack) => {
      local.isMicrophoneEnabled = true;
      local.getTrackPublication.mockReturnValue({ track: published });
    }),
  };
  const room = {
    localParticipant: local,
    remoteParticipants: new Map(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    }),
    connect: vi.fn(async () => emit(RoomEvent.ConnectionStateChanged, ConnectionState.Connected)),
    disconnect: vi.fn(async () => emit(RoomEvent.Disconnected)),
    removeAllListeners: vi.fn(),
    switchActiveDevice: vi.fn(async () => true),
    startAudio: vi.fn(async () => {}),
  };
  const provider = new LiveKitMediaProvider(() => room as unknown as Room);
  const me = () => provider.snapshot().participants.find((p) => p.local)!;
  return { provider, local, me };
}
const report = (open: boolean): MicGateReport => ({
  open,
  level: open ? -20 : -60,
  threshold: -38,
});

it('the own speaking ring follows the input gate, not the level meter', async () => {
  const { provider, local, me } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  await provider.publishMic();
  const mixer = mixers.at(-1)!;
  mixer.callbacks.gate?.(report(false));
  // The SDK's own detector says speaking (e.g. a keyboard burst), but nothing is sent: no ring.
  local.isSpeaking = true;
  provider.setListenerScope('scope'); // any state refresh
  expect(me().speaking).toBe(false);
  mixer.callbacks.gate?.(report(true));
  expect(me().speaking).toBe(true);
  mixer.callbacks.gate?.(report(false));
  expect(me().speaking).toBe(false);
  // A soundboard clip is sent past the gate, so the ring shows it too.
  mixer.playing = true;
  mixer.callbacks.playing?.(true);
  expect(me().speaking).toBe(true);
  mixer.playing = false;
  mixer.callbacks.playing?.(false);
  expect(me().speaking).toBe(false);
  await provider.disconnect();
});

it('mute and push-to-talk release win over an open gate', async () => {
  const { provider, me } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  await provider.publishMic();
  const mixer = mixers.at(-1)!;
  mixer.callbacks.gate?.(report(true));
  expect(me().speaking).toBe(true);
  await provider.mute(true); // push-to-talk release uses the same call
  expect(me().muted).toBe(true);
  expect(me().speaking).toBe(false);
  mixer.callbacks.gate?.(report(true));
  expect(me().speaking).toBe(false);
  await provider.disconnect();
});

it('without a gate (no AudioWorklet) the ring falls back to level detection', async () => {
  const { provider, local, me } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  await provider.publishMic();
  mixers.at(-1)!.callbacks.gate?.(null);
  local.isSpeaking = true;
  provider.setListenerScope('scope-2');
  expect(me().speaking).toBe(true);
  await provider.disconnect();
});

it('passes saved sensitivity and leveler to new and running microphones, and streams levels', async () => {
  const { provider } = fixture();
  provider.setInputGate({ auto: false, threshold: -90 });
  provider.setMicLeveler(false);
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  await provider.publishMic();
  const mixer = mixers.at(-1)!;
  // Clamped to the speaking-meter floor: nothing quieter than a listener's ring is ever sent.
  expect(mixer.audio).toEqual({ gate: { auto: false, threshold: -38 }, leveler: false });
  provider.setInputGate({ auto: true, threshold: -30 });
  provider.setMicLeveler(true);
  expect(mixer.setGate).toHaveBeenCalledWith({ auto: true, threshold: -30 });
  expect(mixer.setLeveler).toHaveBeenCalledWith(true);
  const levels = vi.fn();
  const stop = provider.subscribeInputMeter(levels);
  mixer.callbacks.level?.(report(true));
  expect(levels).toHaveBeenCalledWith(report(true));
  stop();
  mixer.callbacks.level?.(report(false));
  expect(levels).toHaveBeenCalledTimes(1);
  await provider.disconnect();
});
