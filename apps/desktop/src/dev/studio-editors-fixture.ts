import {
  applyOps,
  createProject,
  defaultTrack,
  type StudioNote,
  type StudioOp,
  type StudioProject,
} from '@rooms/studio';
import type { EditorPresence } from '../studio/editors/port';
import { people, sample } from './sample';

/**
 * Dev-only Studio editors fixture, "Stüdyo düzenleyicileri" (S94): arrangement, piano roll and drum
 * steps on a fake store with two remote members. Reachable only through `?fixture=S94` in development
 * builds; StudioEditorsFixture.tsx renders it instead of the app shell.
 */
export const STUDIO_EDITORS_FIXTURE_VARIANTS = {
  S94: ['default', 'drums', 'perf', 'read-only', 'empty'],
} as const;
export type StudioEditorsFixtureVariant = (typeof STUDIO_EDITORS_FIXTURE_VARIANTS)['S94'][number];

/** A deterministic pseudo-random sequence so screenshots stay identical between runs. */
function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const CHORDS = [
  [60, 64, 67],
  [57, 60, 64],
  [53, 57, 60],
  [55, 59, 62],
];

export function studioEditorsFixtureDoc(variant: StudioEditorsFixtureVariant): StudioProject {
  const base = createProject({
    id: 'fixture-project',
    roomId: 'fixture-room',
    name: sample('Cuma akşamı', 'Friday night'),
    createdBy: 'self',
    createdAt: 1_760_000_000_000,
    template: variant === 'empty' ? 'empty' : 'drums-bass',
  });
  if (variant === 'empty') return base;
  const ops: StudioOp[] = [
    { op: 'project.set', field: 'lengthBeats', value: 64 },
    { op: 'track.create', track: defaultTrack('keys', 'instrument', { color: 1 }) },
    {
      op: 'track.create',
      track: defaultTrack('lead', 'instrument', {
        instrument: 'synth-lead@1',
        color: 2,
        name: sample('Melodi', 'Melody'),
      }),
    },
    {
      op: 'track.create',
      track: defaultTrack('vocal', 'audio', { color: 3, name: sample('Vokal', 'Vocal') }),
    },
    {
      op: 'clip.create',
      clip: {
        id: 'tpl-drums-clip-2',
        trackId: 'tpl-drums',
        startBeat: 16,
        lengthBeats: 16,
        name: '',
        kind: 'midi',
      },
    },
    {
      op: 'clip.create',
      clip: {
        id: 'keys-clip',
        trackId: 'keys',
        startBeat: 0,
        lengthBeats: 32,
        name: sample('Akorlar', 'Chords'),
        kind: 'midi',
      },
    },
    {
      op: 'clip.create',
      clip: {
        id: 'lead-clip',
        trackId: 'lead',
        startBeat: 8,
        lengthBeats: 8,
        name: '',
        kind: 'midi',
      },
    },
  ];
  const notes: StudioNote[] = [];
  for (let bar = 0; bar < 8; bar += 1)
    for (const pitch of CHORDS[bar % 4])
      notes.push({
        id: `k${notes.length}`,
        clipId: 'keys-clip',
        pitch,
        startBeat: bar * 4,
        lengthBeats: 3.5,
        velocity: 88,
      });
  const melody = [72, 74, 76, 79, 76, 74, 72, 69, 71, 72];
  melody.forEach((pitch, i) =>
    notes.push({
      id: `m${i}`,
      clipId: 'lead-clip',
      pitch,
      startBeat: i * 0.75,
      lengthBeats: 0.5,
      velocity: 70 + (i % 3) * 20,
    }),
  );
  if (variant === 'perf') {
    ops.push({
      op: 'clip.create',
      clip: {
        id: 'perf-clip',
        trackId: 'keys',
        startBeat: 32,
        lengthBeats: 128,
        name: sample('2 000 nota', '2,000 notes'),
        kind: 'midi',
      },
    });
    const random = seeded(7);
    for (let i = 0; i < 2000; i += 1)
      notes.push({
        id: `p${i}`,
        clipId: 'perf-clip',
        pitch: 40 + Math.floor(random() * 48),
        startBeat: Math.floor(random() * 512) / 4,
        lengthBeats: 0.25 + Math.floor(random() * 4) / 4,
        velocity: 40 + Math.floor(random() * 87),
      });
  }
  for (const note of notes) ops.push({ op: 'note.create', note });
  return applyOps(base, ops).doc;
}

export function studioEditorsFixturePresence(): EditorPresence[] {
  return [
    {
      userId: 'ece',
      name: people.ece,
      colorIndex: 4,
      playheadBeat: 21,
      selection: { clipId: 'keys-clip', noteIds: ['k3', 'k4', 'k5'] },
    },
    {
      userId: 'can',
      name: people.can,
      colorIndex: 7,
      playheadBeat: 41,
      selection: { clipId: 'lead-clip', noteIds: [] },
    },
  ];
}

/** Which clip the detail editor opens for each variant. */
export function studioEditorsFixtureClip(variant: StudioEditorsFixtureVariant): string | null {
  if (variant === 'drums') return 'tpl-drums-clip';
  if (variant === 'perf') return 'perf-clip';
  if (variant === 'empty') return null;
  return 'keys-clip';
}
