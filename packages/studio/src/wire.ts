import { z } from 'zod';
import {
  MAX_BATCH_OPS,
  MAX_PRESENCE_NOTE_IDS,
  MAX_SYNC_WAIT_MS,
  STUDIO_PROTOCOL_VERSION,
} from './limits';
import {
  beatPositionSchema,
  projectNameSchema,
  studioIdSchema,
  studioProjectSchema,
  tempoSchema,
} from './model';
import { studioOpSchema } from './ops';
import type { StudioSkipReason } from './reducer';
import { studioTemplateIdSchema } from './templates';

// Request and response bodies of the Studio routes (Contract v1, coordinator/specs/studio.md), shared by the
// activities service and the desktop bridge. Requests are strict; responses ignore unknown fields so a newer
// server can add some without breaking an older client.

const protocolVersion = z.literal(STUDIO_PROTOCOL_VERSION);
const count = z.number().int().min(0);

// ---- Requests ----

/** `POST …/studio/projects`. The server picks the project id. */
export const studioCreateRequestSchema = z
  .object({
    protocolVersion,
    name: projectNameSchema,
    tempo: tempoSchema.optional(),
    template: studioTemplateIdSchema.optional(),
  })
  .strict();
export type StudioCreateRequest = z.infer<typeof studioCreateRequestSchema>;

/** `GET …/projects/:projectId?afterSeq=N&waitMs=…`. */
export const studioSyncQuerySchema = z
  .object({
    afterSeq: z.coerce.number().int().min(0).max(Number.MAX_SAFE_INTEGER).default(0),
    waitMs: z.coerce.number().int().min(0).max(MAX_SYNC_WAIT_MS).default(0),
  })
  .strict();
export type StudioSyncQuery = z.infer<typeof studioSyncQuerySchema>;

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

// ---- Responses ----

/** One member's presence as the server reports it. */
export const studioPresenceEntrySchema = z.object({
  ...studioPresenceRequestSchema.shape,
  userId: z.string().min(1),
  displayName: z.string(),
  lastSeenAt: count,
});
export type StudioPresence = z.infer<typeof studioPresenceEntrySchema>;

/** What the caller may do in this project (sync response). */
export const studioProjectAccessSchema = z.object({ canEdit: z.boolean(), canDelete: z.boolean() });
export type StudioProjectAccess = z.infer<typeof studioProjectAccessSchema>;
/** What the caller may do in this room (list response). */
export const studioRoomAccessSchema = z.object({ canCreate: z.boolean() });
export type StudioRoomAccess = z.infer<typeof studioRoomAccessSchema>;

export const studioProjectSummarySchema = z.object({
  id: studioIdSchema,
  name: projectNameSchema,
  createdBy: studioIdSchema,
  createdAt: count,
  updatedAt: count,
  tempo: tempoSchema,
  tracks: count,
});
export type StudioProjectSummary = z.infer<typeof studioProjectSummarySchema>;

/** `GET …/studio/projects`. */
export const studioListResponseSchema = z.object({
  protocolVersion,
  projects: z.array(studioProjectSummarySchema),
  access: studioRoomAccessSchema,
});
/** `POST …/studio/projects`. */
export const studioCreateResponseSchema = z.object({
  protocolVersion,
  project: studioProjectSummarySchema,
});
/** `DELETE …/studio/projects/:projectId`. */
export const studioDeleteResponseSchema = z.object({ protocolVersion, removed: studioIdSchema });

const SKIP_REASONS = [
  'missing-target',
  'exists',
  'missing-track',
  'missing-clip',
  'kind-mismatch',
  'limit',
  'invalid',
] as const satisfies readonly StudioSkipReason[];
// A reason added to the reducer must be added here, or stored receipts holding it would fail to save.
type MissingSkipReason = Exclude<StudioSkipReason, (typeof SKIP_REASONS)[number]>;
export const skipReasonsComplete: [MissingSkipReason] extends [never] ? true : never = true;
export const studioSkipSchema = z
  .object({
    index: count,
    op: z.string().min(1).max(32),
    reason: z.enum(SKIP_REASONS),
  })
  .strict();

/** `POST …/projects/:projectId/ops` reply; a retried batch gets the same reply as the first time. */
export const studioOpsReplySchema = z.object({
  protocolVersion,
  seq: z.number().int().min(1),
  applied: z.array(count).max(MAX_BATCH_OPS),
  skipped: z.array(studioSkipSchema).max(MAX_BATCH_OPS),
});
export type StudioOpsReply = z.infer<typeof studioOpsReplySchema>;

/** One sequenced batch in a sync response; clients replay the ops with the same reducer. */
export const studioSyncBatchSchema = z.object({
  seq: z.number().int().min(1),
  actorId: studioIdSchema,
  batchId: z.string().uuid(),
  ops: z.array(studioOpSchema).min(1).max(MAX_BATCH_OPS),
});
export type StudioSyncBatch = z.infer<typeof studioSyncBatchSchema>;

const syncBase = {
  protocolVersion,
  serverTimeMs: count,
  seq: count,
  presence: z.array(studioPresenceEntrySchema),
  access: studioProjectAccessSchema,
};
/** `GET …/projects/:projectId`: a snapshot for a new or too-far-behind client, otherwise the batches after `afterSeq`. */
export const studioSyncResponseSchema = z.union([
  z.object({ ...syncBase, snapshot: studioProjectSchema }),
  z.object({ ...syncBase, batches: z.array(studioSyncBatchSchema) }),
]);
export type StudioSyncResponse = z.infer<typeof studioSyncResponseSchema>;

/** `POST …/projects/:projectId/presence`. */
export const studioPresenceReplySchema = z.object({
  protocolVersion,
  presence: z.array(studioPresenceEntrySchema),
});
