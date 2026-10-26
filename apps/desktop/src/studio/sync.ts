import { z } from 'zod';
import {
  applyOps,
  chunkOps,
  dropConfirmed,
  invertOps,
  MAX_SYNC_WAIT_MS,
  rebase,
  studioOpSchema,
  type StudioOp,
  type StudioProject,
} from '@rooms/studio';
import type {
  StudioBridge,
  StudioPresence,
  StudioPresenceState,
  StudioSyncResponse,
} from '../../../../packages/shared-contracts/src/studio';
import { t } from '../i18n';
import {
  isRetryableStudioError,
  isTerminalStudioError,
  studioErrorCode,
  studioErrorMessage,
} from './errors';

// One open Studio project: the confirmed server document, this client's pending batches on top of it (the
// optimistic view), the long-poll loop, the batch sender, local undo/redo and presence. No React and no window
// globals, so tests drive it with a fake bridge; store.ts keeps one per account and exposes it to the UI.

/** `connecting` until the first snapshot; `offline` while requests fail and are retried; `error` is final. */
export type StudioSyncStatus = 'connecting' | 'live' | 'offline' | 'error' | 'closed';

export interface StudioSyncView {
  status: StudioSyncStatus;
  /** The optimistic document (confirmed ⊕ pending), or null before the first snapshot. */
  doc: StudioProject | null;
  /** Last server sequence folded into the confirmed document. */
  seq: number;
  /** The member may look and listen but not edit (`canControl` is off). */
  readOnly: boolean;
  canDelete: boolean;
  /** Batches not yet seen in the server log. */
  pending: number;
  canUndo: boolean;
  canRedo: boolean;
  /** Other members in the project (this user excluded). */
  presence: StudioPresence[];
  /** Server clock minus the local clock, for playheads shared by presence. */
  serverOffsetMs: number;
  /** Interface text of the last failure; cleared by `clearError` or a successful request. */
  error: string | null;
}

interface PendingBatch {
  batchId: string;
  ops: StudioOp[];
  /** Sent at least once: its body is fixed from then on, because a retry must be byte-identical. */
  attempted: boolean;
  /** Sequence the server gave it; the batch stays pending until the log (or a snapshot) reaches it. */
  ackSeq?: number;
}

export interface StudioSessionOptions {
  bridge: StudioBridge;
  roomId: string;
  projectId: string;
  /** This user's id: the `actorId` of their own batches in the server log. */
  actorId: string;
  uuid?: () => string;
  /** Long-poll wait once live (tests shorten it). */
  waitMs?: number;
}

const UNDO_LIMIT = 100;
/** Presence goes out at most four times a second. */
export const PRESENCE_INTERVAL_MS = 250;
const RETRY_FIRST_MS = 1_000;
const RETRY_MAX_MS = 15_000;
const opsSchema = z.array(studioOpSchema).min(1);

export interface StudioSession {
  view(): StudioSyncView;
  subscribe(listener: () => void): () => void;
  /** Applies `ops` at once and sends them; false when nothing changed or editing is not allowed. */
  dispatch(ops: readonly StudioOp[]): boolean;
  undo(): boolean;
  redo(): boolean;
  /** Shares playhead/selection/view with the others; merged into what was shared before. */
  setPresence(state: Partial<StudioPresenceState>): void;
  clearError(): void;
  close(): void;
}

