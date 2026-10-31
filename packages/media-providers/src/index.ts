import { t } from '@rooms/i18n';
import { SpeakingMeter } from './speaking-meter';
import { captureMissesInput, inputDeviceLabel } from './input-device';
export { selectedInputLabel } from './input-device';
import type { NoiseSuppressionMode, NoiseProcessingState } from './noise-suppression';
import { SoundboardMixer } from './soundboard';
import {
  DEFAULT_MIC_GATE,
  micGateSettings,
  type MicGateReport,
  type MicGateSettings,
} from './mic-gate';
import {
  FLAT_EQUALIZER,
  equalizerNodes,
  isFlat,
  parseEqualizer,
  tuneEqualizer,
  type MusicEqualizer,
} from './music-equalizer';
export type { MusicEqualizer } from './music-equalizer';
import {
  ConnectionState,
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  LocalAudioTrack,
  LocalVideoTrack,
  VideoPreset,
  VideoQuality,
  createLocalAudioTrack,
  type Participant,
  type RemoteParticipant,
  type TrackPublication,
} from 'livekit-client';
import {
  screenPublishPlan,
  screenSubscriptionQuality,
  type ScreenLayer,
  type ScreenShareContent,
  type ScreenShareQuality,
  type ScreenViewQuality,
} from './screen-quality';
export {
  screenProfiles,
  screenPublishPlan,
  screenQualityChoices,
  screenQualitySelection,
  screenSimulcastLayers,
  screenSubscriptionQuality,
  screenLayerLines,
} from './screen-quality';
export type {
  ScreenLayer,
  ScreenShareContent,
  ScreenShareQuality,
  ScreenViewQuality,
} from './screen-quality';
import type { ConnectionStatus } from '@rooms/contracts';
import {
  PERSONAL_SOUND_ATTRIBUTES,
  PERSONAL_SOUND_EVENTS,
  isPersonalSoundId,
} from '../../shared-contracts/src/personal-sounds';

/**
 * Adaptive stream sizes a remote video to its element at 1x density, so a watched screen in a
 * normal window (or on a 150% scaled Windows display) came in at 540p or 720p. A screen share asks
 * for four times its element size instead: Otomatik gets the top layer and the server steps down
 * only when the network cannot carry it, while a hidden share still pauses. Cameras are unchanged.
 */
const SCREEN_PIXEL_DENSITY = 4;
function fullSizeScreen(track: unknown) {
  if (!track || typeof track !== 'object' || !('adaptiveStreamSettings' in track)) return;
  const video = track as { adaptiveStreamSettings?: object };
  if (video.adaptiveStreamSettings)
    video.adaptiveStreamSettings = {
      ...video.adaptiveStreamSettings,
      pixelDensity: SCREEN_PIXEL_DENSITY,
    };
}
export interface MediaParticipant {
  id: string;
  name: string;
  local: boolean;
  muted: boolean;
  /** Not hearing the room; shared by the access service as the rooms.deafened attribute. */
  deafened?: boolean;
  speaking: boolean;
  camera: boolean;
  screen: boolean;
  /** This person's screen share carries sound (a screen_share_audio publication exists). */
  screenAudio?: boolean;
  volume: number;
  screenVolume?: number;
  quality: string;
  /** Screen share this person chose to watch, as they announced it; null when not watching. */
  watching?: string | null;
  /** Entrance and leave sounds the access service stamped on this person; absent means classic. */
  sounds?: { enter?: string; leave?: string };
}
export interface MediaTrack {
  id: string;
  participantId: string;
  source: string;
  kind: string;
  local: boolean;
  muted: boolean;
  /** False for a remote screen share that is only advertised until the listener watches it. */
  subscribed?: boolean;
  /** Layers a remote screen share offers; one entry when its publisher sends a single quality. */
  layers?: ScreenLayer[];
}
export interface MediaDiagnostics {
  bitrate: number | null;
  packetLoss: number | null;
  rtt: number | null;
  video?: {
    width: number;
    height: number;
    framesPerSecond: number | null;
    codec: string | null;
    direction: 'sent' | 'received';
  };
}
export interface MediaSnapshot {
  status: ConnectionStatus;
  roomId: string | null;
  error: string | null;
  muted: boolean;
  deafened: boolean;
  camera: boolean;
  sharing: boolean;
  /** This client's screen share is sending system audio right now. */
  sharingAudio?: boolean;
  /** Quality preset this client's screen share was published with; null while not sharing. */
  sharingQuality?: ScreenShareQuality | null;
  /** This viewer's screen share quality; 'auto' until they pick one (the desktop remembers it). */
  screenQuality?: ScreenViewQuality;
  audioBlocked: boolean;
  inputDeviceFallback?: boolean;
  /** OS name of the microphone the room hears; null or absent while unknown. */
  inputDevice?: string | null;
  participants: MediaParticipant[];
  tracks: MediaTrack[];
  diagnostics: MediaDiagnostics;
  noiseProcessing?: NoiseProcessingState;
}
export interface MediaGrant {
  roomId: string;
  url: string;
  token: string;
}
export interface ScreenShareOptions {
  quality?: ScreenShareQuality;
  audio?: boolean;
  content?: ScreenShareContent;
}
export interface RealtimeMediaProvider {
  publishControl?(payload: string, destination: string, reliable: boolean): Promise<void>;
  onControl?(listener: (payload: string, senderId: string) => void): () => void;
  /** Lossy, room-wide pointer positions for shared surfaces such as the whiteboard. */
  publishCursor?(payload: string): Promise<void>;
  onCursor?(listener: (payload: string, senderId: string) => void): () => void;
  /** Small room-wide visual cues (the soundboard's floating emoji); old clients ignore the topic. */
  publishReaction?(payload: string): Promise<void>;
  onReaction?(listener: (payload: string, senderId: string) => void): () => void;
  /** A moderator asked this client to join another voice room (sent by the server only). */
  onMove?(listener: (channelId: string) => void): () => void;
  readonly status: ConnectionStatus;
  connectRoom(roomId: string, shortLivedMembershipToken: string, serverUrl: string): Promise<void>;
  publishMic(deviceId?: string): Promise<void>;
  setNoiseSuppression(value: boolean, mode?: NoiseSuppressionMode): Promise<void>;
  /** Scales what the room hears from this microphone: 1 as captured, 0–2. */
  setInputLevel?(value: number): void;
  /** Input sensitivity: below it nothing is sent and the speaking ring stays off. */
  setInputGate?(settings: MicGateSettings): void;
  /** The leveler after the noise filter ("Ses seviyesini dengele"). */
  setMicLeveler?(value: boolean): void;
  /** Live level of the sent microphone and the gate threshold, while the microphone runs. */
  subscribeInputMeter?(listener: (report: MicGateReport) => void): () => void;
  playSoundboard(buffer: AudioBuffer, volume: number): Promise<void>;
  stopSoundboard(): void;
  publishCamera(enabled: boolean, deviceId?: string): Promise<void>;
  /** Moves a published camera to another device (empty: the system default). */
  selectCamera?(deviceId: string): Promise<void>;
  publishScreen(options?: ScreenShareOptions): Promise<void>;
  stopScreen(): Promise<void>;
  /**
   * Swaps the shared screen or window for the one the host just selected, on the live
   * publication, so viewers stay subscribed. A failure leaves the previous source sharing.
   */
  changeScreenSource?(): Promise<void>;
  /** Moves the running share to another quality preset without stopping it. */
  changeScreenQuality?(quality: ScreenShareQuality): Promise<void>;
  /** Turns the share's system sound off, or on again (needs a capture the host just selected). */
  setScreenSound?(on: boolean): Promise<{ audio: boolean }>;
  subscribe(participantId: string): Promise<MediaStream>;
  attachTrack(trackId: string, element: HTMLMediaElement): () => void;
  deviceSelection(inputId: string, outputId: string): Promise<void>;
  participantState(): MediaParticipant[];
  diagnostics(): MediaDiagnostics;
  snapshot(): MediaSnapshot;
  subscribeState(listener: () => void): () => void;
  mute(value: boolean): Promise<void>;
  deafen(value: boolean): Promise<void>;
  setListenerScope?(scope: string): void;
  /** This listener's own DJ equalizer; it never changes what others hear. */
  musicEqualizer?(): MusicEqualizer;
  setMusicEqualizer?(value: MusicEqualizer): void;
  setParticipantVolume(participantId: string, volume: number): void;
  setScreenVolume?(participantId: string, volume: number): void;
  watchScreen?(participantId: string | null): void;
  /** Caps the screen shares this viewer receives ('auto' or lines such as 720) for the session. */
  setScreenQuality?(quality: ScreenViewQuality): void;
  startAudio(): Promise<void>;
  /**
   * Leaves the room. keepMicrophone (a switch to another room) keeps a live, unmuted, filtered
   * microphone running so the next room's mute(false) publishes it instead of opening a new one;
   * a plain disconnect, mute(true) or deafen(true) releases it.
   */
  disconnect(options?: { keepMicrophone?: boolean }): Promise<void>;
  /** Warms DNS/TLS to the media server (e.g. on hovering a voice room); never joins anything. */
  prepareConnection?(serverUrl: string): void;
  reconnect(): Promise<void>;
}
const WATCH_TOPIC = 'rooms-watch-v1';
const videoQualities = {
  low: VideoQuality.LOW,
  medium: VideoQuality.MEDIUM,
  high: VideoQuality.HIGH,
} as const;
// Announced layers carry the protocol enum; LiveKit's client enum uses the same numbers.
/** Loopback capture of the system sound for a screen share: stereo, untouched, our own voices out. */
const SCREEN_AUDIO_CAPTURE = {
  channelCount: 2,
  noiseSuppression: false,
  autoGainControl: false,
  echoCancellation: false,
  restrictOwnAudio: true,
};
/** Publish options of a screen share's picture, from its quality plan. */
function screenPublishOptions(plan: ReturnType<typeof screenPublishPlan>) {
  return {
    videoCodec: 'h264' as const,
    screenShareEncoding: plan.encoding,
    simulcast: true,
    screenShareSimulcastLayers: plan.layers.map(
      (layer) => new VideoPreset(layer.width, layer.height, layer.bitrate, layer.frameRate),
    ),
    degradationPreference: plan.degradationPreference,
    audioPreset: { maxBitrate: 128000 },
    forceStereo: true,
    // Game and video sound is not speech: DTX would cut quiet passages, RED doubles stereo.
    dtx: false,
    red: false,
  };
}
const qualityNames: Record<number, ScreenLayer['quality'] | undefined> = {
  [VideoQuality.LOW]: 'low',
  [VideoQuality.MEDIUM]: 'medium',
  [VideoQuality.HIGH]: 'high',
};
/** Layers a published screen share announced; rc.34 publishers send q/h, no simulcast sends one. */
function screenLayers(pub: TrackPublication): ScreenLayer[] {
  return (pub.trackInfo?.layers ?? []).flatMap((layer) => {
    const quality = qualityNames[Number(layer.quality)];
    return quality && layer.width > 0 && layer.height > 0
      ? [{ quality, width: layer.width, height: layer.height }]
      : [];
  });
}
const CURSOR_TOPIC = 'rooms-cursor-v1';
const REACTION_TOPIC = 'rooms-reaction-v1';
const MOVE_TOPIC = 'rooms-move-v1';
const isScreenSource = (source: Track.Source) =>
  source === Track.Source.ScreenShare || source === Track.Source.ScreenShareAudio;
