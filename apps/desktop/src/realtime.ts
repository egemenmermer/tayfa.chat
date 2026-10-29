import { useCommunity } from './community';
import { useDmCall } from './dm-call';
import { t, uiError } from './i18n';
import { create } from 'zustand';
import { useSyncExternalStore } from 'react';
import { type NoiseSuppressionMode, type MediaSnapshot, type MusicEqualizer } from '@rooms/media';
import { mediaProvider, mediaBridge } from './runtime-sources';
import { useRooms } from './store';
export const useVoiceContext = create<{
  channelId: string | null;
  roomName: string | null;
  error: string | null;
  busy: boolean;
}>(() => ({ channelId: null, roomName: null, error: null, busy: false }));
/** An automatic return to a voice room after the connection dropped on its own. */
export interface VoiceRejoin {
  channelId: string;
  roomName: string;
  /** 1-based attempt that runs now or next; equals maxAttempts once it gave up. */
  attempt: number;
  maxAttempts: number;
  /** waiting between attempts, joining during one, failed after the last one. */
  phase: 'waiting' | 'joining' | 'failed';
}
export const useVoiceRejoin = create<{ rejoin: VoiceRejoin | null }>(() => ({ rejoin: null }));
/** Capped backoff before each automatic attempt (about two minutes in all, a service restart). */
export const VOICE_REJOIN_DELAYS_MS = [1000, 2000, 4000, 8000, 15000, 30000, 30000, 30000];
/**
 * A drop this soon after an automatic rejoin keeps counting attempts instead of starting over,
 * so a connection that keeps being taken away (the same account joining the room on another
 * device) ends after the limit instead of fighting for ever.
 */
const REJOIN_STABLE_MS = 60_000;
/** Text the LiveKit provider sets for DisconnectReason.PARTICIPANT_REMOVED (moderator kick). */
const KICKED_ERROR = 'A moderator disconnected you from the voice room.';
const bridge = mediaBridge;
const errorText = uiError;
export function useRealtime(): MediaSnapshot & {
  channelId: string | null;
  roomName: string | null;
  busy: boolean;
} {
  const snapshot = useSyncExternalStore(
    (listener) => mediaProvider().subscribeState(listener),
    () => mediaProvider().snapshot(),
    () => mediaProvider().snapshot(),
  );
  const context = useVoiceContext();
  const rejoin = useVoiceRejoin((state) => state.rejoin);
  // An automatic rejoin reads as one reconnect, not as a failed join followed by a new one.
  const rejoining = !!rejoin && rejoin.phase !== 'failed';
  return {
    ...snapshot,
    ...(context.busy
      ? {
          participants: [],
          tracks: [],
          muted: true,
          camera: false,
          sharing: false,
          sharingAudio: false,
        }
      : {}),
    ...context,
    status: rejoining ? 'reconnecting' : context.busy ? 'connecting' : snapshot.status,
    error: rejoining ? null : (context.error ?? (snapshot.error ? uiError(snapshot.error) : null)),
  };
}
let transitionEpoch = 0,
  sequence: Promise<unknown> = Promise.resolve(),
  activeChannel: string | null = null;
let pendingTarget: string | null = null,
  pendingPromise: Promise<void> | null = null;
let desiredMuted = true,
  microphoneScope = '';
/** Deafen carried through a join that is still in progress (a second join reuses it). */
let pendingDeafened = false;
const sessionScope = () =>
  `${useCommunity.getState().serverUrl}:${useCommunity.getState().user?.id ?? ''}`;
