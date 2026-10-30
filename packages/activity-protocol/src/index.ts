import { z } from 'zod';

export const opaqueId = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().trim().min(1).max(240);
const media = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('youtube'),
      videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/),
      title: text,
    })
    .strict(),
  // A shared reference describes the work, never a filesystem path or provider URL.
  z.object({ kind: z.literal('independent-source'), referenceId: opaqueId, title: text }).strict(),
  // An item of the community cinema catalog. The cinema service resolves `ref` and
  // relays one server-side stream to everyone in the hall; no provider data is shared.
  z
    .object({
      kind: z.literal('community-media'),
      ref: z.string().regex(/^[a-z]-[A-Za-z0-9_-]{1,120}$/),
      title: text,
      live: z.boolean(),
      art: z
        .string()
        .regex(/^[a-f0-9]{16,64}$/)
        .nullable()
        .optional(),
    })
    .strict(),
]);
export const holdemTableRulesSchema = z
  .object({
    name: z.string().trim().min(1).max(32),
    capacity: z.number().int().min(2).max(9),
    smallBlind: z.number().int().min(1).max(100000),
    bigBlind: z.number().int().min(1).max(100000),
    minBuyIn: z.number().int().min(1).max(1000000),
    maxBuyIn: z.number().int().min(1).max(1000000),
    initialChips: z.number().int().min(1).max(1000000),
    spectatorsAllowed: z.boolean(),
  })
  .strict()
  .superRefine((rules, context) => {
    if (
      rules.smallBlind > rules.bigBlind ||
      rules.minBuyIn < rules.bigBlind ||
      rules.minBuyIn > rules.maxBuyIn ||
      rules.initialChips < rules.minBuyIn ||
      rules.initialChips > rules.maxBuyIn
    )
      context.addIssue({ code: z.ZodIssueCode.custom, message: 'Inconsistent Holdem table rules' });
  });
export type HoldemTableRules = z.infer<typeof holdemTableRulesSchema>;
/** Game kinds every current client knows. The server accepts any kind in its game registry. */
export const builtInGameKinds = [
  'holdem',
  'blackjack',
  'batak',
  '101',
  'rooms-pisti-v1',
  'rooms-okey-v1',
  'rooms-tavla-v1',
] as const;
export type BuiltInGameKind = (typeof builtInGameKinds)[number];
/** A table game's protocol id (`packages/games/src/registry.ts`); built-in kinds keep their literal types. */
export type GameKind = BuiltInGameKind | (string & {});
// Clients validate shape only, so a game added on the server needs no protocol change; the
// service rejects kinds and actions its registry does not know.
export const GAME_KIND_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;
export const GAME_ACTION_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;
export const MAX_GAME_SEATS = 12;
const MAX_GAME_PAYLOAD_BYTES = 8192;
const sharedActivities = ['cinema', 'youtube', 'hall', 'screen'] as const;
const gameKind = z.string().regex(GAME_KIND_PATTERN);
const gameSeat = z
  .number()
  .int()
  .min(0)
  .max(MAX_GAME_SEATS - 1);
/** Per-game `game.action` data, checked by the game module's `parseCommand`. */
const gamePayload = z
  .json()
  .refine(
    (value) => JSON.stringify(value).length <= MAX_GAME_PAYLOAD_BYTES,
    'Game payload too large',
  );
/** Flat `game.create` options for registry games, checked by the module's `parseOptions`. */
const gameOptions = z
  .record(
    z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/),
    z.union([z.string().max(64), z.number().finite(), z.boolean()]),
  )
  .refine((value) => Object.keys(value).length <= 16, 'Too many game options');
const replacePrimarySchema = z
  .object({
    activity: z.union([z.enum(sharedActivities), gameKind]),
    startedAt: z.number().int().nonnegative(),
  })
  .strict();
