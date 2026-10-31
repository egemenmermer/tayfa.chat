import { useEffect, useRef } from 'react';
import { useCommunity } from './community';
import { mediaProvider } from './runtime-sources';
import { useVoiceContext } from './realtime';
import { useRooms } from './store';
import { PersonalSoundCache } from './personal-sound-cache';
import { isPersonalSoundMuted, usePersonalSoundMutes } from './personal-sound-mutes';
import { PERSONAL_SOUND_POLICY } from '../../../packages/shared-contracts/src/personal-sounds';
import {
  PersonalCuePolicy,
  type CueDecision,
  type RosterCue,
} from '../../../packages/shared-contracts/src/personal-sound-policy';
import type { MediaSnapshot } from '@rooms/media';
import { StreamCueTracker, playVoiceCue } from './voice-cues';
export type RoomCue = 'enter' | 'leave';
type CueState = {
  scope: string;
  channel: string | null;
  status: MediaSnapshot['status'];
  participants: Pick<MediaSnapshot['participants'][number], 'id' | 'local' | 'sounds'>[];
};
export interface RosterUpdate {
  cues: RosterCue[];
  /** This snapshot started a new baseline instead of being compared with the previous roster. */
  rebased: boolean;
}
const human = (id: string) => !id.startsWith('rooms-music-');
const remote = (state: CueState) =>
  new Map(state.participants.filter((p) => !p.local && human(p.id)).map((p) => [p.id, p]));
/**
 * Initial roster and reconnect snapshots are baselines, never a burst of join cues. Remote cues
 * are per person; a departure carries the sound the leaver had in the last roster that held them.
 */