function serialize(work: () => Promise<void>) {
  const next = sequence.catch(() => {}).then(work);
  sequence = next.catch(() => {});
  return next;
}
const updateListenerScope = () => {
  const state = useCommunity.getState();
  mediaProvider().setListenerScope?.(
    state.user ? JSON.stringify([state.serverUrl, state.user.id]) : '',
  );
};
updateListenerScope();
// A moderator moved this person: join the target through the normal grant check.
/** The level the person chose for the microphone the room hears now; 100 % when unset. */
function applyInputLevel() {
  const name = mediaProvider().snapshot().inputDevice;
  const percent = (name ? useRooms.getState().preferences.inputLevels[name] : undefined) ?? 100;
  try {
    mediaProvider().setInputLevel?.(percent / 100);
  } catch {
    /* A malformed level leaves the microphone as captured. */
  }
}
let heardInput: string | null | undefined;
mediaProvider().subscribeState(() => {
  const name = mediaProvider().snapshot().inputDevice;
  if (name === heardInput) return;
  heardInput = name;
  applyInputLevel();
});
useRooms.subscribe((state, previous) => {
  if (state.preferences.inputLevels !== previous.preferences.inputLevels) applyInputLevel();
});
mediaProvider().onMove?.((channelId) => {
  if (useVoiceContext.getState().channelId === channelId) return;
  const name = useCommunity.getState().channels.find((c) => c.id === channelId)?.name ?? t('Oda');
  window.dispatchEvent(
    new CustomEvent('rooms:toast', {
      detail: t('Bir yönetici seni {name} odasına taşıdı.', { name }),
    }),
  );
  void joinVoice(channelId, name).catch(() => {});
});
useCommunity.subscribe((state, previous) => {
  if (state.user?.id !== previous.user?.id || state.serverUrl !== previous.serverUrl)
    updateListenerScope();
});
let rejoinTimer: ReturnType<typeof setTimeout> | null = null,
  rejoinGeneration = 0,
  /** True only while the rejoin loop itself calls joinVoice, so that join does not cancel it. */
  automaticJoin = false,
  rejoinedAt = 0,
  rejoinedAttempts = 0;
