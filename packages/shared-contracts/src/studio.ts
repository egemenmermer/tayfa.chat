import { z } from 'zod';
import {
  beatPositionSchema,
  MAX_PRESENCE_NOTE_IDS,
  projectNameSchema,
  STUDIO_PROTOCOL_VERSION,
  studioIdSchema,
  studioTemplateIdSchema,
  tempoSchema,
  type StudioOp,
  type StudioProject,
  type StudioSkip,
} from '@rooms/studio';

// Desktop side of Studio Contract v1 (coordinator/specs/studio.md): what `window.rooms.studio` takes and returns.
// The create/presence body schemas mirror apps/services/activities/studio-schemas.ts; both belong in
// packages/studio once that package is open for changes again.

/** `POST …/studio/projects` without the protocol version, which the main process adds. */
export const studioCreateInputSchema = z
  .object({
    name: projectNameSchema,
    tempo: tempoSchema.optional(),
    template: studioTemplateIdSchema.optional(),
  })
  .strict();
export type StudioCreateInput = z.infer<typeof studioCreateInputSchema>;

/** Which editor panel a member has open; a short token the client chooses (e.g. `arrangement`, `mixer`). */
export const studioViewSchema = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/);
/** `POST …/projects/:projectId/presence`. Each post replaces the sender's whole presence state. */
export const studioPresenceStateSchema = z
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
export type StudioPresenceState = z.infer<typeof studioPresenceStateSchema>;

export interface StudioPresence extends StudioPresenceState {
  userId: string;
  displayName: string;
  lastSeenAt: number;
}

export interface StudioProjectSummary {
  id: string;
  name: string;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  tempo: number;
  tracks: number;
}

export interface StudioProjectList {
  protocolVersion: typeof STUDIO_PROTOCOL_VERSION;
  projects: StudioProjectSummary[];
  access: { canCreate: boolean };
}

/** One sequenced batch from the server log. `actorId` is the user id of the sender. */
export interface StudioLogBatch {
  seq: number;
  actorId: string;
  batchId: string;
  ops: StudioOp[];
}

interface StudioSyncBase {
  protocolVersion: typeof STUDIO_PROTOCOL_VERSION;
  serverTimeMs: number;
  seq: number;
  presence: StudioPresence[];
  access: { canEdit: boolean; canDelete: boolean };
}
/** A long-poll answer: either the batches after `afterSeq` or the whole document at `seq`. */
export type StudioSyncResponse =
  | (StudioSyncBase & { snapshot: StudioProject; batches?: undefined })
  | (StudioSyncBase & { batches: StudioLogBatch[]; snapshot?: undefined });

export interface StudioOpsResponse {
  protocolVersion: typeof STUDIO_PROTOCOL_VERSION;
  seq: number;
  applied: number[];
  skipped: StudioSkip[];
}

export interface StudioBatchInput {
  batchId: string;
  ops: StudioOp[];
}

/**
 * `window.rooms.studio`. The main process holds the bearer, validates the sender and every input, and talks to
 * the activities service. Errors arrive as `Error` whose message carries a public code (e.g. `STUDIO_EDIT_DENIED`).
 */
export interface StudioBridge {
  list(roomId: string): Promise<StudioProjectList>;
  create(
    roomId: string,
    input: StudioCreateInput,
  ): Promise<{ protocolVersion: 1; project: StudioProjectSummary }>;
  remove(roomId: string, projectId: string): Promise<{ protocolVersion: 1; removed: string }>;
  /** Long poll: `afterSeq = 0` always answers a snapshot, so the first sync of a session uses `waitMs = 0`. */
  sync(
    roomId: string,
    projectId: string,
    afterSeq: number,
    waitMs: number,
  ): Promise<StudioSyncResponse>;
  ops(roomId: string, projectId: string, batch: StudioBatchInput): Promise<StudioOpsResponse>;
  presence(
    roomId: string,
    projectId: string,
    state: StudioPresenceState,
  ): Promise<{ protocolVersion: 1; presence: StudioPresence[] }>;
}
