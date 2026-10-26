import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityCommand } from '../packages/activity-protocol/src/index';
import {
  applyCommand,
  emptyRoom,
  GAME_ARCHIVE_LIMIT,
  pruneDisconnected,
} from '../apps/services/activities/engine';
import {
  advanceGameBots,
  canDeal,
  createGame,
  gameCommand,
  GAME_HISTORY_LIMIT,
  gameTurn,
  gameView,
  type GameTable,
} from '../apps/services/activities/games';
import { decodeStoredRoom, encodeStoredRoom } from '../apps/services/activities/storage-codec';
import { batakModule } from '../packages/games/src/batak-module';
import { blackjackModule } from '../packages/games/src/blackjack-module';
import type { BlackjackTableRound } from '../packages/games/src/blackjack-table';
import type { Card } from '../packages/games/src/cards';
import { holdemModule } from '../packages/games/src/holdem-module';
import { okey101Module } from '../packages/games/src/okey101-module';
import { startOkey101 } from '../packages/games/src/okey101-table';
import type { OkeyTile } from '../packages/games/src/okey101';
import { TURN_DURATION_MS } from '../packages/games/src/seats';

// Table lifecycle through the activity service (A1 track T1): nothing a busted stack, an absent owner, an idle
// player or a failing bot does may leave a table that can never deal again.
const alice = { userId: 'alice', displayName: 'Alice', canCreate: true };
const bob = { userId: 'bob', displayName: 'Bob', canCreate: true };
type Create = Extract<ActivityCommand, { type: 'game.create' }>;
const create = (command: Omit<Create, 'type'>) =>
  createGame({ type: 'game.create', ...command } as Create, alice);
const act = (table: GameTable, actor: typeof alice, command: ActivityCommand, now = 0) =>
  gameCommand(table, command, actor, now);
const startHand = (table: GameTable, actor = alice, now = 0) =>
  act(table, actor, { type: 'game.action', action: 'start' }, now);
const addBot = (table: GameTable, seat: number) =>
  act(table, alice, { type: 'game.bot.add', seat });
const seatOf = (table: GameTable, seat: number) => table.seats.find((s) => s.seat === seat)!;
const events = (table: GameTable, userId: string, type: string) =>
  (seatOf(table, table.seats.find((s) => s.userId === userId)!.seat).recoveryEvents ?? []).filter(
    (event) => event.type === type,
  );
