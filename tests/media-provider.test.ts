// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ConnectionState,
  RoomEvent,
  DisconnectReason,
  Track,
  LocalAudioTrack,
  VideoQuality,
  createLocalAudioTrack,
  type Room,
} from 'livekit-client';
import { SoundboardMixer } from '../packages/media-providers/src/soundboard';
import { LiveKitMediaProvider } from '../packages/media-providers/src/index';

// The SDK capture and DSP graph are isolated here; real WASM/native graphs are verified separately.
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
function audioTrack() {
  const capture = { readyState: 'live', stop: vi.fn(), addEventListener: vi.fn() };
  const track = Object.assign(Object.create(LocalAudioTrack.prototype), {
    stop: vi.fn(() => {
      capture.readyState = 'ended';
    }),
    setAudioContext: vi.fn(),
    setProcessor: vi.fn(async () => {}),
    applyConstraints: vi.fn(async () => {}),
    mute: vi.fn(async () => {}),
    unmute: vi.fn(async () => {}),
  });
  Object.defineProperty(track, 'mediaStreamTrack', { value: capture, configurable: true });
  return track as LocalAudioTrack;
}

function fixture() {
  vi.stubGlobal(
    'AudioContext',
    class {
      resume = vi.fn(async () => {});
      close = vi.fn(async () => {});
    },
  );
  vi.mocked(createLocalAudioTrack)
    .mockReset()
    .mockImplementation(async () => audioTrack());
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
    setCameraEnabled: vi.fn(),
    publishData: vi.fn(async (_payload: Uint8Array, _options?: Record<string, unknown>) => {}),
    setScreenShareEnabled: vi.fn(async (enabled: boolean) => {
      local.isScreenShareEnabled = enabled;
    }),
  };
  Object.assign(local, {
    publishTrack: vi.fn(async (track: LocalAudioTrack) => {
      local.isMicrophoneEnabled = true;
      local.getTrackPublication.mockReturnValue({ track });
      local.trackPublications.set('mic', { track });
    }),
    unpublishTrack: vi.fn(async () => {
      local.getTrackPublication.mockReturnValue(undefined);
      local.isMicrophoneEnabled = false;
    }),
  });
  const room = {
    localParticipant: local,
    remoteParticipants: new Map(),
    on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
      listeners.set(event, [...(listeners.get(event) ?? []), cb]);
    }),
    connect: vi.fn(async () => {
      emit(RoomEvent.ConnectionStateChanged, ConnectionState.Connected);
    }),
    disconnect: vi.fn(async () => {
      emit(RoomEvent.Disconnected);
    }),
    removeAllListeners: vi.fn(),
    switchActiveDevice: vi.fn(async (_kind: string, _id: string) => true),
    startAudio: vi.fn(async () => {}),
  };
  const provider = new LiveKitMediaProvider(() => room as unknown as Room);
  return { provider, room, local, emit };
}
describe('LiveKit adapter lifecycle', () => {
  it('requires TLS for remote media and rejects credential-bearing URLs before constructing a room', async () => {
    const factory = vi.fn();
    const provider = new LiveKitMediaProvider(factory);
    await expect(provider.connectRoom('room', 'ephemeral', 'ws://example.com')).rejects.toThrow(
      'TLS',
    );
    await expect(
      provider.connectRoom('room', 'ephemeral', 'wss://example.com/?token=secret'),
    ).rejects.toThrow('plain');
    expect(factory).not.toHaveBeenCalled();
  });
  it('uses the granted URL/token, publishes only on explicit action, and resets tracks on leave', async () => {
    const { provider, room, local } = fixture();
    await provider.connectRoom('voice-1', 'ephemeral', 'ws://127.0.0.1:7880');
    expect(room.connect).toHaveBeenCalledWith('ws://127.0.0.1:7880/', 'ephemeral', {
      autoSubscribe: true,
    });
    expect(local.setMicrophoneEnabled).not.toHaveBeenCalled();
    await provider.publishMic('mic-1');
    expect(provider.snapshot().muted).toBe(false);
    await provider.mute(true);
    expect(provider.snapshot().muted).toBe(true);
    await provider.disconnect();
    expect(room.disconnect).toHaveBeenCalledWith(true);
    expect(provider.snapshot()).toMatchObject({
      status: 'not-configured',
      roomId: null,
      tracks: [],
      participants: [],
    });
  });
  it('deafen mutes the actual microphone and does not unmute it when hearing resumes', async () => {
    const { provider, local } = fixture();
    await provider.connectRoom('room', 'ephemeral', 'ws://localhost:7880');
    await provider.publishMic();
    await provider.deafen(true);
    expect(local.isMicrophoneEnabled).toBe(false);
    await provider.deafen(false);
    expect(local.isMicrophoneEnabled).toBe(false);
    expect(provider.snapshot().deafened).toBe(false);
    await provider.disconnect();
  });
  it('deafen silences remote playback including a later subscription', async () => {
    const { provider, room, emit } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    const element = document.createElement('audio');
    element.play = vi.fn(async () => {});
    element.pause = vi.fn();
    const participant = { setVolume: vi.fn(), identity: 'bob' };
    const track = { kind: 'audio', attach: () => element };
    await provider.deafen(true);
    emit(RoomEvent.TrackSubscribed, track, { trackSid: 'TR_audio' }, participant);
    expect(element.muted).toBe(true);
    await provider.deafen(false);
    expect(element.muted).toBe(false);
    await provider.deafen(true);
    await expect(provider.mute(false)).rejects.toThrow('Undeafen');
    await provider.disconnect();
    expect(document.body.contains(element)).toBe(false);
    expect(element.pause).toHaveBeenCalled();
  });
  it('plays the DJ through this listener’s equalizer and back, without leaking past deafen', async () => {
    const { provider, room, emit } = fixture();
    const gains: number[][] = [];
    vi.stubGlobal(
      'AudioContext',
      class {
        state = 'running';
        currentTime = 0;
        resume = vi.fn(async () => {});
        createBiquadFilter() {
          const gain: number[] = [];
          gains.push(gain);
          return {
            type: '',
            frequency: { value: 0 },
            Q: { value: 0 },
            gain: { setTargetAtTime: (value: number) => gain.push(value) },
          };
        }
      },
    );
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    const element = document.createElement('audio');
    element.play = vi.fn(async () => {});
    element.pause = vi.fn();
    const track = {
      kind: 'audio',
      attach: () => element,
      setAudioContext: vi.fn(),
      setWebAudioPlugins: vi.fn(),
      setVolume: vi.fn(),
    };
    const publication = { trackSid: 'TR_dj', source: Track.Source.Microphone, track };
    const dj = {
      identity: 'rooms-music-room',
      setVolume: vi.fn(),
      trackPublications: new Map([['TR_dj', publication]]),
    };
    room.remoteParticipants.set(dj.identity, dj);
    emit(RoomEvent.TrackSubscribed, track, publication, dj);
    // A flat equalizer leaves the DJ on its ordinary element.
    expect(track.setAudioContext).not.toHaveBeenCalled();
    expect(element.muted).toBe(false);
    provider.setMusicEqualizer({ bass: 6, mid: 0, treble: -3 });
    expect(provider.musicEqualizer()).toEqual({ bass: 6, mid: 0, treble: -3 });
    expect(gains.map((g) => g.at(-1))).toEqual([6, 0, -3]);
    expect(track.setWebAudioPlugins).toHaveBeenCalledTimes(1);
    expect(track.setAudioContext).toHaveBeenLastCalledWith(expect.any(Object));
    expect(element.muted).toBe(true);
    await provider.deafen(true);
    expect(track.setVolume).toHaveBeenLastCalledWith(0);
    expect(element.muted).toBe(true);
    provider.setParticipantVolume('rooms-music-room', 0.5);
    expect(track.setVolume).toHaveBeenLastCalledWith(0);
    await provider.deafen(false);
    // The DJ volume curve is quadratic: 0.5 becomes 0.25.
    expect(track.setVolume).toHaveBeenLastCalledWith(0.25);
    expect(element.muted).toBe(true);
    expect(() => provider.setMusicEqualizer({ bass: 40, mid: 0, treble: 0 })).toThrow();
    provider.setMusicEqualizer({ bass: 0, mid: 0, treble: 0 });
    expect(track.setAudioContext).toHaveBeenLastCalledWith(undefined);
    expect(element.muted).toBe(false);
    await provider.disconnect();
  });
  it('records denial without false capture success', async () => {
    const { provider, local } = fixture();
    await provider.connectRoom('room', 'ephemeral', 'ws://localhost:7880');
    local.setScreenShareEnabled.mockRejectedValueOnce(
      new DOMException('Denied', 'NotAllowedError'),
    );
    await expect(provider.publishScreen()).rejects.toThrow();
    expect(provider.snapshot()).toMatchObject({ sharing: false });
    expect(provider.snapshot().error).toContain('izni kapalı');
    await provider.disconnect();
  });
  it('connection failure never reports connected or exposes token/error URL', async () => {
    const { provider, room } = fixture();
    room.connect.mockRejectedValueOnce(new Error('JWT TOP_SECRET at ws://server'));
    await expect(provider.connectRoom('room', 'TOP_SECRET', 'ws://localhost:7880')).rejects.toThrow(
      'Unable',
    );
    expect(provider.status).toBe('error');
    expect(JSON.stringify(provider.snapshot())).not.toContain('TOP_SECRET');
    await provider.disconnect();
  });
  it('allows another authorized publisher while a friend is already sharing', async () => {
    const { provider, room, local } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    room.remoteParticipants.set('bob', {
      identity: 'bob',
      trackPublications: new Map(),
      isScreenShareEnabled: true,
    });
    await provider.publishScreen();
    expect(local.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.any(Object),
      expect.any(Object),
    );
    await provider.disconnect();
  });
  it('stops screen capture immediately even when reconnecting and unpublication fails', async () => {
    const { provider, local, emit } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    const stop = vi.fn();
    local.getTrackPublication.mockReturnValue({ track: { stop } });
    local.setScreenShareEnabled.mockRejectedValueOnce(new Error('Network unavailable'));
    emit(RoomEvent.ConnectionStateChanged, ConnectionState.Reconnecting);
    await expect(provider.stopScreen()).rejects.toThrow('Ses işlemi');
    expect(stop).toHaveBeenCalled();
    expect(provider.snapshot().sharing).toBe(false);
    await provider.disconnect();
  });
  it('publishes the chosen camera, falls back to the default and switches a live camera', async () => {
    const { provider, local, room } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    local.setCameraEnabled.mockRejectedValueOnce(new Error('OverconstrainedError'));
    await provider.publishCamera(true, 'usb-cam');
    expect(local.setCameraEnabled).toHaveBeenNthCalledWith(
      1,
      true,
      expect.objectContaining({ deviceId: 'usb-cam' }),
    );
    expect(local.setCameraEnabled).toHaveBeenNthCalledWith(
      2,
      true,
      expect.objectContaining({ deviceId: undefined }),
    );
    local.isCameraEnabled = true;
    await provider.selectCamera('laptop-cam');
    expect(room.switchActiveDevice).toHaveBeenCalledWith('videoinput', 'laptop-cam');
    await provider.disconnect();
  });
  it('mutes the microphone while the room is reconnecting', async () => {
    const { provider, local, emit } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    const mute = vi.fn(async () => {});
    local.getTrackPublication.mockReturnValue({ track: { mute } });
    emit(RoomEvent.ConnectionStateChanged, ConnectionState.Reconnecting);
    local.setMicrophoneEnabled.mockClear();
    await expect(provider.mute(true)).resolves.toBeUndefined();
    expect(mute).toHaveBeenCalled();
    expect(local.setMicrophoneEnabled).not.toHaveBeenCalled();
    expect(provider.snapshot().muted).toBe(true);
    await provider.disconnect();
  });
  it('tracks reconnect state without reacquiring microphone or screen', async () => {
    const { provider, emit, local } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    emit(RoomEvent.ConnectionStateChanged, ConnectionState.Reconnecting);
    expect(provider.status).toBe('reconnecting');
    expect(local.setMicrophoneEnabled).not.toHaveBeenCalled();
    emit(RoomEvent.ConnectionStateChanged, ConnectionState.Connected);
    expect(provider.status).toBe('connected');
    await provider.disconnect();
  });
});

