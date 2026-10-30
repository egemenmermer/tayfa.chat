// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ConnectionState,
  LocalAudioTrack,
  RoomEvent,
  Track,
  createLocalAudioTrack,
  type Room,
} from 'livekit-client';
import { LiveKitMediaProvider } from '../packages/media-providers/src/index';
import { SoundboardMixer } from '../packages/media-providers/src/soundboard';

// Capture and the DSP graph are isolated; only the hand-off between two rooms is under test.
vi.mock('livekit-client', async (original) => ({
  ...(await original<typeof import('livekit-client')>()),
  createLocalAudioTrack: vi.fn(),
}));
vi.mock('../packages/media-providers/src/soundboard', () => ({
  SoundboardMixer: vi.fn(
    class {
      processedTrack = { readyState: 'live' };
      setNoiseSuppression = vi.fn(async () => {});
      setInputLevel = vi.fn();
      destroy = vi.fn(async () => {});
      stop = vi.fn();
      play = vi.fn(async () => {});
    },
  ),
}));

function capture() {
  const processed = { readyState: 'live', stop: vi.fn(), addEventListener: vi.fn() };
  const track = Object.assign(Object.create(LocalAudioTrack.prototype), {
    stop: vi.fn(() => {
      processed.readyState = 'ended';
    }),
    setAudioContext: vi.fn(),
    setProcessor: vi.fn(async () => {}),
    applyConstraints: vi.fn(async () => {}),
    mute: vi.fn(async () => {}),
    unmute: vi.fn(async () => {}),
    getSourceTrackSettings: vi.fn(() => ({ deviceId: 'default' })),
  });
  Object.defineProperty(track, 'mediaStreamTrack', { value: processed, configurable: true });
  return track as LocalAudioTrack & { stop: ReturnType<typeof vi.fn> };
}

function makeRoom() {
  const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
  const emit = (event: string, ...args: unknown[]) =>
    listeners.get(event)?.forEach((cb) => cb(...args));
  const local = {
    identity: 'onur',
    name: 'Onur',
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
    publishData: vi.fn(async () => {}),
    publishTrack: vi.fn(async (track: LocalAudioTrack) => {
      local.isMicrophoneEnabled = true;
      local.getTrackPublication.mockReturnValue({ track });
      local.trackPublications.set('mic', { track });
    }),
  };
  return {
    localParticipant: local,
    remoteParticipants: new Map(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    }),
    connect: vi.fn(async () => emit(RoomEvent.ConnectionStateChanged, ConnectionState.Connected)),
    disconnect: vi.fn(async () => {}),
    removeAllListeners: vi.fn(),
    switchActiveDevice: vi.fn(async () => true),
  };
}

let enumerate: ReturnType<typeof vi.fn>;
let devices: { kind: string; deviceId: string; groupId: string; label: string }[];
function setup() {
  vi.stubGlobal(
    'AudioContext',
    class {
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
    },
  );
  devices = [];
  enumerate = vi.fn(async () => devices);
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: enumerate },
  });
  const rooms: ReturnType<typeof makeRoom>[] = [];
  const provider = new LiveKitMediaProvider(() => {
    const room = makeRoom();
    rooms.push(room);
    return room as unknown as Room;
  });
  return { provider, rooms };
}
/** Joins a room the way realtime.ts does after the grant: settings first, then the microphone. */
async function enter(provider: LiveKitMediaProvider, id: string, input = '') {
  await provider.connectRoom(id, 'token', 'ws://localhost:7880');
  await provider.setNoiseSuppression(true, 'strong');
  await provider.deviceSelection(input, '');
  await provider.mute(false);
}

beforeEach(() => {
  vi.mocked(createLocalAudioTrack).mockReset();
  vi.mocked(SoundboardMixer).mockClear();
});
afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator, 'mediaDevices');
});

