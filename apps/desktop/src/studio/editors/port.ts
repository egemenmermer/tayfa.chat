import type { StudioOp, StudioProject } from '@rooms/studio';

/** What another member (or this user) has selected; the wire shape of presence `selection`. */
export interface EditorSelection {
  clipId?: string;
  /** At most MAX_PRESENCE_NOTE_IDS ids reach the server; the editors keep the full set locally. */
  noteIds: string[];
}

export interface EditorPresence {
  userId: string;
  name: string;
  /** Index into the categorical colour ramp (colors.ts). */
  colorIndex: number;
  playheadBeat?: number;
  selection?: EditorSelection;
}

/** Loop range in beats; `enabled` false keeps the range but the transport plays through. */
export interface EditorLoop {
  startBeat: number;
  endBeat: number;
  enabled: boolean;
}

/**
 * The narrow surface the arrangement, piano roll and step sequencer are built against. The Studio
 * store (ST-client) is wired to it by the shell; tests and fixtures use fake-port.ts.
 *
 * Contract for the adapter:
 * - `dispatch` receives one gesture as one call. It can exceed MAX_BATCH_OPS (e.g. moving 2 000
 *   notes, duplicating a long clip), so the adapter splits it with `chunkOps` before sending.
 * - `position()` is read every animation frame; it must be cheap (engine transport position).
 * - `doc` is a new object after every change (the editors memoise on identity).
 */
export interface EditorPort {
  doc: StudioProject;
  canEdit: boolean;
  dispatch(ops: StudioOp[]): void;
  /** Everyone in the project except this user. */
  presence: EditorPresence[];
  selfUserId: string;
  /** Engine transport position in beats. */
  position(): number;
  /** Plays one note on the track's instrument right away (audition). */
  preview(trackId: string, pitch: number, velocity: number): void;
  setSelection(selection: EditorSelection): void;
  /**
   * Port gaps (not in the prompt's shape, optional so the adapter can add them later): the loop
   * lives in the engine/transport, not in the project document, and seeking is a transport call.
   */
  loop?: EditorLoop | null;
  setLoop?(loop: EditorLoop | null): void;
  seek?(beat: number): void;
}
