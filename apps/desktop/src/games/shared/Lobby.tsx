import { VoiceAvatar } from '../../VoiceAvatar';
import { InviteLinkCard } from '../../InviteLinkCard';
import type { SocialInvite } from '@rooms/social';
import { locale, t, uiError } from '../../i18n';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Bot,
  Eye,
  Headphones,
  X,
  UserPlus,
  SlidersHorizontal,
  Gamepad2,
  History,
  LogOut,
  Plus,
  Power,
  RefreshCw,
  ShieldCheck,
  Spade,
  Trophy,
} from 'lucide-react';
import { Avatar, IconButton, Modal } from '@rooms/design';
import { useActivityRoom } from '../../activity';
import { retiredActivity } from '../../activity-route';
import { useCommunity } from '../../community';
import type {
  ActivityCommand,
  GamePublicState,
} from '../../../../../packages/activity-protocol/src';
import { endsActivity } from '../../../../../packages/activity-protocol/src';
import { ReferenceCreateGame } from './CreateGame';
import { useGameFixtureMetadata } from './fixture';
import { GameRecovery } from './GameRecovery';
import { catalogEntry, offeredGames } from '../catalog';
import { gameDefinition, type GameSetupValues } from '../registry';
import { array, names, object, tableTitle } from './model';
import { SeatAvatar, SeatControlsContext, seatRemovable, type SeatControls } from './SeatAvatar';
import { useGameSounds } from './sounds';
import { TableDockContext } from './TableDock';

