import type { ComponentType } from 'react';
import { batakCatalog } from './batak/catalog';
import { blackjackCatalog } from './blackjack/catalog';
import { holdemCatalog } from './holdem/catalog';
import { okeyCatalog } from './okey/catalog';
import { okey101Catalog } from './okey101/catalog';
import { pistiCatalog } from './pisti/catalog';
import { tavlaCatalog } from './tavla/catalog';

/**
 * What the app shows about a game before anyone sits at its table. This is the light half of the
 * client game registry: the Games lobby, the app directory and the activity launcher load it in the
 * main bundle, so a catalog file imports nothing but React, i18n and `shared/catalog-art`. The
 * table, rules and history views live in `registry.ts`, which only the lazy /games page loads.
 */
export interface GameCatalogEntry {
  /** Protocol id from `packages/games/src/registry.ts`, e.g. `'rooms-pisti-v1'`. */
  kind: string;
  /** Display name. Product names stay as they are; wrap them in `t()` only for Turkish letters. */
  name: string;
  /** Player count on the Games lobby card and in the app directory, e.g. `t('2–9 oyuncu')`. */
  players: string;
  /** One sentence for the Games lobby card and the app directory. */
  detail: string;
  /** Subtitle on the in-page table catalog (`shared/Lobby.tsx`). */
  lobbyDetail: string;
  /** Virtual chips (bets and buy-ins) or points (score per hand). */
  scoring: 'chips' | 'points';
  /** App directory section. */
  section: 'cards' | 'tables';
  /** Seats to show when the server sends no capacity (older servers). */
  fallbackCapacity: number;
  /**
   * Listed in the Games lobby, the app directory, the table catalog, the history filter and
   * `/games?create=`. Keep false until the game's table view is playable end to end.
   */
  offered: boolean;
  /** Drawn pieces for the Games lobby and the app directory (`.kh-art`). */
  Art: ComponentType;
  /** Drawn pieces inside `.rg-catalog-art` on the table catalog. */
  LobbyArt: ComponentType;
}

/** Every game the client knows, in catalog order. One line per game. */
export const gameCatalogEntries: readonly GameCatalogEntry[] = [
  holdemCatalog,
  blackjackCatalog,
  batakCatalog,
  okey101Catalog,
  pistiCatalog,
  okeyCatalog,
  tavlaCatalog,
];

const byKind = new Map(gameCatalogEntries.map((entry) => [entry.kind, entry]));
export const catalogEntry = (kind: string | null | undefined) =>
  kind ? byKind.get(kind) : undefined;
/** Games people can open a table for. */
export const offeredGames = gameCatalogEntries.filter((entry) => entry.offered);
export const isOfferedGame = (kind: string | null | undefined) =>
  catalogEntry(kind)?.offered === true;
/** Names of every known game, including ones not offered yet, so their live tables keep a title. */
export const gameNames: Record<string, string> = Object.fromEntries(
  gameCatalogEntries.map((entry) => [entry.kind, entry.name]),
);
