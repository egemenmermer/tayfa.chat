import { expect, it } from 'vitest';
import { RoomCueTracker } from '../apps/desktop/src/room-event-sounds';
const base = {
  scope: 'account',
  channel: 'room',
  status: 'connected' as const,
  participants: [
    { id: 'self', local: true },
    { id: 'friend', local: false },
  ] as { id: string; local: boolean; sounds?: { enter?: string; leave?: string } }[],
};
const none = { cues: [], rebased: false };
const rebase = { cues: [], rebased: true };
const own = (kind: 'enter' | 'leave') => ({
  cues: [{ kind, actor: 'self', local: true }],
  rebased: true,
});
it('one self-join cue with full initial roster, no initial burst or duplicate', () => {
  const t = new RoomCueTracker();
  expect(t.update(base)).toEqual(own('enter'));
  expect(t.update(base)).toEqual(none);
});
it('human membership changes give one cue per person and bot changes are silent', () => {
  const t = new RoomCueTracker();
  t.update(base);
  const next = {
    ...base,
    participants: [
      ...base.participants,
      { id: 'new', local: false },
      { id: 'rooms-music-room', local: false },
    ],
  };
  expect(t.update(next)).toEqual({
    cues: [{ kind: 'enter', actor: 'new', local: false }],
    rebased: false,
  });
  expect(
    t.update({
      ...next,
      participants: next.participants.filter((p) => p.id !== 'rooms-music-room'),
    }),
  ).toEqual(none);
  expect(t.update(base)).toEqual({
    cues: [{ kind: 'leave', actor: 'new', local: false }],
    rebased: false,
  });
});
it('two joins in one roster change are two cues, each with the joiner’s own sound', () => {
  const t = new RoomCueTracker();
  t.update(base);
  expect(
    t.update({
      ...base,
      participants: [
        ...base.participants,
        { id: 'ada', local: false, sounds: { enter: 'p.fanfar', leave: 'p.kapanis' } },
        { id: 'bo', local: false },
      ],
    }),
  ).toEqual({
    cues: [
      { kind: 'enter', actor: 'ada', local: false, sound: 'p.fanfar' },
      { kind: 'enter', actor: 'bo', local: false },
    ],
    rebased: false,
  });
});
it('a departure carries the leave sound the person had before leaving', () => {
  const t = new RoomCueTracker();
  t.update({
    ...base,
    participants: [...base.participants, { id: 'ada', local: false, sounds: { leave: 'p.damla' } }],
  });
  t.update({
    ...base,
    participants: [
      ...base.participants,
      { id: 'ada', local: false, sounds: { enter: 'p.fanfar', leave: 'p.kapanis' } },
    ],
  });
  expect(t.update(base)).toEqual({
    cues: [{ kind: 'leave', actor: 'ada', local: false, sound: 'p.kapanis' }],
    rebased: false,
  });
});
it('a simultaneous join and departure are cues for both people', () => {
  const t = new RoomCueTracker();
  t.update(base);
  expect(
    t.update({
      ...base,
      participants: [
        { id: 'self', local: true },
        { id: 'ada', local: false, sounds: { enter: 'p.portal' } },
      ],
    }),
  ).toEqual({
    cues: [
      { kind: 'enter', actor: 'ada', local: false, sound: 'p.portal' },
      { kind: 'leave', actor: 'friend', local: false },
    ],
    rebased: false,
  });
});
it('reconnect rebases membership without artificial join/leave sounds', () => {
  const t = new RoomCueTracker();
  t.update(base);
  expect(t.update({ ...base, status: 'reconnecting', participants: [] })).toEqual(rebase);
  expect(t.update({ ...base, participants: [{ id: 'self', local: true }] })).toEqual(rebase);
  expect(t.update(base).cues).toEqual([{ kind: 'enter', actor: 'friend', local: false }]);
});
it('self departure emits once and failed join never emits', () => {
  const t = new RoomCueTracker();
  t.update({ ...base, status: 'connecting' });
  expect(t.update({ ...base, status: 'error' })).toEqual(rebase);
  expect(t.update({ ...base, channel: null, status: 'not-configured' })).toEqual(rebase);
  t.update(base);
  expect(t.update({ ...base, channel: null, status: 'not-configured', participants: [] })).toEqual(
    own('leave'),
  );
  expect(t.update({ ...base, channel: null, status: 'not-configured' })).toEqual(rebase);
});
it('a room change is a new baseline with only the self-join cue', () => {
  const t = new RoomCueTracker();
  t.update(base);
  expect(
    t.update({
      ...base,
      channel: 'other',
      participants: [...base.participants, { id: 'ada', local: false }],
    }),
  ).toEqual(own('enter'));
});
it('account rotation cannot compare private rosters', () => {
  const t = new RoomCueTracker();
  t.update(base);
  expect(
    t.update({
      ...base,
      scope: 'new-account',
      status: 'not-configured',
      channel: null,
      participants: [],
    }),
  ).toEqual(rebase);
});
it('own join and leave cues carry the listener’s own sounds (H02)', () => {
  const t = new RoomCueTracker();
  const me = { id: 'self', local: true, sounds: { enter: 'p.fanfar', leave: 'p.kapi' } };
  const inRoom = { ...base, participants: [me, { id: 'friend', local: false }] };
  expect(t.update(inRoom)).toEqual({
    cues: [{ kind: 'enter', actor: 'self', local: true, sound: 'p.fanfar' }],
    rebased: true,
  });
  expect(t.update({ ...inRoom, channel: null, participants: [] })).toEqual({
    cues: [{ kind: 'leave', actor: 'self', local: true, sound: 'p.kapi' }],
    rebased: true,
  });
});