export const commandSchema = z
  .object({
    protocolVersion: z.literal(1),
    commandId: z.string().uuid(),
    expectedRevision: z.number().int().nonnegative(),
    command: z.discriminatedUnion('type', [
      z.object({ type: z.literal('join') }).strict(),
      z.object({ type: z.literal('leave') }).strict(),
      z
        .object({
          type: z.literal('start'),
          activity: z.enum([
            'cinema',
            'youtube',
            'hall',
            'screen',
            'holdem',
            'blackjack',
            'batak',
            '101',
          ]),
          title: text,
        })
        .strict(),
      z.object({ type: z.literal('end') }).strict(),
      z
        .object({
          type: z.literal('playback'),
          playing: z.boolean(),
          positionSec: z.number().finite().min(0).max(86400),
          rate: z.number().min(0.25).max(2),
        })
        .strict(),
      z
        .object({
          type: z.literal('cinema.source'),
          expectedSourceVersion: z.string().uuid().nullable(),
          itemId: opaqueId,
          timelineEpoch: z.number().int().nonnegative(),
          referenceId: opaqueId,
          sourceVersion: z.string().uuid(),
          durationSec: z.number().finite().positive().max(86400),
        })
        .strict(),
      z
        .object({
          type: z.literal('cinema.release'),
          itemId: opaqueId,
          timelineEpoch: z.number().int().nonnegative(),
          sourceVersion: z.string().uuid(),
        })
        .strict(),
      z
        .object({
          type: z.literal('cinema.ready'),
          itemId: opaqueId,
          timelineEpoch: z.number().int().nonnegative(),
          sourceVersion: z.string().uuid(),
          ready: z.boolean(),
        })
        .strict(),
      z
        .object({
          type: z.literal('cinema.playback'),
          itemId: opaqueId,
          timelineEpoch: z.number().int().nonnegative(),
          sourceVersion: z.string().uuid(),
          playing: z.boolean(),
          positionSec: z.number().finite().min(0).max(86400),
          rate: z.number().min(0.25).max(2),
        })
        .strict(),
      z
        .object({
          type: z.literal('queue.add'),
          itemId: opaqueId,
          media,
          // Select and start the new item right away instead of only queueing it.
          start: z.boolean().optional(),
        })
        .strict(),
      z.object({ type: z.literal('queue.remove'), itemId: opaqueId }).strict(),
      // Removes every item except the one playing.
      z.object({ type: z.literal('queue.clear') }).strict(),
      z.object({ type: z.literal('queue.reorder'), itemIds: z.array(opaqueId).max(100) }).strict(),
      z
        .object({ type: z.literal('queue.select'), itemId: opaqueId, play: z.boolean().optional() })
        .strict(),
      // Advances only while `fromItemId` is still current, so every viewer may report the end once.
      z
        .object({
          type: z.literal('queue.next'),
          fromItemId: opaqueId,
          reason: z.enum(['ended', 'skip']),
        })
        .strict(),
      z.object({ type: z.literal('session.control'), mode: z.enum(['everyone', 'host']) }).strict(),
      z
        .object({ type: z.literal('session.permit'), userId: opaqueId, allowed: z.boolean() })
        .strict(),
      z.object({ type: z.literal('session.host'), userId: opaqueId }).strict(),
      z
        .object({
          type: z.literal('poll.create'),
          pollId: opaqueId,
          question: text,
          options: z
            .array(z.object({ id: opaqueId, label: text }).strict())
            .min(2)
            .max(12),
        })
        .strict(),
      z.object({ type: z.literal('poll.vote'), pollId: opaqueId, optionId: opaqueId }).strict(),
      z.object({ type: z.literal('poll.close'), pollId: opaqueId }).strict(),
      z
        .object({
          type: z.literal('whiteboard.put'),
          element: z
            .object({
              id: opaqueId,
              kind: z.enum(['stroke', 'text', 'rectangle', 'ellipse', 'note']),
              points: z
                .array(
                  z.tuple([
                    z.number().finite().min(0).max(4096),
                    z.number().finite().min(0).max(4096),
                  ]),
                )
                .min(1)
                .max(500),
              text: z.string().max(2000).optional(),
              color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
              width: z.number().min(1).max(24),
            })
            .strict()
            // A sticky note is anchored by its top-left corner: exactly one point.
            .refine((element) => element.kind !== 'note' || element.points.length === 1, {
              message: 'A note needs exactly one anchor point',
            }),
        })
        .strict(),
      z.object({ type: z.literal('whiteboard.remove'), elementId: opaqueId }).strict(),
      // Clears every stroke and note. Community admins (the `canControl` rule) only.
      z.object({ type: z.literal('whiteboard.clear') }).strict(),
      z
        .object({
          type: z.literal('game.create'),
          game: gameKind,
          // Built-in table options; registry games take `options` instead.
          variant: z.enum(['ihaleli', 'esli', 'koz-maca', 'gommeli']).optional(),
          folding: z.boolean().optional(),
          teams: z.boolean().optional(),
          holdem: holdemTableRulesSchema.optional(),
          options: gameOptions.optional(),
          replacePrimary: replacePrimarySchema.optional(),
        })
        .strict(),
      z.object({ type: z.literal('game.configure'), holdem: holdemTableRulesSchema }).strict(),
      z.object({ type: z.literal('game.watch'), watching: z.boolean() }).strict(),
      z
        .object({
          type: z.literal('game.sit'),
          seat: gameSeat,
          buyIn: z.number().int().min(1).max(1000000).optional(),
        })
        .strict(),
      z.object({ type: z.literal('game.bot.add'), seat: gameSeat }).strict(),
      // The table owner or room host frees a bot's seat or an away player's seat.
      z.object({ type: z.literal('game.seat.remove'), seat: gameSeat }).strict(),
      z.object({ type: z.literal('game.leave') }).strict(),
      z
        .object({
          type: z.literal('game.action'),
          // `start` (and Blackjack's between-hands `bet`) are table commands; every other name
          // belongs to the table's game module, e.g. fold/hit/play/discard for the built-in games.
          action: z.string().regex(GAME_ACTION_PATTERN),
          payload: gamePayload.optional(),
          // Flat fields of the built-in games; registry games put their data in `payload`.
          amount: z.number().int().min(0).max(1000000).optional(),
          cardId: opaqueId.optional(),
          tileIds: z.array(opaqueId).max(30).optional(),
          melds: z.array(z.array(opaqueId).max(13)).max(10).optional(),
          // 101: per-meld reading of an opening whose okeys allow a run or a group (null = server picks).
          meldKinds: z
            .array(z.enum(['run', 'group']).nullable())
            .max(10)
            .optional(),
          trump: z.enum(['clubs', 'diamonds', 'hearts', 'spades']).optional(),
        })
        .strict(),
    ]),
  })
  .strict();
