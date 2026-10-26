import { locale, t } from '../../i18n';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Coins,
  Eye,
  History,
  LogOut,
  MoreHorizontal,
  Power,
  RefreshCw,
  ShieldCheck,
  Trophy,
} from 'lucide-react';
import { IconButton, Modal } from '@rooms/design';
import { useActivityRoom } from '../../activity';
import { useCommunity } from '../../community';
import type {
  ActivityCommand,
  GamePublicState,
} from '../../../../../packages/activity-protocol/src';
import { gameDefinition } from '../registry';
import { useGameFixtureMetadata } from './fixture';
import { GameRecovery } from './GameRecovery';
import { GameResults } from './GameResults';
import { array } from './model';
import { SeatControlsContext, seatRemovable, type SeatControls } from './SeatAvatar';
import { TableDockContext } from './TableDock';
import type { TableUI } from './table-ui';
import { guardTimer } from './TurnClock';

/** Blackjack: a stack below the smallest bet (2) may buy back up to the 1000 cap. */
const REBUY_BELOW = 2,
  REBUY_STACK = 1000;

type PopoverTrigger = {
  'aria-expanded': boolean;
  'aria-haspopup': 'dialog' | 'menu';
  onClick(): void;
};

/**
 * A small panel under a header button (rules, table actions). Escape or a press outside closes
 * it; Escape returns focus to the button.
 */
function Popover({
  open,
  onOpenChange,
  label,
  className,
  role = 'dialog',
  trigger,
  children,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  label: string;
  className: string;
  role?: 'dialog' | 'menu';
  trigger(props: PopoverTrigger): ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const change = useRef(onOpenChange);
  change.current = onOpenChange;
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) change.current(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      change.current(false);
      ref.current?.querySelector<HTMLButtonElement>('button[aria-expanded]')?.focus();
    };
    document.addEventListener('pointerdown', outside, true);
    window.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      window.removeEventListener('keydown', key, true);
    };
  }, [open]);
  useEffect(() => {
    if (open && role === 'menu')
      ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
  }, [open, role]);
  return (
    <div className="rx-pop" ref={ref}>
      {trigger({
        'aria-expanded': open,
        'aria-haspopup': role,
        onClick: () => onOpenChange(!open),
      })}
      {open && (
        <div className={`rx-pop-panel ${className}`} role={role} aria-label={label}>
          {children}
        </div>
      )}
    </div>
  );
}