describe('explicit screen quality and system audio', () => {
  it('defaults to 1080p60 without capturing audio', async () => {
    const { provider, local } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    await provider.publishScreen();
    expect(local.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        audio: false,
        resolution: { width: 1920, height: 1080, frameRate: 60 },
        contentHint: 'motion',
      }),
      expect.objectContaining({
        videoCodec: 'h264',
        screenShareEncoding: { maxBitrate: 8000000, maxFramerate: 60 },
        simulcast: true,
        // LiveKit's screen share default is maintain-resolution, which drops frames on motion.
        degradationPreference: 'maintain-framerate',
        screenShareSimulcastLayers: [
          expect.objectContaining({
            width: 640,
            height: 360,
            encoding: expect.objectContaining({ maxBitrate: 600000, maxFramerate: 30 }),
          }),
          expect.objectContaining({
            width: 1280,
            height: 720,
            encoding: expect.objectContaining({ maxBitrate: 3500000, maxFramerate: 60 }),
          }),
        ],
      }),
    );
    await provider.disconnect();
  });
  it('keeps text sharp for detail content and adds no layer equal to a 720p profile', async () => {
    const { provider, local } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    await provider.publishScreen({ quality: '720p30', content: 'detail' });
    expect(local.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ contentHint: 'detail' }),
      expect.objectContaining({
        degradationPreference: 'maintain-resolution',
        screenShareSimulcastLayers: [expect.objectContaining({ width: 640, height: 360 })],
      }),
    );
    await provider.disconnect();
  });
  it('captures explicitly requested stereo system audio without microphone processing', async () => {
    const { provider, local } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    local.getTrackPublication.mockImplementation((source) =>
      source === Track.Source.ScreenShareAudio ? { track: { stop: vi.fn() } } : undefined,
    );
    await provider.publishScreen({ quality: '4k30', audio: true });
    expect(local.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        audio: expect.objectContaining({
          channelCount: 2,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        }),
        resolution: { width: 3840, height: 2160, frameRate: 30 },
      }),
      // Game and video sound: no speech DTX gaps, no doubled stereo RED.
      expect.objectContaining({ forceStereo: true, dtx: false, red: false }),
    );
    // Tayfa's own playback is asked to stay out (Windows 11, macOS 14.2+ honour it).
    expect(local.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({ audio: expect.objectContaining({ restrictOwnAudio: true }) }),
      expect.anything(),
    );
    expect(provider.snapshot()).toMatchObject({ sharing: true, sharingAudio: true });
    await provider.disconnect();
  });
  it('keeps sharing the picture when requested system audio was not acquired', async () => {
    const { provider, local } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    // Chromium rejects the whole capture when the loopback cannot start…
    local.setScreenShareEnabled.mockRejectedValueOnce(
      Object.assign(new Error('Could not start audio source'), { name: 'NotReadableError' }),
    );
    await expect(provider.publishScreen({ audio: true })).rejects.toThrow();
    expect(provider.snapshot().error).toBeTruthy();
    // …while a capture without an audio track still shares the picture, without a stale error.
    await provider.publishScreen({ audio: true });
    expect(local.setScreenShareEnabled).toHaveBeenCalledTimes(2);
    expect(provider.snapshot()).toMatchObject({ sharing: true, sharingAudio: false, error: null });
    await provider.stopScreen();
    expect(provider.snapshot()).toMatchObject({ sharing: false, sharingAudio: false });
    await provider.disconnect();
  });
});

