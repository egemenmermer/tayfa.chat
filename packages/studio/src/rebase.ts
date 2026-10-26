import type { StudioProject } from './model';
import type { StudioOp } from './ops';
import { StudioDraft, type StudioSkip } from './reducer';

/** A batch this client sent (or is about to send) that the server has not confirmed yet. */
export interface StudioPendingBatch {
  batchId: string;
  ops: readonly StudioOp[];
}

export interface StudioRebaseResult {
  doc: StudioProject;
  skipped: Array<StudioSkip & { batchId: string }>;
}

/**
 * The client's optimistic view: the server-confirmed document with the client's pending batches re-applied in
 * order. Call it again whenever confirmed batches arrive; a pending op whose target someone else deleted is skipped
 * here exactly as the server will skip it.
 */
export function rebase(
  confirmedDoc: StudioProject,
  pendingBatches: readonly StudioPendingBatch[],
): StudioRebaseResult {
  const draft = new StudioDraft(confirmedDoc);
  const skipped: StudioRebaseResult['skipped'] = [];
  for (const batch of pendingBatches)
    batch.ops.forEach((op, index) => {
      const reason = draft.apply(op);
      if (reason) skipped.push({ batchId: batch.batchId, index, op: String(op.op), reason });
    });
  return { doc: draft.finish(), skipped };
}

/**
 * Pending batches minus those the server log already contains. The server deduplicates per (actorId, batchId), so
 * only this client's own log entries confirm its pending batches.
 */
export function dropConfirmed<T extends StudioPendingBatch>(
  pendingBatches: readonly T[],
  serverBatches: Iterable<{ actorId: string; batchId: string }>,
  actorId: string,
): T[] {
  const confirmed = new Set<string>();
  for (const batch of serverBatches) if (batch.actorId === actorId) confirmed.add(batch.batchId);
  return pendingBatches.filter((batch) => !confirmed.has(batch.batchId));
}