/** Runs bot moves and timeouts one sweep at a time until the round is settled. */
function playOut(table: GameTable, start = 0) {
  let now = start;
  for (let step = 0; table.status === 'playing' && step < 20_000; step++) {
    now += TURN_DURATION_MS + 1;
    advanceGameBots(table, now);
  }
  expect(table.status).toBe('finished');
  return now;
}
const card = (suit: Card['suit'], rank: number): Card => ({ id: `${suit}-${rank}`, suit, rank });

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Hold'em wiring", () => {
  it('takes the muck rule from the table options and rejects unknown ones', () => {
    const table = create({ game: 'holdem', options: { muckLosers: true } });
    addBot(table, 1);
    startHand(table);
    expect(table.holdem!.muckLosers).toBe(true);
    expect(() => create({ game: 'holdem', options: { straddle: true } })).toThrow(
      'GAME_OPTIONS_UNSUPPORTED',
    );
    expect(create({ game: 'holdem' }).options).toBeUndefined();
  });

  it('stores the public action log with every hand', () => {
    const table = create({ game: 'holdem' });
    addBot(table, 1);
    startHand(table);
    playOut(table);
    const result = table.history.at(-1)!.result as {
      actions: { action: string; userId: string }[];
      mucked: string[];
    };
    expect(result.actions.slice(0, 2).map((entry) => entry.action)).toEqual([
      'smallBlind',
      'bigBlind',
    ]);
    expect(result.actions.length).toBeGreaterThan(2);
    expect(result.mucked).toEqual([]);
  });

  it('settles a hand the blinds already decided, with no turn clock and conserved chips', () => {
    const table = create({ game: 'holdem' });
    addBot(table, 1);
    // Both stacks go all-in on the blinds: the board runs out at the deal.
    seatOf(table, 0).chips = 10;
    seatOf(table, 1).chips = 20;
    startHand(table, alice, 5000);
    expect(table.holdem!.stage).toBe('ended');
    expect(table.status).toBe('finished');
    expect(table.turnDeadline).toBe(0);
    expect(gameTurn(table)).toBeNull();
    expect(table.history).toHaveLength(1);
    expect(table.seats.reduce((sum, seat) => sum + seat.chips, 0)).toBe(30);
    // The sweep has nothing to do and must not throw on the settled hand.
    expect(() => advanceGameBots(table, 100_000)).not.toThrow();
    expect(holdemModule.botCommand(table.holdem!, 0, Math.random)).toEqual({ action: 'check' });
    expect(holdemModule.table.timeoutDetails(table.holdem!, 0)).toEqual({});
  });

  it('deals only stacks with chips and tops up a busted permanent bot', () => {
    const table = create({ game: 'holdem' });
    addBot(table, 1);
    addBot(table, 2);
    act(table, bob, { type: 'game.sit', seat: 3 });
    seatOf(table, 3).chips = 0;
    seatOf(table, 2).chips = 0;
    startHand(table);
    expect(table.holdem!.seats.map((seat) => seat.userId)).toEqual([
      'alice',
      seatOf(table, 1).userId,
      seatOf(table, 2).userId,
    ]);
    expect(seatOf(table, 2).chips).toBe(1000);
    // Bob waits for a rebuy; with nobody else to play the owner cannot deal.
    const heads = create({ game: 'holdem' });
    act(heads, bob, { type: 'game.sit', seat: 1 });
    seatOf(heads, 1).chips = 0;
    expect(() => startHand(heads)).toThrow('MORE_SEATS_REQUIRED');
  });

  it('gives a returning player the stack they stood up with', () => {
    const table = create({
      game: 'holdem',
      holdem: {
        name: 'Masa',
        capacity: 6,
        smallBlind: 5,
        bigBlind: 10,
        minBuyIn: 200,
        maxBuyIn: 2000,
        initialChips: 1000,
        spectatorsAllowed: true,
      },
    });
    act(table, bob, { type: 'game.sit', seat: 1, buyIn: 1000 });
    seatOf(table, 1).chips = 1700;
    act(table, bob, { type: 'game.leave' });
    act(table, bob, { type: 'game.sit', seat: 2, buyIn: 500 });
    expect(seatOf(table, 2).chips).toBe(1700);
    // A busted player buys in fresh.
    seatOf(table, 2).chips = 0;
    act(table, bob, { type: 'game.leave' });
    act(table, bob, { type: 'game.sit', seat: 1, buyIn: 500 });
    expect(seatOf(table, 1).chips).toBe(500);
  });

  it('moves the button by seat when a player between hands leaves', () => {
    const table = create({ game: 'holdem' });
    for (const seat of [1, 2, 3]) addBot(table, seat);
    const buttonSeat = () => table.holdem!.seats[table.holdem!.button].userId;
    startHand(table);
    expect(buttonSeat()).toBe('alice');
    table.status = 'finished';
    startHand(table);
    expect(buttonSeat()).toBe(seatOf(table, 1).userId);
    table.status = 'finished';
    const seat2 = seatOf(table, 2).userId;
    act(table, alice, { type: 'game.seat.remove', seat: 1 });
    startHand(table);
    // By list index (hand 3 of 3 players) the button would jump to seat 3 and skip seat 2.
    expect(buttonSeat()).toBe(seat2);
  });

  it('folds for a player who left mid-hand instead of calling, while permanent bots still call', () => {
    const table = create({ game: 'holdem' });
    addBot(table, 1);
    startHand(table);
    // Heads-up: Alice is the button and small blind and acts first, facing 10 more.
    expect(gameTurn(table)).toBe(0);
    act(table, alice, { type: 'game.leave' }, 1000);
    advanceGameBots(table, 2000);
    const log = table.history.at(-1)!.result as { actions: { userId: string; action: string }[] };
    expect(log.actions.at(-1)).toMatchObject({ userId: 'alice', action: 'fold' });
    expect(table.seats.map((seat) => seat.seat)).toEqual([1]);
    expect(
      holdemModule.botCommand(
        { ...table.holdem!, stage: 'preflop', turn: 1, maximumBet: 40 },
        1,
        Math.random,
        { timedOut: false },
      ),
    ).toEqual({ action: 'call' });
  });
});

