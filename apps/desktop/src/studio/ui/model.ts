import type { StudioOp, StudioProject } from '@rooms/studio';
import type {
  StudioCreateInput,
  StudioPresence,
  StudioProjectList,
  StudioProjectSummary,
} from '../../../../../packages/shared-contracts/src/studio';
import type { StudioSyncStatus } from '../sync';

/**
 * What the Studio frame (transport, presence, track headers) reads and calls. StudioPage builds it from
 * `useStudioStore`/`studioActions`; tests and the dev fixture pass a fake, so the frame never needs a session.
 */
export interface StudioEditorModel {
  status: StudioSyncStatus;
  doc: StudioProject | null;
  readOnly: boolean;
  /** Batches not yet confirmed by the server. */
  pending: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Other members in the project (this user excluded). */
  presence: StudioPresence[];
  error: string | null;
  dispatch(ops: StudioOp[]): boolean;
  undo(): boolean;
  redo(): boolean;
  clearError(): void;
  /** Opens the project again after a final error. */
  retry(): void;
  /** Publishes this user's clip/note selection as presence (optional: fixtures may omit it). */
  setSelection?(selection: { clipId?: string; noteIds: string[] }): void;
}

/** The project list's calls; the real one wraps the bridge with readable errors (store.ts). */
export interface StudioProjectsApi {
  list(roomId: string): Promise<StudioProjectList>;
  create(roomId: string, input: StudioCreateInput): Promise<{ project: StudioProjectSummary }>;
  remove(roomId: string, projectId: string): Promise<unknown>;
}

/** Display name for a user id; null when this client does not know the member. */
export type StudioNameOf = (userId: string) => string | null;

/** A fresh opaque id for client-created entities (contract: creates carry client-generated ids). */
export function newStudioId(): string {
  return crypto.randomUUID().replace(/-/g, '');
}