export function createStudioSession(options: StudioSessionOptions): StudioSession {
  const { bridge, roomId, projectId, actorId } = options;
  const uuid = options.uuid ?? (() => crypto.randomUUID());
  const waitMs = Math.min(options.waitMs ?? MAX_SYNC_WAIT_MS, MAX_SYNC_WAIT_MS);
  const listeners = new Set<() => void>();
  let view: StudioSyncView = {
    status: 'connecting',
    doc: null,
    seq: 0,
    readOnly: false,
    canDelete: false,
    pending: 0,
    canUndo: false,
    canRedo: false,
    presence: [],
    serverOffsetMs: 0,
    error: null,
  };
  let closed = false;
  let confirmed: StudioProject | null = null;
  let seq = 0;
  let pending: PendingBatch[] = [];
  let undoStack: StudioOp[][] = [];
  let redoStack: StudioOp[][] = [];
  let pollFailing = false;
  let sendFailing = false;
  let needSnapshot = true;
  let sending = false;
  const sleepers = new Set<() => void>();

  const publish = (patch: Partial<StudioSyncView> = {}) => {
    if (closed && patch.status !== 'closed') return;
    const status: StudioSyncStatus =
      patch.status ??
      (view.status === 'error' || view.status === 'closed'
        ? view.status
        : !confirmed
          ? pollFailing
            ? 'offline'
            : 'connecting'
          : pollFailing || sendFailing
            ? 'offline'
            : 'live');
    view = {
      ...view,
      seq,
      pending: pending.length,
      canUndo: !view.readOnly && undoStack.length > 0,
      canRedo: !view.readOnly && redoStack.length > 0,
      ...patch,
      status,
    };
    if (patch.readOnly !== undefined)
      view = {
        ...view,
        canUndo: !view.readOnly && undoStack.length > 0,
        canRedo: !view.readOnly && redoStack.length > 0,
      };
    listeners.forEach((listener) => listener());
  };
  /** The optimistic document from scratch: confirmed with every pending batch re-applied in order. */
  const recompute = () => {
    publish({ doc: confirmed ? rebase(confirmed, pending).doc : null });
  };
  /** Resolves after `ms`, or at once when the session closes. */
  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        sleepers.delete(done);
        resolve();
      };
      const timer = setTimeout(done, ms);
      sleepers.add(done);
    });
  const backoff = (attempt: number) =>
    Math.min(RETRY_MAX_MS, RETRY_FIRST_MS * 2 ** Math.min(attempt, 6)) * (0.75 + Math.random() / 2);
  const fail = (error: unknown) => {
    publish({ status: 'error', error: studioErrorMessage(error) });
    stop();
  };
  const stop = () => {
    closed = true;
    for (const wake of [...sleepers]) wake();
    if (presenceTimer) clearTimeout(presenceTimer);
    presenceTimer = undefined;
  };

  // --- Receiving ---------------------------------------------------------------------------------------------
  /** `resync`: a snapshot here replaces a document the client already had (not the first load). */
  const accept = (response: StudioSyncResponse, resync: boolean) => {
    const readOnly = !response.access.canEdit;
    const presence = response.presence.filter((entry) => entry.userId !== actorId);
    const serverOffsetMs = response.serverTimeMs - Date.now();
    if (response.snapshot) {
      if (response.snapshot.id !== projectId || response.snapshot.roomId !== roomId)
        throw new Error('INVALID_ACTIVITY_RESPONSE');
      confirmed = response.snapshot;
      seq = response.seq;
      // Batches the snapshot already contains are done. The rest are sent (again) with their own id: the server
      // answers a batch it already has from its log, and after a restart that lost the newest writes it applies
      // the batch for the first time. Updated in place so a reply still in flight finds its batch.
      pending = pending.filter((batch) => batch.ackSeq === undefined || batch.ackSeq > seq);
      for (const batch of pending) batch.ackSeq = undefined;
      // Inverses were computed against history the client no longer knows.
      if (resync) {
        undoStack = [];
        redoStack = [];
      }
      needSnapshot = false;
    } else if (confirmed) {
      const fresh = response.batches.filter((batch) => batch.seq > seq);
      if (fresh.some((batch, index) => batch.seq !== seq + index + 1)) {
        // A hole in the log: only a snapshot can be trusted now.
        needSnapshot = true;
        return;
      }
      let doc = confirmed;
      for (const batch of fresh) doc = applyOps(doc, batch.ops).doc;
      confirmed = doc;
      seq = fresh.length ? fresh[fresh.length - 1].seq : seq;
      pending = dropConfirmed(pending, fresh, actorId).filter(
        (batch) => batch.ackSeq === undefined || batch.ackSeq > seq,
      );
    } else {
      needSnapshot = true;
      return;
    }
    if (readOnly) {
      pending = [];
      undoStack = [];
      redoStack = [];
    }
    pollFailing = false;
    publish({
      readOnly,
      canDelete: response.access.canDelete,
      presence,
      serverOffsetMs,
      doc: rebase(confirmed, pending).doc,
    });
    void pump();
  };

  const poll = async () => {
    let failures = 0;
    while (!closed) {
      const fresh = needSnapshot || !confirmed;
      // After a failure the next request answers at once so the status turns live as soon as it can.
      const wait = fresh || failures ? 0 : waitMs;
      try {
        // A never-edited project (seq 0) answers every poll with a snapshot; that is not a replacement.
        const resync = confirmed !== null && (needSnapshot || seq > 0);
        const response = await bridge.sync(roomId, projectId, fresh ? 0 : seq, wait);
        if (closed) return;
        accept(response, resync);
        failures = 0;
      } catch (error) {
        if (closed) return;
        const code = studioErrorCode(error);
        if (isTerminalStudioError(code)) return fail(error);
        if (!isRetryableStudioError(code)) {
          // An answer the client cannot use: start over from a snapshot after a pause.
          needSnapshot = true;
        }
        pollFailing = true;
        publish({ error: studioErrorMessage(error) });
        await sleep(backoff(failures++));
      }
    }
  };

  // --- Sending -----------------------------------------------------------------------------------------------
  const enqueue = (ops: StudioOp[]) => {
    for (const chunk of chunkOps(ops)) {
      const last = pending[pending.length - 1];
      // Batches never sent can still grow, which keeps a drag from spending one request per frame.
      if (last && !last.attempted && chunkOps([...last.ops, ...chunk]).length === 1)
        last.ops = [...last.ops, ...chunk];
      else pending.push({ batchId: uuid(), ops: chunk, attempted: false });
    }
  };
  const pump = async () => {
    if (sending || closed) return;
    sending = true;
    let failures = 0;
    try {
      for (;;) {
        if (closed || view.readOnly || !confirmed) return;
        const batch = pending.find((entry) => entry.ackSeq === undefined);
        if (!batch) return;
        batch.attempted = true;
        try {
          const reply = await bridge.ops(roomId, projectId, {
            batchId: batch.batchId,
            ops: batch.ops,
          });
          if (closed) return;
          failures = 0;
          if (sendFailing) {
            sendFailing = false;
            publish({ error: null });
          }
          batch.ackSeq = reply.seq;
          // Already folded into confirmed by a poll that came back first.
          if (reply.seq <= seq) {
            pending = pending.filter((entry) => entry !== batch);
            publish();
          }
        } catch (error) {
          if (closed) return;
          const code = studioErrorCode(error);
          if (isTerminalStudioError(code)) return fail(error);
          if (isRetryableStudioError(code)) {
            // Same batchId and the same ops: the server answers a duplicate from its log.
            sendFailing = true;
            publish({ error: studioErrorMessage(error) });
            await sleep(backoff(failures++));
            continue;
          }
          if (code === 'STUDIO_EDIT_DENIED') {
            pending = [];
            undoStack = [];
            redoStack = [];
            publish({ readOnly: true, error: studioErrorMessage(error) });
            recompute();
            return;
          }
          // Refused for good (invalid, too large, conflicting id): drop it; the view falls back without it.
          pending = pending.filter((entry) => entry !== batch);
          publish({ error: studioErrorMessage(error) });
          recompute();
        }
      }
    } finally {
      sending = false;
    }
  };

  /** Applies ops to the view, queues them, and records `inverse` on `into` (undo or redo). */
  const apply = (ops: StudioOp[], into: StudioOp[][]) => {
    const before = view.doc!;
    const result = applyOps(before, ops);
    if (!result.applied.length) return false;
    into.push(invertOps(before, ops));
    if (into.length > UNDO_LIMIT) into.shift();
    enqueue(ops);
    publish({ doc: result.doc });
    void pump();
    return true;
  };
  const refuseReadOnly = () => {
    publish({ error: t('Bu projeyi düzenleme iznin yok. Dinleyebilir ve izleyebilirsin.') });
    return false;
  };

  // --- Presence ----------------------------------------------------------------------------------------------
  let shared: StudioPresenceState = {};
  let presenceDirty = false;
  let presenceInFlight = false;
  let presenceSentAt = -Infinity;
  let presenceTimer: ReturnType<typeof setTimeout> | undefined;
  const flushPresence = () => {
    presenceTimer = undefined;
    if (closed || !presenceDirty) return;
    const due = presenceSentAt + PRESENCE_INTERVAL_MS - Date.now();
    if (presenceInFlight || due > 0) {
      if (!presenceInFlight) presenceTimer = setTimeout(flushPresence, due);
      return;
    }
    presenceDirty = false;
    presenceInFlight = true;
    presenceSentAt = Date.now();
    bridge
      .presence(roomId, projectId, shared)
      .then((reply) => {
        if (!closed)
          publish({ presence: reply.presence.filter((entry) => entry.userId !== actorId) });
      })
      // Presence is best effort; the next change or poll brings it back.
      .catch(() => {})
      .finally(() => {
        presenceInFlight = false;
        if (presenceDirty && !presenceTimer && !closed)
          presenceTimer = setTimeout(
            flushPresence,
            Math.max(0, presenceSentAt + PRESENCE_INTERVAL_MS - Date.now()),
          );
      });
  };

  void poll();
  return {
    view: () => view,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispatch(input) {
      if (closed || !view.doc) return false;
      if (view.readOnly) return refuseReadOnly();
      const ops = opsSchema.parse(input) as StudioOp[];
      const changed = apply(ops, undoStack);
      if (changed) {
        redoStack = [];
        publish();
      }
      return changed;
    },
    undo() {
      if (closed || !view.doc) return false;
      if (view.readOnly) return refuseReadOnly();
      const inverse = undoStack.pop();
      if (!inverse) return false;
      if (!apply(inverse, redoStack)) publish();
      return true;
    },
    redo() {
      if (closed || !view.doc) return false;
      if (view.readOnly) return refuseReadOnly();
      const ops = redoStack.pop();
      if (!ops) return false;
      if (!apply(ops, undoStack)) publish();
      return true;
    },
    setPresence(state) {
      if (closed) return;
      const next: Record<string, unknown> = { ...shared, ...state };
      for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
      if (JSON.stringify(next) === JSON.stringify(shared)) return;
      shared = next as StudioPresenceState;
      presenceDirty = true;
      if (!presenceTimer) flushPresence();
    },
    clearError() {
      if (view.error) publish({ error: null });
    },
    close() {
      if (closed) return;
      stop();
      publish({ status: 'closed' });
      listeners.clear();
    },
  };
}