describe('bot sweep safety', () => {
  it('falls back to a plain legal move when the module bot throws', () => {
    const table = create({ game: 'batak', variant: 'ihaleli' });
    for (const seat of [1, 2, 3]) addBot(table, seat);
    startHand(table);
    const spy = vi.spyOn(batakModule, 'botCommand').mockImplementation(() => {
      throw new Error('broken bot');
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const before = table.batak!.turn;
    expect(() => advanceGameBots(table, TURN_DURATION_MS + 1)).not.toThrow();
    expect(spy).toHaveBeenCalled();
    // Bidding: the first legal plain action is a pass.
    expect(table.batak!.turn).not.toBe(before);
  });

  it('backs off instead of retrying every sweep when no move is legal', () => {
    const table = create({ game: 'batak', variant: 'ihaleli' });
    for (const seat of [1, 2, 3]) addBot(table, seat);
    startHand(table);
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const action = vi.spyOn(batakModule, 'action').mockReturnValue({ error: 'BROKEN' });
    const revision = JSON.stringify(table.batak);
    const now = TURN_DURATION_MS + 1;
    expect(advanceGameBots(table, now)).toBe(true);
    expect(table.botRetryAt).toBe(now + 5000);
    expect(errors).toHaveBeenCalledTimes(1);
    const calls = action.mock.calls.length;
    expect(advanceGameBots(table, now + 1000)).toBe(false);
    expect(action.mock.calls.length).toBe(calls);
    action.mockRestore();
    advanceGameBots(table, now + 6000);
    expect(JSON.stringify(table.batak)).not.toBe(revision);
    expect(table.botRetryAt).toBeUndefined();
  });

  it('counts a timed-out 101 turn once even when the gösterge keeps the turn', () => {
    const table = create({ game: '101' });
    for (const seat of [1, 2, 3]) addBot(table, seat);
    startHand(table);
    const round = table.okey!;
    expect(round.turn).toBe(0);
    round.hands[0][0] = { id: 'twin', color: round.indicator.color, value: round.indicator.value };
    let now = TURN_DURATION_MS + 1;
    advanceGameBots(table, now);
    expect(table.okey!.gostergeShown![0]).toBe(true);
    // The rest of the turn is played at once, without a fresh clock or a second timeout.
    for (let i = 0; i < 3 && table.okey!.turn === 0; i++) advanceGameBots(table, ++now);
    expect(table.okey!.turn).not.toBe(0);
    expect(events(table, 'alice', 'turn-timeout')).toHaveLength(1);
    expect(seatOf(table, 0)).toMatchObject({ timeouts: 1, bot: false });
    // A human who shows the gösterge in person gets a fresh clock for the rest of the turn.
    expect(okey101Module.phase({ ...round, gostergeShown: [true, false, false, false] })).toBe(1);
  });
});

describe('table lifecycle', () => {
  it('lets the owner or room host remove a bot or an away seat, never a present player', () => {
    const table = create({ game: 'batak', variant: 'ihaleli' });
    addBot(table, 1);
    act(table, bob, { type: 'game.sit', seat: 2 });
    expect(() => act(table, bob, { type: 'game.seat.remove', seat: 1 })).toThrow(
      'TABLE_OWNER_REQUIRED',
    );
    expect(() => act(table, alice, { type: 'game.seat.remove', seat: 2 })).toThrow(
      'SEAT_REMOVE_NOT_ALLOWED',
    );
    expect(() => act(table, alice, { type: 'game.seat.remove', seat: 3 })).toThrow('SEAT_EMPTY');
    act(table, alice, { type: 'game.seat.remove', seat: 1 });
    expect(table.seats.map((seat) => seat.seat)).toEqual([0, 2]);
    // Taken over by a bot, then Bob presses Otur: he is coming back and keeps the seat.
    seatOf(table, 2).bot = true;
    act(table, bob, { type: 'game.sit', seat: 2 });
    expect(seatOf(table, 2)).toMatchObject({ bot: true, pendingReturn: true });
    expect(() => act(table, alice, { type: 'game.seat.remove', seat: 2 })).toThrow(
      'SEAT_REMOVE_NOT_ALLOWED',
    );
    seatOf(table, 2).bot = false;
    seatOf(table, 2).pendingReturn = false;
    // Bob lost the connection 30 s ago: the room host (not the owner) frees the chair.
    seatOf(table, 2).connected = false;
    seatOf(table, 2).disconnectedAt = 0;
    gameCommand(
      table,
      { type: 'game.seat.remove', seat: 2 },
      { userId: 'carol', displayName: 'Carol', canCreate: true, roomHost: true },
      30_000,
    );
    expect(table.seats.map((seat) => seat.seat)).toEqual([0]);
  });

  it('publishes per-seat `removable` by the same rule game.seat.remove enforces', () => {
    const table = create({ game: 'batak', variant: 'ihaleli' });
    addBot(table, 1);
    act(table, bob, { type: 'game.sit', seat: 2 });
    const carol = { userId: 'carol', displayName: 'Carol', canCreate: true, roomHost: true };
    const stranger = { userId: 'stranger', displayName: 'S', canCreate: true };
    const viewers: (typeof alice & { roomHost?: boolean })[] = [alice, bob, carol, stranger];
    const removable = (viewer: (typeof viewers)[number], now: number) =>
      gameView(table, viewer.userId, {
        roomHost: viewer.roomHost,
        now,
      }).seats.map((seat) => [seat.seat, seat.removable]);
    // Bob is present: only the permanent bot (seat 1) can be freed, and only by the owner or the host.
    expect(removable(alice, 0)).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ]);
    expect(removable(carol, 0)).toEqual([
      [0, false],
      [1, true],
      [2, false],
    ]);
    expect(removable(bob, 0)).toEqual([
      [0, false],
      [1, false],
      [2, false],
    ]);
    expect(removable(stranger, 0)).toEqual([
      [0, false],
      [1, false],
      [2, false],
    ]);
    // Bob drops: not removable before 30 s, removable after (the same moment the command allows it).
    seatOf(table, 2).connected = false;
    seatOf(table, 2).disconnectedAt = 1000;
    expect(removable(alice, 30_999)[2]).toEqual([2, false]);
    expect(removable(alice, 31_000)[2]).toEqual([2, true]);
    // A takeover bot whose player pressed Otur is coming back: not removable.
    seatOf(table, 2).connected = true;
    seatOf(table, 2).disconnectedAt = null;
    seatOf(table, 2).bot = true;
    seatOf(table, 2).pendingReturn = true;
    expect(removable(alice, 40_000)[2]).toEqual([2, false]);
    // The published flag always agrees with what the command does.
    seatOf(table, 2).pendingReturn = false;
    for (const now of [0, 31_000])
      for (const viewer of viewers)
        for (const [seat, flag] of removable(viewer, now)) {
          const copy = structuredClone(table);
          let allowed = true;
          try {
            gameCommand(copy, { type: 'game.seat.remove', seat: seat as number }, viewer, now);
          } catch {
            allowed = false;
          }
          expect(flag, `${viewer.userId} seat ${seat} at ${now}`).toBe(allowed);
        }
  });

  it('lets a removed bot finish the running hand, then frees the seat', () => {
    const table = create({ game: 'holdem' });
    addBot(table, 1);
    addBot(table, 2);
    startHand(table);
    act(table, alice, { type: 'game.seat.remove', seat: 2 });
    expect(seatOf(table, 2)).toMatchObject({ left: true, bot: true });
    playOut(table);
    expect(table.seats.map((seat) => seat.seat)).toEqual([0, 1]);
  });

  it('removes and re-seats through the room engine (protocol command wired)', () => {
    const room = emptyRoom('friends', 1000),
      identity = { userId: 'alice', displayName: 'Alice', canControl: true, canCreate: true };
    const send = (command: ActivityCommand) =>
      applyCommand(
        room,
        identity,
        {
          protocolVersion: 1,
          commandId: randomUUID(),
          expectedRevision: room.snapshot.revision,
          command,
        },
        1000,
      );
    send({ type: 'join' });
    send({ type: 'game.create', game: 'batak', variant: 'ihaleli' });
    send({ type: 'game.bot.add', seat: 3 });
    send({ type: 'game.seat.remove', seat: 3 });
    expect(room.game!.seats.map((seat) => seat.seat)).toEqual([0]);
    expect(room.events.at(-1)!.type).toBe('game.seat.remove');
  });

  it('deals without the owner: a stood-up owner and an owner who left the room', () => {
    const table = create({ game: 'holdem' });
    act(table, bob, { type: 'game.sit', seat: 1 });
    addBot(table, 2);
    expect(canDeal(table, 'bob')).toBe(false);
    expect(() => startHand(table, bob)).toThrow('TABLE_OWNER_REQUIRED');
    act(table, alice, { type: 'game.leave' });
    expect(canDeal(table, 'bob')).toBe(true);
    expect(gameView(table, 'bob').view.legalActions).toEqual(['start']);
    startHand(table, bob);
    expect(table.status).toBe('playing');

    // Through the engine: the owner leaves the room and the activity host becomes a spectator.
    const room = emptyRoom('friends', 0);
    const people = {
      alice: { userId: 'alice', displayName: 'Alice', canControl: true, canCreate: true },
      carol: { userId: 'carol', displayName: 'Carol', canControl: true, canCreate: true },
      bob: { userId: 'bob', displayName: 'Bob', canControl: true, canCreate: true },
    };
    const send = (who: keyof typeof people, command: ActivityCommand, now = 1000) =>
      applyCommand(
        room,
        people[who],
        {
          protocolVersion: 1,
          commandId: randomUUID(),
          expectedRevision: room.snapshot.revision,
          command,
        },
        now,
      );
    send('alice', { type: 'join' }, 900);
    send('carol', { type: 'join' }, 950);
    send('bob', { type: 'join' });
    send('alice', { type: 'game.create', game: 'holdem' });
    send('bob', { type: 'game.sit', seat: 1 });
    send('alice', { type: 'game.bot.add', seat: 2 });
    send('alice', { type: 'leave' });
    expect(room.game!.ownerId).toBe('carol');
    expect(pruneDisconnected(room, 2000)).toBe(false);
    expect(room.game!.ownerId).toBe('carol');
    send('bob', { type: 'game.action', action: 'start' }, 2000);
    expect(room.game!.status).toBe('playing');
  });

  it('skips a Blackjack stack that cannot bet, lowers an uncovered bet and refills a bot', () => {
    let table = create({ game: 'blackjack' });
    // A natural settles during the deal and moves the stacks; that is not under test: deal again.
    // A missing refill still fails, because no deal then leaves the bot at 1000.
    for (let deal = 0; deal < 200; deal++) {
      table = create({ game: 'blackjack' });
      act(table, bob, { type: 'game.sit', seat: 1 });
      addBot(table, 2);
      act(table, bob, { type: 'game.action', action: 'bet', amount: 500 });
      seatOf(table, 1).chips = 401;
      seatOf(table, 0).chips = 1;
      seatOf(table, 2).chips = 0;
      startHand(table);
      if (!table.blackjack!.finished && seatOf(table, 2).chips === 1000) break;
    }
    const round = table.blackjack as BlackjackTableRound;
    expect(round.players.map((player) => player.userId)).toEqual(['bob', seatOf(table, 2).userId]);
    expect(round.players[0].hands[0].bet).toBe(400);
    expect(seatOf(table, 1).bet).toBe(500);
    expect(seatOf(table, 2).chips).toBe(1000);
    playOut(table);
    // Alice rebuys once she cannot cover the smallest bet; a covered stack cannot.
    act(table, alice, { type: 'game.sit', seat: 0, buyIn: 5000 });
    expect(seatOf(table, 0).chips).toBe(1000);
    expect(() => act(table, alice, { type: 'game.sit', seat: 0, buyIn: 10 })).toThrow(
      'CHIP_CHANGE_NOT_ALLOWED',
    );
  });

  it('stands a timed-out Blackjack hand instead of hitting', () => {
    let table = create({ game: 'blackjack' });
    // A dealer natural, an ace up (insurance prompt) or a player natural (turn passes to the bot) is
    // not the decision under test: deal again.
    for (let deal = 0; deal < 200; deal++) {
      table = create({ game: 'blackjack' });
      addBot(table, 1);
      startHand(table);
      const dealt = table.blackjack!;
      if (!dealt.finished && !dealt.insurancePending && dealt.turn === 0) break;
    }
    const round = table.blackjack as BlackjackTableRound;
    expect(round).toMatchObject({ finished: false, turn: 0 });
    round.players[0].hands[0].cards = [card('hearts', 10), card('clubs', 2)];
    expect(blackjackModule.botCommand(round, 0)).toEqual({ action: 'hit' });
    advanceGameBots(table, TURN_DURATION_MS + 1);
    expect(events(table, 'alice', 'turn-timeout')[0]).toMatchObject({ action: 'stand' });
    expect(
      blackjackModule.phase({ ...round, players: [{ ...round.players[0], activeHand: 1 }] }),
    ).toBe('play:1');
  });

  it('hands an idle seat to a bot after two timed-out turns in a row, until the player returns', () => {
    const table = create({ game: 'holdem' });
    addBot(table, 1);
    let now = 0;
    startHand(table, alice, now);
    now = playOut(table, now);
    expect(seatOf(table, 0)).toMatchObject({ timeouts: 1, bot: false });
    startHand(table, alice, now);
    now = playOut(table, now);
    expect(seatOf(table, 0)).toMatchObject({ timeouts: 2, bot: true, pendingReturn: false });
    expect(events(table, 'alice', 'takeover-started')).toHaveLength(1);
    act(table, alice, { type: 'game.sit', seat: 0 }, now);
    expect(seatOf(table, 0)).toMatchObject({ timeouts: 0, pendingReturn: true });
  });

  it('restarts the clock on every bot decision, including a trick winner leading again', () => {
    for (let run = 0; run < 5; run++) {
      const table = create({ game: 'batak', variant: 'ihaleli' });
      for (const seat of [1, 2, 3]) addBot(table, seat);
      startHand(table);
      let now = 0;
      for (let step = 0; table.status === 'playing' && step < 5000; step++) {
        now += TURN_DURATION_MS + 1;
        const mover = gameTurn(table);
        advanceGameBots(table, now);
        if (table.status === 'playing' && mover !== 0)
          expect(table.turnDeadline).toBe(now + TURN_DURATION_MS);
      }
      expect(table.status).toBe('finished');
    }
    const round = { stage: 'playing', completedTricks: [{}, {}] } as never;
    expect(batakModule.phase(round)).toBe('playing:2');
  });

  it('never opens a 101 hand for a timed-out player', () => {
    const round = startOkey101(false, false, 0);
    const colors = ['red', 'yellow', 'blue'] as const;
    const groups: OkeyTile[] = [13, 12, 11].flatMap((value) =>
      colors.map((color) => ({ id: `${color}-${value}`, color, value })),
    );
    const junk: OkeyTile[] = [1, 3, 5, 7, 9].map((value, index) => ({
      id: `junk-${index}`,
      color: index % 2 ? 'black' : 'blue',
      value,
    }));
    round.hands[0] = [...groups, ...junk];
    round.stage = 'discard';
    round.turn = 0;
    round.gostergeShown = [true, false, false, false];
    expect(okey101Module.botCommand(round, 0, Math.random, { timedOut: false }).action).toBe(
      'open',
    );
    expect(okey101Module.botCommand(round, 0, Math.random, { timedOut: true }).action).toBe(
      'discard',
    );
  });
});

