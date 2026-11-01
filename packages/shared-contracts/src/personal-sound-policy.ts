import { PERSONAL_SOUND_POLICY, type PersonalSoundEvent } from './personal-sounds';

/** One roster change seen by this listener. `sound` is the actor's attribute at that moment. */
export interface RosterCue {
  kind: PersonalSoundEvent;
  actor: string;
  /** The listener's own join or departure. */
  local: boolean;
  sound?: string;
}
export type CueDecision =
  | { kind: PersonalSoundEvent; actor: string; play: 'classic' }
  | { kind: PersonalSoundEvent; actor: string; play: 'personal'; sound: string };

/**
 * Decides what one listener hears for roster changes, so a room never becomes a queue of clips.
 * Pure and clock-injected; the desktop and iPhone runtimes own timers and playback.
 *
 * - The listener's own events play their own sound, as in Discord: only they hear it, so no
 *   cooldown applies. Without a sound, or when it is not allowed, the classic cue plays.
 * - A departure is held for `leaveHoldMs`; a return inside the hold silences both (reconnects).
 * - Returning soon after leaving, or leaving soon after joining, plays the classic cue.
 * - At most one personal sound per person and event per `perPersonCooldownMs`.
 * - At most one personal sound per `roomWindowMs` for the whole room; others fall back to classic.
 * - Classic cues closer than `classicCoalesceMs` collapse into one.
 * - Without a sound, or when `allow(actor)` is false, the classic cue plays.
 */
export class PersonalCuePolicy {
  private readonly config: typeof PERSONAL_SOUND_POLICY;
  private readonly joined = new Map<string, number>();
  private readonly left = new Map<string, number>();
  private readonly held = new Map<
    string,
    { cue: RosterCue; at: number; joined: number | undefined }
  >();
  private readonly personal = new Map<string, number>();
  private roomPersonalAt = -Infinity;
  private classicAt = -Infinity;
  constructor(config: Partial<typeof PERSONAL_SOUND_POLICY> = {}) {
    this.config = { ...PERSONAL_SOUND_POLICY, ...config };
  }
  push(cue: RosterCue, now: number, allow: (actor: string) => boolean): CueDecision[] {
    if (cue.local) return this.own(cue, now, allow);
    if (cue.kind === 'enter') {
      const returning = this.held.get(cue.actor);
      if (returning) {
        this.held.delete(cue.actor);
        if (returning.joined !== undefined) this.joined.set(cue.actor, returning.joined);
        return [];
      }
      const left = this.left.get(cue.actor);
      this.joined.set(cue.actor, now);
      return left !== undefined && now - left < this.config.rejoinClassicMs
        ? this.classic(cue, now)
        : this.decide(cue, now, allow);
    }
    const joined = this.joined.get(cue.actor);
    this.joined.delete(cue.actor);
    this.held.set(cue.actor, { cue, at: now, joined });
    return [];
  }
  /** Releases departures whose hold has passed. */
  tick(now: number, allow: (actor: string) => boolean): CueDecision[] {
    const out: CueDecision[] = [];
    for (const [actor, entry] of [...this.held]) {
      if (now - entry.at < this.config.leaveHoldMs) continue;
      this.held.delete(actor);
      this.left.set(actor, entry.at);
      const shortStay =
        entry.joined !== undefined && entry.at - entry.joined < this.config.shortStayClassicMs;
      out.push(...(shortStay ? this.classic(entry.cue, now) : this.decide(entry.cue, now, allow)));
    }
    return out;
  }
  /** When the next held departure is due, for the runtime's timer. */
  nextDue(): number | null {
    let due: number | null = null;
    for (const entry of this.held.values()) {
      const at = entry.at + this.config.leaveHoldMs;
      if (due === null || at < due) due = at;
    }
    return due;
  }
  /** A new room or account, or cues that cannot be heard: forget pending departures and history. */
  reset() {
    this.joined.clear();
    this.left.clear();
    this.held.clear();
    this.personal.clear();
    this.roomPersonalAt = -Infinity;
    this.classicAt = -Infinity;
  }
  private decide(cue: RosterCue, now: number, allow: (actor: string) => boolean): CueDecision[] {
    const key = `${cue.kind}:${cue.actor}`,
      last = this.personal.get(key);
    if (
      !cue.sound ||
      !allow(cue.actor) ||
      (last !== undefined && now - last < this.config.perPersonCooldownMs) ||
      now - this.roomPersonalAt < this.config.roomWindowMs
    )
      return this.classic(cue, now);
    this.personal.set(key, now);
    this.roomPersonalAt = now;
    // The clip itself announces the event; a classic cue right on top of it adds nothing.
    this.classicAt = now;
    return [{ kind: cue.kind, actor: cue.actor, play: 'personal', sound: cue.sound }];
  }
  private own(cue: RosterCue, now: number, allow: (actor: string) => boolean): CueDecision[] {
    if (!cue.sound || !allow(cue.actor)) return this.classic(cue, now);
    this.roomPersonalAt = now;
    this.classicAt = now;
    return [{ kind: cue.kind, actor: cue.actor, play: 'personal', sound: cue.sound }];
  }
  private classic(cue: RosterCue, now: number): CueDecision[] {
    if (now - this.classicAt < this.config.classicCoalesceMs) return [];
    this.classicAt = now;
    return [{ kind: cue.kind, actor: cue.actor, play: 'classic' }];
  }
}