it('reports observed encoder dimensions and codec instead of the requested profile', async () => {
  vi.useFakeTimers();
  const { provider, local } = fixture();
  try {
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    const report = new Map([
      [
        'video',
        {
          id: 'video',
          type: 'outbound-rtp',
          frameWidth: 1280,
          frameHeight: 720,
          framesPerSecond: 28,
          codecId: 'codec',
        },
      ],
      ['codec', { id: 'codec', type: 'codec', mimeType: 'video/H264' }],
    ]);
    local.trackPublications.set('screen', {
      trackSid: 'screen',
      source: Track.Source.ScreenShare,
      kind: 'video',
      track: { stop: vi.fn(), getRTCStatsReport: vi.fn(async () => report) },
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(provider.diagnostics().video).toEqual({
      width: 1280,
      height: 720,
      framesPerSecond: 28,
      codec: 'video/H264',
      direction: 'sent',
    });
  } finally {
    await provider.disconnect();
    vi.useRealTimers();
  }
});

it('recovers a missing selected microphone on explicit unmute and clears the stale error', async () => {
  const { provider, local, room } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  vi.mocked(createLocalAudioTrack).mockRejectedValueOnce(
    new DOMException('Old device ID', 'OverconstrainedError'),
  );
  await provider.mute(false);
  expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'default');
  expect(createLocalAudioTrack).toHaveBeenLastCalledWith(
    expect.objectContaining({ deviceId: 'default', noiseSuppression: false }),
  );
  expect(provider.snapshot()).toMatchObject({
    muted: false,
    error: null,
    inputDeviceFallback: true,
  });
  await provider.disconnect();
});
it('does not retry capture after a permission denial', async () => {
  const { provider, local, room } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  vi.mocked(createLocalAudioTrack).mockRejectedValueOnce(
    new DOMException('Denied', 'NotAllowedError'),
  );
  await expect(provider.mute(false)).rejects.toThrow('izni kapalı');
  expect(createLocalAudioTrack).toHaveBeenCalledTimes(1);
  expect(room.switchActiveDevice).not.toHaveBeenCalled();
  await provider.disconnect();
});
describe('saved audio devices that are gone', () => {
  const listDevices = (...devices: Pick<MediaDeviceInfo, 'kind' | 'deviceId'>[]) =>
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { enumerateDevices: vi.fn(async () => devices) },
    });
  const builtIn = [
    { kind: 'audioinput', deviceId: 'default' },
    { kind: 'audioinput', deviceId: 'built-in-mic' },
    { kind: 'audiooutput', deviceId: 'default' },
    { kind: 'audiooutput', deviceId: 'built-in-speaker' },
  ] as const;
  afterEach(() => {
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'mediaDevices');
  });

  it('joins on the system default when the saved headset is no longer listed', async () => {
    listDevices(...builtIn);
    const { provider, room } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    await provider.deviceSelection('airpods-mic', 'airpods-out');
    expect(room.switchActiveDevice).toHaveBeenCalledWith('audioinput', 'default');
    expect(room.switchActiveDevice).toHaveBeenCalledWith('audiooutput', 'default');
    expect(room.switchActiveDevice).not.toHaveBeenCalledWith('audioinput', 'airpods-mic');
    expect(room.switchActiveDevice).not.toHaveBeenCalledWith('audiooutput', 'airpods-out');
    expect(provider.snapshot()).toMatchObject({ status: 'connected', error: null });
    await provider.mute(false);
    // Still asked for as a preference, so the headset is used again once it is back.
    expect(createLocalAudioTrack).toHaveBeenLastCalledWith(
      expect.objectContaining({ deviceId: 'airpods-mic' }),
    );
    expect(provider.snapshot()).toMatchObject({ muted: false, error: null });
    await provider.disconnect();
  });

  it('falls back when a listed speaker cannot be found while switching', async () => {
    listDevices(...builtIn, { kind: 'audiooutput', deviceId: 'airpods-out' });
    const { provider, room } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    room.switchActiveDevice.mockImplementation(async (kind: string, id: string) => {
      if (kind === 'audiooutput' && id === 'airpods-out')
        throw new DOMException('Requested device not found', 'NotFoundError');
      return true;
    });
    await provider.deviceSelection('', 'airpods-out');
    expect(room.switchActiveDevice).toHaveBeenLastCalledWith('audiooutput', 'default');
    expect(provider.snapshot().error).toBeNull();
    await provider.disconnect();
  });

  it('still reports failures a fallback cannot fix', async () => {
    listDevices(...builtIn);
    const { provider, room } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    room.switchActiveDevice.mockRejectedValueOnce(new DOMException('Busy', 'NotReadableError'));
    await expect(provider.deviceSelection('built-in-mic', '')).rejects.toThrow('Cihaz açılamadı');
    expect(room.switchActiveDevice).toHaveBeenCalledTimes(1);
    room.switchActiveDevice.mockRejectedValueOnce(new DOMException('None', 'NotFoundError'));
    await expect(provider.deviceSelection('', '')).rejects.toThrow('Seçili cihaz bulunamadı');
    expect(room.switchActiveDevice).toHaveBeenCalledTimes(2);
    await provider.disconnect();
  });

  it('opens the microphone after the chosen speaker left mid-call', async () => {
    listDevices(...builtIn, { kind: 'audiooutput', deviceId: 'airpods-out' });
    const { provider } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    await provider.deviceSelection('', 'airpods-out');
    const sinks: string[] = [];
    vi.stubGlobal(
      'AudioContext',
      class {
        resume = vi.fn(async () => {});
        close = vi.fn(async () => {});
        setSinkId = vi.fn(async (id: string) => {
          sinks.push(id);
          throw new DOMException('Requested device not found', 'NotFoundError');
        });
      },
    );
    await provider.mute(false);
    expect(sinks).toEqual(['airpods-out']);
    expect(provider.snapshot()).toMatchObject({ muted: false, error: null });
    await provider.disconnect();
  });
});
function screenPublication(trackSid: string, source: Track.Source) {
  const publication = {
    trackSid,
    source,
    kind: source === Track.Source.ScreenShare ? 'video' : 'audio',
    isMuted: false,
    isDesired: true,
    setSubscribed: vi.fn((value: boolean) => {
      publication.isDesired = value;
    }),
  };
  return publication;
}
it('streams screen audio only to a listener who watches it and keeps it apart from speech', async () => {
  const { provider, room, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const publication = screenPublication('screen-audio', Track.Source.ScreenShareAudio);
  const bob = {
    identity: 'bob',
    setVolume: vi.fn(),
    trackPublications: new Map([['screen', publication]]),
  };
  room.remoteParticipants.set('bob', bob);
  const element = document.createElement('audio');
  element.play = vi.fn(async () => {});
  element.pause = vi.fn();
  const track = { kind: 'audio', attach: () => element, detach: vi.fn() };
  // Auto-subscription of a screen nobody here watches is undone at once.
  emit(RoomEvent.TrackSubscribed, track, publication, bob);
  expect(publication.setSubscribed).toHaveBeenLastCalledWith(false);
  expect(element.isConnected).toBe(false);
  provider.watchScreen('bob');
  expect(publication.setSubscribed).toHaveBeenLastCalledWith(true);
  emit(RoomEvent.TrackSubscribed, track, publication, bob);
  expect(element.muted).toBe(false);
  provider.setScreenVolume('bob', 0.2);
  expect(bob.setVolume).toHaveBeenLastCalledWith(0.2, Track.Source.ScreenShareAudio);
  provider.setParticipantVolume('bob', 0.8);
  expect(bob.setVolume).toHaveBeenLastCalledWith(0.8, Track.Source.Microphone);
  await provider.deafen(true);
  expect(element.muted).toBe(true);
  await provider.deafen(false);
  expect(element.muted).toBe(false);
  provider.watchScreen(null);
  expect(publication.setSubscribed).toHaveBeenLastCalledWith(false);
  expect(element.muted).toBe(true);
  await provider.disconnect();
});
it('tells viewers whether a screen share carries sound', async () => {
  const { provider, room, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const audio = screenPublication('screen-audio', Track.Source.ScreenShareAudio);
  const person = (identity: string, withSound: boolean) => ({
    identity,
    name: identity,
    isScreenShareEnabled: true,
    setVolume: vi.fn(),
    trackPublications: new Map(),
    getTrackPublication: (source: Track.Source) =>
      withSound && source === Track.Source.ScreenShareAudio ? audio : undefined,
  });
  room.remoteParticipants.set('bob', person('bob', true));
  room.remoteParticipants.set('cem', person('cem', false));
  emit(RoomEvent.TrackPublished);
  const participants = provider.snapshot().participants;
  expect(participants.find((p) => p.id === 'bob')).toMatchObject({ screenAudio: true });
  expect(participants.find((p) => p.id === 'cem')).toMatchObject({ screenAudio: false });
  await provider.disconnect();
});
it('caps watched screen video at the viewer choice, for a restarted share too', async () => {
  const { provider, room, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const announced = (...layers: [VideoQuality, number, number][]) => ({
    layers: layers.map(([quality, width, height]) => ({ quality, width, height })),
  });
  const video = Object.assign(screenPublication('screen-video', Track.Source.ScreenShare), {
    trackInfo: announced(
      [VideoQuality.LOW, 640, 360],
      [VideoQuality.MEDIUM, 1280, 720],
      [VideoQuality.HIGH, 1920, 1080],
    ),
    setVideoQuality: vi.fn(),
  });
  // The audio publication has no setVideoQuality: calling it there would throw.
  const audio = screenPublication('screen-audio', Track.Source.ScreenShareAudio);
  const bob = {
    identity: 'bob',
    name: 'Bob',
    setVolume: vi.fn(),
    trackPublications: new Map<string, object>([
      ['video', video],
      ['audio', audio],
    ]),
  };
  room.remoteParticipants.set('bob', bob);
  provider.watchScreen('bob');
  // Until the viewer picks, LiveKit's adaptive stream stays in charge.
  expect(video.setVideoQuality).not.toHaveBeenCalled();
  expect(provider.snapshot().screenQuality).toBe('auto');
  expect(provider.snapshot().tracks).toContainEqual(
    expect.objectContaining({
      id: 'screen-video',
      layers: [
        { quality: 'low', width: 640, height: 360 },
        { quality: 'medium', width: 1280, height: 720 },
        { quality: 'high', width: 1920, height: 1080 },
      ],
    }),
  );
  provider.setScreenQuality(720);
  expect(video.setVideoQuality).toHaveBeenLastCalledWith(VideoQuality.MEDIUM);
  expect(provider.snapshot().screenQuality).toBe(720);
  // An rc.34 share (q/h, no high layer) restarts as a new publication; the choice follows it.
  const rc34 = Object.assign(screenPublication('screen-video-2', Track.Source.ScreenShare), {
    trackInfo: announced([VideoQuality.LOW, 960, 540], [VideoQuality.MEDIUM, 1920, 1080]),
    setVideoQuality: vi.fn(),
  });
  bob.trackPublications.set('video', rc34);
  emit(RoomEvent.TrackSubscribed, { kind: 'video' }, rc34, bob);
  expect(rc34.setVideoQuality).toHaveBeenLastCalledWith(VideoQuality.LOW);
  provider.setScreenQuality('auto');
  expect(rc34.setVideoQuality).toHaveBeenLastCalledWith(VideoQuality.MEDIUM);
  // A single-layer publisher only has its one layer to give.
  const single = Object.assign(screenPublication('screen-video-3', Track.Source.ScreenShare), {
    trackInfo: announced([VideoQuality.HIGH, 1920, 1080]),
    setVideoQuality: vi.fn(),
  });
  bob.trackPublications.set('video', single);
  emit(RoomEvent.TrackSubscribed, { kind: 'video' }, single, bob);
  provider.setScreenQuality(360);
  expect(single.setVideoQuality).toHaveBeenLastCalledWith(VideoQuality.HIGH);
  // Not watching: nothing is requested for a stream this listener does not receive.
  provider.watchScreen(null);
  single.setVideoQuality.mockClear();
  provider.setScreenQuality(1080);
  expect(single.setVideoQuality).not.toHaveBeenCalled();
  expect(() => provider.setScreenQuality(0)).toThrow();
  await provider.disconnect();
  // The choice lasts for the app session, across leaving voice.
  expect(provider.snapshot().screenQuality).toBe(1080);
});
it('advertises a remote screen share without downloading it until the listener watches', async () => {
  const { provider, room, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const video = screenPublication('screen-video', Track.Source.ScreenShare);
  room.remoteParticipants.set('bob', {
    identity: 'bob',
    name: 'Bob',
    setVolume: vi.fn(),
    trackPublications: new Map([['screen', video]]),
  });
  emit(RoomEvent.TrackPublished, video, room.remoteParticipants.get('bob'));
  expect(video.setSubscribed).toHaveBeenLastCalledWith(false);
  expect(provider.snapshot().tracks).toContainEqual(
    expect.objectContaining({ id: 'screen-video', source: 'screen_share', subscribed: false }),
  );
  await provider.disconnect();
});
it('announces the watched screen and lists viewers from their own authenticated packets', async () => {
  const { provider, room, local, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const carol = { identity: 'carol', name: 'Carol', trackPublications: new Map() };
  room.remoteParticipants.set('carol', carol);
  provider.watchScreen('bob');
  const [payload, options] = vi.mocked(local.publishData).mock.calls.at(-1)!;
  expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({ watching: 'bob' });
  expect(options).toMatchObject({ reliable: true, topic: 'rooms-watch-v1' });
  const packet = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  emit(
    RoomEvent.DataReceived,
    packet({ watching: 'alice', viewer: 'dave' }),
    carol,
    0,
    'rooms-watch-v1',
  );
  emit(RoomEvent.DataReceived, packet({ watching: 42 }), carol, 0, 'rooms-watch-v1');
  const people = provider.snapshot().participants;
  expect(people.find((p) => p.id === 'carol')?.watching).toBe('alice');
  expect(people.find((p) => p.id === 'alice')?.watching).toBe('bob');
  expect(people.some((p) => p.id === 'dave')).toBe(false);
  room.remoteParticipants.delete('carol');
  emit(RoomEvent.ParticipantDisconnected, carol);
  emit(RoomEvent.ParticipantConnected, carol);
  expect(vi.mocked(local.publishData).mock.calls.at(-1)?.[1]).toMatchObject({
    destinationIdentities: ['carol'],
  });
  await provider.disconnect();
});
it('shares whiteboard pointers lossily and keeps them apart from control input', async () => {
  const { provider, room, local, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const carol = { identity: 'carol', name: 'Carol', trackPublications: new Map() };
  room.remoteParticipants.set('carol', carol);
  const cursors: [string, string][] = [],
    controls: string[] = [];
  provider.onCursor((payload, sender) => cursors.push([payload, sender]));
  provider.onControl((payload) => controls.push(payload));
  await provider.publishCursor(JSON.stringify({ b: 'room', x: 10, y: 20 }));
  const [payload, options] = vi.mocked(local.publishData).mock.calls.at(-1)!;
  expect(JSON.parse(new TextDecoder().decode(payload))).toEqual({ b: 'room', x: 10, y: 20 });
  expect(options).toEqual({ reliable: false, topic: 'rooms-cursor-v1' });
  await expect(provider.publishCursor('x'.repeat(513))).rejects.toThrow();
  const packet = (value: string) => new TextEncoder().encode(value);
  emit(RoomEvent.DataReceived, packet('{"b":"room","x":5,"y":6}'), carol, 0, 'rooms-cursor-v1');
  emit(RoomEvent.DataReceived, packet('{"b":"room","x":5,"y":6}'), undefined, 0, 'rooms-cursor-v1');
  emit(RoomEvent.DataReceived, new Uint8Array(600), carol, 0, 'rooms-cursor-v1');
  expect(cursors).toEqual([['{"b":"room","x":5,"y":6}', 'carol']]);
  expect(controls).toEqual([]);
  for (let i = 0; i < 700; i++)
    emit(RoomEvent.DataReceived, packet('{"b":"room"}'), carol, 0, 'rooms-cursor-v1');
  expect(cursors.length).toBeLessThanOrEqual(600);
  await provider.disconnect();
});
it('relays soundboard reactions on their own topic, with a flood limit and no effect on control input', async () => {
  const { provider, room, local, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const carol = { identity: 'carol', name: 'Carol', trackPublications: new Map() };
  room.remoteParticipants.set('carol', carol);
  const reactions: [string, string][] = [],
    controls: string[] = [],
    cursors: string[] = [];
  provider.onReaction((payload, sender) => reactions.push([payload, sender]));
  provider.onControl((payload) => controls.push(payload));
  provider.onCursor((payload) => cursors.push(payload));
  const body = '{"v":1,"k":"sound","e":"🎉"}';
  await provider.publishReaction(body);
  const [payload, options] = vi.mocked(local.publishData).mock.calls.at(-1)!;
  expect(new TextDecoder().decode(payload)).toBe(body);
  expect(options).toEqual({ reliable: true, topic: 'rooms-reaction-v1' });
  await expect(provider.publishReaction('x'.repeat(257))).rejects.toThrow();
  const packet = (value: string) => new TextEncoder().encode(value);
  emit(RoomEvent.DataReceived, packet(body), carol, 0, 'rooms-reaction-v1');
  // Server-originated or oversized packets and other topics never become reactions.
  emit(RoomEvent.DataReceived, packet(body), undefined, 0, 'rooms-reaction-v1');
  emit(RoomEvent.DataReceived, new Uint8Array(300), carol, 0, 'rooms-reaction-v1');
  emit(RoomEvent.DataReceived, packet(body), carol, 0, 'rooms-unknown-v9');
  expect(reactions).toEqual([[body, 'carol']]);
  expect(controls).toEqual([]);
  expect(cursors).toEqual([]);
  for (let i = 0; i < 60; i++)
    emit(RoomEvent.DataReceived, packet(body), carol, 0, 'rooms-reaction-v1');
  expect(reactions.length).toBeLessThanOrEqual(20);
  await provider.disconnect();
});
it('follows a move only when the server sends it, and says when a moderator disconnected you', async () => {
  const { provider, room, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const carol = { identity: 'carol', name: 'Carol', trackPublications: new Map() };
  room.remoteParticipants.set('carol', carol);
  const moves: string[] = [];
  provider.onMove((channelId) => moves.push(channelId));
  const packet = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  // A member cannot forge a move; only the server sends without a participant.
  emit(RoomEvent.DataReceived, packet({ channelId: 'lounge' }), carol, 0, 'rooms-move-v1');
  emit(RoomEvent.DataReceived, packet({ channelId: '../x' }), undefined, 0, 'rooms-move-v1');
  emit(RoomEvent.DataReceived, packet({ channelId: 'lounge' }), undefined, 0, 'rooms-cursor-v1');
  emit(
    RoomEvent.DataReceived,
    packet({ channelId: 'lounge', by: 'admin' }),
    undefined,
    0,
    'rooms-move-v1',
  );
  expect(moves).toEqual(['lounge']);
  emit(RoomEvent.Disconnected, DisconnectReason.PARTICIPANT_REMOVED);
  expect(provider.snapshot().error).toBe('A moderator disconnected you from the voice room.');
});
it('reads personal sounds only from well-formed server attributes and follows their changes', async () => {
  const { provider, room, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const upload = '6f1c2a3b-1234-4abc-8def-0123456789ab';
  const bob = {
    identity: 'bob',
    name: 'Bob',
    trackPublications: new Map(),
    attributes: {
      'rooms.sound.enter': 'p.fanfar',
      'rooms.sound.leave': '../../me/assign',
    } as Record<string, string>,
  };
  room.remoteParticipants.set('bob', bob);
  emit(RoomEvent.ParticipantConnected, bob);
  const person = (id: string) => provider.snapshot().participants.find((p) => p.id === id);
  expect(person('bob')?.sounds).toEqual({ enter: 'p.fanfar' });
  expect(person('alice')?.sounds).toBeUndefined();
  bob.attributes = { 'rooms.sound.enter': 'p.fanfar', 'rooms.sound.leave': upload };
  emit(RoomEvent.ParticipantAttributesChanged, { 'rooms.sound.leave': upload }, bob);
  expect(person('bob')?.sounds).toEqual({ enter: 'p.fanfar', leave: upload });
  bob.attributes = { 'rooms.sound.enter': '', 'rooms.sound.leave': 'P.FANFAR' };
  emit(RoomEvent.ParticipantAttributesChanged, { 'rooms.sound.enter': '' }, bob);
  expect(person('bob')?.sounds).toBeUndefined();
  await provider.disconnect();
});
it('local volume is applied again when a muted participant publishes a replacement track', async () => {
  const { provider, room, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const bob = { identity: 'bob', setVolume: vi.fn(), trackPublications: new Map() };
  room.remoteParticipants.set('bob', bob);
  provider.setParticipantVolume('bob', 0);
  const element = document.createElement('audio');
  element.play = vi.fn(async () => {});
  element.pause = vi.fn();
  emit(
    RoomEvent.TrackSubscribed,
    { kind: 'audio', attach: () => element },
    { trackSid: 'replacement' },
    bob,
  );
  expect(bob.setVolume).toHaveBeenLastCalledWith(0, Track.Source.Microphone);
  await provider.disconnect();
});

it('does not publish a delayed microphone into a room that was left', async () => {
  const { provider, local } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  let finish!: () => void;
  const track = audioTrack();
  vi.mocked(createLocalAudioTrack).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = () => resolve(track);
      }),
  );
  const pending = provider.mute(false);
  await vi.waitFor(() => expect(createLocalAudioTrack).toHaveBeenCalled());
  const leaving = provider.disconnect();
  finish();
  await Promise.all([pending, leaving]);
  expect(track.stop).toHaveBeenCalled();
  expect(local.isMicrophoneEnabled).toBe(false);
  expect(provider.snapshot()).toMatchObject({ status: 'not-configured', muted: true, error: null });
});
it('does not show a late permission error after leaving voice', async () => {
  const { provider, local } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  let fail!: (error: unknown) => void;
  vi.mocked(createLocalAudioTrack).mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        fail = reject;
      }),
  );
  const pending = provider.mute(false).catch(() => {});
  await vi.waitFor(() => expect(createLocalAudioTrack).toHaveBeenCalled());
  const leaving = provider.disconnect();
  fail(new DOMException('Denied', 'NotAllowedError'));
  await Promise.all([pending, leaving]);
  expect(provider.snapshot()).toMatchObject({ status: 'not-configured', muted: true, error: null });
});

it('stops local capture and clears old presence before network disconnect completes', async () => {
  const { provider, room, local, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const stop = vi.fn();
  local.trackPublications.set('mic', { track: { stop } });
  let finish!: () => void;
  room.disconnect.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const leaving = provider.disconnect();
  expect(stop).toHaveBeenCalledTimes(1);
  expect(provider.snapshot()).toMatchObject({
    status: 'not-configured',
    roomId: null,
    participants: [],
    tracks: [],
    muted: true,
  });
  expect(provider.disconnect()).toBe(leaving);
  const attach = vi.fn();
  emit(
    RoomEvent.TrackSubscribed,
    { kind: 'audio', attach },
    { trackSid: 'late' },
    { identity: 'bob' },
  );
  expect(attach).not.toHaveBeenCalled();
  finish();
  await leaving;
});

it('bot listener gain reaches very quiet levels, remains local, and survives replacement tracks', async () => {
  const { provider, room, emit } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const bot = { identity: 'rooms-music-room', setVolume: vi.fn(), trackPublications: new Map() },
    human = { identity: 'bob', setVolume: vi.fn(), trackPublications: new Map() };
  room.remoteParticipants.set(bot.identity, bot);
  room.remoteParticipants.set(human.identity, human);
  provider.setParticipantVolume(bot.identity, 0.01);
  expect(bot.setVolume).toHaveBeenLastCalledWith(0.0001, Track.Source.Microphone);
  expect(provider.snapshot().participants.find((p) => p.id === bot.identity)?.volume).toBe(0.01);
  provider.setParticipantVolume(human.identity, 0.01);
  expect(human.setVolume).toHaveBeenLastCalledWith(0.01, Track.Source.Microphone);
  const element = document.createElement('audio');
  element.play = vi.fn(async () => {});
  element.pause = vi.fn();
  emit(
    RoomEvent.TrackSubscribed,
    { kind: 'audio', attach: () => element },
    { trackSid: 'new-bot-track' },
    bot,
  );
  expect(bot.setVolume).toHaveBeenLastCalledWith(0.0001, Track.Source.Microphone);
  provider.setParticipantVolume(bot.identity, 0);
  expect(bot.setVolume).toHaveBeenLastCalledWith(0, Track.Source.Microphone);
  provider.setParticipantVolume(bot.identity, 1);
  expect(bot.setVolume).toHaveBeenLastCalledWith(1, Track.Source.Microphone);
  await provider.disconnect();
});

it('listener settings survive reconnect and a new provider while remaining account scoped', async () => {
  localStorage.clear();
  const first = fixture();
  first.provider.setListenerScope('DEMO-server:alice');
  await first.provider.connectRoom('room', 'token', 'ws://localhost:7880');
  first.provider.setParticipantVolume('rooms-music-room', 0.09);
  first.provider.setParticipantVolume('bob', 0.25);
  await first.provider.disconnect();
  await first.provider.connectRoom('other', 'token', 'ws://localhost:7880');
  const bot = { identity: 'rooms-music-room', setVolume: vi.fn(), trackPublications: new Map() };
  first.room.remoteParticipants.set(bot.identity, bot);
  const e = document.createElement('audio');
  e.play = vi.fn(async () => {});
  e.pause = vi.fn();
  first.emit(
    RoomEvent.TrackSubscribed,
    { kind: 'audio', attach: () => e },
    { trackSid: 'bot' },
    bot,
  );
  expect(bot.setVolume).toHaveBeenLastCalledWith(0.0081, Track.Source.Microphone);
  await first.provider.disconnect();
  const second = fixture();
  second.provider.setListenerScope('DEMO-server:alice');
  await second.provider.connectRoom('room', 'token', 'ws://localhost:7880');
  second.room.remoteParticipants.set(bot.identity, bot);
  second.emit(
    RoomEvent.TrackSubscribed,
    { kind: 'audio', attach: () => e },
    { trackSid: 'bot2' },
    bot,
  );
  expect(bot.setVolume).toHaveBeenLastCalledWith(0.0081, Track.Source.Microphone);
  second.provider.setListenerScope('DEMO-server:bob');
  expect(second.provider.snapshot().participants.find((p) => p.id === bot.identity)?.volume).toBe(
    1,
  );
  second.provider.setListenerScope('DEMO-server:alice');
  expect(second.provider.snapshot().participants.find((p) => p.id === bot.identity)?.volume).toBe(
    0.09,
  );
  await second.provider.disconnect();
  localStorage.clear();
});

it('attaches the selected local filter before any microphone publication', async () => {
  const { provider, local } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  await provider.setNoiseSuppression(true, 'strong');
  await provider.publishMic();
  expect(createLocalAudioTrack).toHaveBeenCalledWith(
    expect.objectContaining({
      noiseSuppression: false,
      autoGainControl: false,
      sampleRate: 48000,
      channelCount: 1,
    }),
  );
  const track = vi.mocked(createLocalAudioTrack).mock.results[0];
  const captured = await track.value;
  expect(vi.mocked(captured.setProcessor).mock.invocationCallOrder[0]).toBeLessThan(
    (local as unknown as { publishTrack: ReturnType<typeof vi.fn> }).publishTrack.mock
      .invocationCallOrder[0],
  );
  // The mixer also gets the input gate and leveler defaults (automatic sensitivity, leveler on).
  expect(SoundboardMixer).toHaveBeenCalledWith(true, 'strong', expect.any(Object), {
    gate: { auto: true, threshold: -34 },
    leveler: true,
  });
  await provider.disconnect();
});
it('never publishes raw microphone audio after a filter initialization failure', async () => {
  const { provider, local } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const track = audioTrack();
  vi.mocked(track.setProcessor).mockRejectedValueOnce(new Error('Model unavailable'));
  vi.mocked(createLocalAudioTrack).mockResolvedValueOnce(track);
  await expect(provider.publishMic()).rejects.toThrow();
  expect(
    (local as unknown as { publishTrack: ReturnType<typeof vi.fn> }).publishTrack,
  ).not.toHaveBeenCalled();
  expect(track.stop).toHaveBeenCalled();
  expect(provider.snapshot().muted).toBe(true);
  await provider.disconnect();
});

it('leaves voice even when the microphone mixer or its AudioContext refuse to close', async () => {
  const { provider, room } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  await provider.mute(false);
  const internals = provider as unknown as {
    mixer: { destroy: ReturnType<typeof vi.fn> } | null;
    soundContext: { state?: string; close: ReturnType<typeof vi.fn> } | null;
  };
  const mixer = internals.mixer!,
    context = internals.soundContext!;
  expect(mixer).toBeTruthy();
  expect(context).toBeTruthy();
  mixer.destroy.mockRejectedValueOnce(new Error('worklet gone'));
  context.close.mockRejectedValueOnce(
    new DOMException('Cannot close a closed AudioContext.', 'InvalidStateError'),
  );
  await expect(provider.disconnect()).resolves.toBeUndefined();
  expect(context.close).toHaveBeenCalled();
  expect(internals.mixer).toBeNull();
  expect(internals.soundContext).toBeNull();
  expect(provider.snapshot()).toMatchObject({ status: 'not-configured', muted: true, error: null });
  // The next join is not blocked by the failed teardown.
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  expect(room.connect).toHaveBeenCalledTimes(2);
  await provider.disconnect();
});

it('does not close an AudioContext that is already closed when leaving voice', async () => {
  const { provider } = fixture();
  await provider.connectRoom('room', 'token', 'ws://localhost:7880');
  const close = vi.fn(async () => {
    throw new DOMException('Cannot close a closed AudioContext.', 'InvalidStateError');
  });
  (provider as unknown as { soundContext: unknown }).soundContext = { state: 'closed', close };
  await expect(provider.disconnect()).resolves.toBeUndefined();
  expect(close).not.toHaveBeenCalled();
});

describe('personal volume up to 200%', () => {
  function voice(identity = 'bob') {
    const element = document.createElement('audio');
    element.play = vi.fn(async () => {});
    element.pause = vi.fn();
    const track = {
      kind: 'audio',
      attach: () => element,
      setAudioContext: vi.fn(),
      setVolume: vi.fn(),
    };
    const publication = { trackSid: `TR_${identity}`, source: Track.Source.Microphone, track };
    const person = {
      identity,
      setVolume: vi.fn(),
      trackPublications: new Map([[publication.trackSid, publication]]),
    };
    return { element, track, publication, person };
  }
  it('maps 0, 100% and 200% to gains, boosting above 100% through Web Audio', async () => {
    const { provider, room, emit } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    const { element, track, publication, person } = voice();
    room.remoteParticipants.set(person.identity, person);
    emit(RoomEvent.TrackSubscribed, track, publication, person);
    provider.setParticipantVolume('bob', 0);
    expect(person.setVolume).toHaveBeenLastCalledWith(0, Track.Source.Microphone);
    provider.setParticipantVolume('bob', 1);
    expect(person.setVolume).toHaveBeenLastCalledWith(1, Track.Source.Microphone);
    // Up to 100% the ordinary element volume is used.
    expect(track.setAudioContext).not.toHaveBeenCalled();
    expect(element.muted).toBe(false);
    provider.setParticipantVolume('bob', 2);
    expect(track.setAudioContext).toHaveBeenLastCalledWith(expect.any(Object));
    expect(element.muted).toBe(true);
    expect(person.setVolume).toHaveBeenLastCalledWith(2, Track.Source.Microphone);
    provider.setParticipantVolume('bob', 1.5);
    expect(person.setVolume).toHaveBeenLastCalledWith(1.5, Track.Source.Microphone);
    expect(track.setAudioContext).toHaveBeenCalledTimes(1);
    // Back to 100%: the element plays again and nothing above 1 reaches it.
    provider.setParticipantVolume('bob', 1);
    expect(track.setAudioContext).toHaveBeenLastCalledWith(undefined);
    expect(element.muted).toBe(false);
    expect(person.setVolume).toHaveBeenLastCalledWith(1, Track.Source.Microphone);
    expect(() => provider.setParticipantVolume('bob', 2.01)).toThrow();
    expect(() => provider.setParticipantVolume('bob', -0.1)).toThrow();
    expect(() => provider.setParticipantVolume('bob', Number.NaN)).toThrow();
    expect(provider.snapshot().participants.find((p) => p.id === 'bob')?.volume).toBe(1);
    await provider.disconnect();
  });
  it('keeps the music bot curve and caps it at the element volume', async () => {
    const { provider, room } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    const { person } = voice('rooms-music-room');
    room.remoteParticipants.set(person.identity, person);
    provider.setParticipantVolume(person.identity, 0.5);
    expect(person.setVolume).toHaveBeenLastCalledWith(0.25, Track.Source.Microphone);
    provider.setParticipantVolume(person.identity, 2);
    expect(person.setVolume).toHaveBeenLastCalledWith(1, Track.Source.Microphone);
    await provider.disconnect();
  });
  it('silences a boosted person while deafened and restores the level afterwards', async () => {
    const { provider, room, emit } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    const { element, track, publication, person } = voice();
    room.remoteParticipants.set(person.identity, person);
    emit(RoomEvent.TrackSubscribed, track, publication, person);
    provider.setParticipantVolume('bob', 1.8);
    await provider.deafen(true);
    expect(person.setVolume).toHaveBeenLastCalledWith(0, Track.Source.Microphone);
    expect(element.muted).toBe(true);
    // Lowering the level while deafened must not leak sound through the element.
    provider.setParticipantVolume('bob', 0.7);
    expect(element.muted).toBe(true);
    provider.setParticipantVolume('bob', 1.2);
    expect(person.setVolume).toHaveBeenLastCalledWith(0, Track.Source.Microphone);
    await provider.deafen(false);
    expect(person.setVolume).toHaveBeenLastCalledWith(1.2, Track.Source.Microphone);
    provider.setParticipantVolume('bob', 0);
    expect(person.setVolume).toHaveBeenLastCalledWith(0, Track.Source.Microphone);
    await provider.disconnect();
  });
  it('boosts a replacement track right away and persists levels per account up to 200%', async () => {
    localStorage.clear();
    const first = fixture();
    first.provider.setListenerScope('DEMO-server:alice');
    await first.provider.connectRoom('room', 'token', 'ws://localhost:7880');
    first.provider.setParticipantVolume('bob', 1.75);
    first.provider.setScreenVolume('bob', 0.5);
    expect(() => first.provider.setScreenVolume('bob', 1.5)).toThrow();
    await first.provider.disconnect();
    // A stored screen level above 100% is never trusted, a person level up to 200% is.
    localStorage.setItem(
      'rooms-listener-levels-v1:DEMO-server:alice',
      JSON.stringify({ bob: 1.75, 'screen:bob': 1.9, carl: 2.5 }),
    );
    const second = fixture();
    second.provider.setListenerScope('DEMO-server:alice');
    await second.provider.connectRoom('room', 'token', 'ws://localhost:7880');
    const { track, publication, person } = voice();
    second.room.remoteParticipants.set(person.identity, person);
    second.emit(RoomEvent.TrackSubscribed, track, publication, person);
    expect(track.setAudioContext).toHaveBeenLastCalledWith(expect.any(Object));
    expect(person.setVolume).toHaveBeenLastCalledWith(1.75, Track.Source.Microphone);
    expect(JSON.parse(localStorage.getItem('rooms-listener-levels-v1:DEMO-server:alice')!)).toEqual(
      expect.objectContaining({ bob: 1.75 }),
    );
    await second.provider.disconnect();
    localStorage.clear();
  });
});

describe('changing a running screen share in place', () => {
  const capture = (name: string) => ({
    name,
    readyState: 'live',
    contentHint: '',
    stop: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    getConstraints: vi.fn(() => ({ width: { ideal: 1920 } })),
    applyConstraints: vi.fn(async () => {}),
  });
  type Capture = ReturnType<typeof capture>;
  async function sharing(layerEncodings = 3, withSound = true) {
    const base = fixture();
    // The fixture adds publishTrack/unpublishTrack with Object.assign, so its type omits them.
    const ctx = {
      ...base,
      local: base.local as typeof base.local & {
        publishTrack: ReturnType<typeof vi.fn>;
        unpublishTrack: ReturnType<typeof vi.fn>;
      },
    };
    await ctx.provider.connectRoom('room', 'token', 'ws://localhost:7880');
    const old = capture('old');
    const video = {
      mediaStreamTrack: old as Capture,
      publishOptions: { simulcast: true, screenShareEncoding: { maxBitrate: 8_000_000 } },
      lastEncodedDimensions: { width: 1920, height: 1080 } as unknown,
      sender: { getParameters: vi.fn(() => ({ encodings: new Array(layerEncodings).fill({}) })) },
      replaceTrack: vi.fn(async (track: Capture) => {
        video.mediaStreamTrack = track;
      }),
    };
    const sound = { stop: vi.fn() };
    let soundPublished = withSound;
    ctx.local.getTrackPublication.mockImplementation((source: Track.Source) =>
      source === Track.Source.ScreenShare
        ? { track: video }
        : source === Track.Source.ScreenShareAudio && soundPublished
          ? { track: sound }
          : undefined,
    );
    await ctx.provider.publishScreen({ quality: '1080p60' });
    ctx.local.unpublishTrack.mockImplementation(async (track: unknown) => {
      if (track === sound) soundPublished = false;
    });
    ctx.local.publishTrack.mockImplementation(async (track: unknown, options: any) => {
      if (options?.source === Track.Source.ScreenShareAudio) {
        soundPublished = true;
        sound.stop = vi.fn();
      }
      void track;
    });
    return { ...ctx, video, old, sound };
  }
  const display = (stream: { video?: Capture[]; audio?: { stop: () => void }[] }) => {
    const getDisplayMedia = vi.fn(async () => ({
      getVideoTracks: () => stream.video ?? [],
      getAudioTracks: () => stream.audio ?? [],
      getTracks: () => [...(stream.video ?? []), ...(stream.audio ?? [])],
    }));
    vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getDisplayMedia } });
    return getDisplayMedia;
  };
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('swaps the picture on the live publication: nothing is unpublished, sound stays', async () => {
    const { provider, local, video, old, sound } = await sharing();
    const next = capture('next');
    display({ video: [next] });
    await provider.changeScreenSource();
    expect(video.replaceTrack).toHaveBeenCalledWith(next, { userProvidedTrack: false });
    expect(next.contentHint).toBe('motion');
    expect(local.unpublishTrack).not.toHaveBeenCalled();
    expect(local.publishTrack).not.toHaveBeenCalled();
    expect(local.setScreenShareEnabled).toHaveBeenCalledTimes(1);
    expect(old.stop).not.toHaveBeenCalled();
    expect(sound.stop).not.toHaveBeenCalled();
    expect(provider.snapshot()).toMatchObject({ sharing: true, sharingAudio: true });
    await provider.disconnect();
  });
  it('keeps the old source when the new one cannot be captured or swapped in', async () => {
    const { provider, local, video, old } = await sharing();
    const getDisplayMedia = display({});
    getDisplayMedia.mockRejectedValueOnce(new Error('Permission denied'));
    await expect(provider.changeScreenSource()).rejects.toThrow('Permission denied');
    expect(video.replaceTrack).not.toHaveBeenCalled();
    const next = capture('next');
    display({ video: [next] });
    video.replaceTrack.mockRejectedValueOnce(new Error('sender closed'));
    await expect(provider.changeScreenSource()).rejects.toThrow('sender closed');
    expect(next.stop).toHaveBeenCalled();
    expect(old.stop).not.toHaveBeenCalled();
    expect(video.mediaStreamTrack).toBe(old);
    expect(local.setScreenShareEnabled).toHaveBeenCalledTimes(1);
    expect(provider.snapshot().sharing).toBe(true);
    await provider.disconnect();
  });
  it('moves to another preset on the live sender and reports it', async () => {
    const { provider, local, video, old } = await sharing();
    expect(provider.snapshot().sharingQuality).toBe('1080p60');
    await provider.changeScreenQuality('1080p30');
    expect(old.applyConstraints).toHaveBeenCalledWith(
      expect.objectContaining({ frameRate: { ideal: 30 } }),
    );
    expect(video.publishOptions.screenShareEncoding).toMatchObject({ maxBitrate: 5_000_000 });
    expect(video.lastEncodedDimensions).toBeUndefined();
    expect(video.replaceTrack).toHaveBeenCalledWith(old, { userProvidedTrack: false });
    expect(local.unpublishTrack).not.toHaveBeenCalled();
    expect(provider.snapshot().sharingQuality).toBe('1080p30');
    await provider.disconnect();
  });
  it('publishes the same capture again only when the layer count differs (720p30)', async () => {
    const { provider, local, video, old } = await sharing();
    await provider.changeScreenQuality('720p30');
    expect(local.unpublishTrack).toHaveBeenCalledWith(video, false);
    expect(local.publishTrack).toHaveBeenCalledWith(
      video,
      expect.objectContaining({ source: Track.Source.ScreenShare, simulcast: true }),
    );
    expect(old.stop).not.toHaveBeenCalled();
    expect(provider.snapshot().sharingQuality).toBe('720p30');
    await provider.disconnect();
  });
  it('a refused quality change leaves the previous quality running', async () => {
    const { provider, video, old } = await sharing();
    const options = video.publishOptions;
    old.applyConstraints.mockRejectedValueOnce(new Error('Overconstrained'));
    await expect(provider.changeScreenQuality('4k30')).rejects.toThrow('Overconstrained');
    expect(video.publishOptions).toBe(options);
    expect(video.replaceTrack).not.toHaveBeenCalled();
    expect(provider.snapshot()).toMatchObject({ sharing: true, sharingQuality: '1080p60' });
    await provider.disconnect();
  });
  it('turns the sound off without touching the picture, and on again from a capture', async () => {
    const { provider, local, video, sound } = await sharing();
    await expect(provider.setScreenSound(false)).resolves.toEqual({ audio: false });
    expect(local.unpublishTrack).toHaveBeenCalledWith(sound, true);
    expect(provider.snapshot()).toMatchObject({ sharing: true, sharingAudio: false });
    expect(video.replaceTrack).not.toHaveBeenCalled();
    vi.stubGlobal('MediaStream', class {});
    // The SDK probes a new audio track for silence with a real AudioContext.
    vi.spyOn(LocalAudioTrack.prototype, 'checkForSilence').mockResolvedValue(false);
    const picture = capture('throwaway');
    const loopback = Object.assign(capture('loopback'), { kind: 'audio', getSettings: () => ({}) });
    display({ video: [picture], audio: [loopback] });
    await expect(provider.setScreenSound(true)).resolves.toEqual({ audio: true });
    expect(picture.stop).toHaveBeenCalled();
    expect(local.publishTrack).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: Track.Source.ScreenShareAudio, dtx: false, red: false }),
    );
    expect(provider.snapshot().sharingAudio).toBe(true);
    await provider.disconnect();
  });
  it('reports no sound when the capture comes without a loopback track', async () => {
    const { provider, local } = await sharing(3, false);
    const picture = capture('throwaway');
    display({ video: [picture] });
    await expect(provider.setScreenSound(true)).resolves.toEqual({ audio: false });
    expect(picture.stop).toHaveBeenCalled();
    expect(local.publishTrack).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: Track.Source.ScreenShareAudio }),
    );
    await provider.disconnect();
  });
  it('refuses every change while nothing is shared', async () => {
    const { provider } = fixture();
    await provider.connectRoom('room', 'token', 'ws://localhost:7880');
    await expect(provider.changeScreenSource()).rejects.toThrow('not being shared');
    await expect(provider.changeScreenQuality('720p30')).rejects.toThrow('not being shared');
    await expect(provider.setScreenSound(false)).rejects.toThrow('not being shared');
    await provider.disconnect();
  });
});
