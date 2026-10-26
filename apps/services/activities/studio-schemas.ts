import { z } from 'zod';
import { opaqueId } from '../../../packages/activity-protocol/src/index';
import {
  beatPositionSchema,
  MAX_BATCH_OPS,
  MAX_PRESENCE_NOTE_IDS,
  MAX_SYNC_WAIT_MS,
  projectNameSchema,
  RETAINED_BATCHES,
  STUDIO_PROTOCOL_VERSION,
  studioIdSchema,
  studioOpSchema,
  studioProjectSchema,
  studioTemplateIdSchema,
  tempoSchema,
} from '../../../packages/studio/src/index';
import { ActivityStorageError } from './storage-codec';

// Route bodies and the stored record of Studio Contract v1. These belong in packages/studio next to the op
// schemas (the desktop bridge validates the same shapes); they live here until that package is open again.

const protocolVersion = z.literal(STUDIO_PROTOCOL_VERSION);
const count = z.number().int().min(0);

/** `POST …/studio/projects`. The server picks the project id. */
export const studioCreateRequestSchema = z
  .object({
    protocolVersion,
    name: projectNameSchema,
    tempo: tempoSchema.optional(),
    template: studioTemplateIdSchema.optional(),
  })
  .strict();

/** `GET …/projects/:projectId?afterSeq=N&waitMs=…`. */
export const studioSyncQuerySchema = z
  .object({
    afterSeq: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    waitMs: z.coerce.number().int().min(0).max(MAX_SYNC_WAIT_MS).default(0),
  })
  .strict();

/** Which editor panel a member has open; a short token the client chooses (e.g. `arrangement`, `mixer`). */
export const studioViewSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
/** `POST …/projects/:projectId/presence`. Each post replaces the sender's whole presence state. */
export const studioPresenceRequestSchema = z
  .object({
    playheadBeat: beatPositionSchema.optional(),
    selection: z
      .object({
        clipId: studioIdSchema.optional(),
        noteIds: z.array(studioIdSchema).max(MAX_PRESENCE_NOTE_IDS),
      })
      .strict()
      .optional(),
    view: studioViewSchema.optional(),
  })
  .strict();
export type StudioPresenceState = z.infer<typeof studioPresenceRequestSchema>;
export interface StudioPresence extends StudioPresenceState {
  userId: string;
  displayName: string;
  lastSeenAt: number;
}

export const studioSkipSchema = z
  .object({
    index: count,
    op: z.string().min(1).max(32),
    reason: z.enum([
      'missing-target',
      'exists',
      'missing-track',
      'missing-clip',
      'kind-mismatch',
      'limit',
      'invalid',
    ]),
  })
  .strict();

/**
 * One sequenced batch as stored. `applied`/`skipped` are kept only to answer a retried batch identically; sync
 * responses send `{seq, actorId, batchId, ops}` and clients replay the ops with the same reducer.
 */
const logEntrySchema = z
  .object({
    seq: z.number().int().min(1),
    actorId: studioIdSchema,
    batchId: z.string().uuid(),
    ops: z.array(studioOpSchema).min(1).max(MAX_BATCH_OPS),
    applied: z.array(count).max(MAX_BATCH_OPS),
    skipped: z.array(studioSkipSchema).max(MAX_BATCH_OPS),
  })
  .strict();
export type StudioLogEntry = z.infer<typeof logEntrySchema>;

export const STUDIO_STORAGE_VERSION = 1;
const storedSchema = z
  .object({
    version: z.literal(STUDIO_STORAGE_VERSION),
    roomId: opaqueId,
    updatedAt: count,
    seq: count,
    project: studioProjectSchema,
    log: z.array(logEntrySchema).max(RETAINED_BATCHES),
  })
  .strict()
  .superRefine((stored, context) => {
    // The retained log is the newest batches, contiguous and ending at `seq`.
    const first = stored.seq - stored.log.length + 1;
    if (first < 1 || stored.log.some((entry, i) => entry.seq !== first + i))
      context.addIssue({ code: 'custom', message: 'Studio log out of sequence' });
  });
export type StoredStudioProject = z.infer<typeof storedSchema>;

/**
 * Strict read of a stored project (pattern of `decodeStoredRoom`): an unknown version, a malformed document or a
 * record filed under another room/project is an `ActivityStorageError`, never a partial project.
 */
export function decodeStudioProject(
  value: unknown,
  expected?: { roomId: string; projectId: string },
): StoredStudioProject {
  if (
    typeof value === 'object' &&
    value !== null &&
    'version' in value &&
    value.version !== STUDIO_STORAGE_VERSION
  )
    throw new ActivityStorageError('unsupported-version');
  const result = storedSchema.safeParse(value);
  if (!result.success) throw new ActivityStorageError('invalid-state');
  const stored = result.data;
  if (
    stored.project.roomId !== stored.roomId ||
    (expected && (stored.roomId !== expected.roomId || stored.project.id !== expected.projectId))
  )
    throw new ActivityStorageError('room-mismatch');
  return stored;
}
