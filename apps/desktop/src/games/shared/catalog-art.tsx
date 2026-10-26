import type { ReactNode } from 'react';

/**
 * Drawn table pieces for game catalog cards; no photos, so the lobby keeps the app's own look.
 * Light on purpose: the Games lobby and the app directory load these in the main bundle.
 */
export function KhCards({
  kind,
  cards,
  children,
}: {
  kind: string;
  cards: [rank: string, suit: string][];
  children?: ReactNode;
}) {
  return (
    <span className={`kh-art ${kind}`} aria-hidden="true">
      {cards.map(([rank, suit]) => (
        <i key={rank + suit} className={`kh-card ${'♥♦'.includes(suit) ? 'red' : ''}`}>
          <b>{rank}</b>
          {suit}
        </i>
      ))}
      {children}
    </span>
  );
}

export function KhTiles({ tiles }: { tiles: [value: string, tone: string][] }) {
  return (
    <span className="kh-art okey" aria-hidden="true">
      {tiles.map(([value, tone]) => (
        <i key={value} className={`kh-tile ${tone}`}>
          {value}
        </i>
      ))}
    </span>
  );
}

/** Content of `.rg-catalog-art` on the in-page table catalog (`shared/Lobby.tsx`). */
export function LobbyCards({
  cards,
  children,
}: {
  cards: [rank: string, suit: string, red: boolean][];
  children?: ReactNode;
}) {
  return (
    <div className="rg-art-cards">
      {cards.map(([rank, suit, red]) => (
        <span key={rank} className={red ? 'red' : ''}>
          {rank}
          <b>{suit}</b>
        </span>
      ))}
      {children}
    </div>
  );
}

export function LobbyTiles({ numbers }: { numbers: number[] }) {
  return (
    <div className="rg-art-tiles">
      {numbers.map((number) => (
        <span key={number}>
          {number}
          <small>•</small>
        </span>
      ))}
    </div>
  );
}