export type CommandEnvelope = z.infer<typeof commandSchema>;
export type ActivityCommand = CommandEnvelope['command'];
export type SharedMedia = z.infer<typeof media>;
export interface Participant {
  userId: string;
  displayName: string;
  joinedAt: number;
  lastSeenAt: number;
  canControl: boolean;
  canCreate?: boolean;
}
export interface QueueItem {
  id: string;
  media: SharedMedia;
  addedBy: string;
}
export interface Timeline {
  playing: boolean;
  positionSec: number;
  rate: number;
  effectiveServerTimeMs: number;
  epoch: number;
  itemId: string | null;
}
export interface Poll {
  id: string;
  question: string;
  options: { id: string; label: string }[];
  votes: Record<string, string>;
  createdBy: string;
  closed: boolean;
}
export interface BoardElement {
  id: string;
  /**
   * `note` is a sticky note: `points[0]` is its top-left corner, `text` its body, `color` its paper.
   * Clients that predate notes draw it as an invisible one-point stroke and otherwise ignore it.
   */
  kind: 'stroke' | 'text' | 'rectangle' | 'ellipse' | 'note';
  points: [number, number][];
  text?: string;
  color: string;
  width: number;
  authorId: string;
}
export interface CinemaSourceDeclaration {
  userId: string;
  sourceVersion: string;
  durationSec: number;
  ready: boolean;
  updatedAt: number;
}
/** Public matching hints only; never proof of ownership, licensing or identical bytes. */
export interface CinemaSourceState {
  itemId: string;
  timelineEpoch: number;
  referenceId: string;
  durationSec: number | null;
  sources: CinemaSourceDeclaration[];
}
export interface RoomSnapshot {
  roomId: string;
  revision: number;
  participants: Participant[];
  primary: null | {
    /** `hall`: the permanent community cinema, keyed by its hall channel. */
    activity: (typeof sharedActivities)[number] | GameKind;
    title: string;
    hostUserId: string;
    startedAt: number;
    state: 'live' | 'awaiting-source';
    /** `host`: only the host and `controllers` steer playback. Missing means `everyone`. */
    controlMode?: SessionControlMode;
    controllers?: string[];
  };
  timeline: Timeline;
  queue: QueueItem[];
  polls: Poll[];
  whiteboard: BoardElement[];
  cinema?: CinemaSourceState | null;
  game?: GamePublicState | null;
}
export interface PokerHandEvaluation {
  category:
    | 'high-card'
    | 'one-pair'
    | 'two-pair'
    | 'three-of-a-kind'
    | 'straight'
    | 'flush'
    | 'full-house'
    | 'four-of-a-kind'
    | 'straight-flush';
  score: number[];
  bestFiveCardIds: string[];
}
export interface PokerPot {
  kind: 'main' | 'side';
  amount: number;
  eligible: string[];
  winners: string[];
  awards: Record<string, number>;
  split: boolean;
}
export interface GameSpectator {
  userId: string;
  name: string;
}
export interface GameHistorySeat {
  seat: number;
  position: number;
  userId: string;
  name: string;
  bot: boolean;
  startingChips?: number;
}
export interface GameHistoryEntry {
  hand: number;
  endedAt: number;
  result: Record<string, unknown>;
  tableName?: string;
  seats?: GameHistorySeat[];
}
export interface GameRecoveryEvent {
  id: string;
  at: number;
  hand: number;
  type: 'takeover-started' | 'return-requested' | 'control-returned' | 'turn-timeout';
  action?: string;
  toCall?: number;
}
/** The table-rule fields the shared game views read whatever the game (seat count, spectators). */
export interface GameTableRulesCommon {
  capacity?: number;
  spectatorsAllowed?: boolean;
}
/**
 * `view.rules`: every game sends its own table rules under this key (Hold'em `HoldemTableRules`,
 * Batak's house rules, Blackjack's insurance/surrender switches, 101's profile). Shared views read
 * only the common fields; a game reads its own shape from its own view (Hold'em narrows by kind).
 */