/** `{ watching: identity | null }`; anything else is ignored. */
export function parseWatch(payload: Uint8Array): string | null | undefined {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
    const watching = value?.watching;
    if (watching === null) return null;
    if (typeof watching === 'string' && watching.length > 0 && watching.length <= 128)
      return watching;
  } catch {
    /* Malformed data is never input. */
  }
  return undefined;
}
/** Bot music needs finer attenuation than speech; the UI still stores a 0–1 level. */
function listenerGain(id: string, level: number) {
  return id.startsWith('rooms-music-') ? level * level : level;
}
/** The loudest a listener can set one person: 200%, i.e. a Web Audio gain of 2. */
export const MAX_PARTICIPANT_VOLUME = 2;
/** A stored or requested personal level is a finite number from 0 to 200%. */
function isParticipantLevel(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= MAX_PARTICIPANT_VOLUME
  );
}
/** Only well-formed ids survive, so a stray attribute can never become a fetch path. */
function personalSounds(attributes: Readonly<Record<string, string>> | undefined) {
  let sounds: MediaParticipant['sounds'];
  for (const event of PERSONAL_SOUND_EVENTS) {
    const value = attributes?.[PERSONAL_SOUND_ATTRIBUTES[event]];
    if (isPersonalSoundId(value)) sounds = { ...sounds, [event]: value };
  }
  return sounds;
}
/** The browser's answer when a device id names nothing that is plugged in or paired now. */
function isMissingDevice(error: unknown) {
  const failure = error as { name?: string; constraint?: string } | null;
  return (
    failure?.name === 'NotFoundError' ||
    (failure?.name === 'OverconstrainedError' &&
      (!failure.constraint || failure.constraint === 'deviceId'))
  );
}
/** The system's devices, or null when it cannot list them (then every id counts as listed). */
async function listDevices(): Promise<readonly MediaDeviceInfo[] | null> {
  try {
    return (await navigator.mediaDevices?.enumerateDevices?.()) ?? [];
  } catch {
    return null;
  }
}
/** False only when the system lists devices of this kind by id and the id is not among them. */
function deviceListed(
  devices: readonly MediaDeviceInfo[] | null,
  kind: MediaDeviceKind,
  id: string,
) {
  const ids = (devices ?? []).filter((d) => d.kind === kind && d.deviceId).map((d) => d.deviceId);
  return !ids.length || ids.includes(id);
}
/** How long a prewarmed media server counts as warm before another hover may warm it again. */
const PREPARE_INTERVAL_MS = 20_000;
const emptyDiagnostics = (): MediaDiagnostics => ({ bitrate: null, packetLoss: null, rtt: null });
/** No auth credentials other than the in-memory, short-lived room token enter this adapter. */
export class LiveKitMediaProvider implements RealtimeMediaProvider {
  private controlListeners = new Set<(payload: string, senderId: string) => void>();
  onControl(listener: (payload: string, senderId: string) => void) {
    this.controlListeners.add(listener);
    return () => {
      this.controlListeners.delete(listener);
    };
  }
  private cursorListeners = new Set<(payload: string, senderId: string) => void>();
  onCursor(listener: (payload: string, senderId: string) => void) {
    this.cursorListeners.add(listener);
    return () => {
      this.cursorListeners.delete(listener);
    };
  }
  private reactionListeners = new Set<(payload: string, senderId: string) => void>();
  onReaction(listener: (payload: string, senderId: string) => void) {
    this.reactionListeners.add(listener);
    return () => {
      this.reactionListeners.delete(listener);
    };
  }
  async publishReaction(payload: string) {
    if (new TextEncoder().encode(payload).length > 256) throw Error('Invalid reaction packet.');
    const room = this.room;
    if (!room || this.state.status !== 'connected') return;
    await room.localParticipant.publishData(new TextEncoder().encode(payload), {
      reliable: true,
      topic: REACTION_TOPIC,
    });
  }
  private moveListeners = new Set<(channelId: string) => void>();
  onMove(listener: (channelId: string) => void) {
    this.moveListeners.add(listener);
    return () => {
      this.moveListeners.delete(listener);
    };
  }
  async publishCursor(payload: string) {
    if (new TextEncoder().encode(payload).length > 512) throw Error('Invalid cursor packet.');
    const room = this.room;
    if (!room || this.state.status !== 'connected') return;
    await room.localParticipant.publishData(new TextEncoder().encode(payload), {
      reliable: false,
      topic: CURSOR_TOPIC,
    });
  }
  async publishControl(payload: string, destination: string, reliable: boolean) {
    if (new TextEncoder().encode(payload).length > 4096 || !destination || destination.length > 128)
      throw Error('Invalid control packet.');
    const room = this.requireRoom();
    await room.localParticipant.publishData(new TextEncoder().encode(payload), {
      reliable,
      topic: 'rooms-control-v1',
      destinationIdentities: [destination],
    });
  }
  private room: Room | null = null;
  private grant: MediaGrant | null = null;
  private listeners = new Set<() => void>();
  private audio = new Map<string, HTMLMediaElement>();
  private volumes = new Map<string, number>();
  private watchedScreen: string | null = null;
  /** What the running screen share was published with; null when this client is not sharing. */
  private shareOptions: { quality: ScreenShareQuality; content: ScreenShareContent } | null = null;
  /** The viewer's pick for this app session; null until they choose, so LiveKit stays untouched. */
  private screenQuality: ScreenViewQuality | null = null;
  /** Announced screen choice of each remote participant, keyed by their LiveKit identity. */
  private watchers = new Map<string, string | null>();
  private screenAudio = new Set<string>();
  private listenerScope = '';
  private outputDeviceId = '';
  setListenerScope(scope: string) {
    if (scope === this.listenerScope) return;
    this.listenerScope = scope;
    this.volumes.clear();
    try {
      this.equalizer =
        (scope &&
          parseEqualizer(JSON.parse(localStorage.getItem(`rooms-dj-eq-v1:${scope}`) ?? 'null'))) ||
        FLAT_EQUALIZER;
    } catch {
      this.equalizer = FLAT_EQUALIZER;
    }
    this.applyEqualizer();
    try {
      const value = JSON.parse(localStorage.getItem(`rooms-listener-levels-v1:${scope}`) ?? '{}');
      if (scope && value && typeof value === 'object' && !Array.isArray(value))
        for (const [id, level] of Object.entries(value).slice(0, 512))
          if (
            id.length <= 256 &&
            isParticipantLevel(level) &&
            // Shared-screen sound keeps the plain element volume, which stops at 100%.
            (level <= 1 || !id.startsWith('screen:'))
          )
            this.volumes.set(id, level);
    } catch {
      /* Missing or damaged settings do not prevent joining. */
    }
    for (const [id, person] of this.room?.remoteParticipants ?? []) {
      this.applyPersonVolume(person);
      if (person.getTrackPublication?.(Track.Source.ScreenShareAudio))
        person.setVolume(this.volumes.get(`screen:${id}`) ?? 1, Track.Source.ScreenShareAudio);
    }
    if (this.room) this.sync();
  }
  private attachments = new Set<() => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private speakingMeter = new SpeakingMeter(() => this.sync());
  private state: MediaSnapshot = {
    status: 'not-configured',
    roomId: null,
    error: null,
    muted: true,
    deafened: false,
    camera: false,
    sharing: false,
    sharingAudio: false,
    screenQuality: 'auto',
    audioBlocked: false,
    participants: [],
    tracks: [],
    diagnostics: emptyDiagnostics(),
  };
  private soundboardSerial = 0;
  private soundboardWork: Promise<void> = Promise.resolve();
  private noiseSuppression = true;
  private noiseMode: NoiseSuppressionMode = 'strong';
  private inputDeviceId: string | undefined;
  private microphoneSerial = 0;
  private pendingMic: LocalAudioTrack | null = null;
  private pendingMixer: SoundboardMixer | null = null;
  private mixer: SoundboardMixer | null = null;
  private mixerTrack: LocalAudioTrack | null = null;
  private soundContext: AudioContext | null = null;
  private epoch = 0;
  private disconnecting: Promise<void> | null = null;
  /**
   * The microphone carried from the room just left to the next one (a room switch): still
   * capturing through its noise filter, published nowhere. Reused only with the same input and
   * filter settings; anything else stops it.
   */
  private parkedMic: {
    track: LocalAudioTrack;
    device: string | undefined;
    noise: boolean;
    mode: NoiseSuppressionMode;
  } | null = null;
  private prepared = new Map<string, number>();
  private microphoneWork: Promise<void> = Promise.resolve();
  private microphoneTask<T>(operation: () => Promise<T>): Promise<T> {
    const task = this.microphoneWork.then(operation);
    this.microphoneWork = task.then(
      () => {},
      () => {},
    );
    return task;
  }
  private gateSettings: MicGateSettings = DEFAULT_MIC_GATE;
  private leveler = true;
  /** The input gate of the current mixer; null when it has none (the meter decides then). */
  private gateState: { mixer: SoundboardMixer; open: boolean } | null = null;
  private meterListeners = new Set<(report: MicGateReport) => void>();
  setInputGate(settings: MicGateSettings) {
    this.gateSettings = micGateSettings(settings);
    this.mixer?.setGate(this.gateSettings);
    this.pendingMixer?.setGate(this.gateSettings);
  }
  setMicLeveler(value: boolean) {
    this.leveler = value;
    this.mixer?.setLeveler(value);
    this.pendingMixer?.setLeveler(value);
  }
  subscribeInputMeter(listener: (report: MicGateReport) => void) {
    this.meterListeners.add(listener);
    return () => {
      this.meterListeners.delete(listener);
    };
  }
  /** Own speaking state from the gate: lit exactly while voice (or a soundboard clip) is sent. */
  private localGateSpeaking(): boolean | undefined {
    const gate = this.gateState,
      mixer = this.mixer;
    if (!gate || !mixer || gate.mixer !== mixer) return undefined;
    return gate.open || !!mixer.playing;
  }
  private inputLevel = 1;
  setInputLevel(value: number) {
    if (!Number.isFinite(value) || value < 0 || value > 2)
      throw Error('Input level must be between 0 and 2.');
    this.inputLevel = value;
    this.mixer?.setInputLevel(value);
    this.pendingMixer?.setInputLevel(value);
  }
  setNoiseSuppression(value: boolean, mode: NoiseSuppressionMode = this.noiseMode) {
    return this.microphoneTask(async () => {
      const prior = this.noiseSuppression,
        previousMode = this.noiseMode;
      const track = this.room?.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
      if (track instanceof LocalAudioTrack && track.mediaStreamTrack.readyState === 'live') {
        await this.ensureMixer(track);
        this.patch({ noiseProcessing: { status: 'starting', mode } });
        try {
          await track.applyConstraints({
            noiseSuppression: false,
            echoCancellation: true,
            autoGainControl: !value || mode !== 'strong',
          });
          await this.mixer!.setNoiseSuppression(value, mode);
          this.patch({ noiseProcessing: { status: value ? 'active' : 'off', mode } });
        } catch (error) {
          try {
            await track.applyConstraints({
              noiseSuppression: false,
              echoCancellation: true,
              autoGainControl: !prior || previousMode !== 'strong',
            });
            await this.mixer?.setNoiseSuppression(prior, previousMode);
            this.patch({
              noiseProcessing: { status: prior ? 'active' : 'off', mode: previousMode },
            });
          } catch {
            await track.mute();
            track.stop();
            this.patch({ muted: true, noiseProcessing: { status: 'failed', mode: previousMode } });
          }
          throw error;
        }
      }
      this.noiseSuppression = value;
      this.noiseMode = mode;
    });
  }
  private async ensureMixer(track: LocalAudioTrack) {
    const epoch = this.epoch,
      serial = this.microphoneSerial;
    if (this.mixerTrack === track && this.mixer?.processedTrack?.readyState === 'live') return;
    await this.mixer?.destroy();
    await this.soundContext?.close();
    this.mixer = null;
    this.mixerTrack = null;
    const context = new AudioContext({ sampleRate: 48_000 });
    this.soundContext = context;
    track.setAudioContext(context);
    this.patch({
      noiseProcessing: { status: this.noiseSuppression ? 'starting' : 'off', mode: this.noiseMode },
    });
    const mixer = new SoundboardMixer(
      this.noiseSuppression,
      this.noiseMode,
      {
        gate: (report) => {
          if (this.mixer !== mixer && this.pendingMixer !== mixer) return;
          const open = !!report?.open;
          if (report && this.gateState?.mixer === mixer && this.gateState.open === open) return;
          this.gateState = report ? { mixer, open } : null;
          this.sync();
        },
        level: (report) => {
          if (this.mixer === mixer) this.meterListeners.forEach((listener) => listener(report));
        },
        playing: () => {
          if (this.mixer === mixer) this.sync();
        },
        error: () => {
          if (this.mixer !== mixer) return;
          this.stopSoundboard();
          this.patch({
            muted: true,
            error: t(
              'Gürültü filtresi durdu. Mikrofon kapatıldı. Filtre modunu değiştirip mikrofonu yeniden aç.',
            ),
            noiseProcessing: { status: 'failed', mode: this.noiseMode },
          });
          void track
            .mute()
            .catch(() => {})
            .finally(() => track.stop());
        },
        stats: (stats) => {
          if (this.mixer === mixer && this.state.noiseProcessing?.status === 'active')
            this.patch({ noiseProcessing: { status: 'active', mode: this.noiseMode, stats } });
        },
      },
      { gate: this.gateSettings, leveler: this.leveler },
    );
    mixer.setInputLevel(this.inputLevel);
    this.pendingMixer = mixer;
    try {
      // A speaker gone mid-call leaves this on the default output; it never costs the microphone.
      await (context as AudioContext & { setSinkId?(id: string): Promise<void> })
        .setSinkId?.(this.outputDeviceId)
        ?.catch((error: unknown) => {
          if (!isMissingDevice(error)) throw error;
        });
      await track.setProcessor(mixer);
      await context.resume();
      if (epoch !== this.epoch || serial !== this.microphoneSerial)
        throw new DOMException('Cancelled', 'AbortError');
      this.mixer = mixer;
      this.mixerTrack = track;
      this.patch({
        noiseProcessing: { status: this.noiseSuppression ? 'active' : 'off', mode: this.noiseMode },
      });
    } catch (error) {
      await mixer.destroy();
      await context.close();
      if (this.soundContext === context) this.soundContext = null;
      if (epoch === this.epoch && serial === this.microphoneSerial)
        this.patch({ noiseProcessing: { status: 'failed', mode: this.noiseMode } });
      throw error;
    } finally {
      if (this.pendingMixer === mixer) this.pendingMixer = null;
    }
  }
  stopSoundboard() {
    ++this.soundboardSerial;
    this.mixer?.stop();
  }
  playSoundboard(buffer: AudioBuffer, volume: number) {
    const serial = ++this.soundboardSerial;
    const task = this.soundboardWork.then(() => this.playClip(buffer, volume, serial));
    this.soundboardWork = task.catch(() => {});
    return task;
  }
  private async playClip(buffer: AudioBuffer, volume: number, serial: number) {
    if (serial !== this.soundboardSerial) return;
    if (!Number.isFinite(volume) || volume < 0 || volume > 1 || buffer.duration > 8)
      throw new Error(t('En fazla 8 saniyelik bir ses seç.'));
    const room = this.requireRoom();
    if (this.state.muted || this.state.deafened) throw new Error(t('Önce mikrofonu aç.'));
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (!(track instanceof LocalAudioTrack)) throw new Error(t('Mikrofon kullanılamıyor.'));
    await this.microphoneTask(() => this.ensureMixer(track));
    if (this.room !== room || !room.localParticipant.isMicrophoneEnabled || this.state.deafened)
      throw new Error(t('Mikrofon kapalı.'));
    await this.mixer!.play(
      buffer,
      volume,
      () =>
        serial === this.soundboardSerial &&
        this.room === room &&
        room.localParticipant.isMicrophoneEnabled &&
        !this.state.deafened,
    );
    if (this.room !== room || !room.localParticipant.isMicrophoneEnabled || this.state.deafened)
      this.stopSoundboard();
  }
  private priorStats: { time: number; bytes: number } | null = null;
  constructor(
    private readonly createRoom: () => Room = () =>
      new Room({
        adaptiveStream: true,
        dynacast: true,
        disconnectOnPageLeave: true,
        audioCaptureDefaults: {
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: true,
        },
      }),
  ) {}
  get status() {
    return this.state.status;
  }
  snapshot = () => this.state;
  subscribeState = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private patch(patch: Partial<MediaSnapshot>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private requireRoom() {
    if (!this.room || this.status !== 'connected')
      throw new Error('Join a connected voice room first.');
    return this.room;
  }
  private fail(error: unknown) {
    // SDK exceptions may contain signaling URLs/JWTs: expose only an actionable category.
    const name =
      typeof error === 'object' && error !== null && 'name' in error ? String(error.name) : '';
    this.patch({
      error:
        name === 'NotAllowedError' || name === 'PermissionDeniedError'
          ? t(
              'Mikrofon veya kamera izni kapalı. Sistem Ayarları → Gizlilik ve Güvenlik bölümünden Tayfa iznini aç.',
            )
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? t('Seçili cihaz bulunamadı. Ses ayarlarından sistem varsayılanını seç.')
            : name === 'NotReadableError'
              ? t(
                  'Cihaz açılamadı. Başka bir uygulamanın cihazı kullanıp kullanmadığını kontrol et.',
                )
              : t('Ses işlemi tamamlanamadı. Cihaz ayarlarını ve oda bağlantısını kontrol et.'),
    });
  }
  private sync() {
    const room = this.room;
    if (!room) return;
    if (!room.localParticipant.isMicrophoneEnabled) this.stopSoundboard();
    const people: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
    const microphones = new Map<string, MediaStreamTrack>();
    if (this.status === 'connected')
      for (const person of people) {
        const track = person.getTrackPublication?.(Track.Source.Microphone)?.track
          ?.mediaStreamTrack;
        if (
          person.isMicrophoneEnabled &&
          track?.readyState === 'live' &&
          !person.identity.startsWith('rooms-music-')
        )
          microphones.set(person.identity, track);
      }
    this.speakingMeter.reconcile(microphones);
    this.patch({
      muted: !room.localParticipant.isMicrophoneEnabled,
      camera: room.localParticipant.isCameraEnabled,
      sharing: room.localParticipant.isScreenShareEnabled,
      sharingQuality: room.localParticipant.isScreenShareEnabled
        ? (this.shareOptions?.quality ?? null)
        : null,
      sharingAudio:
        room.localParticipant.isScreenShareEnabled &&
        !!room.localParticipant.getTrackPublication?.(Track.Source.ScreenShareAudio)?.track,
      participants: people
        .filter((p) => p.identity)
        .map((p) => ({
          id: p.identity,
          name: p.name || p.identity,
          local: p === room.localParticipant,
          muted: !p.isMicrophoneEnabled,
          deafened:
            p === room.localParticipant
              ? this.state.deafened
              : p.attributes?.['rooms.deafened'] === '1',
          // Mute and push-to-talk win: a disabled microphone is never shown as speaking.
          speaking:
            this.status === 'connected' &&
            p.isMicrophoneEnabled &&
            ((p === room.localParticipant ? this.localGateSpeaking() : undefined) ??
              this.speakingMeter.speaking(p.identity) ??
              p.isSpeaking),
          camera: p.isCameraEnabled,
          screen: p.isScreenShareEnabled,
          screenAudio:
            p.isScreenShareEnabled && !!p.getTrackPublication?.(Track.Source.ScreenShareAudio),
          volume: this.volumes.get(p.identity) ?? 1,
          screenVolume: this.volumes.get(`screen:${p.identity}`) ?? 1,
          quality: p.connectionQuality,
          watching:
            p === room.localParticipant
              ? this.watchedScreen
              : (this.watchers.get(p.identity) ?? null),
          sounds: personalSounds(p.attributes),
        })),
      tracks: people.flatMap((p) =>
        [...p.trackPublications.values()]
          .filter(
            (pub) =>
              !!pub.track ||
              (p !== room.localParticipant && pub.source === Track.Source.ScreenShare),
          )
          .map((pub) => ({
            id: pub.trackSid,
            participantId: p.identity,
            source: pub.source,
            kind: pub.kind,
            local: p === room.localParticipant,
            muted: pub.isMuted,
            subscribed: !!pub.track,
            ...(p !== room.localParticipant && pub.source === Track.Source.ScreenShare
              ? { layers: screenLayers(pub) }
              : {}),
          })),
      ),
    });
  }
  async connectRoom(roomId: string, token: string, serverUrl: string) {
    const parsed = new URL(serverUrl);
    if (
      !['wss:', 'ws:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash
    )
      throw new Error('A plain ws/wss media server URL is required.');
    if (parsed.protocol === 'ws:' && !['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname))
      throw new Error('Remote media servers require TLS.');
    if (!roomId || !token) throw new Error('A room membership grant is required.');
    // A microphone carried over from the room just left survives; a live room is left in full.
    await this.teardown(this.room ? 'release' : 'keep');
    const epoch = ++this.epoch;
    this.grant = { roomId, token, url: parsed.href };
    const room = this.createRoom();
    this.room = room;
    let controlSecond = 0,
      controlCount = 0,
      cursorSecond = 0,
      cursorCount = 0,
      reactionSecond = 0,
      reactionCount = 0;
    room.on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
      if (this.room !== room || this.state.status !== 'connected') return;
      if (!participant) {
        // Only the server sends without a participant; members cannot forge a move.
        if (topic !== MOVE_TOPIC || payload.length > 512) return;
        try {
          const channelId = JSON.parse(
            new TextDecoder('utf-8', { fatal: true }).decode(payload),
          )?.channelId;
          if (typeof channelId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(channelId))
            for (const listener of this.moveListeners) listener(channelId);
        } catch {
          /* Malformed data is never a move. */
        }
        return;
      }
      if (topic === CURSOR_TOPIC) {
        // Cursors are frequent and disposable: their own budget, never mixed with control input.
        const second = Math.floor(Date.now() / 1000);
        if (second !== cursorSecond) {
          cursorSecond = second;
          cursorCount = 0;
        }
        if (payload.length > 512 || ++cursorCount > 600) return;
        try {
          const data = new TextDecoder('utf-8', { fatal: true }).decode(payload);
          for (const listener of this.cursorListeners) listener(data, participant.identity);
        } catch {
          /* Malformed data is never input. */
        }
        return;
      }
      if (topic === REACTION_TOPIC) {
        // A sound spammed by one client must not turn into a flood of floating emoji.
        const second = Math.floor(Date.now() / 1000);
        if (second !== reactionSecond) {
          reactionSecond = second;
          reactionCount = 0;
        }
        if (payload.length > 256 || ++reactionCount > 20) return;
        try {
          const data = new TextDecoder('utf-8', { fatal: true }).decode(payload);
          for (const listener of this.reactionListeners) listener(data, participant.identity);
        } catch {
          /* Malformed data is never a reaction. */
        }
        return;
      }
      if ((topic !== 'rooms-control-v1' && topic !== WATCH_TOPIC) || payload.length > 4096) return;
      const second = Math.floor(Date.now() / 1000);
      if (second !== controlSecond) {
        controlSecond = second;
        controlCount = 0;
      }
      if (++controlCount > 256) return;
      if (topic === WATCH_TOPIC) {
        // The viewer is the authenticated sender, never a name inside the payload.
        const watching = parseWatch(payload);
        if (watching !== undefined) {
          this.watchers.set(participant.identity, watching);
          this.sync();
        }
        return;
      }
      try {
        const data = new TextDecoder('utf-8', { fatal: true }).decode(payload);
        for (const listener of this.controlListeners) listener(data, participant.identity);
      } catch {
        /* Malformed data is never input. */
      }
    });
    this.patch({ status: 'connecting', roomId, error: null });
    const sync = () => {
      if (this.room === room) this.sync();
    };
    for (const event of [
      RoomEvent.ParticipantConnected,
      RoomEvent.ParticipantDisconnected,
      RoomEvent.TrackPublished,
      RoomEvent.TrackUnpublished,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
      RoomEvent.ActiveSpeakersChanged,
      RoomEvent.ConnectionQualityChanged,
      RoomEvent.ParticipantNameChanged,
      RoomEvent.ParticipantAttributesChanged,
      RoomEvent.MediaDevicesChanged,
      RoomEvent.ActiveDeviceChanged,
    ])
      room.on(event, sync);
    room.on(RoomEvent.TrackPublished, () => {
      if (this.room === room) this.applyScreenSubscriptions();
    });
    room.on(RoomEvent.MediaDevicesChanged, () => {
      if (this.room === room) void this.followInput(room).catch(() => {});
    });
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (this.room === room) this.announceWatch(participant.identity);
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (this.room !== room) return;
      this.watchers.delete(participant.identity);
      sync();
    });
    room.on(RoomEvent.ConnectionStateChanged, (value) => {
      if (this.room !== room) return;
      const status: ConnectionStatus =
        value === ConnectionState.Connected
          ? 'connected'
          : value === ConnectionState.Connecting
            ? 'connecting'
            : value === ConnectionState.Reconnecting || value === ConnectionState.SignalReconnecting
              ? 'reconnecting'
              : 'error';
      this.patch({ status });
      sync();
    });
    room.on(RoomEvent.Disconnected, (reason) => {
      if (this.room === room) {
        this.stopSoundboard();
        this.cleanupPlayback();
        this.patch({
          status: 'error',
          muted: true,
          sharing: false,
          sharingAudio: false,
          sharingQuality: null,
          camera: false,
          tracks: [],
          participants: [],
          error:
            reason === DisconnectReason.PARTICIPANT_REMOVED
              ? 'A moderator disconnected you from the voice room.'
              : 'Voice disconnected. Rejoin to obtain a fresh membership grant.',
        });
      }
    });
    room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
      if (this.room !== room) return;
      if (isScreenSource(publication.source) && participant.identity !== this.watchedScreen) {
        // Auto-subscription delivered a screen nobody here chose to watch.
        publication.setSubscribed(false);
        return;
      }
      if (publication.source === Track.Source.ScreenShare) {
        fullSizeScreen(track);
        this.applyScreenQuality();
      }
      if (track.kind === Track.Kind.Audio && typeof document !== 'undefined') {
        const element = track.attach();
        element.hidden = true;
        document.body.append(element);
        this.audio.set(publication.trackSid, element);
        const screen = publication.source === Track.Source.ScreenShareAudio;
        if (screen) this.screenAudio.add(publication.trackSid);
        element.muted =
          this.state.deafened || (screen && this.watchedScreen !== participant.identity);
        if (screen)
          participant.setVolume(
            this.volumes.get(`screen:${participant.identity}`) ?? 1,
            Track.Source.ScreenShareAudio,
          );
        else this.applyPersonVolume(participant);
        void element.play().catch(() => this.patch({ audioBlocked: true }));
        if (participant.identity.startsWith('rooms-music-')) this.applyEqualizer();
      }
      sync();
    });
    room.on(RoomEvent.TrackUnsubscribed, (track, publication) => {
      if (this.room !== room) return;
      const element = this.audio.get(publication.trackSid);
      if (element) {
        track.detach(element);
        element.remove();
      }
      this.audio.delete(publication.trackSid);
      this.screenAudio.delete(publication.trackSid);
      this.equalized.delete(publication.trackSid);
      this.boosted.delete(publication.trackSid);
      sync();
    });
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (this.room === room) this.patch({ audioBlocked: !room.canPlaybackAudio });
    });
    room.on(RoomEvent.MediaDevicesError, (error) => {
      if (this.room === room) this.fail(error);
    });
    try {
      await room.connect(parsed.href, token, { autoSubscribe: true });
      if (epoch !== this.epoch) {
        await room.disconnect(true);
        return;
      }
      this.patch({ status: 'connected' });
      this.applyScreenSubscriptions();
      sync();
      this.timer = setInterval(() => {
        void this.measure();
      }, 5000);
    } catch (error) {
      if (epoch === this.epoch) {
        this.fail(error);
        this.patch({ status: 'error' });
        await room.disconnect(true);
        this.cleanupPlayback();
      }
      throw new Error(
        'Unable to connect to the media server. Check the server URL and room membership.',
      );
    }
  }
  private captureOptions(deviceId: string | { exact: string } | undefined) {
    return {
      deviceId,
      echoCancellation: true,
      noiseSuppression: false,
      autoGainControl: !this.noiseSuppression || this.noiseMode !== 'strong',
      channelCount: 1,
      sampleRate: 48_000,
    };
  }
  /**
   * The room keeps hearing the microphone the person selected. Chromium resolves "system
   * default" only when capture opens, and after an unplug LiveKit reopens the default, so a
   * headset switched on (or back) during a call would stay unused while another microphone
   * keeps sending, and the headset's own mute switch would silence nothing the room hears.
   */
  private followInput(room: Room) {
    return this.microphoneTask(async () => {
      const selected = this.inputDeviceId || 'default';
      const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
      if (
        this.room !== room ||
        !(track instanceof LocalAudioTrack) ||
        track.mediaStreamTrack.readyState !== 'live' ||
        !navigator.mediaDevices?.enumerateDevices
      )
        return;
      const devices = await navigator.mediaDevices.enumerateDevices();
      if (this.room !== room || (this.inputDeviceId || 'default') !== selected) return;
      if (captureMissesInput(devices, selected, track.getSourceTrackSettings())) {
        try {
          // Mute state survives the restart, and the noise filter restarts on the new input.
          await track.restartTrack(this.captureOptions({ exact: selected }));
        } catch (error) {
          if (this.room !== room) return;
          // The old capture is already closed: leave the microphone off and say why.
          await room.localParticipant.setMicrophoneEnabled(false).catch(() => {});
          this.fail(error);
          this.sync();
          return;
        }
        if (this.room !== room) return;
        this.sync();
      }
      this.describeInput(room, devices);
    });
  }
  /** Names the microphone the room hears, so settings can show the device actually in use. */
  private describeInput(room: Room, devices: readonly MediaDeviceInfo[]) {
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    if (this.room !== room || !(track instanceof LocalAudioTrack)) return;
    try {
      this.patch({ inputDevice: inputDeviceLabel(devices, track.getSourceTrackSettings()) });
    } catch {
      /* The name is a convenience; capture itself is unaffected. */
    }
  }
  private async describeCurrentInput(room: Room) {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      this.describeInput(room, await navigator.mediaDevices.enumerateDevices());
    } catch {
      /* Device names may be unavailable; capture itself is unaffected. */
    }
  }
  private async captureMicrophone(room: Room, serial: number, deviceId?: string) {
    const options = this.captureOptions(deviceId ?? this.inputDeviceId);
    try {
      return await createLocalAudioTrack(options);
    } catch (error) {
      if (!isMissingDevice(error)) throw error;
      if (this.room !== room || serial !== this.microphoneSerial || this.state.deafened)
        throw error;
      if (!(await room.switchActiveDevice('audioinput', 'default'))) throw error;
      if (this.room !== room || serial !== this.microphoneSerial || this.state.deafened)
        throw error;
      const track = await createLocalAudioTrack({ ...options, deviceId: 'default' });
      if (this.room === room && serial === this.microphoneSerial) {
        this.inputDeviceId = undefined;
        this.patch({ inputDeviceFallback: true });
      }
      return track;
    }
  }
  publishMic(deviceId?: string) {
    const serial = this.microphoneSerial;
    return this.microphoneTask(async () => {
      if (serial !== this.microphoneSerial) return;
      if (this.state.deafened) throw new Error('Undeafen before enabling your microphone.');
      const room = this.requireRoom();
      let created: LocalAudioTrack | undefined;
      try {
        const existing = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
        if (
          existing instanceof LocalAudioTrack &&
          existing.mediaStreamTrack.readyState === 'live'
        ) {
          await this.ensureMixer(existing);
          if (this.room !== room || this.state.deafened || serial !== this.microphoneSerial)
            throw new Error('Voice room changed while opening the microphone.');
          await existing.unmute();
        } else {
          if (existing instanceof LocalAudioTrack) {
            await room.localParticipant.unpublishTrack(existing);
            existing.stop();
          }
          if (this.room !== room || serial !== this.microphoneSerial) return;
          // A room switch carried the microphone over: publish it as it is, already filtered.
          const carried = deviceId === undefined ? this.claimParkedMic() : null;
          if (!carried) this.releaseParkedMic();
          created = carried ?? (await this.captureMicrophone(room, serial, deviceId));
          this.pendingMic = created;
          if (this.room !== room || this.state.deafened || serial !== this.microphoneSerial) {
            created.stop();
            return;
          }
          await this.ensureMixer(created);
          if (this.room !== room || this.state.deafened || serial !== this.microphoneSerial)
            throw new Error('Voice room changed while opening the microphone.');
          // Attach processing before publishing: never transmit an initial raw segment.
          await room.localParticipant.publishTrack(created, { source: Track.Source.Microphone });
          if (this.room !== room || this.state.deafened || serial !== this.microphoneSerial) {
            await created.mute();
            throw new Error('Voice room changed while publishing the microphone.');
          }
          if (carried)
            this.patch({
              noiseProcessing: {
                status: this.noiseSuppression ? 'active' : 'off',
                mode: this.noiseMode,
              },
            });
        }
        this.patch({ error: null });
        this.sync();
        void this.describeCurrentInput(room);
      } catch (error) {
        if (created) {
          created.stop();
          await this.mixer?.destroy();
          this.mixer = null;
          this.mixerTrack = null;
          await this.soundContext?.close();
          this.soundContext = null;
        }
        if (serial !== this.microphoneSerial || this.room !== room) return;
        this.fail(error);
        throw new Error(this.state.error ?? 'Media operation failed.');
      } finally {
        if (this.pendingMic === created) this.pendingMic = null;
      }
    });
  }
  async mute(value: boolean) {
    if (!value) return this.publishMic();
    ++this.microphoneSerial;
    this.releaseParkedMic();
    this.pendingMic?.stop();
    void this.pendingMixer?.destroy();
    this.stopSoundboard();
    return this.microphoneTask(async () => {
      try {
        const room = this.room;
        if (room && this.status !== 'connected') {
          // Reconnecting: muting is a local capture change and must not wait for the
          // transport, or a hot microphone stays live when the room comes back.
          await room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track?.mute();
          this.patch({ muted: true });
          return;
        }
        await this.requireRoom().localParticipant.setMicrophoneEnabled(false);
        this.sync();
      } catch (error) {
        this.fail(error);
        throw new Error(this.state.error ?? 'Media operation failed.');
      }
    });
  }
  async publishCamera(enabled: boolean, deviceId?: string) {
    const options = (id?: string) => ({
      deviceId: id,
      resolution: { width: 1280, height: 720, frameRate: 30 },
    });
    try {
      try {
        await this.requireRoom().localParticipant.setCameraEnabled(enabled, options(deviceId));
      } catch (error) {
        // The chosen camera was unplugged: fall back to the system default, as the mic does.
        if (!enabled || !deviceId) throw error;
        await this.requireRoom().localParticipant.setCameraEnabled(true, options(undefined));
      }
      this.sync();
    } catch (error) {
      this.fail(error);
      throw new Error(this.state.error ?? 'Media operation failed.');
    }
  }
  async selectCamera(deviceId: string) {
    const room = this.room;
    if (!room || this.status !== 'connected' || !room.localParticipant.isCameraEnabled) return;
    try {
      await room.switchActiveDevice('videoinput', deviceId || 'default');
    } catch {
      // The camera keeps the device it has.
    }
  }
  async publishScreen(options: ScreenShareOptions = {}) {
    const room = this.requireRoom();
    const quality = options.quality ?? '1080p60';
    const plan = screenPublishPlan(quality, options.content);
    try {
      await room.localParticipant.setScreenShareEnabled(
        true,
        {
          audio: options.audio ? SCREEN_AUDIO_CAPTURE : false,
          resolution: plan.capture,
          // Set before publishing so the encoder starts in the right mode.
          contentHint: plan.contentHint,
        },
        screenPublishOptions(plan),
      );
      // A missing loopback track (no output device, OS refusal) keeps the picture shared; the
      // caller compares `sharingAudio` with what it asked for and tells the sharer.
      this.shareOptions = { quality, content: options.content ?? 'motion' };
      this.patch({ error: null });
      this.endShareWithCapture(
        room,
        room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track,
      );
      this.sync();
    } catch (error) {
      this.fail(error);
      throw new Error(this.state.error ?? 'Media operation failed.');
    }
  }
  /** Ends the share when the OS or the shared window closes the capture. */
  private endShareWithCapture(
    room: Room,
    capture: { mediaStreamTrack: MediaStreamTrack } | undefined,
  ) {
    capture?.mediaStreamTrack.addEventListener(
      'ended',
      () => {
        if (this.room === room)
          void room.localParticipant
            .setScreenShareEnabled(false)
            .then(() => {
              this.shareOptions = null;
              this.sync();
            })
            .catch((error) => this.fail(error));
      },
      { once: true },
    );
  }
  /** The running share's live picture track, or an error when this client is not sharing. */
  private runningShare() {
    const room = this.requireRoom();
    const video = room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track;
    if (!video || !room.localParticipant.isScreenShareEnabled)
      throw new Error('Screen is not being shared.');
    return { room, video: video as LocalVideoTrack };
  }
  async changeScreenSource() {
    const { room, video } = this.runningShare();
    const shared = this.shareOptions ?? { quality: '1080p60' as const, content: 'motion' as const };
    const plan = screenPublishPlan(shared.quality, shared.content);
    // The host selected the new source already. Until replaceTrack succeeds the old capture and
    // publication are untouched, so any failure below leaves the previous source sharing.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: {
        width: { ideal: plan.capture.width },
        height: { ideal: plan.capture.height },
        frameRate: { ideal: plan.capture.frameRate },
      },
      audio: false,
    });
    const next = stream.getVideoTracks()[0];
    if (!next) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error('The selected source gave no picture.');
    }
    next.contentHint = plan.contentHint;
    try {
      // LiveKit stops the old capture once the sender holds the new one and recomputes the
      // encodings for the new source's size.
      await video.replaceTrack(next, { userProvidedTrack: false });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    this.endShareWithCapture(room, video);
    this.sync();
  }
  async changeScreenQuality(quality: ScreenShareQuality) {
    const { room, video } = this.runningShare();
    const shared = this.shareOptions ?? { quality: '1080p60' as const, content: 'motion' as const };
    if (quality === shared.quality) return;
    const plan = screenPublishPlan(quality, shared.content);
    const capture = video.mediaStreamTrack;
    const before = { constraints: capture.getConstraints(), options: video.publishOptions };
    const sameLayers = video.sender?.getParameters().encodings?.length === plan.layers.length + 1;
    const resize = () =>
      capture.applyConstraints({
        width: { ideal: plan.capture.width },
        height: { ideal: plan.capture.height },
        frameRate: { ideal: plan.capture.frameRate },
      });
    try {
      await resize();
      if (sameLayers) {
        // Same number of simulcast layers: new caps and sizes go onto the live sender.
        video.publishOptions = { ...video.publishOptions, ...screenPublishOptions(plan) };
        video.lastEncodedDimensions = undefined;
        // The same track again: nothing is swapped, LiveKit only recomputes the encodings.
        await video.replaceTrack(capture, { userProvidedTrack: false });
      } else {
        // A different layer count cannot be renegotiated in place: publish the same capture again.
        await this.republishScreenCapture(room, video, screenPublishOptions(plan));
      }
    } catch (error) {
      video.publishOptions = before.options;
      await capture.applyConstraints(before.constraints).catch(() => {});
      if (!sameLayers && !room.localParticipant.isScreenShareEnabled)
        await this.republishScreenCapture(room, video, before.options ?? {}).catch(() => {});
      this.sync();
      throw error;
    }
    this.shareOptions = { ...shared, quality };
    this.sync();
  }
  private async republishScreenCapture(room: Room, video: LocalVideoTrack, options: object) {
    await room.localParticipant.unpublishTrack(video, false);
    await room.localParticipant.publishTrack(video, {
      ...options,
      source: Track.Source.ScreenShare,
    });
  }
  async setScreenSound(on: boolean) {
    const { room } = this.runningShare();
    const local = room.localParticipant;
    const current = local.getTrackPublication(Track.Source.ScreenShareAudio)?.track;
    if (!on) {
      if (current) await local.unpublishTrack(current, true);
      this.sync();
      return { audio: false };
    }
    if (current) return { audio: true };
    // The OS loopback comes with a capture; only its sound is kept, the picture of this second
    // capture is dropped at once and the share keeps its own.
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: SCREEN_AUDIO_CAPTURE,
    });
    stream.getVideoTracks().forEach((track) => track.stop());
    const sound = stream.getAudioTracks()[0];
    if (!sound) return { audio: false };
    try {
      await local.publishTrack(new LocalAudioTrack(sound, undefined, false), {
        source: Track.Source.ScreenShareAudio,
        audioPreset: { maxBitrate: 128000 },
        forceStereo: true,
        dtx: false,
        red: false,
      });
    } catch (error) {
      sound.stop();
      throw error;
    }
    this.sync();
    return { audio: true };
  }
  async stopScreen() {
    const room = this.room;
    if (!room) return;
    room.localParticipant.getTrackPublication(Track.Source.ScreenShare)?.track?.stop();
    room.localParticipant.getTrackPublication(Track.Source.ScreenShareAudio)?.track?.stop();
    this.shareOptions = null;
    this.patch({ sharing: false, sharingAudio: false, sharingQuality: null });
    try {
      await room.localParticipant.setScreenShareEnabled(false);
      this.sync();
    } catch (error) {
      this.fail(error);
      this.patch({ sharing: false, sharingAudio: false, sharingQuality: null });
      throw new Error(
        this.state.error ?? 'Screen publication could not be removed. Capture has stopped.',
      );
    }
  }
  async deafen(value: boolean) {
    const room = this.room;
    if (!room) throw new Error('Join a voice room first.');
    // Deafen mutes playback without changing subscriptions: no audio can leak during resubscription.
    this.patch({ deafened: value });
    this.refreshScreenPlayback();
    if (value) {
      ++this.microphoneSerial;
      this.releaseParkedMic();
      this.pendingMic?.stop();
      void this.pendingMixer?.destroy();
      this.stopSoundboard();
      await room.localParticipant.setMicrophoneEnabled(false);
    }
    this.sync();
  }
  private equalizer: MusicEqualizer = FLAT_EQUALIZER;
  private equalizerContext: AudioContext | null = null;
  private equalizerChain: BiquadFilterNode[] = [];
  /** DJ audio tracks currently played through the equalizer instead of their element. */
  private equalized = new Set<string>();
  musicEqualizer() {
    return this.equalizer;
  }
  setMusicEqualizer(value: MusicEqualizer) {
    const eq = parseEqualizer(value);
    if (!eq) throw Error('Equalizer bands must be between -12 and 12 dB.');
    this.equalizer = eq;
    if (this.listenerScope)
      try {
        localStorage.setItem(`rooms-dj-eq-v1:${this.listenerScope}`, JSON.stringify(eq));
      } catch {
        /* The equalizer still applies for this session. */
      }
    this.applyEqualizer();
  }
  /**
   * A flat equalizer leaves the DJ on its ordinary element. Otherwise the DJ track plays through
   * Web Audio filters with its element silenced, still following volume, deafen and output device.
   */
  private applyEqualizer() {
    const room = this.room;
    if (!room) return;
    const flat = isFlat(this.equalizer);
    if (!flat && !this.equalizerContext && typeof AudioContext !== 'undefined') {
      this.equalizerContext = new AudioContext({ sampleRate: 48_000 });
      this.equalizerChain = equalizerNodes(this.equalizerContext);
      void (this.equalizerContext as AudioContext & { setSinkId?(id: string): Promise<void> })
        .setSinkId?.(this.outputDeviceId)
        ?.catch(() => {});
    }
    const context = this.equalizerContext;
    if (!flat && context) tuneEqualizer(this.equalizerChain, this.equalizer, context);
    for (const person of room.remoteParticipants.values()) {
      if (!person.identity.startsWith('rooms-music-')) continue;
      const gain = this.state.deafened
        ? 0
        : listenerGain(person.identity, this.volumes.get(person.identity) ?? 1);
      for (const pub of person.trackPublications.values()) {
        const track = pub.track as
          | (Track & {
              setAudioContext?(context: AudioContext | undefined): void;
              setWebAudioPlugins?(nodes: AudioNode[]): void;
              setVolume?(volume: number): void;
            })
          | undefined;
        const element = this.audio.get(pub.trackSid);
        if (!track?.setAudioContext || !track.setWebAudioPlugins || !element) continue;
        if (flat || !context) {
          if (!this.equalized.delete(pub.trackSid)) continue;
          track.setAudioContext(undefined);
          element.muted = this.state.deafened;
        } else if (!this.equalized.has(pub.trackSid)) {
          element.muted = true;
          track.setWebAudioPlugins(this.equalizerChain);
          track.setAudioContext(context);
          this.equalized.add(pub.trackSid);
          if (context.state !== 'running') void context.resume().catch(() => {});
        }
        track.setVolume?.(gain);
      }
    }
  }
  /**
   * Plays one person at this listener's level. The element volume of a normal track tops out at 1,
   * so a person set above 100% is routed through a Web Audio gain instead (the same way the DJ
   * equalizer takes over a track), which can amplify to 200%. Deafen silences that path through
   * its gain, because muting the element no longer reaches it.
   */
  private applyPersonVolume(person: RemoteParticipant) {
    const id = person.identity,
      level = this.volumes.get(id) ?? 1;
    const music = id.startsWith('rooms-music-');
    const boost = !music && level > 1 && typeof AudioContext !== 'undefined';
    let boosted = false;
    for (const pub of person.trackPublications?.values() ?? []) {
      if (pub.source !== Track.Source.Microphone) continue;
      const track = pub.track as
        (Track & { setAudioContext?(context: AudioContext | undefined): void }) | undefined;
      const element = this.audio.get(pub.trackSid);
      if (!track?.setAudioContext || !element) continue;
      if (boost) {
        if (!this.boostContext) {
          this.boostContext = new AudioContext();
          void (this.boostContext as AudioContext & { setSinkId?(id: string): Promise<void> })
            .setSinkId?.(this.outputDeviceId)
            ?.catch(() => {});
        }
        if (!this.boosted.has(pub.trackSid)) {
          element.muted = true;
          track.setAudioContext(this.boostContext);
          this.boosted.add(pub.trackSid);
        }
        if (this.boostContext.state !== 'running') void this.boostContext.resume().catch(() => {});
        boosted = true;
      } else if (this.boosted.delete(pub.trackSid)) {
        track.setAudioContext(undefined);
        element.muted = this.state.deafened;
      }
    }
    const gain = listenerGain(id, level);
    person.setVolume(
      boosted ? (this.state.deafened ? 0 : gain) : Math.min(1, gain),
      Track.Source.Microphone,
    );
  }
  private boostContext: AudioContext | null = null;
  /** Microphone tracks currently played through the 200% Web Audio path. */
  private boosted = new Set<string>();
  setParticipantVolume(id: string, volume: number) {
    if (!isParticipantLevel(volume)) throw new Error('Volume must be between 0 and 2.');
    this.volumes.set(id, volume);
    if (this.listenerScope)
      try {
        localStorage.setItem(
          `rooms-listener-levels-v1:${this.listenerScope}`,
          JSON.stringify(Object.fromEntries([...this.volumes].slice(-512))),
        );
      } catch {
        /* Playback remains usable when local storage is unavailable. */
      }
    const person = this.room?.remoteParticipants.get(id);
    if (person) this.applyPersonVolume(person);
    if (id.startsWith('rooms-music-')) this.applyEqualizer();
    this.sync();
  }
  watchScreen(id: string | null) {
    const changed = id !== this.watchedScreen;
    this.watchedScreen = id;
    this.applyScreenSubscriptions();
    this.applyScreenQuality();
    this.refreshScreenPlayback();
    if (changed) {
      this.announceWatch();
      this.sync();
    }
  }
  /** Remote screen shares stream only to people who chose to watch them. */
  private applyScreenSubscriptions() {
    for (const person of this.room?.remoteParticipants.values() ?? [])
      for (const pub of person.trackPublications.values()) {
        if (!isScreenSource(pub.source)) continue;
        const wanted = person.identity === this.watchedScreen;
        if (pub.isDesired !== wanted) pub.setSubscribed(wanted);
      }
  }
  setScreenQuality(quality: ScreenViewQuality) {
    if (quality !== 'auto' && !(Number.isInteger(quality) && quality > 0))
      throw Error('Screen quality must be auto or a positive line count.');
    this.screenQuality = quality;
    this.applyScreenQuality();
    this.patch({ screenQuality: quality });
  }
  /**
   * Requests the chosen layer of every screen share this listener receives. LiveKit ignores the
   * request for a publication that is not subscribed, so watching and every new subscription (a
   * restarted share is a new publication) apply it again. Under adaptive stream a fixed choice is
   * a ceiling: a small tile can still receive a smaller layer.
   */
  private applyScreenQuality() {
    const choice = this.screenQuality;
    if (choice === null) return;
    for (const person of this.room?.remoteParticipants.values() ?? [])
      for (const pub of person.trackPublications.values()) {
        if (pub.source !== Track.Source.ScreenShare || !pub.isDesired) continue;
        const quality = screenSubscriptionQuality(screenLayers(pub), choice);
        if (quality) pub.setVideoQuality(videoQualities[quality]);
      }
  }
  /** Tells the room (or one newcomer) which screen this listener watches. */
  private announceWatch(destination?: string) {
    const room = this.room;
    if (!room || this.state.status !== 'connected') return;
    void room.localParticipant
      .publishData(new TextEncoder().encode(JSON.stringify({ watching: this.watchedScreen })), {
        reliable: true,
        topic: WATCH_TOPIC,
        ...(destination ? { destinationIdentities: [destination] } : {}),
      })
      .catch(() => {});
  }
  private refreshScreenPlayback() {
    const allowed = new Set<string>();
    const person = this.watchedScreen
      ? this.room?.remoteParticipants.get(this.watchedScreen)
      : undefined;
    for (const pub of person?.trackPublications.values() ?? [])
      if (pub.source === Track.Source.ScreenShareAudio) allowed.add(pub.trackSid);
    for (const [id, element] of this.audio)
      element.muted =
        this.equalized.has(id) ||
        this.boosted.has(id) ||
        this.state.deafened ||
        (this.screenAudio.has(id) && !allowed.has(id));
    this.applyEqualizer();
    // Deafen reaches a boosted person only through its gain, so refresh those.
    if (this.boosted.size)
      for (const person of this.room?.remoteParticipants.values() ?? [])
        if ([...(person.trackPublications?.keys() ?? [])].some((sid) => this.boosted.has(sid)))
          this.applyPersonVolume(person);
  }
  setScreenVolume(id: string, volume: number) {
    if (!Number.isFinite(volume) || volume < 0 || volume > 1)
      throw Error('Volume must be between 0 and 1.');
    this.volumes.set(`screen:${id}`, volume);
    if (this.listenerScope) {
      try {
        localStorage.setItem(
          `rooms-listener-levels-v1:${this.listenerScope}`,
          JSON.stringify(Object.fromEntries([...this.volumes].slice(-512))),
        );
      } catch {
        /* Storage is optional. */
      }
    }
    this.room?.remoteParticipants.get(id)?.setVolume(volume, Track.Source.ScreenShareAudio);
    this.sync();
  }
  async startAudio() {
    try {
      await this.requireRoom().startAudio();
      this.patch({ audioBlocked: false });
    } catch (error) {
      this.fail(error);
      throw new Error(this.state.error ?? 'Media operation failed.');
    }
  }
  /**
   * A saved headset that is gone (unplugged, or AirPods taken by a phone) must not end the
   * join: the call uses the system default and the saved choice stays for when it returns.
   * Returns the id now in use, '' for the default.
   */
  private async switchDevice(
    room: Room,
    kind: 'audioinput' | 'audiooutput',
    id: string,
    devices: readonly MediaDeviceInfo[] | null,
  ) {
    if (id && !deviceListed(devices, kind, id)) id = '';
    try {
      if (await room.switchActiveDevice(kind, id || 'default')) return id;
    } catch (error) {
      if (!id || !isMissingDevice(error)) throw error;
      if (await room.switchActiveDevice(kind, 'default')) return '';
    }
    throw new Error(kind === 'audioinput' ? 'Input unavailable.' : 'Output unavailable.');
  }
  async deviceSelection(inputId: string, outputId: string) {
    try {
      const room = this.requireRoom();
      // One device list serves both checks (each enumeration costs a round trip to the OS).
      const devices = await listDevices();
      await this.switchDevice(room, 'audioinput', inputId || '', devices);
      const output = await this.switchDevice(room, 'audiooutput', outputId || '', devices);
      await Promise.all(
        [this.soundContext, this.equalizerContext, this.boostContext].map((context) =>
          (
            context as (AudioContext & { setSinkId?(id: string): Promise<void> }) | null
          )?.setSinkId?.(output),
        ),
      );
      this.outputDeviceId = output;
      // Keep the chosen headset: capture asks for it as a preference, so the default opens while it
      // is gone, and followInput moves back to it once it is listed again.
      this.inputDeviceId = inputId || undefined;
      this.patch({ error: null, inputDeviceFallback: false });
      this.sync();
      void this.describeCurrentInput(room);
    } catch (error) {
      this.fail(error);
      throw new Error(this.state.error ?? 'Media operation failed.');
    }
  }
  participantState() {
    return this.state.participants;
  }
  diagnostics() {
    return this.state.diagnostics;
  }
  async subscribe(id: string) {
    const p = this.requireRoom().getParticipantByIdentity(id);
    if (!p) throw new Error('Participant is not in this room.');
    return new MediaStream(
      [...p.trackPublications.values()].flatMap((pub) =>
        pub.track ? [pub.track.mediaStreamTrack] : [],
      ),
    );
  }
  attachTrack(id: string, element: HTMLMediaElement) {
    const room = this.requireRoom();
    const people = [room.localParticipant, ...room.remoteParticipants.values()];
    const track = people
      .flatMap((p) => [...p.trackPublications.values()])
      .find((pub) => pub.trackSid === id)?.track;
    if (!track) throw new Error('This media track is no longer available.');
    track.attach(element);
    if (track.kind === Track.Kind.Video) {
      element.muted = true;
      element.autoplay = true;
    }
    let removed = false;
    const detach = () => {
      if (removed) return;
      removed = true;
      track.detach(element);
      this.attachments.delete(detach);
    };
    this.attachments.add(detach);
    return detach;
  }
  private async measure() {
    const room = this.room;
    if (!room || this.status !== 'connected') return;
    let bytes = 0,
      lost = 0,
      received = 0,
      rtt: number | null = null;
    let video: MediaDiagnostics['video'];
    const seen = new Set<string>();
    const tracks = [room.localParticipant, ...room.remoteParticipants.values()].flatMap((p) =>
      [...p.trackPublications.values()].flatMap((pub) => (pub.track ? [pub.track] : [])),
    );
    await Promise.allSettled(
      tracks.map(async (track) => {
        const report = await track.getRTCStatsReport();
        report?.forEach((stat) => {
          if (seen.has(stat.id)) return;
          seen.add(stat.id);
          if (
            (stat.type === 'inbound-rtp' || stat.type === 'outbound-rtp') &&
            stat.frameWidth > 0 &&
            stat.frameHeight > 0 &&
            (!video || stat.frameWidth * stat.frameHeight > video.width * video.height)
          ) {
            const codec = report?.get(stat.codecId);
            video = {
              width: stat.frameWidth,
              height: stat.frameHeight,
              framesPerSecond:
                typeof stat.framesPerSecond === 'number' ? stat.framesPerSecond : null,
              codec: codec?.mimeType ?? null,
              direction: stat.type === 'outbound-rtp' ? 'sent' : 'received',
            };
          }
          if (stat.type === 'inbound-rtp') {
            bytes += stat.bytesReceived ?? 0;
            received += stat.packetsReceived ?? 0;
            lost += Math.max(0, stat.packetsLost ?? 0);
          }
          if (
            stat.type === 'candidate-pair' &&
            stat.state === 'succeeded' &&
            stat.nominated &&
            typeof stat.currentRoundTripTime === 'number'
          )
            rtt = stat.currentRoundTripTime * 1000;
        });
      }),
    );
    if (this.room !== room) return;
    const time = performance.now();
    const prior = this.priorStats;
    this.priorStats = { time, bytes };
    this.patch({
      diagnostics: {
        bitrate:
          prior && bytes >= prior.bytes
            ? ((bytes - prior.bytes) * 8000) / (time - prior.time)
            : null,
        packetLoss: received + lost ? lost / (received + lost) : null,
        rtt,
        video,
      },
    });
  }
  private cleanupPlayback() {
    this.watchedScreen = null;
    this.watchers.clear();
    this.screenAudio.clear();
    this.speakingMeter.stop();
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.attachments.forEach((detach) => detach());
    this.audio.forEach((e) => {
      e.pause();
      e.srcObject = null;
      e.remove();
    });
    this.audio.clear();
    this.equalized.clear();
    this.boosted.clear();
    this.priorStats = null;
  }
  disconnect(options?: { keepMicrophone?: boolean }): Promise<void> {
    return this.teardown(options?.keepMicrophone ? 'park' : 'release');
  }
  /** The live, unmuted, filtered microphone of this room, if it can be carried to the next one. */
  private carriableMic(room: Room) {
    const track = room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track;
    return track instanceof LocalAudioTrack &&
      this.status === 'connected' &&
      room.localParticipant.isMicrophoneEnabled &&
      !track.isMuted &&
      !this.state.deafened &&
      track.mediaStreamTrack.readyState === 'live' &&
      this.mixerTrack === track &&
      this.mixer?.processedTrack?.readyState === 'live'
      ? track
      : null;
  }
  /** Takes the carried microphone if it still matches the selected input and filter. */
  private claimParkedMic() {
    const parked = this.parkedMic;
    if (
      parked &&
      parked.track.mediaStreamTrack.readyState === 'live' &&
      this.mixerTrack === parked.track &&
      this.mixer?.processedTrack?.readyState === 'live' &&
      parked.device === this.inputDeviceId &&
      parked.noise === this.noiseSuppression &&
      parked.mode === this.noiseMode
    ) {
      this.parkedMic = null;
      return parked.track;
    }
    this.releaseParkedMic();
    return null;
  }
  /** Stops a carried microphone and its filter (leave, mute, deafen, failed or changed switch). */
  private releaseParkedMic() {
    const parked = this.parkedMic;
    if (!parked) return;
    this.parkedMic = null;
    parked.track.stop();
    if (this.mixerTrack !== parked.track) return;
    const mixer = this.mixer,
      context = this.soundContext;
    this.mixer = null;
    this.mixerTrack = null;
    this.soundContext = null;
    void Promise.resolve()
      .then(() => mixer?.destroy())
      .catch(() => {});
    if (context && context.state !== 'closed')
      void Promise.resolve()
        .then(() => context.close())
        .catch(() => {});
    this.patch({ noiseProcessing: { status: 'off', mode: this.noiseMode } });
  }
  /**
   * park: leave and carry a live microphone over; keep: leave, keeping a microphone carried
   * earlier; release: leave and stop every capture.
   */
  private teardown(mode: 'park' | 'keep' | 'release'): Promise<void> {
    if (mode === 'release') this.releaseParkedMic();
    if (this.disconnecting) return this.disconnecting;
    const room = this.room;
    const carried = mode === 'park' && room ? this.carriableMic(room) : null;
    ++this.epoch;
    ++this.microphoneSerial;
    this.room = null;
    this.grant = null;
    this.pendingMic?.stop();
    void this.pendingMixer?.destroy();
    if (carried) {
      this.releaseParkedMic();
      this.parkedMic = {
        track: carried,
        device: this.inputDeviceId,
        noise: this.noiseSuppression,
        mode: this.noiseMode,
      };
    }
    // Decided now: the async cleanup below must never close a filter that a carried mic still uses.
    const keepMixer = !!this.parkedMic && this.mixerTrack === this.parkedMic.track;
    if (!keepMixer) {
      this.mixerTrack?.stop();
      void this.mixer?.destroy();
    }
    this.stopSoundboard();
    // Stop capture and playback synchronously; network/mixer cleanup must not hold them open.
    for (const publication of room?.localParticipant.trackPublications.values() ?? [])
      if (publication.track !== carried) publication.track?.stop();
    this.cleanupPlayback();
    this.patch({
      noiseProcessing: keepMixer
        ? (this.state.noiseProcessing ?? { status: 'off', mode: this.noiseMode })
        : { status: 'off', mode: this.noiseMode },
      status: 'not-configured',
      roomId: null,
      error: null,
      muted: true,
      deafened: false,
      camera: false,
      sharing: false,
      sharingAudio: false,
      audioBlocked: false,
      inputDeviceFallback: false,
      inputDevice: null,
      participants: [],
      tracks: [],
      diagnostics: emptyDiagnostics(),
    });
    // A carried microphone is unpublished, not stopped (LiveKit stops every local track otherwise).
    const transport = room
      ? room.disconnect(!carried).finally(() => room.removeAllListeners())
      : Promise.resolve();
    // Local audio teardown is best effort: leaving (and signing out) must not fail because a
    // mixer or an already closed AudioContext refuses to close again.
    const cleanup = (async () => {
      await this.soundboardWork;
      await this.microphoneWork;
      // The carried microphone keeps its filter and context; releaseParkedMic closes them.
      if (keepMixer) return;
      const mixer = this.mixer,
        context = this.soundContext;
      this.mixer = null;
      this.mixerTrack = null;
      this.soundContext = null;
      await Promise.resolve()
        .then(() => mixer?.destroy())
        .catch(() => {});
      if (context && context.state !== 'closed')
        await Promise.resolve()
          .then(() => context.close())
          .catch(() => {});
    })();
    this.disconnecting = Promise.allSettled([transport, cleanup])
      .then((results) => {
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
      })
      .finally(() => {
        this.disconnecting = null;
      });
    return this.disconnecting;
  }
  prepareConnection(serverUrl: string) {
    let url: URL;
    try {
      url = new URL(serverUrl);
    } catch {
      return;
    }
    if (!['wss:', 'ws:'].includes(url.protocol) || url.username || url.password) return;
    const now = Date.now();
    if (now - (this.prepared.get(url.href) ?? -Infinity) < PREPARE_INTERVAL_MS) return;
    this.prepared.set(url.href, now);
    url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
    url.search = '';
    url.hash = '';
    // Only resolves the name and opens TLS ahead of the join; the answer itself is ignored.
    if (typeof fetch === 'function')
      void fetch(url.href, {
        method: 'HEAD',
        mode: 'no-cors',
        credentials: 'omit',
        cache: 'no-store',
      }).catch(() => {});
  }
  async reconnect() {
    throw new Error(
      'Obtain a fresh membership grant, then call connectRoom. Automatic transient reconnect is managed by LiveKit.',
    );
  }
}
export const liveKitMediaProvider = new LiveKitMediaProvider();
export const mediaTransportStatus: ConnectionStatus = 'not-configured';

export { createRnnoiseNode } from './rnnoise';

export { createNoiseSuppressionNode } from './noise-suppression';
export { createMicGateNode, type MicGateNode } from './mic-gate-node';
export {
  DEFAULT_MIC_GATE,
  MIC_GATE_DEFAULT_DB,
  MIC_GATE_MAX_DB,
  MIC_GATE_MIN_DB,
  clampMicGateThreshold,
  micGateSettings,
} from './mic-gate';
export type { MicGateReport, MicGateSettings } from './mic-gate';
export type { NoiseSuppressionMode, NoiseProcessingState } from './noise-suppression';
