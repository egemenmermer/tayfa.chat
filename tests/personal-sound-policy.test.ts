import { describe, expect, it } from 'vitest';
import {
  PersonalCuePolicy,
  type RosterCue,
} from '../packages/shared-contracts/src/personal-sound-policy';

const yes = () => true;
const enter = (actor: string, sound?: string): RosterCue => ({
  kind: 'enter',
  actor,
  local: false,
  sound,
});
const leave = (actor: string, sound?: string): RosterCue => ({
  kind: 'leave',
  actor,
  local: false,
  sound,
});
const plays = (decisions: { play: string }[]) => decisions.map((d) => d.play);

describe('PersonalCuePolicy', () => {
  it('plays the actor’s sound for a genuine join', () => {
    const policy = new PersonalCuePolicy();
    expect(policy.push(enter('a', 'p.fanfar'), 0, yes)).toEqual([
      { kind: 'enter', actor: 'a', play: 'personal', sound: 'p.fanfar' },
    ]);
  });
  it('plays the listener’s own sound to them every time, as in Discord (H02)', () => {
    const policy = new PersonalCuePolicy();
    const own = (kind: 'enter' | 'leave', at: number, sound?: string) =>
      policy.push({ kind, actor: 'me', local: true, ...(sound ? { sound } : {}) }, at, yes);
    expect(own('enter', 0, 'p.fanfar')).toEqual([
      { kind: 'enter', actor: 'me', play: 'personal', sound: 'p.fanfar' },
    ]);
    // No cooldown and no rejoin rule for your own events.
    expect(plays(own('leave', 2000, 'p.kapi'))).toEqual(['personal']);
    expect(plays(own('enter', 4000, 'p.fanfar'))).toEqual(['personal']);
    // Without a sound, or when the listener turned personal sounds off, the classic cue.
    expect(plays(own('leave', 6000))).toEqual(['classic']);
    expect(
      plays(
        policy.push({ kind: 'enter', actor: 'me', local: true, sound: 'p.x' }, 8000, () => false),
      ),
    ).toEqual(['classic']);
  });
  it('falls back to the classic cue without a sound or when the listener does not allow it', () => {
    const policy = new PersonalCuePolicy();
    expect(plays(policy.push(enter('a'), 0, yes))).toEqual(['classic']);
    expect(plays(policy.push(enter('b', 'p.kapi'), 1000, (actor) => actor !== 'b'))).toEqual([
      'classic',
    ]);
  });
  it('holds departures and silences a reconnect inside the hold', () => {
    const policy = new PersonalCuePolicy();
    policy.push(enter('a', 'p.fanfar'), 0, yes);
    expect(policy.push(leave('a', 'p.kapanis'), 20_000, yes)).toEqual([]);
    expect(policy.nextDue()).toBe(21_500);
    expect(policy.push(enter('a', 'p.fanfar'), 20_900, yes)).toEqual([]);
    expect(policy.tick(22_000, yes)).toEqual([]);
    expect(policy.nextDue()).toBeNull();
  });
  it('releases a held departure with the actor’s leave sound', () => {
    const policy = new PersonalCuePolicy();
    policy.push(enter('a'), 0, yes);
    policy.push(leave('a', 'p.kapanis'), 60_000, yes);
    expect(policy.tick(61_000, yes)).toEqual([]);
    expect(policy.tick(61_500, yes)).toEqual([
      { kind: 'leave', actor: 'a', play: 'personal', sound: 'p.kapanis' },
    ]);
  });
  it('uses the classic cue for a quick return and for a short stay', () => {
    const policy = new PersonalCuePolicy();
    policy.push(enter('a'), 0, yes);
    policy.push(leave('a', 'p.kapanis'), 60_000, yes);
    policy.tick(61_500, yes);
    expect(plays(policy.push(enter('a', 'p.fanfar'), 70_000, yes))).toEqual(['classic']);
    policy.push(leave('a', 'p.kapanis'), 75_000, yes);
    expect(plays(policy.tick(76_500, yes))).toEqual(['classic']);
  });
  it('keeps the original join time across a reconnect for the short-stay rule', () => {
    const policy = new PersonalCuePolicy();
    policy.push(enter('a'), 0, yes);
    policy.push(leave('a'), 30_000, yes);
    policy.push(enter('a'), 30_500, yes);
    policy.push(leave('a', 'p.kapanis'), 35_000, yes);
    expect(plays(policy.tick(36_500, yes))).toEqual(['personal']);
  });
  it('limits one personal sound per person and event per cooldown', () => {
    const policy = new PersonalCuePolicy();
    expect(plays(policy.push(enter('a', 'p.fanfar'), 0, yes))).toEqual(['personal']);
    policy.push(leave('a'), 50_000, yes);
    policy.tick(51_500, yes);
    expect(plays(policy.push(enter('a', 'p.fanfar'), 100_000, yes))).toEqual(['classic']);
    policy.push(leave('a'), 110_000, yes);
    policy.tick(111_500, yes);
    expect(plays(policy.push(enter('a', 'p.fanfar'), 150_000, yes))).toEqual(['personal']);
  });
  it('plays one personal sound per room window and coalesces a burst of classic cues', () => {
    const policy = new PersonalCuePolicy();
    const heard = ['a', 'b', 'c', 'd', 'e'].flatMap((actor, i) =>
      policy.push(enter(actor, 'p.fanfar'), 1000 + i * 150, yes),
    );
    expect(heard.filter((d) => d.play === 'personal')).toHaveLength(1);
    expect(heard.filter((d) => d.play === 'classic').length).toBeLessThanOrEqual(2);
    expect(plays(policy.push(enter('f', 'p.kapi'), 6100, yes))).toEqual(['personal']);
  });
  it('forgets pending departures on reset', () => {
    const policy = new PersonalCuePolicy();
    policy.push(enter('a'), 0, yes);
    policy.push(leave('a', 'p.kapanis'), 20_000, yes);
    policy.reset();
    expect(policy.nextDue()).toBeNull();
    expect(policy.tick(30_000, yes)).toEqual([]);
  });
});
