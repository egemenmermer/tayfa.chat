// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { commandSchema, type GamePublicState } from '../packages/activity-protocol/src';

const f = vi.hoisted(() => ({
  community: {
    user: { id: 'self' },
    status: 'connected',
    serverUrl: 'https://example.invalid',
    channels: [{ id: 'room-1', name: 'Salon' }],
    createInvite: async () => null,
  },
}));
vi.mock('../apps/desktop/src/community', () => ({
  useCommunity: Object.assign(
    (select?: (value: typeof f.community) => unknown) =>
      select ? select(f.community) : f.community,
    { getState: () => f.community, subscribe: () => () => {} },
  ),
}));
vi.mock('../apps/desktop/src/activity', () => ({ useActivityRoom: vi.fn() }));

import { offeredGames } from '../apps/desktop/src/games/catalog';
import { holdemGame } from '../apps/desktop/src/games/holdem/entry';
import { holdemFixture } from '../apps/desktop/src/games/holdem/fixture';
import { ReferenceGames } from '../apps/desktop/src/games/shared/Lobby';

afterEach(cleanup);

const activityRoom = () => ({
  status: 'connected' as const,
  busy: false,
  error: null,
  serverOffsetMs: 0,
  clearError: vi.fn(),
  room: {
    roomId: 'room-1',
    primary: null,
    participants: [{ userId: 'self', displayName: 'Ege', canCreate: true, canControl: true }],
  },
  send: vi.fn(async () => undefined),
  refresh: vi.fn(async () => undefined),
});
const lobby = (game: GamePublicState | null, create: string | null = null) => {
  const activity = activityRoom();
  render(
    <MemoryRouter>
      <ReferenceGames
        activity={activity as unknown as Parameters<typeof ReferenceGames>[0]['activity']}
        roomId="room-1"
        game={game}
        onCreate={vi.fn()}
        create={create}
        setup={{}}
        onSetup={vi.fn()}
      />
    </MemoryRouter>,
  );
  return activity;
};
const waiting = (kind: string, patch: Partial<GamePublicState> = {}, view = {}) =>
  ({
    kind,
    ownerId: 'self',
    status: 'waiting',
    seats: [{ seat: 0, userId: 'osman', name: 'Osman', bot: false, chips: 1000, connected: true }],
    turn: null,
    view: { legalActions: [], watching: false, ownRecovery: null, capacity: 4, ...view },
    history: [],
    ...patch,
  }) as unknown as GamePublicState;
const button = (name: string | RegExp) => screen.getByRole('button', { name }) as HTMLButtonElement;

it('still lists every offered game in the table catalog', () => {
  lobby(null);
  for (const entry of offeredGames)
    expect(screen.getByRole('heading', { level: 3, name: entry.name })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: 'Masa oluştur' })).toHaveLength(offeredGames.length);
});

it('creates a Blackjack table from its setup page with the table options and no Hold’em rules', () => {
  const activity = lobby(null, 'blackjack');
  expect(screen.queryByLabelText('Masa adı')).toBeNull();
  expect(screen.getByText('Ege')).toBeTruthy();
  fireEvent.click(button('Masayı kur'));
  expect(activity.send).toHaveBeenCalledWith({
    type: 'game.create',
    game: 'blackjack',
    options: { insurance: true, surrender: false },
  });
});

it('sends the Hold’em rules and the muck option from the create dialog', () => {
  const activity = lobby(null, 'holdem');
  fireEvent.click(screen.getByLabelText(/Kaybeden kartını açmasın/));
  fireEvent.click(button('Masayı kur'));
  const command = (activity.send.mock.calls as unknown[][])[0][0];
  expect(command).toMatchObject({
    type: 'game.create',
    game: 'holdem',
    holdem: { name: 'Texas Hold’em', smallBlind: 10, bigBlind: 20 },
    options: { muckLosers: true },
  });
  expect(
    commandSchema.safeParse({
      protocolVersion: 1,
      commandId: '7c4a52a6-6f7e-4f5c-9a77-0d6f5c3f2b11',
      expectedRevision: 0,
      command,
    }).success,
  ).toBe(true);
});

it('seats a Blackjack player without a buy-in and offers no rules editor', () => {
  const activity = lobby(waiting('blackjack', { ownerId: 'self' }));
  expect(screen.queryByRole('button', { name: 'Düzenle' })).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: 'Otur' })[0]);
  expect(screen.getByText('Koltuk 2')).toBeTruthy();
  expect(screen.queryByLabelText('Giriş miktarı')).toBeNull();
  fireEvent.click(button('Katıl'));
  expect(activity.send).toHaveBeenCalledWith({ type: 'game.sit', seat: 1 });
});

it('lets the Hold’em owner edit the rules and asks a new player for a buy-in', () => {
  const rules = holdemFixture('your-turn').view.rules;
  const activity = lobby(waiting('holdem', {}, { rules, capacity: 6 }));
  fireEvent.click(button('Düzenle'));
  expect(screen.queryByLabelText(/Kaybeden kartını açmasın/)).toBeNull();
  fireEvent.click(button('Kaydet'));
  expect(activity.send).toHaveBeenCalledWith({ type: 'game.configure', holdem: rules });
  cleanup();
  const next = lobby(waiting('holdem', { ownerId: 'osman' }, { rules, capacity: 6 }));
  fireEvent.click(screen.getAllByRole('button', { name: 'Otur' })[0]);
  fireEvent.change(screen.getByLabelText('Giriş miktarı'), { target: { value: '5000' } });
  expect(button('Katıl').disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Giriş miktarı'), { target: { value: '500' } });
  fireEvent.click(button('Katıl'));
  expect(next.send).toHaveBeenCalledWith({ type: 'game.sit', seat: 1, buyIn: 500 });
});

it('shows the published muckLosers house rule in the rule rows, and nothing on older servers', () => {
  const game = holdemFixture('your-turn');
  const rows = (muckLosers?: boolean) =>
    holdemGame.ruleRows({
      ...game,
      view: { ...game.view, rules: { ...game.view.rules, muckLosers } },
    });
  expect(rows(true)).toContainEqual(['Kaybeden kartını açmasın', 'Açık']);
  expect(rows(false)).toContainEqual(['Kaybeden kartını açmasın', 'Kapalı']);
  expect(rows(undefined).map(([label]) => label)).not.toContain('Kaybeden kartını açmasın');
});

it('mounts the Hold’em table from the registry with the lobby’s own command path', () => {
  const activity = lobby(holdemFixture('your-turn'));
  fireEvent.click(button('Gör · 40'));
  expect(activity.send).toHaveBeenCalledWith({ type: 'game.action', action: 'call' });
  // The playing table uses the table layout: one-row header, stage, docked controls.
  expect(document.querySelector('.rg-page.rx-game.rx-holdem > .rx-head')).toBeTruthy();
  expect(document.querySelector('.rx-stage .rg-board')).toBeTruthy();
  expect(button('Oyunlara dön')).toBeTruthy();
  expect(button('Masa kuralları')).toBeTruthy();
  expect(button('Masayı kapat')).toBeTruthy();
  expect(document.querySelector('.rg-end')).toBeNull();
});