describe('stored caps', () => {
  it('keeps the newest hands in a table history', () => {
    const table = create({ game: 'holdem' });
    addBot(table, 1);
    table.history = Array.from({ length: GAME_HISTORY_LIMIT + 5 }, (_, hand) => ({
      hand,
      endedAt: hand,
      result: {},
    }));
    startHand(table);
    playOut(table);
    expect(table.history).toHaveLength(GAME_HISTORY_LIMIT);
    expect(table.history[0].hand).toBe(6);
  });

  it('keeps the newest archived tables and round-trips the new table fields through storage', () => {
    const room = emptyRoom('friends', 0),
      identity = { userId: 'alice', displayName: 'Alice', canControl: true, canCreate: true };
    const send = (command: ActivityCommand) =>
      applyCommand(
        room,
        identity,
        {
          protocolVersion: 1,
          commandId: randomUUID(),
          expectedRevision: room.snapshot.revision,
          command,
        },
        1000,
      );
    send({ type: 'join' });
    send({ type: 'game.create', game: 'holdem' });
    for (let i = 0; i < GAME_ARCHIVE_LIMIT + 3; i++)
      send({
        type: 'game.create',
        game: 'holdem',
        replacePrimary: { activity: 'holdem', startedAt: room.snapshot.primary!.startedAt },
      });
    expect(room.gameArchives).toHaveLength(GAME_ARCHIVE_LIMIT);
    send({ type: 'game.bot.add', seat: 1 });
    send({ type: 'game.action', action: 'start' });
    room.game!.savedStacks = { bob: 700 };
    room.game!.seats[0].timeouts = 1;
    const decoded = decodeStoredRoom(JSON.parse(encodeStoredRoom(room)), room.snapshot.roomId);
    expect(decoded.game).toMatchObject({ buttonSeat: 0, savedStacks: { bob: 700 } });
    expect(decoded.game!.seats[0].timeouts).toBe(1);
  });
});
