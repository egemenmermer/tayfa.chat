import './kiraathane.css';
import { ArrowRight, History, Info, LoaderCircle, Users } from 'lucide-react';
import type { GamePublicState } from '../../../packages/activity-protocol/src';
import { locale, t } from './i18n';
import { catalogEntry, gameNames, offeredGames } from './games/catalog';

export { gameNames };
/** Games people can open a table for (the light half of `games/registry.ts`). */
export const gameCatalog = offeredGames;

export function tableCapacity(game: GamePublicState): number {
  const value = Number(
    game.view.rules?.capacity ??
      game.view.capacity ??
      catalogEntry(game.kind)?.fallbackCapacity ??
      4,
  );
  return Number.isInteger(value) && value >= 1 && value <= 9 ? value : 4;
}

/** Small drawn table pieces; no photos, so the lobby keeps the app's own look. */
export function GameArt({ kind }: { kind: string }) {
  const Art = catalogEntry(kind)?.Art;
  return Art ? <Art /> : <span className="kh-art" aria-hidden="true" />;
}

export function Kiraathane({
  game,
  ready,
  error,
  blocked,
  busy,
  otherActivity,
  onCreate,
  onOpen,
  onHistory,
  onRetry,
}: {
  game: GamePublicState | null;
  ready: boolean;
  error: string | null;
  /** Why this person cannot open tables at all (e.g. no permission). */
  blocked: string;
  busy: boolean;
  /** A non-game activity (cinema, YouTube…) that a new table would replace. */
  otherActivity: string | null;
  onCreate(kind: string): void;
  onOpen(): void;
  onHistory(): void;
  onRetry(): void;
}) {
  const status =
    game?.status === 'waiting'
      ? t('Oyuncu bekliyor')
      : game?.status === 'finished'
        ? t('El bitti, yenisi başlayabilir')
        : t('Oynanıyor');
  const reason = !ready ? t('Masa bağlantısı bekleniyor.') : blocked;
  return (
    <section className="kh" aria-label={t('Oyunlar')}>
      <header className="kh-head">
        <div>
          <h1>{t('Oyunlar')}</h1>
          <p>{t('Arkadaşlarınla sanal fişle oyna. Odada aynı anda bir masa açık olur.')}</p>
        </div>
        <button className="button secondary" onClick={onHistory}>
          <History size={16} />
          {t('Geçmiş')}
        </button>
      </header>
      {error && (
        <div className="kh-note error" role="alert">
          {error}
          <button className="button secondary small" onClick={onRetry} disabled={busy}>
            {t('Yeniden dene')}
          </button>
        </div>
      )}
      {!ready && !error && (
        <div className="kh-note" role="status">
          <LoaderCircle size={15} className="spin" />
          {t('Masalar yükleniyor…')}
        </div>
      )}
      {game && (
        <article className="kh-open">
          <GameArt kind={game.kind} />
          <div className="kh-open-text">
            <small>{t('Açık masa')}</small>
            <strong>
              {typeof game.view.tableName === 'string' && game.view.tableName
                ? game.view.tableName
                : gameNames[game.kind]}
            </strong>
            <span>
              {gameNames[game.kind]} · {status}
            </span>
          </div>
          <div
            className="kh-seats"
            aria-label={t('{seated} / {capacity} oyuncu', {
              seated: game.seats.length,
              capacity: tableCapacity(game),
            })}
          >
            {game.seats.slice(0, 6).map((seat) => (
              <span key={seat.seat} title={seat.name} className={seat.bot ? 'bot' : ''}>
                {seat.bot ? 'B' : seat.name.trim().slice(0, 1).toLocaleUpperCase(locale)}
              </span>
            ))}
            <em>
              <Users size={13} />
              {game.seats.length}/{tableCapacity(game)}
            </em>
          </div>
          <button className="button primary" onClick={onOpen}>
            {t('Masaya geç')}
            <ArrowRight size={16} />
          </button>
        </article>
      )}
      {otherActivity && !game && (
        <div className="kh-note">
          <Info size={15} />
          {t(
            'Odada {activity} açık. Masa açınca o etkinlik herkes için kapanır; bunu etkinliğin hostu yapabilir.',
            { activity: otherActivity },
          )}
        </div>
      )}
      <div className="kh-grid">
        {gameCatalog.map((item) => {
          const open = game?.kind === item.kind;
          return (
            <article key={item.kind} className={`kh-game ${open ? 'is-open' : ''}`}>
              <div className="kh-felt">
                <GameArt kind={item.kind} />
              </div>
              <div className="kh-game-body">
                <h2>{gameNames[item.kind]}</h2>
                <p>{item.detail}</p>
                <div className="kh-tags">
                  <span>{item.players}</span>
                  <span>{item.scoring === 'points' ? t('Puan') : t('Sanal fiş')}</span>
                </div>
              </div>
              <button
                className={`button ${open ? 'primary' : game ? 'secondary' : 'primary'}`}
                disabled={!open && (!!reason || busy)}
                title={!open && reason ? reason : undefined}
                onClick={() => (open ? onOpen() : onCreate(item.kind))}
              >
                {open ? t('Masaya geç') : game ? t('Bu oyuna geç') : t('Masa aç')}
              </button>
            </article>
          );
        })}
      </div>
    </section>
  );
}
