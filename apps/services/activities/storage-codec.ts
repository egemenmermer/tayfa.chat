import { z } from 'zod';
import { gameModule, isGameKind } from '../../../packages/games/src/registry';
import type { StoredRoom } from './repository';

export const ACTIVITY_STORAGE_VERSION = 1;
const id = z.string().min(1).max(128),
  number = z.number().finite(),
  revision = z.number().int().nonnegative();
// A stored table must belong to a game the registry still hosts.
const gameKind = z.string().refine(isGameKind, 'Unknown game kind');
const history = z.array(
  z
    .object({ hand: revision, endedAt: number, result: z.record(z.string(), z.unknown()) })
    .passthrough(),
);
const statistics = z.record(
  z.string(),
  z.object({ hands: revision, wins: revision, score: number }).passthrough(),
);
// Preserve extension fields and game-engine payloads; this boundary validates durable structure,
// not every card/rule invariant. Engine-specific historical acceptance remains a release gate.
const game = z
  .object({
    kind: gameKind,
    ownerId: id,
    status: z.enum(['waiting', 'playing', 'finished']),
    capacity: revision,
    handNumber: revision,
    turnDeadline: number,
    seats: z.array(
      z
        .object({
          seat: revision,
          userId: id,
          name: z.string(),
          bot: z.boolean(),
          permanentBot: z.boolean(),
          chips: number,
          bet: number,
          connected: z.boolean(),
          disconnectedAt: number.nullable(),
          pendingReturn: z.boolean(),
        })
        .passthrough(),
    ),
    variant: z.enum(['ihaleli', 'esli', 'koz-maca', 'gommeli']),
    folding: z.boolean(),
    teams: z.boolean(),
    history,
    statistics,
  })
  .passthrough()
  .superRefine((value, context) => {
    const stateKey = gameModule(value.kind)?.table?.stateKey ?? 'round';
    if (value.status === 'playing' && !(value as Record<string, unknown>)[stateKey])
      context.addIssue({ code: 'custom', message: 'Missing active game engine state' });
  });
const source = z
  .object({
    userId: id,
    sourceVersion: id,
    durationSec: number,
    ready: z.boolean(),
    updatedAt: number,
  })
  .passthrough();
const snapshot = z
  .object({
    roomId: id,
    revision,
    participants: z.array(
      z
        .object({
          userId: id,
          displayName: z.string(),
          joinedAt: number,
          lastSeenAt: number,
          canControl: z.boolean(),
          canCreate: z.boolean().optional(),
        })
        .passthrough(),
    ),
    primary: z
      .object({
        activity: z.union([z.enum(['cinema', 'youtube', 'hall', 'screen']), gameKind]),
        title: z.string(),
        hostUserId: id,
        startedAt: number,
        state: z.enum(['live', 'awaiting-source']),
      })
      .passthrough()
      .nullable(),
    timeline: z
      .object({
        playing: z.boolean(),
        positionSec: number,
        rate: number,
        effectiveServerTimeMs: number,
        epoch: revision,
        itemId: id.nullable(),
      })
      .passthrough(),
    queue: z.array(
      z
        .object({
          id,
          addedBy: id,
          media: z.discriminatedUnion('kind', [
            z.object({ kind: z.literal('youtube'), videoId: id, title: z.string() }).passthrough(),
            z
              .object({ kind: z.literal('independent-source'), referenceId: id, title: z.string() })
              .passthrough(),
            z
              .object({
                kind: z.literal('community-media'),
                ref: z.string().regex(/^[a-z]-[A-Za-z0-9_-]{1,120}$/),
                title: z.string(),
                live: z.boolean(),
              })
              .passthrough(),
          ]),
        })
        .passthrough(),
    ),
    polls: z.array(
      z
        .object({
          id,
          question: z.string(),
          options: z.array(z.object({ id, label: z.string() }).passthrough()),
          votes: z.record(z.string(), z.string()),
          createdBy: id,
          closed: z.boolean(),
        })
        .passthrough(),
    ),
    whiteboard: z.array(
      z
        .object({
          id,
          kind: z.enum(['stroke', 'text', 'rectangle', 'ellipse', 'note']),
          points: z.array(z.tuple([number, number])),
          text: z.string().optional(),
          color: z.string(),
          width: number,
          authorId: id,
        })
        .passthrough(),
    ),
    cinema: z
      .object({
        itemId: id,
        timelineEpoch: revision,
        referenceId: id,
        durationSec: number.nullable(),
        sources: z.array(source),
      })
      .passthrough()
      .nullable()
      .optional(),
  })
  .passthrough();
const stored = z
  .object({
    schemaVersion: z.literal(ACTIVITY_STORAGE_VERSION).optional(),
    snapshot,
    events: z.array(
      z
        .object({
          revision,
          commandId: id.nullable(),
          type: z.string(),
          actorId: id,
          serverTimeMs: number,
        })
        .passthrough(),
    ),
    receipts: z.array(
      z.object({ actorId: id, commandId: id, fingerprint: z.string(), revision }).passthrough(),
    ),
    game: game.nullable().optional(),
    gameArchives: z
      .array(z.object({ kind: gameKind, history, statistics }).passthrough())
      .optional(),
  })
  .passthrough();

export class ActivityStorageError extends Error {
  constructor(public readonly category: 'unsupported-version' | 'invalid-state' | 'room-mismatch') {
    super(`Activity storage ${category}`);
  }
}
/** Pure read: legacy v0 gains a version in memory, never an automatic database write. */
export function decodeStoredRoom(value: unknown, expectedRoomId?: string): StoredRoom {
  if (
    typeof value === 'object' &&
    value !== null &&
    'schemaVersion' in value &&
    value.schemaVersion !== ACTIVITY_STORAGE_VERSION
  )
    throw new ActivityStorageError('unsupported-version');
  const result = stored.safeParse(value);
  if (!result.success) throw new ActivityStorageError('invalid-state');
  if (expectedRoomId !== undefined && result.data.snapshot.roomId !== expectedRoomId)
    throw new ActivityStorageError('room-mismatch');
  return { ...result.data, schemaVersion: ACTIVITY_STORAGE_VERSION } as StoredRoom;
}
export function encodeStoredRoom(room: StoredRoom): string {
  return JSON.stringify(decodeStoredRoom(room));
}
