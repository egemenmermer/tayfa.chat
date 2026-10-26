import {
  studioCreateRequestSchema,
  type STUDIO_PROTOCOL_VERSION,
  type StudioCreateRequest,
  type StudioOp,
  type StudioPresence,
  type StudioPresenceState,
  type StudioProject,
  type StudioProjectSummary,
  type StudioSkip,
} from '@rooms/studio';

// Desktop side of Studio Contract v1 (coordinator/specs/studio.md): what `window.rooms.studio` takes and returns.
// Request/response shapes come from packages/studio (wire.ts), shared with the activities service.

export {
  studioPresenceRequestSchema as studioPresenceStateSchema,
  studioViewSchema,
} from '@rooms/studio';
export type { StudioPresence, StudioPresenceState, StudioProjectSummary } from '@rooms/studio';

/** `POST …/studio/projects` without the protocol version, which the main process adds. */
export const studioCreateInputSchema = studioCreateRequestSchema.omit({ protocolVersion: true });
export type StudioCreateInput = Omit<StudioCreateRequest, 'protocolVersion'>;

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
  /**
   * Desktop only: asks where to save an exported song and writes the WAV there (main validates the bytes).
   * Resolves false when the user cancels the dialog.
   */
  saveExport?(fileName: string, wav: Uint8Array): Promise<boolean>;
}