export function ReferenceGames({
  activity,
  roomId,
  game,
  onCreate,
  create,
  setup,
  onSetup,
}: {
  activity: ReturnType<typeof useActivityRoom>;
  roomId: string | null;
  game: GamePublicState | null;
  onCreate(value: string | null): void;
  create: string | null;
  /** Choices for the game's setup page (see `GameCreateDefinition`). */
  setup: GameSetupValues;
  onSetup(patch: GameSetupValues): void;
}) {
  const c = useCommunity(),
    navigate = useNavigate(),
    fixtureMetadata = useGameFixtureMetadata();
  // A game's own table rules (`tableRules`), typed in the create dialog or the owner's "Düzenle".
  const [rulesValue, setRulesValue] = useState<GameSetupValues | null>(null),
    [entry, setEntry] = useState(1000),
    [configure, setConfigure] = useState(false);
  const [history, setHistory] = useState(false),
    [amount, setAmount] = useState(20),
    [end, setEnd] = useState(false),
    [rules, setRules] = useState(false),
    [buyIn, setBuyIn] = useState<number | null>(null),
    [now, setNow] = useState(Date.now()),
    // The docked bottom region of a table this page renders (`LobbyTable`), as in TableShell.
    [dock, setDock] = useState<HTMLElement | null>(null);
  const fixture = import.meta.env.DEV && new URLSearchParams(location.search).has('fixture');
  const fixtureReason = t('Yerel görsel örnekte gerçek oyun işlemi kapalı');
  useEffect(() => {
    activity.clearError();
  }, [create, activity.clearError]);
  const ready = activity.status === 'connected',
    view = game?.view ?? {},
    playing = game?.status === 'playing',
    waiting = game?.status === 'waiting';
  const own = game?.seats.find((seat) => seat.userId === c.user?.id),
    owner = game?.ownerId === c.user?.id,
    definition = game ? gameDefinition(game.kind) : undefined;
  const access = !!own || view.watching === true;
  // A playing or finished `tableInLobby` game (Hold'em) gets the table layout of TableShell:
  // one-row header, the table filling the page and its own controls docked at the bottom.
  const tableView = !!game && !waiting && !!definition?.LobbyTable;
  // A table rendered on this page (`LobbyTable`) gets its cues here, where the hook also sees the
  // waiting view and so cues the first deal; the other tables call useGameSounds themselves.
  useGameSounds(definition?.LobbyTable ? game : null);
  const capacity = Math.min(
    9,
    Math.max(
      1,
      Number(
        view.rules?.capacity ?? view.capacity ?? catalogEntry(game?.kind)?.fallbackCapacity ?? 4,
      ),
    ),
  );
  const commandLock = useRef(false);
  const commandScope = `${c.serverUrl}:${roomId}:${c.user?.id}:${activity.room?.primary?.startedAt}`;
  const commandGeneration = useRef(commandScope);
  commandGeneration.current = commandScope;
  const [inviteOpen, setInviteOpen] = useState(false),
    [invite, setInvite] = useState<SocialInvite | null>(null),
    [inviteBusy, setInviteBusy] = useState(false),
    [inviteError, setInviteError] = useState('');
  const inviteRequest = useRef(0);
  const [replaceConsent, setReplaceConsent] =
    useState<Extract<ActivityCommand, { type: 'game.create' }>['replacePrimary']>();
  const currentPrimary = activity.room?.primary;
  const ownParticipant = activity.room?.participants.find((person) => person.userId === c.user?.id);
  const canReplace =
    ownParticipant?.canCreate === true &&
    ownParticipant.canControl &&
    endsActivity(currentPrimary ?? null, c.user?.id, true);
  const replacementMatches =
    !!replaceConsent &&
    !!currentPrimary &&
    replaceConsent.activity === currentPrimary.activity &&
    replaceConsent.startedAt === currentPrimary.startedAt;
  const createConflict = !!currentPrimary && !(canReplace && replacementMatches);
  const closeInvite = () => {
    inviteRequest.current++;
    setInviteOpen(false);
    setInviteBusy(false);
    setInvite(null);
    setInviteError('');
  };
  useEffect(() => {
    closeInvite();
    setReplaceConsent(undefined);
  }, [commandScope, create]);
  const generateInvite = async () => {
    if (fixture || !roomId || c.status !== 'connected' || inviteBusy) return;
    const request = ++inviteRequest.current,
      scope = commandGeneration.current;
    setInviteBusy(true);
    setInviteError('');
    try {
      const result = await c.createInvite(roomId);
      if (request === inviteRequest.current && scope === commandGeneration.current)
        setInvite(result);
    } catch (error) {
      if (request === inviteRequest.current && scope === commandGeneration.current)
        setInviteError(uiError(error));
    } finally {
      if (request === inviteRequest.current) setInviteBusy(false);
    }
  };
  const selectedSeat = buyIn === null ? null : game?.seats.find((seat) => seat.seat === buyIn);
  const seatReason = selectedSeat
    ? t('Bu koltuk artık dolu. Başka bir koltuk seç.')
    : own
      ? t('Zaten masadasın.')
      : '';

  const legal = array<string>(view.legalActions),
    myTurn = !!own && own.seat === game?.turn;
  const can = (action: string) =>
    ready &&
    !fixture &&
    !activity.busy &&
    legal.includes(action) &&
    (action === 'start'
      ? !!own
      : myTurn &&
        !own?.pendingNextHand &&
        own?.connected === true &&
        view.ownRecovery?.takeover !== true &&
        view.ownRecovery?.pendingReturn !== true);
  const deadline = Number(view.turnDeadline ?? 0);
  useEffect(() => {
    if (!playing || !deadline) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [playing, deadline]);
  useEffect(() => {
    setHistory(false);
    setEnd(false);
    setBuyIn(null);
    setConfigure(false);
  }, [roomId, c.user?.id, game?.status, activity.room?.primary?.startedAt]);
  // Creating a table replaces the room's activity, which renews the command scope; go to the
  // new table on success instead of treating the scope change as a stale answer.
  const createTable = async (command: Extract<ActivityCommand, { type: 'game.create' }>) => {
    if (fixture || !ready || activity.busy || commandLock.current) return;
    commandLock.current = true;
    try {
      await activity.send(command);
      onCreate(null);
      navigate('/games?tab=table');
    } catch {
      /* The activity hook keeps and shows the real failure. */
    } finally {
      commandLock.current = false;
    }
  };
  const send = async (command: ActivityCommand) => {
    if (fixture || !ready || activity.busy || commandLock.current) return false;
    const scope = commandGeneration.current;
    commandLock.current = true;
    try {
      await activity.send(command);
      if (scope !== commandGeneration.current) return false;
      setBuyIn(null);
      return true;
    } catch {
      return false; /* Activity hook retains the real failure. */
    } finally {
      commandLock.current = false;
    }
  };
  const startReason = !own
    ? t('Oyunu başlatmak için önce otur')
    : !owner && !legal.includes('start')
      ? t('Oyunu yalnızca masa sahibi başlatabilir')
      : !ready
        ? t('Etkinlik bağlantısı bekleniyor')
        : !game || game.seats.length < (definition?.minSeats ?? capacity)
          ? t('Başlamak için koltukları doldurun')
          : (definition?.startBlocker?.(game) ?? '');
  const roomName = c.channels.find((channel) => channel.id === roomId)?.name ?? t('Oda');
  const title =
    view.tableName ??
    tableTitle(activity.room?.primary?.title, game?.kind) ??
    (game ? names[game.kind] : t('Oyun alanı'));
  const seatName = (id: string) =>
    game?.seats.find((seat) => seat.userId === id)?.name ?? t('Oyuncu');
  const refresh = () => void activity.refresh();
  const newHand = () => void send({ type: 'game.action', action: 'start' });
  // A lobby dialog over the table turns its keyboard shortcuts off.
  const shortcuts =
    !history && !rules && !end && !configure && !inviteOpen && buyIn === null && !create;
  const seatTimer =
    playing && deadline > 0
      ? Math.max(0, Math.ceil((deadline - now - activity.serverOffsetMs) / 1000))
      : null;
  const avatar = (seat: GamePublicState['seats'][number]) =>
    game ? (
      <SeatAvatar seat={seat} game={game} timer={seatTimer} />
    ) : seat.bot ? (
      <Avatar name={seat.name} />
    ) : (
      <VoiceAvatar id={seat.userId} name={seat.name} />
    );
  const seatControls: SeatControls = {
    canRemove: (seat) =>
      !!game && seatRemovable(game, seat, c.user?.id, activity.room?.primary?.hostUserId),
    disabled: fixture || !ready || activity.busy,
    disabledReason: fixture ? fixtureReason : undefined,
    remove: (seat) => send({ type: 'game.seat.remove', seat }),
  };
  const seatBuyIn = game ? definition?.buyIn : undefined;
  useEffect(() => {
    if (buyIn !== null) setEntry(game && seatBuyIn ? seatBuyIn.initial(game) : 1000);
  }, [buyIn]);
  const tableRules = definition?.tableRules,
    editableRules =
      game && tableRules?.configure && owner && waiting && !game.history.length
        ? tableRules.initial(game)
        : undefined;
  const createRules = create ? gameDefinition(create).tableRules : undefined;
  useEffect(() => {
    if (create) setRulesValue(gameDefinition(create).tableRules?.initial(null) ?? null);
  }, [create]);
  const ruleRows: [string, string][] = [
    [t('Oyun'), game ? names[game.kind] : create ? names[create] : '—'],
    [t('Koltuk'), String(capacity)],
    ...(game ? (definition?.lobbyRuleRows?.(game) ?? []) : []),
  ];
  useEffect(() => {
    if (!fixtureMetadata) return;
    const ui = fixtureMetadata.ui;
    if (ui.amount !== null) {
      setAmount(ui.amount);
      setEntry(ui.amount);
    }
    setBuyIn(ui.modal === 'buy-in' ? ui.buyInSeat : null);
    setRules(ui.modal === 'rules');
  }, [fixtureMetadata]);
  const createSetup = create ? gameDefinition(create).create : undefined;
  if (create && createSetup)
    return (
      <ReferenceCreateGame
        kind={create}
        definition={createSetup}
        setup={setup}
        onSetup={onSetup}
        participants={activity.room?.participants ?? []}
        busy={activity.busy}
        disabled={fixture || !ready || createConflict}
        reason={
          fixture
            ? fixtureReason
            : !ready
              ? t('Etkinlik bağlantısı gerekli')
              : currentPrimary && !canReplace
                ? t('Açık etkinliği yalnızca hostu kapatabilir. Kapatıldığında masa açabilirsin.')
                : ''
        }
        consent={
          currentPrimary && canReplace
            ? {
                label: t('{tableTitle} etkinliğini bitir ve bu masayı kur', {
                  tableTitle: tableTitle(currentPrimary.title, game?.kind) ?? '',
                }),
                checked: replacementMatches,
                onChange: (checked) =>
                  setReplaceConsent(
                    checked
                      ? { activity: currentPrimary.activity, startedAt: currentPrimary.startedAt }
                      : undefined,
                  ),
              }
            : undefined
        }
        error={activity.error ?? ''}
        onCancel={() => onCreate(null)}
        onSubmit={() =>
          void createTable({
            type: 'game.create',
            game: create,
            ...createSetup.command({ ...createSetup.defaults, ...setup }),
            ...(canReplace && replacementMatches ? { replacePrimary: replaceConsent } : {}),
          })
        }
      />
    );
  return (
    <SeatControlsContext.Provider value={seatControls}>
      <div
        className={`rg-page ${game && !waiting ? 'rg-playing' : ''}${tableView ? ` rx-game rx-${game.kind}` : ''}`}
      >
        {tableView ? (
          <header className="rx-head">
            <IconButton
              className="rx-back"
              label={t('Oyunlara dön')}
              onClick={() => navigate('/games')}
            >
              <ArrowLeft size={17} />
            </IconButton>
            <div className="rx-head-title">
              <h1>{title}</h1>
              <small>
                {t('{roomName} · {names} · Sanal fiş', { roomName, names: names[game.kind] })} ·{' '}
                {game.seats.length} / {capacity}
              </small>
            </div>
            <div className="rx-head-actions">
              <button className="rx-chip" onClick={() => setRules(true)}>
                <ShieldCheck size={15} />
                {t('Masa kuralları')}
              </button>
              <button
                className="rx-chip"
                disabled={!access}
                aria-label={t('Geçmiş')}
                title={!access ? t('Geçmiş için izleyici olarak katıl') : t('Geçmiş')}
                onClick={() => navigate('/games?tab=history')}
              >
                <History size={15} />
                <span>{t('Geçmiş')}</span>
              </button>
              <IconButton label={t('Masayı yenile')} onClick={refresh}>
                <RefreshCw size={16} />
              </IconButton>
              {own && (
                <IconButton
                  label={t('Masadan kalk')}
                  disabled={fixture || activity.busy || !ready}
                  onClick={() => void send({ type: 'game.leave' })}
                >
                  <LogOut size={16} />
                </IconButton>
              )}
              {owner && (
                <IconButton
                  label={t('Masayı kapat')}
                  disabled={fixture || activity.busy || !ready}
                  onClick={() => setEnd(true)}
                >
                  <Power size={16} />
                </IconButton>
              )}
            </div>
          </header>
        ) : (
          <header className="rg-heading">
            <div>
              <div className="rg-title">
                <h1>
                  {game
                    ? game.status === 'finished'
                      ? t('El tamamlandı')
                      : title
                    : t('Masa hazır. Sen de gel.')}
                </h1>
                {game && (
                  <span>
                    {game.seats.length} / {capacity}
                  </span>
                )}
                {playing && <span>{t('Kurallar kilitli')}</span>}
              </div>
              <p>
                {game
                  ? t('{roomName} · {names} · Sanal fiş', { roomName, names: names[game.kind] })
                  : t('Bir oyun seç, arkadaşlarınla aynı masaya otur.')}
              </p>
            </div>
            <div>
              {waiting && (
                <button
                  disabled={fixture || !roomId || c.status !== 'connected'}
                  title={
                    fixture
                      ? fixtureReason
                      : c.status !== 'connected'
                        ? t('Topluluk bağlantısı gerekli')
                        : undefined
                  }
                  onClick={() => setInviteOpen(true)}
                >
                  <UserPlus size={16} />
                  {t('Arkadaş davet et')}
                </button>
              )}
              {game && own && (
                <button
                  disabled={fixture || activity.busy || !ready}
                  title={fixture ? fixtureReason : undefined}
                  onClick={() => void send({ type: 'game.leave' })}
                >
                  <X size={16} />
                  {t('Masadan kalk')}
                </button>
              )}
              <button
                disabled={!!game && !access}
                title={game && !access ? t('Geçmiş için izleyici olarak katıl') : undefined}
                onClick={() => navigate('/games?tab=history')}
              >
                <History size={16} />
                {game ? t('Geçmiş') : t('Masa geçmişi')}
              </button>
              {game && (
                <IconButton label={t('Masayı yenile')} onClick={refresh}>
                  <RefreshCw size={17} />
                </IconButton>
              )}
            </div>
          </header>
        )}
        {game && <GameRecovery activity={activity} game={game} />}
        {tableView && activity.error && (
          <div className="rg-banner error" role="alert">
            {activity.error}
          </div>
        )}
        {!ready && (
          <div className={`rg-banner ${activity.status === 'error' ? 'error' : ''}`} role="status">
            {activity.status === 'loading'
              ? t('Masalar getiriliyor…')
              : !roomId
                ? t('Oyun için bir oda seç.')
                : t('Oyun hizmeti bağlantısı bekleniyor.')}
            <button onClick={() => (!roomId ? navigate('/settings?tab=connections') : refresh())}>
              {!roomId ? t('Topluluğa bağlan') : t('Yeniden dene')}
            </button>
          </div>
        )}
        {!game ? (
          <>
            <div className="rg-catalog">
              {offeredGames.map(({ kind, name, lobbyDetail, LobbyArt }) => (
                <article className={`rg-catalog-card ${kind}`} key={kind}>
                  <div className="rg-catalog-art" aria-hidden="true">
                    <LobbyArt />
                  </div>
                  <div>
                    <h3>{name}</h3>
                    <p>{lobbyDetail}</p>
                    <button className="button secondary" onClick={() => onCreate(kind)}>
                      <Plus size={16} />
                      {t('Masa oluştur')}
                    </button>
                  </div>
                </article>
              ))}
            </div>
            <section className="rg-active-tables">
              <h3>{t('Odanın masası')}</h3>
              <div>
                <Gamepad2 size={29} />
                <div>
                  <strong>
                    {activity.status === 'loading'
                      ? t('Masalar getiriliyor')
                      : !ready
                        ? t('Masa bağlantısı bekleniyor')
                        : t('Açık oyun masası yok')}
                  </strong>
                  <p>
                    {activity.room?.primary
                      ? t('Bu odada {title} etkinliği açık.', {
                          title: activity.room.primary.title,
                        })
                      : !ready
                        ? t('Masa durumu bağlantı kurulunca alınır.')
                        : t('Bir oyun seçerek masa oluşturabilirsin.')}
                  </p>
                </div>
              </div>
            </section>
            <div className="rg-voice-note">
              <Headphones size={17} />
              <span>{t('Oyun penceresini kapatmak ses bağlantını kesmez.')}</span>
            </div>
            <p className="rg-footer-note">
              {t(
                'Yalnızca sanal fiş ve puan. Bir odada aynı anda tek ana medya veya oyun etkinliği başlatılabilir.',
              )}
            </p>
          </>
        ) : waiting ? (
          <>
            <div className="rg-lobby">
              <section>
                <div className="rg-section-heading">
                  <h3>{t('Koltuklar')}</h3>
                  <span>
                    {t('{capacity} koltuk · {names}', { capacity, names: names[game.kind] })}
                  </span>
                </div>
                <div className="rg-seat-grid">
                  {Array.from({ length: capacity }, (_, index) => {
                    const seat = game.seats.find((item) => item.seat === index);
                    return (
                      <div
                        className={`rg-lobby-seat ${seat ? '' : 'empty'} ${seat?.userId === c.user?.id ? 'you' : ''}`}
                        key={index}
                      >
                        {seat ? (
                          <>
                            {avatar(seat)}
                            <strong>{seat.name}</strong>
                            <small>
                              {seat.bot
                                ? t('Oyun botu')
                                : seat.userId === game.ownerId
                                  ? t('Masa sahibi')
                                  : seat.connected
                                    ? t('Masada')
                                    : t('Bağlantısı kesildi')}
                              {seat.userId === c.user?.id ? t(' · sen') : ''}
                            </small>
                          </>
                        ) : (
                          <>
                            <Plus size={23} />
                            <span>{t('Koltuk {number} boş', { number: index + 1 })}</span>
                            <div>
                              <button
                                disabled={!!own || !ready || fixture || activity.busy}
                                title={
                                  fixture ? fixtureReason : own ? t('Zaten masadasın') : undefined
                                }
                                onClick={() => setBuyIn(index)}
                              >
                                {t('Otur')}
                              </button>
                              {owner && (
                                <button
                                  disabled={!ready || fixture || activity.busy}
                                  title={fixture ? fixtureReason : undefined}
                                  onClick={() => void send({ type: 'game.bot.add', seat: index })}
                                >
                                  <Bot size={12} />
                                  {t('Bot ekle')}
                                </button>
                              )}
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                <div className="rg-spectators">
                  <Eye size={19} />
                  <strong>{t('İzleyici')}</strong>
                  <p>
                    {array<{ name: string }>(view.spectators)
                      .map((person) => person.name)
                      .join(' · ') || t('İzleyici yok')}
                  </p>
                  {!own && (
                    <button
                      disabled={
                        fixture ||
                        !ready ||
                        activity.busy ||
                        view.rules?.spectatorsAllowed === false
                      }
                      onClick={() =>
                        void send({ type: 'game.watch', watching: view.watching !== true })
                      }
                    >
                      {view.watching ? t('İzlemeyi bırak') : t('İzle')}
                    </button>
                  )}
                </div>
              </section>
              <aside className="rg-rules">
                <h3>
                  {t('Masa kuralları')} <SlidersHorizontal size={19} />
                </h3>
                {editableRules !== undefined && (
                  <button
                    className="text-button"
                    disabled={fixture || !ready || activity.busy || !editableRules}
                    onClick={() => {
                      if (editableRules) {
                        setRulesValue(editableRules);
                        setConfigure(true);
                      }
                    }}
                  >
                    {t('Düzenle')}
                  </button>
                )}
                {ruleRows.map(([label, value]) => (
                  <div key={label}>
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
                <p>{t('Kurallar oyun başladığında kilitlenir.')}</p>
              </aside>
            </div>
            <div className="rg-hand-strip">
              <div>
                <h3>
                  {game.seats.length === capacity ? t('Masa dolu') : t('Oyuncular bekleniyor')}
                </h3>
                <p>{startReason || t('Yeni el başlayabilir.')}</p>
              </div>
              {definition?.betweenHandActions?.includes('bet') && own && (
                <label className="rg-lobby-bet">
                  {t('Sanal bahis')}
                  <input
                    type="number"
                    min={2}
                    max={own.chips}
                    step={2}
                    value={amount}
                    onChange={(event) => setAmount(Number(event.target.value))}
                  />
                  <button
                    disabled={
                      fixture ||
                      !ready ||
                      activity.busy ||
                      !Number.isInteger(amount) ||
                      amount < 2 ||
                      amount % 2 !== 0 ||
                      amount > own.chips
                    }
                    onClick={() => void send({ type: 'game.action', action: 'bet', amount })}
                  >
                    {t('Bahsi belirle')}
                  </button>
                </label>
              )}
              <button onClick={() => setRules(true)}>{t('Masa kuralları')}</button>
              <button
                className="button primary"
                disabled={!!startReason || !can('start')}
                title={fixture ? fixtureReason : startReason}
                onClick={newHand}
              >
                <Spade size={17} />
                {t('Oyunu başlat')}
              </button>
            </div>
          </>
        ) : definition?.LobbyTable ? (
          <>
            <div className="rx-stage">
              <TableDockContext.Provider value={dock}>
                <definition.LobbyTable
                  game={game}
                  userId={c.user?.id}
                  can={can}
                  send={send}
                  onSit={setBuyIn}
                  shortcuts={shortcuts}
                  ready={ready}
                  busy={activity.busy}
                  fixtureReason={fixture ? fixtureReason : undefined}
                  timer={seatTimer}
                  startReason={startReason}
                />
              </TableDockContext.Provider>
            </div>
            {/* The table's own hand, status and action bar portal in here (`TableDock`). */}
            <div className="rx-dock">
              <div className="rx-dock-slot" ref={setDock} />
            </div>
          </>
        ) : null}
        {game && owner && !tableView && (
          <button
            className="rg-end"
            disabled={fixture || activity.busy || !ready}
            title={fixture ? fixtureReason : undefined}
            onClick={() => setEnd(true)}
          >
            {t('Masayı kapat')}
          </button>
        )}
        {!tableView && activity.error && (
          <div className="rg-banner error" role="alert">
            {activity.error}
          </div>
        )}
        {history && (!game || access) && (
          <Modal title={t('Masa geçmişi')} className="rg-modal" onClose={() => setHistory(false)}>
            <div className="rg-modal-body">
              {game?.history.length ? (
                game.history.map((hand) => (
                  <div className="rg-history-row" key={hand.hand}>
                    <Trophy size={17} />
                    <strong>{t('El {hand}', { hand: hand.hand })}</strong>
                    <small>{new Date(hand.endedAt).toLocaleTimeString(locale)}</small>
                    <p>
                      {Object.entries(object(hand.result.payouts))
                        .map(([id, value]) =>
                          t('{seatName} · {chips} fiş', {
                            seatName: seatName(id),
                            chips: String(value),
                          }),
                        )
                        .join(' / ') || t('El tamamlandı')}
                    </p>
                  </div>
                ))
              ) : (
                <p>{t('Tamamlanmış el yok.')}</p>
              )}
            </div>
          </Modal>
        )}
        {rules && (
          <Modal title={t('Masa kuralları')} className="rg-modal" onClose={() => setRules(false)}>
            <div className="rg-modal-body rg-rules">
              {ruleRows.map(([label, value]) => (
                <div key={label}>
                  <span>{label}</span>
                  <strong>{value}</strong>
                </div>
              ))}
            </div>
          </Modal>
        )}
        {buyIn !== null && (
          <Modal title={t('Masaya katıl')} className="rg-modal" onClose={() => setBuyIn(null)}>
            <div className="rg-modal-body">
              {game && seatBuyIn ? (
                <seatBuyIn.Field game={game} value={entry} onChange={setEntry} />
              ) : (
                <p>{t('Koltuk {number}', { number: buyIn + 1 })}</p>
              )}
              {seatReason && <p role="status">{seatReason}</p>}
              {activity.error && (
                <div className="rg-banner error" role="alert">
                  {activity.error}
                </div>
              )}
            </div>
            <footer className="rg-modal-footer">
              <button className="button secondary" onClick={() => setBuyIn(null)}>
                {t('Vazgeç')}
              </button>
              <button
                className="button primary"
                disabled={
                  fixture ||
                  activity.busy ||
                  !ready ||
                  !!seatReason ||
                  (!!game && !!seatBuyIn && !seatBuyIn.valid(game, entry))
                }
                onClick={() => {
                  if (!seatReason)
                    void send({
                      type: 'game.sit',
                      seat: buyIn,
                      ...(seatBuyIn ? { buyIn: entry } : {}),
                    });
                }}
              >
                {t('Katıl')}
              </button>
            </footer>
          </Modal>
        )}
        {end && (
          <Modal title={t('Masayı kapat?')} className="rg-modal" onClose={() => setEnd(false)}>
            <div className="rg-modal-body">
              <p>{t('Oyun etkinliği biter. Ses bağlantısı bu işlemden bağımsızdır.')}</p>
              {activity.error && (
                <div className="rg-banner error" role="alert">
                  {activity.error}
                </div>
              )}
            </div>
            <footer className="rg-modal-footer">
              <button className="button secondary" onClick={() => setEnd(false)}>
                {t('Vazgeç')}
              </button>
              <button
                className="button danger"
                disabled={fixture || activity.busy || !owner || !ready}
                onClick={() =>
                  void send({ type: 'end' }).then((ok) => {
                    if (ok) setEnd(false);
                  })
                }
              >
                {t('Masayı kapat')}
              </button>
            </footer>
          </Modal>
        )}
        {configure && tableRules?.configure && rulesValue && (
          <Modal
            title={t('Masa kurallarını düzenle')}
            className="rg-modal"
            onClose={() => setConfigure(false)}
          >
            <div className="rg-modal-body">
              <tableRules.Form value={rulesValue} onChange={setRulesValue} editing />
              {activity.error && <p role="alert">{activity.error}</p>}
            </div>
            <footer className="rg-modal-footer">
              <button className="button secondary" onClick={() => setConfigure(false)}>
                {t('Vazgeç')}
              </button>
              <button
                className="button primary"
                disabled={
                  fixture ||
                  !ready ||
                  activity.busy ||
                  !tableRules.valid(rulesValue) ||
                  !owner ||
                  !waiting ||
                  !!game?.history.length
                }
                onClick={() =>
                  void send(tableRules.configure!(rulesValue)).then((ok) => {
                    if (ok) setConfigure(false);
                  })
                }
              >
                {t('Kaydet')}
              </button>
            </footer>
          </Modal>
        )}
        {inviteOpen && (
          <Modal
            title={t('{roomName} daveti', { roomName })}
            className="rg-modal rg-invite"
            onClose={closeInvite}
          >
            <div className="rg-modal-body">
              <p>{t('Bu davet topluluğa katılmak içindir. Masada koltuk ayırmaz.')}</p>
              {invite ? (
                <InviteLinkCard serverUrl={c.serverUrl} invite={invite} autoFocus />
              ) : (
                <button
                  className="button primary"
                  disabled={fixture || inviteBusy || !roomId || c.status !== 'connected'}
                  title={fixture ? fixtureReason : undefined}
                  onClick={() => void generateInvite()}
                >
                  {inviteBusy ? t('Oluşturuluyor…') : t('Davet oluştur')}
                </button>
              )}
              {inviteError && (
                <p className="rg-banner error" role="alert">
                  {inviteError}
                </p>
              )}
            </div>
          </Modal>
        )}
        {create && (
          <Modal
            title={t('{names} masası', { names: names[create] })}
            className="rg-modal"
            onClose={() => onCreate(null)}
          >
            <div className="rg-modal-body">
              {createRules && rulesValue && (
                <createRules.Form value={rulesValue} onChange={setRulesValue} editing={false} />
              )}
              <p>{t('Yalnızca sanal fiş ve puan.')}</p>
              {activity.room?.primary && (
                <div className="rg-banner">
                  {t('{tableTitle} etkinliği açık.', {
                    tableTitle: tableTitle(activity.room.primary.title, game?.kind) ?? '',
                  })}
                  {/* An old-cinema session has no page here; the consent below can still end it. */}
                  {!retiredActivity(activity.room.primary.activity) && (
                    <button
                      onClick={() => {
                        onCreate(null);
                        navigate(game ? '/games?tab=table' : '/voice');
                      }}
                    >
                      {t('Etkinliği aç')}
                    </button>
                  )}
                  <label className="rg-replace-consent">
                    <input
                      type="checkbox"
                      checked={replacementMatches}
                      disabled={fixture || !canReplace || activity.busy}
                      onChange={(event) =>
                        setReplaceConsent(
                          event.target.checked && currentPrimary
                            ? {
                                activity: currentPrimary.activity,
                                startedAt: currentPrimary.startedAt,
                              }
                            : undefined,
                        )
                      }
                    />
                    <span>
                      {t('{tableTitle} etkinliğini bitir ve yeni masayı kur', {
                        tableTitle: tableTitle(currentPrimary?.title, game?.kind) ?? '',
                      })}
                    </span>
                  </label>
                  {!canReplace && (
                    <p>
                      {t(
                        'Açık etkinliği yalnızca hostu kapatabilir. Kapatıldığında masa açabilirsin.',
                      )}
                    </p>
                  )}
                  <p>{t('Ses bağlantısı devam eder. Mevcut kuyruk korunur.')}</p>
                </div>
              )}
            </div>
            <footer className="rg-modal-footer">
              <button className="button secondary" onClick={() => onCreate(null)}>
                {t('Vazgeç')}
              </button>
              <button
                className="button primary"
                disabled={
                  fixture ||
                  !ready ||
                  activity.busy ||
                  createConflict ||
                  (!!createRules && (!rulesValue || !createRules.valid(rulesValue)))
                }
                title={
                  fixture
                    ? fixtureReason
                    : createConflict
                      ? t('Etkinliği değiştirmeyi onayla veya önce bitir')
                      : !ready
                        ? t('Etkinlik bağlantısı gerekli')
                        : undefined
                }
                onClick={() =>
                  void createTable({
                    type: 'game.create',
                    game: create,
                    ...(createRules && rulesValue ? createRules.command(rulesValue) : {}),
                    ...(canReplace && replacementMatches ? { replacePrimary: replaceConsent } : {}),
                  })
                }
              >
                {t('Masayı kur')}
              </button>
            </footer>
            {activity.error && (
              <div className="rg-banner error" role="alert">
                {activity.error}
              </div>
            )}
          </Modal>
        )}
      </div>
    </SeatControlsContext.Provider>
  );
}