export class RoomCueTracker {
  private previous: CueState | null = null;
  private established = false;
  update(next: CueState): RosterUpdate {
    const before = this.previous;
    this.previous = next;
    const own = (kind: RoomCue, state: CueState): RosterUpdate => ({
      cues: [{ kind, actor: state.participants.find((p) => p.local)?.id ?? 'self', local: true }],
      rebased: true,
    });
    const rebase: RosterUpdate = { cues: [], rebased: true };
    if (!before || before.scope !== next.scope) {
      this.established = false;
      if (next.status === 'connected' && next.channel) {
        this.established = true;
        return own('enter', next);
      }
      return rebase;
    }
    if (!next.channel) {
      const left = !!before.channel && this.established;
      this.established = false;
      return left ? own('leave', before) : rebase;
    }
    if (before.channel !== next.channel) {
      this.established = false;
      if (next.status === 'connected') {
        this.established = true;
        return own('enter', next);
      }
      return rebase;
    }
    if (next.status !== 'connected') return rebase;
    if (!this.established) {
      this.established = true;
      return own('enter', next);
    }
    if (before.status !== 'connected') return rebase;
    const old = remote(before),
      now = remote(next);
    const cue = (kind: RoomCue, person: CueState['participants'][number]): RosterCue => {
      const sound = person.sounds?.[kind];
      return { kind, actor: person.id, local: false, ...(sound ? { sound } : {}) };
    };
    return {
      cues: [
        ...[...now.values()].filter((p) => !old.has(p.id)).map((p) => cue('enter', p)),
        ...[...old.values()].filter((p) => !now.has(p.id)).map((p) => cue('leave', p)),
      ],
      rebased: false,
    };
  }
}
const sources = new Map<RoomCue, string>();
/** Original low-amplitude two-note PCM cues, no external asset or network. */
export function roomCueSource(kind: RoomCue): string {
  const cached = sources.get(kind);
  if (cached) return cached;
  const rate = 24000,
    count = Math.round(rate * 0.24),
    buffer = new ArrayBuffer(44 + count * 2),
    view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + count * 2, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, count * 2, true);
  for (let i = 0; i < count; i++) {
    const t = i / rate,
      note = t < 0.12 ? 0 : 1,
      f = kind === 'enter' ? [540, 760][note] : [620, 410][note],
      phase = (t % 0.12) / 0.12,
      envelope = Math.sin(Math.PI * phase) ** 2;
    view.setInt16(
      44 + i * 2,
      Math.round(Math.sin(2 * Math.PI * f * t) * envelope * 0.13 * 32767),
      true,
    );
  }
  const result = URL.createObjectURL(new Blob([buffer], { type: 'audio/wav' }));
  sources.set(kind, result);
  return result;
}
export function RoomEventSounds() {
  const tracker = useRef(new RoomCueTracker());
  const streams = useRef(new StreamCueTracker());
  useEffect(() => {
    const provider = mediaProvider(),
      policy = new PersonalCuePolicy(),
      cache = new PersonalSoundCache();
    const scopeOf = () =>
      JSON.stringify([useCommunity.getState().serverUrl, useCommunity.getState().user?.id ?? '']);
    let active = true,
      epoch = 0,
      account = scopeOf(),
      room = '',
      classicAt = -Infinity,
      timer: ReturnType<typeof setTimeout> | undefined;
    cache.setScope(account);
    /** Personal clips remember their actor so a mute or the preference can stop just them. */
    const players = new Map<HTMLAudioElement, { gain: number; actor?: string }>();
    const deadlines = new Set<ReturnType<typeof setTimeout>>();
    /** Departures the policy still holds, mirrored so a reconnect baseline can settle them. */
    const leaving = new Map<string, number>();
    const stopPersonal = (actor?: string) => {
      for (const [player, info] of players)
        if (info.actor && (actor === undefined || info.actor === actor)) {
          player.pause();
          players.delete(player);
        }
    };
    const stop = () => {
      epoch++;
      for (const player of players.keys()) player.pause();
      players.clear();
      for (const deadline of deadlines) clearTimeout(deadline);
      deadlines.clear();
      clearTimeout(timer);
      timer = undefined;
      policy.reset();
      leaving.clear();
      classicAt = -Infinity;
      cache.prefetch([]);
    };
    const audible = () =>
      active &&
      useRooms.getState().preferences.roomEventSounds &&
      !provider.snapshot().deafened &&
      !!useCommunity.getState().user;
    const allow = (actor: string) =>
      cache.available &&
      useRooms.getState().preferences.personalSounds &&
      !isPersonalSoundMuted(actor);
    const output = (source: string, gain: number, actor?: string, failed?: () => void) => {
      const at = epoch;
      try {
        const player = new Audio(source);
        players.set(player, { gain, actor });
        player.volume = gain * useRooms.getState().preferences.soundEffectsLevel;
        player.onended = () => players.delete(player);
        void (async () => {
          try {
            const outputId = useRooms.getState().preferences.outputId;
            if (outputId && 'setSinkId' in player)
              await (
                player as HTMLAudioElement & { setSinkId(id: string): Promise<void> }
              ).setSinkId(outputId);
            if (at === epoch && players.has(player) && audible() && (!actor || allow(actor)))
              await player.play();
          } catch {
            /* Local cues must never fail the room operation; a clip we stopped needs no stand-in. */
            if (at === epoch && players.has(player)) failed?.();
          } finally {
            if (player.paused) players.delete(player);
          }
        })();
      } catch {
        failed?.();
      }
    };
    /** Stand-ins and policy classics share one coalescing window. */
    const classic = (kind: RoomCue) => {
      const now = performance.now();
      if (now - classicAt < PERSONAL_SOUND_POLICY.classicCoalesceMs) return;
      classicAt = now;
      output(roomCueSource(kind), PERSONAL_SOUND_POLICY.classicGain);
    };
    /** A clip that started late can outlast the room window; the next one never plays over it. */
    const personalPlaying = () =>
      [...players].some(([player, info]) => info.actor && !player.paused && !player.ended);
    /** A clip that misses the deadline is replaced by the classic cue and never played late. */
    const personal = (decision: Extract<CueDecision, { play: 'personal' }>) => {
      const at = epoch;
      let settled = false;
      const deadline = setTimeout(() => {
        deadlines.delete(deadline);
        if (settled || at !== epoch) return;
        settled = true;
        classic(decision.kind);
      }, PERSONAL_SOUND_POLICY.readyDeadlineMs);
      deadlines.add(deadline);
      void cache
        .resolve({
          channelId: useVoiceContext.getState().channelId ?? '',
          userId: decision.actor,
          sound: decision.sound,
        })
        .then((url) => {
          if (settled || at !== epoch) return;
          settled = true;
          clearTimeout(deadline);
          deadlines.delete(deadline);
          if (url && allow(decision.actor) && !personalPlaying())
            output(url, PERSONAL_SOUND_POLICY.personalGain, decision.actor, () =>
              classic(decision.kind),
            );
          else classic(decision.kind);
        });
    };
    const decide = (decisions: CueDecision[]) => {
      for (const decision of decisions)
        if (decision.play === 'personal') personal(decision);
        else classic(decision.kind);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = undefined;
      const due = policy.nextDue();
      if (due === null) return;
      timer = setTimeout(
        () => {
          timer = undefined;
          if (!audible()) return;
          const now = performance.now();
          decide(policy.tick(now, allow));
          for (const [actor, at] of leaving)
            if (now - at >= PERSONAL_SOUND_POLICY.leaveHoldMs) leaving.delete(actor);
          arm();
        },
        Math.max(0, due - performance.now()),
      );
    };
    const read = () => {
      const scope = scopeOf(),
        voice = useVoiceContext.getState(),
        snapshot = provider.snapshot(),
        prefs = useRooms.getState().preferences;
      const status =
        voice.busy ||
        (snapshot.status === 'connected' && !snapshot.participants.some((p) => p.local))
          ? 'connecting'
          : snapshot.status;
      const { cues, rebased } = tracker.current.update({
        scope,
        channel: snapshot.roomId,
        status,
        participants: snapshot.participants,
      });
      // Streams have their own switch, so they are compared even while room cues are off.
      const streamCue = streams.current.update(
        status === 'connected' && snapshot.roomId ? JSON.stringify([scope, snapshot.roomId]) : null,
        snapshot.participants,
      )[0];
      if (streamCue) playVoiceCue(streamCue.kind);
      // A disconnect (kick or loss) keeps the room id but ends the room for this listener. A
      // reconnect inside the room keeps the policy, so held departures and cooldowns survive it.
      const nextRoom = JSON.stringify([
        scope,
        snapshot.status === 'error' ? null : snapshot.roomId,
      ]);
      if (nextRoom !== room) {
        room = nextRoom;
        stop();
      }
      if (!prefs.roomEventSounds || snapshot.deafened || !useCommunity.getState().user) {
        stop();
        return;
      }
      if (!prefs.personalSounds) stopPersonal();
      for (const [player, info] of players) player.volume = info.gain * prefs.soundEffectsLevel;
      const now = performance.now(),
        channelId = voice.channelId;
      // Someone whose departure is still held and who is back in a reconnect baseline returned in
      // time; the baseline itself never plays.
      if (rebased && status === 'connected')
        for (const p of snapshot.participants)
          if (leaving.delete(p.id))
            policy.push({ kind: 'enter', actor: p.id, local: false }, now, allow);
      for (const cue of cues) {
        if (!cue.local && cue.kind === 'enter') leaving.delete(cue.actor);
        if (!cue.local && cue.kind === 'leave') {
          leaving.set(cue.actor, now);
          // The leaver's clip gets the whole hold to arrive.
          if (cue.sound && channelId && allow(cue.actor))
            void cache.resolve({ channelId, userId: cue.actor, sound: cue.sound });
        }
        decide(policy.push(cue, now, allow));
      }
      arm();
      // Departures should play at once, so the sounds of the people present are warmed up early.
      cache.prefetch(
        channelId && !voice.busy && snapshot.status === 'connected'
          ? snapshot.participants.flatMap((p) =>
              !p.local && human(p.id) && p.sounds?.leave && allow(p.id)
                ? [{ channelId, userId: p.id, sound: p.sounds.leave }]
                : [],
            )
          : [],
      );
    };
    let queued = false;
    const schedule = () => {
      if (queued) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (active) read();
      });
    };
    const subscriptions = [
      provider.subscribeState(schedule),
      useVoiceContext.subscribe(schedule),
      useCommunity.subscribe(() => {
        const next = scopeOf();
        if (next !== account) {
          account = next;
          stop();
          cache.setScope(next);
        }
        schedule();
      }),
      useRooms.subscribe(schedule),
      usePersonalSoundMutes.subscribe((state) => {
        for (const actor of state.muted) stopPersonal(actor);
        schedule();
      }),
    ];
    read();
    return () => {
      active = false;
      stop();
      cache.clear();
      for (const unsub of subscriptions) unsub();
    };
  }, []);
  return null;
}