const dmCallActive = () => {
  const dm = useDmCall.getState();
  return dm.busy || dm.call?.state === 'ringing' || dm.call?.state === 'accepted';
};
/** A deliberate leave or join starts the next drop's attempt count from zero. */
function forgetRejoins() {
  rejoinedAt = 0;
  rejoinedAttempts = 0;
  cancelRejoin();
}
/** Stops a pending automatic rejoin and forgets its state (a leave, another join, a move). */
function cancelRejoin() {
  rejoinGeneration++;
  if (rejoinTimer) clearTimeout(rejoinTimer);
  rejoinTimer = null;
  if (useVoiceRejoin.getState().rejoin) useVoiceRejoin.setState({ rejoin: null });
}
function scheduleRejoin(channelId: string, roomName: string, index: number, scope: string) {
  const generation = rejoinGeneration;
  useVoiceRejoin.setState({
    rejoin: {
      channelId,
      roomName,
      attempt: index + 1,
      maxAttempts: VOICE_REJOIN_DELAYS_MS.length,
      phase: 'waiting',
    },
  });
  rejoinTimer = setTimeout(() => {
    rejoinTimer = null;
    void attemptRejoin(channelId, roomName, index, scope, generation);
  }, VOICE_REJOIN_DELAYS_MS[index]);
}
async function attemptRejoin(
  channelId: string,
  roomName: string,
  index: number,
  scope: string,
  generation: number,
) {
  if (generation !== rejoinGeneration) return;
  const context = useVoiceContext.getState();
  // Decided when the timer fires: the kick reason lands after the status change, and a move,
  // a private call or another account may have taken over meanwhile.
  if (
    context.channelId !== channelId ||
    context.busy ||
    mediaProvider().snapshot().error === KICKED_ERROR ||
    dmCallActive() ||
    scope !== sessionScope()
  ) {
    cancelRejoin();
    return;
  }
  useVoiceRejoin.setState({
    rejoin: {
      channelId,
      roomName,
      attempt: index + 1,
      maxAttempts: VOICE_REJOIN_DELAYS_MS.length,
      phase: 'joining',
    },
  });
  let joined = true;
  automaticJoin = true;
  try {
    const join = joinVoice(channelId, roomName);
    automaticJoin = false;
    await join;
  } catch {
    joined = false;
  } finally {
    automaticJoin = false;
  }
  if (generation !== rejoinGeneration) return;
  if (joined && mediaProvider().snapshot().status === 'connected') {
    rejoinedAt = Date.now();
    rejoinedAttempts = index + 1;
    cancelRejoin();
    return;
  }
  if (index + 1 < VOICE_REJOIN_DELAYS_MS.length) {
    scheduleRejoin(channelId, roomName, index + 1, scope);
    return;
  }
  giveUpRejoin(channelId, roomName);
}
/** The last attempt failed: leave properly so the room stops listing this person, then say so. */
function giveUpRejoin(channelId: string, roomName: string) {
  void leaveVoice().catch(() => {});
  const max = VOICE_REJOIN_DELAYS_MS.length;
  useVoiceRejoin.setState({
    rejoin: { channelId, roomName, attempt: max, maxAttempts: max, phase: 'failed' },
  });
  // The room leaves the dock with the leave; the toast says why wherever the person is.
  window.dispatchEvent(
    new CustomEvent('rooms:toast', {
      detail: t('{room} odasına yeniden bağlanılamadı. Tekrar katılmak için odayı seç.', {
        room: roomName,
      }),
    }),
  );
}
function startRejoin(channelId: string, roomName: string) {
  // Never unmute on its own: the automatic return (and a manual one) joins muted.
  desiredMuted = true;
  const index = Date.now() - rejoinedAt < REJOIN_STABLE_MS ? rejoinedAttempts : 0;
  rejoinedAt = 0;
  rejoinedAttempts = 0;
  rejoinGeneration++;
  if (index >= VOICE_REJOIN_DELAYS_MS.length) giveUpRejoin(channelId, roomName);
  else scheduleRejoin(channelId, roomName, index, sessionScope());
}
// A full drop (LiveKit gave up on its own reconnect) of the room this person is in: go back.
// User leaves, room switches and private calls go through leaveVoice/joinVoice first, which
// clear activeChannel or mark the context busy, so they never look like a drop here.
let heardStatus: string | undefined;
mediaProvider().subscribeState(() => {
  const { status, error } = mediaProvider().snapshot();
  const previous = heardStatus;
  heardStatus = status;
  if (error === KICKED_ERROR) {
    // The kick reason can arrive just after the drop: stop the wait it started.
    if (useVoiceRejoin.getState().rejoin?.phase === 'waiting') cancelRejoin();
    return;
  }
  if (status !== 'error' || (previous !== 'connected' && previous !== 'reconnecting')) return;
  const context = useVoiceContext.getState();
  if (!context.channelId || context.busy || activeChannel !== context.channelId) return;
  if (rejoinTimer || useVoiceRejoin.getState().rejoin?.phase === 'joining') return;
  startRejoin(context.channelId, context.roomName ?? t('Oda'));
});
/** Stops trying to rejoin and leaves the room ("Vazgeç ve ayrıl"). */
export const cancelVoiceRejoin = () => leaveVoice();
/** Hides the message left after the last automatic attempt failed. */
export function dismissVoiceRejoin() {
  if (useVoiceRejoin.getState().rejoin?.phase === 'failed') cancelRejoin();
}
function disconnectActive() {
  const id = activeChannel;
  activeChannel = null;
  const media = mediaProvider().disconnect();
  const presence =
    id && window.rooms
      ? bridge()
          .leave(id)
          .catch(() => {})
      : Promise.resolve();
  return Promise.all([media, presence]).then(() => {});
}
export function joinVoice(channelId: string, roomName: string): Promise<void> {
  const dm = useDmCall.getState();
  if (dm.busy || dm.call?.state === 'ringing' || dm.call?.state === 'accepted')
    return Promise.reject(new Error(t('Önce özel görüşmeyi bitir.')));
  if (!automaticJoin) forgetRejoins();
  const context = useVoiceContext.getState(),
    snapshot = mediaProvider().snapshot();
  if (context.busy && pendingTarget === channelId && pendingPromise) return pendingPromise;
  if (!context.busy && context.channelId === channelId && snapshot.status === 'connected')
    return Promise.resolve();
  if (snapshot.status === 'connected' && !context.busy) {
    activeChannel ??= context.channelId;
    desiredMuted = snapshot.muted;
  }
  // Leaving the old room resets deafen in the provider; a move, a rejoin after a drop or a
  // room switch must keep it (a deafened person may be away with speakers on).
  const keepDeafened = !context.busy ? snapshot.deafened : pendingDeafened;
  pendingDeafened = keepDeafened;
  const epoch = ++transitionEpoch,
    scope = sessionScope();
  if (microphoneScope !== scope) {
    // A restart or update keeps the microphone as it was left; only a first join is muted.
    desiredMuted = !useRooms.getState().preferences.microphoneOn;
    microphoneScope = scope;
  }
  pendingTarget = channelId;
  const current = () => epoch === transitionEpoch && scope === sessionScope();
  useVoiceContext.setState({ channelId, roomName, busy: true, error: null });
  // Revoke old capture/playback now, even while a prior grant/connect is pending.
  const departure = disconnectActive();
  void departure.catch(() => {});
  const next = serialize(async () => {
    try {
      await departure;
      if (!current()) return;
      const grant = await bridge().grant(channelId);
      if (!current()) {
        if (window.rooms)
          await bridge()
            .leave(channelId)
            .catch(() => {});
        return;
      }
      const dm = useDmCall.getState();
      if (dm.busy || dm.call?.state === 'ringing' || dm.call?.state === 'accepted')
        throw new Error(t('Önce özel görüşmeyi bitir.'));
      activeChannel = channelId;
      await mediaProvider().connectRoom(grant.roomName, grant.token, grant.serverUrl);
      if (keepDeafened && current()) {
        await mediaProvider().deafen(true);
        announceDeafen(channelId, true);
      }
      if (!current()) {
        await disconnectActive();
        return;
      }
      await mediaProvider().setNoiseSuppression(
        useRooms.getState().preferences.noiseSuppression,
        useRooms.getState().preferences.noiseSuppressionMode,
      );
      if (!current()) {
        await disconnectActive();
        return;
      }
      await mediaProvider().deviceSelection(
        useRooms.getState().preferences.inputId,
        useRooms.getState().preferences.outputId,
      );
      if (!current()) {
        await disconnectActive();
        return;
      }
      if (!desiredMuted) await mediaProvider().mute(false);
      if (!current()) {
        await disconnectActive();
        return;
      }
    } catch (error) {
      if (current()) {
        await disconnectActive().catch(() => {});
        useVoiceContext.setState({ error: errorText(error) });
        throw error;
      }
    } finally {
      if (current()) {
        pendingTarget = null;
        pendingPromise = null;
        useVoiceContext.setState({ busy: false });
      }
    }
  });
  pendingPromise = next;
  return next;
}
export function leaveVoice(preserveBusy = false): Promise<void> {
  forgetRejoins();
  const context = useVoiceContext.getState();
  if (!activeChannel && mediaProvider().snapshot().status === 'connected')
    activeChannel = context.channelId;
  const epoch = ++transitionEpoch;
  pendingTarget = null;
  pendingPromise = null;
  useVoiceContext.setState({ channelId: null, roomName: null, error: null, busy: preserveBusy });
  const departure = disconnectActive();
  void departure.catch(() => {});
  return serialize(async () => {
    await departure;
    if (epoch === transitionEpoch) useVoiceContext.setState({ busy: false });
  });
}
async function run(operation: () => Promise<void>) {
  useVoiceContext.setState({ error: null });
  try {
    await operation();
  } catch (error) {
    useVoiceContext.setState({ error: errorText(error) });
    throw error;
  }
}
export async function toggleMic() {
  await run(async () => {
    const muted = !mediaProvider().snapshot().muted;
    await mediaProvider().mute(muted);
    desiredMuted = muted;
    useRooms.getState().setPreference('microphoneOn', !muted);
    if (mediaProvider().snapshot().inputDeviceFallback)
      useRooms.getState().setPreference('inputId', '');
  });
}
/** Best effort: the room learns about deafen through the access service; failure stays local. */
function announceDeafen(channelId: string | null, deafened: boolean) {
  if (!channelId || !window.rooms) return;
  void bridge()
    .deafen?.(channelId, deafened)
    .catch(() => {});
}
export async function toggleDeafen() {
  await run(async () => {
    const deafened = !mediaProvider().snapshot().deafened;
    await mediaProvider().deafen(deafened);
    announceDeafen(activeChannel, deafened);
  });
}
export async function toggleCamera() {
  await run(() =>
    mediaProvider().publishCamera(
      !mediaProvider().snapshot().camera,
      useRooms.getState().preferences.cameraId || undefined,
    ),
  );
}
/**
 * Starts this client's screen share. Resolves with whether system audio is really being sent:
 * a share that asked for sound but got none (no output device, OS refusal) still shares the
 * picture, and the caller tells the sharer.
 */