it('carries the open, filtered microphone into the next room without opening it again', async () => {
  const { provider, rooms } = setup();
  const track = capture();
  vi.mocked(createLocalAudioTrack).mockResolvedValueOnce(track);
  await enter(provider, 'a');
  expect(provider.snapshot().muted).toBe(false);

  await provider.disconnect({ keepMicrophone: true });
  // The old room unpublishes without stopping it; capture and filter keep running.
  expect(rooms[0].disconnect).toHaveBeenCalledWith(false);
  expect(track.stop).not.toHaveBeenCalled();

  await enter(provider, 'b');
  expect(createLocalAudioTrack).toHaveBeenCalledTimes(1);
  expect(SoundboardMixer).toHaveBeenCalledTimes(1);
  expect(rooms[1].localParticipant.publishTrack).toHaveBeenCalledWith(track, {
    source: Track.Source.Microphone,
  });
  expect(provider.snapshot()).toMatchObject({
    status: 'connected',
    muted: false,
    noiseProcessing: { status: 'active', mode: 'strong' },
  });
  // One device list serves input and output (plus the one that names the microphone in use).
  enumerate.mockClear();
  await provider.deviceSelection('', '');
  expect(enumerate).toHaveBeenCalledTimes(2);
});

it('a plain leave, mute or deafen during the switch stops the carried microphone', async () => {
  for (const end of ['leave', 'mute', 'deafen'] as const) {
    const { provider } = setup();
    const track = capture();
    vi.mocked(createLocalAudioTrack).mockResolvedValueOnce(track);
    await enter(provider, 'a');
    await provider.disconnect({ keepMicrophone: true });
    if (end === 'leave') await provider.disconnect();
    else {
      await provider.connectRoom('b', 'token', 'ws://localhost:7880');
      if (end === 'mute') await provider.mute(true);
      else await provider.deafen(true);
    }
    expect(track.stop).toHaveBeenCalled();
    expect(provider.snapshot().noiseProcessing?.status).toBe('off');
  }
});

it('a failed connect to the next room leaves nothing capturing', async () => {
  const { provider, rooms } = setup();
  const track = capture();
  vi.mocked(createLocalAudioTrack).mockResolvedValueOnce(track);
  await enter(provider, 'a');
  await provider.disconnect({ keepMicrophone: true });
  // realtime.ts answers a failed join with a plain disconnect.
  const next = provider.connectRoom('b', 'token', 'ws://localhost:7880');
  await vi.waitFor(() => expect(rooms[1]).toBeDefined());
  rooms[1].connect.mockRejectedValueOnce(new Error('offline'));
  await next.catch(() => {});
  await provider.disconnect();
  expect(track.stop).toHaveBeenCalled();
});

it('opens a fresh capture when the input changed during the switch', async () => {
  const { provider, rooms } = setup();
  const first = capture(),
    second = capture();
  vi.mocked(createLocalAudioTrack).mockResolvedValueOnce(first).mockResolvedValueOnce(second);
  await enter(provider, 'a');
  await provider.disconnect({ keepMicrophone: true });
  devices = [{ kind: 'audioinput', deviceId: 'headset', groupId: 'g', label: 'Headset' }];
  await enter(provider, 'b', 'headset');
  expect(first.stop).toHaveBeenCalled();
  expect(createLocalAudioTrack).toHaveBeenCalledTimes(2);
  expect(rooms[1].localParticipant.publishTrack).toHaveBeenCalledWith(second, {
    source: Track.Source.Microphone,
  });
});

it('never carries a muted microphone', async () => {
  const { provider, rooms } = setup();
  const track = capture();
  vi.mocked(createLocalAudioTrack).mockResolvedValueOnce(track);
  await enter(provider, 'a');
  rooms[0].localParticipant.isMicrophoneEnabled = false;
  await provider.disconnect({ keepMicrophone: true });
  expect(track.stop).toHaveBeenCalled();
  expect(rooms[0].disconnect).toHaveBeenCalledWith(true);
});

it('warms the media server at most once per interval and never for a bad URL', () => {
  const { provider } = setup();
  const fetch = vi.fn(async () => new Response(null));
  vi.stubGlobal('fetch', fetch);
  provider.prepareConnection('wss://media.example.test/');
  provider.prepareConnection('wss://media.example.test/');
  provider.prepareConnection('https://user:pass@media.example.test/');
  provider.prepareConnection('not a url');
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    'https://media.example.test/',
    expect.objectContaining({ method: 'HEAD', credentials: 'omit' }),
  );
});