export function ReferenceOtherGame({
  activity,
  game,
}: {
  activity: ReturnType<typeof useActivityRoom>;
  game: GamePublicState;
}) {
  const fixtureMetadata = useGameFixtureMetadata(),
    navigate = useNavigate(),
    c = useCommunity(),
    own = game.seats.find((seat) => seat.userId === c.user?.id),
    owner = game.ownerId === c.user?.id,
    definition = gameDefinition(game.kind),
    Table = definition.Table;
  const fixture = import.meta.env.DEV && new URLSearchParams(location.search).has('fixture');
  const [rules, setRules] = useState(false),
    [history, setHistory] = useState(false),
    [more, setMore] = useState(false),
    [confirm, setConfirm] = useState<'leave' | 'end' | null>(null),
    [dock, setDock] = useState<HTMLElement | null>(null),
    [now, setNow] = useState(Date.now()),
    [pending, setPending] = useState(false);
  const lock = useRef(false),
    scope = `${game.kind}:${game.history.length}:${c.user?.id}:${own?.seat}`,
    generation = useRef(scope);
  generation.current = scope;
  const ready = activity.status === 'connected',
    view = game.view,
    legal = array<string>(view.legalActions),
    busy = activity.busy || pending;
  const access = !!own || view.watching === true;
  // The server's legalActions decide who may deal ('start' for the owner, or for any present
  // player while the owner is away) and which moves are open on the viewer's turn.
  const betweenHands = (name: string) =>
    game.status !== 'playing' && definition.betweenHandActions?.includes(name) === true;
  const can = (name: string) =>
    !fixture &&
    ready &&
    !busy &&
    !!own &&
    (legal.includes(name) || betweenHands(name)) &&
    (name === 'start' || definition.betweenHandActions?.includes(name) || own.seat === game.turn);
  const send = async (command: ActivityCommand) => {
    if (fixture || !ready || activity.busy || lock.current) return false;
    lock.current = true;
    setPending(true);
    const current = generation.current;
    try {
      await activity.send(command);
      return current === generation.current;
    } catch {
      return false;
    } finally {
      lock.current = false;
      setPending(false);
    }
  };
  const action: TableUI['action'] = (name, extra = {}) =>
    can(name) ? send({ type: 'game.action', action: name, ...extra }) : Promise.resolve(false);
  const deadline = Number(view.turnDeadline ?? 0);
  useEffect(() => {
    setNow(Date.now());
    if (!deadline || game.status !== 'playing') return;
    const interval = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(interval);
  }, [deadline, game.status]);
  useEffect(() => {
    setRules(false);
    setHistory(false);
    setMore(false);
    setConfirm(null);
  }, [scope]);
  useEffect(() => {
    if (fixtureMetadata) setRules(fixtureMetadata.ui.modal === 'rules');
  }, [fixtureMetadata]);
  const timer = guardTimer(
    deadline > 0 && game.status === 'playing'
      ? Math.max(0, Math.ceil((deadline - now - activity.serverOffsetMs) / 1000))
      : null,
  );
  const roomHostId = activity.room?.primary?.hostUserId;
  const seatControls: SeatControls = {
    canRemove: (seat) => seatRemovable(game, seat, c.user?.id, roomHostId),
    disabled: fixture || !ready || busy,
    disabledReason: fixture ? t('Yerel örnekte hesap işlemleri kapalı') : undefined,
    remove: (seat) => send({ type: 'game.seat.remove', seat }),
  };
  // A chip table (Blackjack) buys back in between hands once the stack cannot cover the smallest
  // bet; the server caps the stack at 1000.
  const rebuyable =
    !!own &&
    definition.catalog.scoring === 'chips' &&
    !definition.tableInLobby &&
    game.status !== 'playing' &&
    own.chips < REBUY_BELOW;
  const rebuy = () =>
    own
      ? send({ type: 'game.sit', seat: own.seat, buyIn: REBUY_STACK - own.chips })
      : Promise.resolve(false);
  const ui: TableUI = {
    game,
    userId: c.user?.id,
    can,
    action,
    timer,
    busy,
    canRemoveSeat: seatControls.canRemove,
    removeSeat: seatControls.remove,
    canRebuy: rebuyable && !fixture && ready && !busy,
    rebuy,
  };
  const roomName =
    c.channels.find((channel) => channel.id === activity.room?.roomId)?.name ?? t('Oda');
  const ruleRows = definition.ruleRows(game);
  const finish = (game.status === 'finished' && definition.finishLabels?.(game)) || null;
  const playing = game.status === 'playing';
  const menu = !!own || owner;
  return (
    <div className={`rg-page rx-game rx-${game.kind}`}>
      <header className="rx-head">
        <IconButton
          className="rx-back"
          label={t('Oyunlara dön')}
          onClick={() => navigate('/games')}
        >
          <ArrowLeft size={17} />
        </IconButton>
        <div className="rx-head-title">
          <h1>
            {game.status === 'finished'
              ? (finish?.title ?? t('El tamamlandı'))
              : definition.catalog.name}
          </h1>
          <small>
            {roomName} · {definition.catalog.scoring === 'chips' ? t('Sanal fiş') : t('Sanal puan')}
          </small>
        </div>
        <div className="rx-head-actions">
          <Popover
            open={rules}
            onOpenChange={setRules}
            className="rx-rules"
            label={t('Masa kuralları')}
            trigger={(props) => (
              <button {...props} className="rx-chip">
                <ShieldCheck size={15} />
                {t('Masa kuralları')}
              </button>
            )}
          >
            <h2>{t('Masa kuralları')}</h2>
            <p>{t('Kurallar kilitli')}</p>
            <div className="rg-rules">
              {ruleRows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </Popover>
          <button
            className="rx-chip"
            disabled={!access}
            // The label hides below 1100 px; keep the name for screen readers and a tooltip.
            aria-label={t('Geçmiş')}
            title={!access ? t('Geçmiş için izleyici olarak katıl') : t('Geçmiş')}
            onClick={() => navigate('/games?tab=history')}
          >
            <History size={15} />
            <span>{t('Geçmiş')}</span>
          </button>
          <IconButton label={t('Masayı yenile')} onClick={() => void activity.refresh()}>
            <RefreshCw size={16} />
          </IconButton>
          {menu && (
            <Popover
              open={more}
              onOpenChange={setMore}
              className="rx-menu"
              role="menu"
              label={t('Masa işlemleri')}
              trigger={(props) => (
                <IconButton {...props} label={t('Masa işlemleri')}>
                  <MoreHorizontal size={17} />
                </IconButton>
              )}
            >
              {own && (
                <button
                  role="menuitem"
                  disabled={fixture || !ready || busy}
                  onClick={() => {
                    setMore(false);
                    setConfirm('leave');
                  }}
                >
                  <LogOut size={15} />
                  {t('Masadan kalk')}
                </button>
              )}
              {owner && (
                <button
                  role="menuitem"
                  className="danger"
                  disabled={fixture || busy || !ready}
                  onClick={() => {
                    setMore(false);
                    setConfirm('end');
                  }}
                >
                  <Power size={15} />
                  {t('Masayı kapat')}
                </button>
              )}
            </Popover>
          )}
        </div>
      </header>
      <GameRecovery activity={activity} game={game} />
      {activity.error && (
        <div className="rg-banner error" role="alert">
          <span>{activity.error}</span>
          <button onClick={() => void activity.refresh()}>{t('Yeniden dene')}</button>
        </div>
      )}
      {!ready && !activity.error && (
        <div className="rg-banner" role="status">
          <span>{t('Masa bağlantısı bekleniyor.')}</span>
          <button onClick={() => void activity.refresh()}>{t('Yeniden dene')}</button>
        </div>
      )}
      {!access ? (
        <section className="rx-watch">
          <Eye size={32} />
          <h2>{t('Masayı izle')}</h2>
          <p>
            {view.rules?.spectatorsAllowed === false
              ? t('Bu masada izleyici erişimi kapalı.')
              : t('Masaya izleyici olarak katıl.')}
          </p>
          <button
            className="button primary"
            disabled={fixture || !ready || busy || view.rules?.spectatorsAllowed === false}
            title={
              fixture
                ? t('Yerel örnekte hesap işlemleri kapalı')
                : view.rules?.spectatorsAllowed === false
                  ? t('Masa izleyici kabul etmiyor')
                  : undefined
            }
            onClick={() => void send({ type: 'game.watch', watching: true })}
          >
            {t('İzle')}
          </button>
        </section>
      ) : (
        <>
          {!own && (
            <div className="rg-banner">
              <Eye size={17} />
              {t('İzleyici · Gizli eller gösterilmez.')}
              <button
                disabled={fixture || !ready || busy}
                onClick={() => void send({ type: 'game.watch', watching: false })}
              >
                {t('İzlemeyi bırak')}
              </button>
            </div>
          )}
          {Table && (
            <div className="rx-stage">
              <SeatControlsContext.Provider value={seatControls}>
                <TableDockContext.Provider value={dock}>
                  <Table {...ui} />
                </TableDockContext.Provider>
              </SeatControlsContext.Provider>
            </div>
          )}
        </>
      )}
      {/* The docked bottom region: games portal their own controls in here (`TableDock`); the
          shell's end-of-hand strip sits under them, so "Sonraki el" never scrolls away. */}
      <div className="rx-dock">
        <div className="rx-dock-slot" ref={setDock} />
        {game.status === 'finished' && own && (
          <div className="rg-hand-strip result">
            <div>
              <h3>
                <Trophy size={19} />
                {finish?.title ?? t('El tamamlandı')}
              </h3>
              <p>
                {legal.includes('start')
                  ? (finish?.hint ?? t('Yeni el başlatabilirsin.'))
                  : t('Masa sahibi bekleniyor.')}
              </p>
            </div>
            {rebuyable && (
              <button
                className="button secondary"
                disabled={!ui.canRebuy}
                title={t('Fişin en küçük bahsi karşılamıyor.')}
                onClick={() => void rebuy()}
              >
                <Coins size={16} />
                {t('Para al')}
              </button>
            )}
            <button
              className="button primary"
              disabled={!can('start')}
              onClick={() => void action('start')}
            >
              {finish?.next ?? t('Sonraki el')}
            </button>
          </div>
        )}
      </div>
      {confirm === 'leave' && (
        <Modal title={t('Masadan kalk?')} className="rg-modal" onClose={() => setConfirm(null)}>
          <div className="rg-modal-body">
            <p>
              {playing
                ? t('El sürerken kalkarsan elini bot bitirir, sonra koltuğun boşalır.')
                : t('Koltuğun boşalır; başka biri oturabilir.')}
            </p>
            {activity.error && <p role="alert">{activity.error}</p>}
          </div>
          <footer className="rg-modal-footer">
            <button className="button secondary" onClick={() => setConfirm(null)}>
              {t('Vazgeç')}
            </button>
            <button
              className="button danger"
              disabled={fixture || !ready || busy}
              onClick={() =>
                void send({ type: 'game.leave' }).then((ok) => {
                  if (ok) setConfirm(null);
                })
              }
            >
              {t('Masadan kalk')}
            </button>
          </footer>
        </Modal>
      )}
      {history && access && (
        <Modal title={t('Masa geçmişi')} className="rg-modal" onClose={() => setHistory(false)}>
          <div className="rg-modal-body">
            {game.history.length ? (
              game.history.map((hand) => (
                <div className="rg-history-row" key={hand.hand}>
                  <Trophy size={16} />
                  <strong>{t('El {hand}', { hand: hand.hand })}</strong>
                  <small>{new Date(hand.endedAt).toLocaleString(locale)}</small>
                  <GameResults game={game} result={hand.result} />
                </div>
              ))
            ) : (
              <p>{t('Tamamlanmış el yok.')}</p>
            )}
          </div>
        </Modal>
      )}
      {confirm === 'end' && (
        <Modal title={t('Masayı kapat?')} className="rg-modal" onClose={() => setConfirm(null)}>
          <div className="rg-modal-body">
            <p>{t('Oyun etkinliği biter. Ses bağlantısı açık kalır.')}</p>
            {activity.error && <p role="alert">{activity.error}</p>}
          </div>
          <footer className="rg-modal-footer">
            <button className="button secondary" onClick={() => setConfirm(null)}>
              {t('Vazgeç')}
            </button>
            <button
              className="button danger"
              disabled={fixture || !ready || busy}
              onClick={() =>
                void send({ type: 'end' }).then((ok) => {
                  if (ok) setConfirm(null);
                })
              }
            >
              {t('Masayı kapat')}
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}
