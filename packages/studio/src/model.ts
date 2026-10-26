import { z } from 'zod';
import {
  MAX_BEATS_PER_BAR,
  MAX_CLIP_GAIN_DB,
  MAX_CLIP_NAME,
  MAX_CLIP_OFFSET_SEC,
  MAX_CLIPS,
  MAX_EQ_DB,
  MAX_KEY_NAME,
  MAX_NOTES,
  MAX_PROJECT_BEATS,
  MAX_PROJECT_NAME,
  MAX_TEMPO,
  MAX_TRACK_NAME,
  MAX_TRACKS,
  MAX_VOLUME,
  MIN_BEATS_PER_BAR,
  MIN_CLIP_GAIN_DB,
  MIN_TEMPO,
  TRACK_COLOR_COUNT,
} from './limits';

// Schemas never transform (no trim/default): the client applies its own op optimistically and the server
// applies the parsed copy, so parsing must return the input unchanged or the two views drift apart.

/** Names that would reach `Object.prototype` when used as a record key. */
const RESERVED_IDS = new Set(['__proto__', 'constructor', 'prototype']);
/** Opaque id: the `opaqueId` pattern of `packages/activity-protocol`, minus prototype-reaching names. */
export const studioIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/)
  .refine((id) => !RESERVED_IDS.has(id), 'Reserved id');

function isCleanText(value: string): boolean {
  return value === value.trim() && !/\p{Cc}/u.test(value);
}
const cleanText = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine(isCleanText, 'Text must be trimmed and free of control characters');

export const projectNameSchema = cleanText(1, MAX_PROJECT_NAME);
/** An empty track or clip name means "unnamed": the UI shows a localized default. */
export const trackNameSchema = cleanText(0, MAX_TRACK_NAME);
export const clipNameSchema = cleanText(0, MAX_CLIP_NAME);
/** Free text such as "Am" or "F# minor"; omitted when the project has no key. */
export const keyNameSchema = cleanText(1, MAX_KEY_NAME);

/**
 * `instrumentId@version`, e.g. `piano@1`. Validated by shape only: a project made with a newer client must still
 * load, and the editor shows a labelled placeholder for instruments it does not know.
 */
export const INSTRUMENT_REF_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}@[1-9][0-9]{0,3}$/;
export const instrumentRefSchema = z.string().regex(INSTRUMENT_REF_PATTERN);

export const tempoSchema = z.number().min(MIN_TEMPO).max(MAX_TEMPO);
export const timeSignatureSchema = z
  .object({
    beats: z.number().int().min(MIN_BEATS_PER_BAR).max(MAX_BEATS_PER_BAR),
    unit: z.union([z.literal(4), z.literal(8)]),
  })
  .strict();
export const projectLengthSchema = z.number().int().min(1).max(MAX_PROJECT_BEATS);
export const beatPositionSchema = z.number().min(0).max(MAX_PROJECT_BEATS);
export const beatLengthSchema = z.number().positive().max(MAX_PROJECT_BEATS);
const unitLevel = z.number().min(0).max(1);
const eqBand = z.number().min(-MAX_EQ_DB).max(MAX_EQ_DB);

export const STUDIO_TRACK_KINDS = ['instrument', 'drums', 'audio'] as const;
export const STUDIO_CLIP_KINDS = ['midi', 'audio'] as const;
export type StudioTrackKind = (typeof STUDIO_TRACK_KINDS)[number];
export type StudioClipKind = (typeof STUDIO_CLIP_KINDS)[number];

export const trackSchema = z
  .object({
    id: studioIdSchema,
    name: trackNameSchema,
    kind: z.enum(STUDIO_TRACK_KINDS),
    instrument: instrumentRefSchema,
    /** Linear gain. */
    volume: z.number().min(0).max(MAX_VOLUME),
    pan: z.number().min(-1).max(1),
    mute: z.boolean(),
    solo: z.boolean(),
    color: z
      .number()
      .int()
      .min(0)
      .max(TRACK_COLOR_COUNT - 1),
    sends: z.object({ reverb: unitLevel, delay: unitLevel }).strict(),
    /** dB per band. */
    eq: z.object({ low: eqBand, mid: eqBand, high: eqBand }).strict(),
  })
  .strict();

