import { z } from 'zod';
import { DEFAULT_PROJECT_BEATS, DEFAULT_TEMPO } from './limits';
import {
  studioProjectSchema,
  type StudioClip,
  type StudioNote,
  type StudioProject,
  type StudioTrack,
  type StudioTrackKind,
} from './model';

/** Project templates. They carry no display names: the UI labels templates, and empty track names, through t(). */
export const STUDIO_TEMPLATE_IDS = ['empty', 'drums-bass'] as const;
export type StudioTemplateId = (typeof STUDIO_TEMPLATE_IDS)[number];
export const studioTemplateIdSchema = z.enum(STUDIO_TEMPLATE_IDS);

/** Instrument a new track of each kind starts with; the audio engine must know these. */
export const DEFAULT_INSTRUMENTS: Record<StudioTrackKind, string> = {
  instrument: 'piano@1',
  drums: 'drum-kit@1',
  audio: 'audio@1',
};
export const BASS_INSTRUMENT = 'bass@1';

/** A new track with neutral mixer settings and an empty name. */
export function defaultTrack(
  id: string,
  kind: StudioTrackKind,
  overrides: Partial<Omit<StudioTrack, 'id' | 'kind'>> = {},
): StudioTrack {
  return {
    id,
    name: '',
    kind,
    instrument: DEFAULT_INSTRUMENTS[kind],
    volume: 1,
    pan: 0,
    mute: false,
    solo: false,
    color: 0,
    sends: { reverb: 0, delay: 0 },
    eq: { low: 0, mid: 0, high: 0 },
    ...overrides,
  };
}

export interface CreateStudioProjectParams {
  id: string;
  roomId: string;
  name: string;
  createdBy: string;
  createdAt: number;
  tempo?: number;
  template?: StudioTemplateId;
}

// General MIDI drum map.
const KICK = 36;
const SNARE = 38;
const CLOSED_HAT = 42;
/** One root per bar: C, A, F, G (bass register). */
const BASS_ROOTS = [36, 33, 29, 31];
const TEMPLATE_BARS = 4;

/** Four bars of 4/4: a rock beat on a drum track and a root-octave-fifth line on a bass track. */
function drumsAndBass(): Pick<StudioProject, 'tracks' | 'trackOrder' | 'clips' | 'notes' | 'lengthBeats'> {
  const lengthBeats = TEMPLATE_BARS * 4;
  const drums = defaultTrack('tpl-drums', 'drums', { color: 0 });
  const bass = defaultTrack('tpl-bass', 'instrument', { instrument: BASS_INSTRUMENT, color: 4 });
  const clip = (id: string, trackId: string): StudioClip => ({
    id,
    trackId,
    startBeat: 0,
    lengthBeats,
    name: '',
    kind: 'midi',
  });
  const drumClip = clip('tpl-drums-clip', drums.id);
  const bassClip = clip('tpl-bass-clip', bass.id);
  const notes: StudioNote[] = [];
  const add = (clipId: string, pitch: number, startBeat: number, length: number, velocity: number) =>
    notes.push({
      id: `${clipId === drumClip.id ? 'tpl-d' : 'tpl-b'}${notes.length}`,
      clipId,
      pitch,
      startBeat,
      lengthBeats: length,
      velocity,
    });
  for (let bar = 0; bar < TEMPLATE_BARS; bar += 1) {
    const at = bar * 4;
    for (const beat of [0, 2]) add(drumClip.id, KICK, at + beat, 0.25, 112);
    for (const beat of [1, 3]) add(drumClip.id, SNARE, at + beat, 0.25, 100);
    for (let eighth = 0; eighth < 8; eighth += 1)
      add(drumClip.id, CLOSED_HAT, at + eighth / 2, 0.25, eighth % 2 ? 60 : 80);
    const root = BASS_ROOTS[bar];
    add(bassClip.id, root, at, 1.5, 104);
    add(bassClip.id, root, at + 1.5, 0.5, 92);
    add(bassClip.id, root + 12, at + 2, 1, 100);
    add(bassClip.id, root + 7, at + 3, 0.5, 92);
    add(bassClip.id, root, at + 3.5, 0.5, 88);
  }
  return {
    lengthBeats,
    tracks: { [drums.id]: drums, [bass.id]: bass },
    trackOrder: [drums.id, bass.id],
    clips: { [drumClip.id]: drumClip, [bassClip.id]: bassClip },
    notes: Object.fromEntries(notes.map((note) => [note.id, note])),
  };
}

/**
 * A new project from a template. Template entities use fixed `tpl-` ids: ids only need to be unique within one
 * project, and clients generate random ids for everything they add. Throws (ZodError) for invalid params; the route
 * validates its request first.
 */
export function createProject(params: CreateStudioProjectParams): StudioProject {
  const content =
    params.template === 'drums-bass'
      ? drumsAndBass()
      : { lengthBeats: DEFAULT_PROJECT_BEATS, tracks: {}, trackOrder: [], clips: {}, notes: {} };
  return studioProjectSchema.parse({
    id: params.id,
    roomId: params.roomId,
    name: params.name,
    createdBy: params.createdBy,
    createdAt: params.createdAt,
    tempo: params.tempo ?? DEFAULT_TEMPO,
    timeSignature: { beats: 4, unit: 4 },
    ...content,
  });
}