export type GameViewRules =
  HoldemTableRules | (GameTableRulesCommon & { readonly [key: string]: unknown });
export interface GamePublicState {
  /**
   * Typed as the kinds the current clients render, so their views stay exhaustive. The service may
   * send any registered kind; add it to `builtInGameKinds` when its client view ships.
   */
  kind: BuiltInGameKind;
  ownerId: string;
  status: 'waiting' | 'playing' | 'finished';
  seats: {
    seat: number;
    userId: string;
    name: string;
    bot: boolean;
    chips: number;
    connected: boolean;
    pendingNextHand?: boolean;
    /** The viewer may free this seat now (`game.seat.remove`): the server's own rule, per viewer. */
    removable?: boolean;
  }[];
  turn: number | null;
  view: Record<string, unknown> & {
    ownRecovery?: {
      disconnectedAt: number | null;
      takeoverAt: number | null;
      pendingReturn: boolean;
      takeover: boolean;
      events?: GameRecoveryEvent[];
    } | null;
    tableName?: string;
    rules?: GameViewRules;
    spectators?: GameSpectator[];
    watching?: boolean;
    spectatorAccess?: boolean;
    ownHand?: PokerHandEvaluation | null;
    showdown?: Record<string, PokerHandEvaluation> | null;
    pots?: PokerPot[];
    settlementReason?: 'uncontested' | 'showdown' | null;
  };
  history: GameHistoryEntry[];
}
export interface ActivityEvent {
  revision: number;
  commandId: string | null;
  type: string;
  actorId: string;
  serverTimeMs: number;
}
export interface ActivityResponse {
  protocolVersion: 1;
  serverTimeMs: number;
  room: RoomSnapshot;
  events: ActivityEvent[];
  replayRequired: boolean;
}
export type SessionControlMode = 'everyone' | 'host';
/** Whether a participant may steer the shared player under the host's session setting. */
export function directsSession(
  primary: RoomSnapshot['primary'],
  userId: string | null | undefined,
  canControl: boolean,
): boolean {
  if (!canControl || !userId) return false;
  if (!primary || primary.controlMode !== 'host') return true;
  return primary.hostUserId === userId || (primary.controllers ?? []).includes(userId);
}
/** Ending a shared player (watch-together, cinema, screen) for everyone is the host's call. */
export function endsActivity(
  primary: RoomSnapshot['primary'],
  userId: string | null | undefined,
  canControl: boolean,
): boolean {
  if (!canControl || !userId) return false;
  if (!primary || !['cinema', 'youtube', 'hall', 'screen'].includes(primary.activity)) return true;
  return primary.hostUserId === userId;
}
export function playbackPosition(timeline: Timeline, serverTimeMs: number): number {
  return Math.max(
    0,
    timeline.positionSec +
      (timeline.playing
        ? (Math.max(0, serverTimeMs - timeline.effectiveServerTimeMs) / 1000) * timeline.rate
        : 0),
  );
}

export type ActivityCommandEnvelope = CommandEnvelope;
