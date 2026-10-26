import { z } from 'zod';
import { MAX_BATCH_BYTES, MAX_BATCH_OPS, MAX_TRACKS, STUDIO_PROTOCOL_VERSION } from './limits';
import {
  beatLengthSchema,
  beatPositionSchema,
  clipGainSchema,
  clipNameSchema,
  clipOffsetSchema,
  clipSchema,
  instrumentRefSchema,
  keyNameSchema,
  noteSchema,
  projectLengthSchema,
  projectNameSchema,
  studioIdSchema,
  tempoSchema,
  timeSignatureSchema,
  trackNameSchema,
  trackSchema,
} from './model';

// Every `*.set` op names one field and carries a value checked by that field's schema. Fields are leaves, so two
// people turning different knobs of one track both keep their change (field-level last-writer-wins). Ids and kinds
// are fixed at creation; a note never changes clip (delete and re-create it instead).

const projectSet = <F extends string, V extends z.ZodType>(field: F, value: V) =>
  z.object({ op: z.literal('project.set'), field: z.literal(field), value }).strict();
const trackSet = <F extends string, V extends z.ZodType>(field: F, value: V) =>
  z.object({ op: z.literal('track.set'), id: studioIdSchema, field: z.literal(field), value }).strict();
const clipSet = <F extends string, V extends z.ZodType>(field: F, value: V) =>
  z.object({ op: z.literal('clip.set'), id: studioIdSchema, field: z.literal(field), value }).strict();
const noteSet = <F extends string, V extends z.ZodType>(field: F, value: V) =>
  z.object({ op: z.literal('note.set'), id: studioIdSchema, field: z.literal(field), value }).strict();
const remove = <O extends string>(op: O) =>
  z.object({ op: z.literal(op), id: studioIdSchema }).strict();

const track = trackSchema.shape;
const note = noteSchema.shape;

export const projectSetOpSchema = z.discriminatedUnion('field', [
  projectSet('name', projectNameSchema),
  projectSet('tempo', tempoSchema),
  projectSet('timeSignature', timeSignatureSchema),
  /** `null` removes the key. */
  projectSet('key', keyNameSchema.nullable()),
  projectSet('lengthBeats', projectLengthSchema),
]);
export const trackSetOpSchema = z.discriminatedUnion('field', [
  trackSet('name', trackNameSchema),
  trackSet('instrument', instrumentRefSchema),
  trackSet('volume', track.volume),
  trackSet('pan', track.pan),
  trackSet('mute', track.mute),
  trackSet('solo', track.solo),
  trackSet('color', track.color),
  trackSet('sends.reverb', track.sends.shape.reverb),
  trackSet('sends.delay', track.sends.shape.delay),
  trackSet('eq.low', track.eq.shape.low),
  trackSet('eq.mid', track.eq.shape.mid),
  trackSet('eq.high', track.eq.shape.high),
]);
export const clipSetOpSchema = z.discriminatedUnion('field', [
  clipSet('name', clipNameSchema),
  /** Moves the clip to another track of a fitting kind. */
  clipSet('trackId', studioIdSchema),
  clipSet('startBeat', beatPositionSchema),
  clipSet('lengthBeats', beatLengthSchema),
  /** Audio clips only. */
  clipSet('offsetSec', clipOffsetSchema),
  clipSet('gainDb', clipGainSchema),
]);
export const noteSetOpSchema = z.discriminatedUnion('field', [
  noteSet('pitch', note.pitch),
  noteSet('startBeat', beatPositionSchema),
  noteSet('lengthBeats', beatLengthSchema),
  noteSet('velocity', note.velocity),
]);

export const studioOpSchema = z.discriminatedUnion('op', [
  projectSetOpSchema,
  /** Appends the track to `trackOrder`. */
  z.object({ op: z.literal('track.create'), track: trackSchema }).strict(),
  trackSetOpSchema,
  /** Also deletes the track's clips and their notes. */
  remove('track.delete'),
  /** `index` is the track's position after the move, clamped to the track count. */
  z
    .object({
      op: z.literal('track.move'),
      id: studioIdSchema,
      index: z
        .number()
        .int()
        .min(0)
        .max(MAX_TRACKS - 1),
    })
    .strict(),
  z.object({ op: z.literal('clip.create'), clip: clipSchema }).strict(),
  clipSetOpSchema,
  /** Also deletes the clip's notes. */
  remove('clip.delete'),
  z.object({ op: z.literal('note.create'), note: noteSchema }).strict(),
  noteSetOpSchema,
  remove('note.delete'),
]);

export type StudioOp = z.infer<typeof studioOpSchema>;
export type StudioOpName = StudioOp['op'];
export type ProjectSetOp = z.infer<typeof projectSetOpSchema>;
export type TrackSetOp = z.infer<typeof trackSetOpSchema>;
export type ClipSetOp = z.infer<typeof clipSetOpSchema>;
export type NoteSetOp = z.infer<typeof noteSetOpSchema>;
export type ProjectField = ProjectSetOp['field'];
export type TrackField = TrackSetOp['field'];
export type ClipField = ClipSetOp['field'];
export type NoteField = NoteSetOp['field'];

const encoder = new TextEncoder();
/** UTF-8 size of `value` as JSON, the way it travels in a request body. */
export function serializedBytes(value: unknown): number {
  return encoder.encode(JSON.stringify(value)).byteLength;
}
export function batchFitsSize(batch: StudioBatch): boolean {
  return serializedBytes(batch) <= MAX_BATCH_BYTES;
}

/**
 * The body of `POST …/projects/:projectId/ops`. No expected revision: the server orders batches, and `batchId`
 * makes a retry idempotent.
 */
export const studioBatchSchema = z
  .object({
    protocolVersion: z.literal(STUDIO_PROTOCOL_VERSION),
    batchId: z.string().uuid(),
    ops: z.array(studioOpSchema).min(1).max(MAX_BATCH_OPS),
  })
  .strict()
  .refine(batchFitsSize, `Batch larger than ${MAX_BATCH_BYTES} bytes`);

export type StudioBatch = z.infer<typeof studioBatchSchema>;

/** Envelope size with an empty op list; every batchId is a 36-character UUID. */
const ENVELOPE_BYTES = serializedBytes({
  protocolVersion: STUDIO_PROTOCOL_VERSION,
  batchId: '00000000-0000-4000-8000-000000000000',
  ops: [],
});

/**
 * Splits ops, in order, into groups that each fit one batch (≤ MAX_BATCH_OPS ops, ≤ MAX_BATCH_BYTES serialized),
 * e.g. a large paste or the inverse of deleting a full track. Every single op fits a batch on its own.
 */
export function chunkOps(ops: readonly StudioOp[]): StudioOp[][] {
  const chunks: StudioOp[][] = [];
  let current: StudioOp[] = [];
  let bytes = ENVELOPE_BYTES;
  for (const op of ops) {
    const size = serializedBytes(op);
    // Each op after the first also adds a comma.
    if (current.length && (current.length >= MAX_BATCH_OPS || bytes + 1 + size > MAX_BATCH_BYTES)) {
      chunks.push(current);
      current = [];
      bytes = ENVELOPE_BYTES;
    }
    bytes += (current.length ? 1 : 0) + size;
    current.push(op);
  }
  if (current.length) chunks.push(current);
  return chunks;
}