export async function startScreen(
  sourceId?: string,
  options: import('@rooms/media').ScreenShareOptions = {},
): Promise<{ audio: boolean }> {
  const channelId = useVoiceContext.getState().channelId;
  if (!channelId) throw new Error('Join a voice room before sharing.');
  await run(async () => {
    await bridge().presenter(channelId, 'acquire');
    try {
      if (sourceId) await bridge().selectCaptureSource(sourceId, { audio: options.audio ?? false });
      await mediaProvider().publishScreen(options);
    } catch (error) {
      await bridge().clearCaptureSource();
      await bridge()
        .presenter(channelId, 'release')
        .catch(() => {});
      throw error;
    }
  });
  return { audio: !!mediaProvider().snapshot().sharingAudio };
}
export async function stopScreen() {
  const channelId = useVoiceContext.getState().channelId;
  await run(async () => {
    await mediaProvider().stopScreen();
    if (channelId) await bridge().presenter(channelId, 'release');
  });
}
export const setParticipantVolume = (id: string, volume: number) =>
  mediaProvider().setParticipantVolume(id, volume);
export function watchScreen(id: string | null) {
  const provider = mediaProvider();
  if (!provider.watchScreen) throw Error(t('Yayın izleme kontrolü kullanılamıyor.'));
  provider.watchScreen(id);
}
export function setScreenVolume(id: string, volume: number) {
  const provider = mediaProvider();
  if (!provider.setScreenVolume) throw Error(t('Yayın sesi kontrolü kullanılamıyor.'));
  provider.setScreenVolume(id, volume);
}
/** Caps the screen shares this viewer receives for the app session ('auto' or lines, e.g. 720). */
export function setScreenQuality(quality: import('@rooms/media').ScreenViewQuality) {
  const provider = mediaProvider();
  if (!provider.setScreenQuality) throw Error(t('Yayın kalitesi seçimi kullanılamıyor.'));
  provider.setScreenQuality(quality);
}
export const startRoomAudio = () => run(() => mediaProvider().startAudio());
/** This listener's own DJ bass/mid/treble; null where the media provider cannot equalize. */
export const musicEqualizer = (): MusicEqualizer | null =>
  mediaProvider().musicEqualizer?.() ?? null;
export function setMusicEqualizer(value: MusicEqualizer) {
  const provider = mediaProvider();
  if (!provider.setMusicEqualizer) throw Error(t('Ekolayzır bu sürümde kullanılamıyor.'));
  provider.setMusicEqualizer(value);
}
/** Lossy pointer positions shared with everyone in the voice room; silently skipped offline. */
export const publishCursor = (payload: string) =>
  void mediaProvider()
    .publishCursor?.(payload)
    .catch(() => {});
export const onCursor = (listener: (payload: string, senderId: string) => void) =>
  mediaProvider().onCursor?.(listener) ?? (() => {});
export const attachMediaTrack = (id: string, element: HTMLMediaElement) =>
  mediaProvider().attachTrack(id, element);

export const setNoiseSuppression = (value: boolean, mode?: NoiseSuppressionMode) =>
  run(() => mediaProvider().setNoiseSuppression(value, mode));
export const playSoundboard = (buffer: AudioBuffer, volume: number) =>
  run(() => mediaProvider().playSoundboard(buffer, volume));
export const stopSoundboard = () => mediaProvider().stopSoundboard();