export const clipOffsetSchema = z.number().min(0).max(MAX_CLIP_OFFSET_SEC);
export const clipGainSchema = z.number().min(MIN_CLIP_GAIN_DB).max(MAX_CLIP_GAIN_DB);
export const clipSchema = z
  .object({
    id: studioIdSchema,
    trackId: studioIdSchema,
    startBeat: beatPositionSchema,
    lengthBeats: beatLengthSchema,
    name: clipNameSchema,
    kind: z.enum(STUDIO_CLIP_KINDS),
    /** Audio clips only: the uploaded recording, where playback starts in it, and clip gain. */
    blobId: studioIdSchema.optional(),
    offsetSec: clipOffsetSchema.optional(),
    gainDb: clipGainSchema.optional(),
  })
  .strict()
  .superRefine((clip, context) => {
    const audioFields = [clip.blobId, clip.offsetSec, clip.gainDb];
    const consistent =
      clip.kind === 'audio'
        ? audioFields.every((value) => value !== undefined)
        : audioFields.every((value) => value === undefined);
    if (!consistent)
      context.addIssue({
        code: 'custom',
        message: 'Audio clips carry blobId, offsetSec and gainDb; MIDI clips carry none of them',
      });
  });

export const noteSchema = z
  .object({
    id: studioIdSchema,
    clipId: studioIdSchema,
    pitch: z.number().int().min(0).max(127),
    /** Relative to the clip start. */
    startBeat: beatPositionSchema,
    lengthBeats: beatLengthSchema,
    velocity: z.number().int().min(1).max(127),
  })
  .strict();

export type StudioTrack = z.infer<typeof trackSchema>;
export type StudioClip = z.infer<typeof clipSchema>;
export type StudioNote = z.infer<typeof noteSchema>;
export type StudioTimeSignature = z.infer<typeof timeSignatureSchema>;

/** MIDI clips live on instrument and drum tracks, audio clips on audio tracks. */
export function clipFitsTrack(clipKind: StudioClipKind, trackKind: StudioTrackKind): boolean {
  return clipKind === 'audio' ? trackKind === 'audio' : trackKind !== 'audio';
}

const projectObjectSchema = z
  .object({
    id: studioIdSchema,
    roomId: studioIdSchema,
    name: projectNameSchema,
    createdBy: studioIdSchema,
    createdAt: z.number().int().nonnegative(),
    tempo: tempoSchema,
    timeSignature: timeSignatureSchema,
    key: keyNameSchema.optional(),
    lengthBeats: projectLengthSchema,
    // Flat maps keyed by id keep every edit a field-level last-writer-wins write.
    tracks: z.record(studioIdSchema, trackSchema),
    trackOrder: z.array(studioIdSchema).max(MAX_TRACKS),
    clips: z.record(studioIdSchema, clipSchema),
    notes: z.record(studioIdSchema, noteSchema),
  })
  .strict();

export type StudioProject = z.infer<typeof projectObjectSchema>;

/**
 * Cross-entity invariants that `applyOps` keeps: keys match ids, `trackOrder` lists every track once, parents
 * exist with a matching kind, and counts stay within the limits. Returns at most `max` messages.
 */
export function studioProjectIssues(project: StudioProject, max = 10): string[] {
  const issues: string[] = [];
  const report = (message: string) => issues.length < max && issues.push(message);
  const has = Object.hasOwn;
  const trackIds = Object.keys(project.tracks);
  const clipIds = Object.keys(project.clips);
  const noteIds = Object.keys(project.notes);
  if (trackIds.length > MAX_TRACKS) report(`More than ${MAX_TRACKS} tracks`);
  if (clipIds.length > MAX_CLIPS) report(`More than ${MAX_CLIPS} clips`);
  if (noteIds.length > MAX_NOTES) report(`More than ${MAX_NOTES} notes`);
  for (const [key, track] of Object.entries(project.tracks))
    if (track.id !== key) report(`Track key ${key} does not match its id`);
  const ordered = new Set(project.trackOrder);
  if (ordered.size !== project.trackOrder.length) report('trackOrder lists a track twice');
  if (ordered.size !== trackIds.length || trackIds.some((id) => !ordered.has(id)))
    report('trackOrder does not list exactly the tracks');
  for (const [key, clip] of Object.entries(project.clips)) {
    if (clip.id !== key) report(`Clip key ${key} does not match its id`);
    const track = has(project.tracks, clip.trackId) ? project.tracks[clip.trackId] : undefined;
    if (!track) report(`Clip ${key} has no track`);
    else if (!clipFitsTrack(clip.kind, track.kind)) report(`Clip ${key} does not fit its track`);
  }
  for (const [key, note] of Object.entries(project.notes)) {
    if (note.id !== key) report(`Note key ${key} does not match its id`);
    const clip = has(project.clips, note.clipId) ? project.clips[note.clipId] : undefined;
    if (!clip) report(`Note ${key} has no clip`);
    else if (clip.kind !== 'midi') report(`Note ${key} is on an audio clip`);
  }
  return issues;
}

/** The whole project document, as stored and as sent in a sync snapshot. Strict: use it to validate on load. */
export const studioProjectSchema = projectObjectSchema.superRefine((project, context) => {
  for (const message of studioProjectIssues(project)) context.addIssue({ code: 'custom', message });
});
