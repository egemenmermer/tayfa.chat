import { z } from 'zod';
import { opaqueId } from '../../../packages/activity-protocol/src/index';
import {
  MAX_BATCH_OPS,
  RETAINED_BATCHES,
  studioIdSchema,
  studioOpSchema,
  studioProjectSchema,
  studioSkipSchema,
} from '../../../packages/studio/src/index';
import { ActivityStorageError } from './storage-codec';

// The stored record of a Studio project. The request/response bodies live in packages/studio (`wire.ts`).

const count = z.number().int().min(0);

/** One sequenced batch as stored, enough to answer a poller that is a few batches behind. */
const logEntrySchema = z
  .object({
    seq: z.number().int().min(1),
    actorId: studioIdSchema,
    batchId: z.string().uuid(),
    ops: z.array(studioOpSchema).min(1).max(MAX_BATCH_OPS),
  })
  .strict();
export type StudioLogEntry = z.infer<typeof logEntrySchema>;

/**
 * What a retried batch needs: the original answer and a hash of its ops (a reused batch id with other ops is a
 * conflict). Receipts are small, so they outlive the log entries that the byte cap drops.
 */
const receiptSchema = z
  .object({
    seq: z.number().int().min(1),
    actorId: studioIdSchema,
    batchId: z.string().uuid(),
    opsHash: z.string().regex(/^[0-9a-f]{64}$/),
    applied: z.array(count).max(MAX_BATCH_OPS),
    skipped: z.array(studioSkipSchema).max(MAX_BATCH_OPS),
  })
  .strict();
export type StudioReceipt = z.infer<typeof receiptSchema>;

export const STUDIO_STORAGE_VERSION = 1;
const storedSchema = z
  .object({
    version: z.literal(STUDIO_STORAGE_VERSION),
    roomId: opaqueId,
    updatedAt: count,
    seq: count,
    project: studioProjectSchema,
    log: z.array(logEntrySchema).max(RETAINED_BATCHES),
    receipts: z.array(receiptSchema).max(RETAINED_BATCHES),
  })
  .strict()
  .superRefine((stored, context) => {
    if (!isContiguous(stored.log, stored.seq) || !isContiguous(stored.receipts, stored.seq))
      context.addIssue({ code: 'custom', message: 'Studio log out of sequence' });
  });
export type StoredStudioProject = z.infer<typeof storedSchema>;

/** The retained entries are the newest batches, contiguous and ending at `seq` (possibly none). */
function isContiguous(entries: readonly { seq: number }[], seq: number) {
  const first = seq - entries.length + 1;
  return first >= 1 && entries.every((e, i) => e.seq === first + i);
}

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

/**
 * Cheap check before a save. The document was validated when it was loaded or created, and every change since
 * went through `applyOps` (which validates its ops and enforces the limits), so re-parsing the whole project on
 * each save would only repeat that work; this guards the record's own bookkeeping instead.
 */
export function assertSaveable(stored: StoredStudioProject): void {
  if (
    stored.version !== STUDIO_STORAGE_VERSION ||
    stored.project.roomId !== stored.roomId ||
    !isContiguous(stored.log, stored.seq) ||
    !isContiguous(stored.receipts, stored.seq)
  )
    throw new ActivityStorageError('invalid-state');
}
