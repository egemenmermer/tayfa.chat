import { SoundboardButton } from './Soundboard';
import { CinemaReminders } from './cinema/CinemaReminders';
import { useEffect, useId, useState, type DragEvent, type MouseEvent, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  HeadphoneOff,
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  Settings,
  SlidersHorizontal,
  Plus,
  Check,
  Home,
  Users,
  Bell,
  MessageSquare,
  Hash,
  Volume2,
  Search,
  Video,
  MonitorUp,
  Gamepad2,
  PartyPopper,
  Film,
  Music,
  VolumeX,
} from 'lucide-react';
import { IconButton, Modal } from '@rooms/design';
import { useCommunity } from './community';
import {
  useRealtime,
  joinVoice,
  leaveVoice,
  prewarmVoice,
  toggleMic,
  toggleDeafen,
  toggleCamera,
  startRoomAudio,
  stopScreen,
} from './realtime';
import { silencedHere } from './participant-audio';
import { useActivityRoom } from './activity';
import { openActivity, retiredActivity } from './activity-route';
import { useVoiceDirectory } from './voice-directory';
import { VoiceAvatar } from './VoiceAvatar';
import { QuietMenu } from './QuietMenu';
import { ChannelTools, useChannelManagement } from './ChannelTools';
import { UserProfileDialog } from './SocialSurfaces';
import type { InviteLink, SocialUser } from '@rooms/social';
import { JoinWithInviteDialog } from './Invite';
import { t, uiError } from './i18n';
import { UpdateNotice } from './UpdateNotice';
import { HallBackground } from './cinema/HallBackground';
import { HallSidebarRow } from './cinema/HallSidebarRow';
import { useCommunityCinema } from './cinema/cinema-status';
import { memberAccount } from './room-members';
import { useRooms } from './store';
import { formatPushToTalkKey, parsePushToTalkKey } from './push-to-talk-key';

/** A control's name with its keyboard shortcut, or how to set one. */
function withShortcut(label: string, key: string) {
  const parsed = parsePushToTalkKey(key);
  return parsed
    ? t('{label} ({key})', { label, key: formatPushToTalkKey(parsed) })
    : t('{label} · kısayol için sağ tıkla', { label });
}
import './sidebar-nav.css';
import {
  VOICE_MEMBER_DRAG,
  VoiceMemberMenu,
  moveVoiceMember,
  useModerationRights,
  type VoiceMemberTarget,
} from './VoiceModeration';
/** A running activity in the joined room, one click from the room list. */
function RoomActivityRow({
  roomId,
  onOpen,
}: {
  roomId: string;
  onOpen(kind: Parameters<typeof openActivity>[0]): void;
}) {
  const activity = useActivityRoom(roomId),
    me = useCommunity((s) => s.user?.id);
  const room = activity.status === 'connected' ? activity.room : null;
  const primary = room?.primary;
  if (!room || !primary) return null;
  const joined = room.participants.some((p) => p.userId === me);
  const count = room.participants.length;
  // An old-cinema session has no page here; the click opens the launcher that explains it.
  const action = retiredActivity(primary.activity)
    ? t('Eski Sinema')
    : joined
      ? t('Aç')
      : t('Katıl');
  return (
    <button
      className="minimal-activity"
      title={t('{title} · {count} kişi', { title: primary.title, count })}
      aria-label={t('{title} sürüyor, {count} kişi. {action}', {
        title: primary.title,
        count,
        action,
      })}
      onClick={() => onOpen(primary.activity)}
    >
      {['cinema', 'youtube', 'screen'].includes(primary.activity) ? (
        <Film size={13} />
      ) : (
        <Gamepad2 size={13} />
      )}
      <span>{primary.title}</span>
      <small>{action}</small>
    </button>
  );
}
/** Incoming friend requests for the signed-in account; null until the first answer. */
function useIncomingFriendRequests(path: string) {
  const userId = useCommunity((s) => s.user?.id),
    serverUrl = useCommunity((s) => s.serverUrl),
    status = useCommunity((s) => s.status);
  const [count, setCount] = useState<number | null>(null),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const changed = () => setRevision((value) => value + 1);
    window.addEventListener('rooms:friends-changed', changed);
    window.addEventListener('focus', changed);
    return () => {
      window.removeEventListener('rooms:friends-changed', changed);
      window.removeEventListener('focus', changed);
    };
  }, []);
  // Leaving the friends page after answering requests refreshes the count too.
  const onFriends = path === '/friends';
  useEffect(() => {
    let active = true;
    const bridge = window.rooms?.social;
    // Fixtures must not query live services with synthetic IDs.
    const fixture =
      import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture');
    if (!userId || status !== 'connected' || !bridge?.friends || fixture) {
      setCount(null);
      return;
    }
    void bridge
      .friends()
      .then((friends) => {
        const current = useCommunity.getState();
        if (active && current.user?.id === userId && current.serverUrl === serverUrl)
          setCount(friends.filter((friend) => friend.relationship === 'incoming').length);
      })
      .catch(() => {
        if (active) setCount(null);
      });
    return () => {
      active = false;
    };
  }, [userId, serverUrl, status, revision, onFriends]);
  return count;
}
/** A count beside a navigation row: the number is shown, the sentence is read. */
function NavBadge({ count, label }: { count: number | null; label: string }) {
  if (!count) return null;
  return (
    <>
      <small className="sidebar-nav-badge" aria-hidden="true">
        {count > 99 ? '99+' : count}
      </small>
      <small className="sidebar-nav-sr">{label}</small>
    </>
  );
}
/**
 * A channel group header. It is a keyboard stop only for members who can manage channels,
 * because its context menu offers nothing else.
 */
function SectionHeader({
  type,
  label,
  createLabel,
}: {
  type: 'text' | 'voice';
  label: string;
  createLabel: string;
}) {
  const { canManage } = useChannelManagement(),
    hint = useId();
  return (
    <div
      className="minimal-section"
      data-channel-type={type}
      role="group"
      aria-label={label}
      tabIndex={canManage ? 0 : undefined}
      aria-describedby={canManage ? hint : undefined}
    >
      <span aria-hidden="true">{label}</span>
      {canManage && (
        <>
          <small id={hint} className="sidebar-nav-sr">
            {t('Seçenekler için Shift+F10')}
          </small>
          <IconButton data-create-type={type} label={createLabel}>
            <Plus size={14} />
          </IconButton>
        </>
      )}
    </div>
  );
}
/** What the channel list says when it has nothing to show. */
function ChannelListState({ createSpace }: { createSpace(): void }) {
  const c = useCommunity(),
    { canManage } = useChannelManagement();
  if (c.channels.length) return null;
  if (c.busy || (c.activeSpaceId && c.loadingMessages))
    return (
      <p className="sidebar-list-state" role="status">
        {t('Kanallar yükleniyor…')}
      </p>
    );
  if (!c.activeSpaceId)
    return (
      <div className="sidebar-list-state">
        <p>
          {c.spaces.length
            ? t('Kanalları görmek için bir topluluk seç.')
            : t('Henüz bir topluluğun yok.')}
        </p>
        {!c.spaces.length && (
          <button className="button small" onClick={createSpace}>
            {t('Topluluk oluştur')}
          </button>
        )}
      </div>
    );
  if (c.error)
    return (
      <div className="sidebar-list-state" role="alert">
        <p>{t('Kanallar alınamadı.')}</p>
        <button
          className="button small"
          onClick={() => void c.openSpace(c.activeSpaceId!).catch(() => {})}
        >
          {t('Yeniden dene')}
        </button>
      </div>
    );
  return (
    <div className="sidebar-list-state">
      <p>{t('Henüz kanal yok')}</p>
      {canManage && (
        <button className="button small" data-create-type="text">
          {t('Kanal oluştur')}
        </button>
      )}
    </div>
  );
}
export function MinimalSidebar({
  notify,
  invite,
  joinInvite,
  createSpace,
  search,
  help,
}: {
  notify(message: string): void;
  invite(): void;
  /** Opens InviteLanding for a pasted link; without it the menu has no join entry. */
  joinInvite?(link: InviteLink): void;
  createSpace(): void;
  /** Kept for callers; server settings now open the settings page. */
  editSpace?(): void;
  search(): void;
  help(): void;
}) {
  const c = useCommunity(),
    r = useRealtime(),
    navigate = useNavigate(),
    location = useLocation(),
    prefs = useRooms((state) => state.preferences);
  // Right-click on the microphone or deafen button leads to their shortcuts.
  const openShortcuts = (event: MouseEvent) => {
    event.preventDefault();
    navigate('/settings?tab=audio');
  };

  const [person, setPerson] = useState<SocialUser | null>(null);
  // Voice participants carry only an id and a name; the profile opens at once and then takes
  // the member's account (username and tag) so "Arkadaş ekle" can send a request.
  const openPerson = (id: string, name: string) => {
    setPerson({ id, username: name, displayName: name, avatar: null });
    void memberAccount(c.serverUrl, c.user?.id, c.activeSpaceId, id).then((account) => {
      if (account) setPerson((current) => (current?.id === id ? account : current));
    });
  };
  const [joining, setJoining] = useState(false);
  const [memberMenu, setMemberMenu] = useState<
      (VoiceMemberTarget & { x: number; y: number }) | null
    >(null),
    [dropRoom, setDropRoom] = useState<string | null>(null);
  const rights = useModerationRights(c.activeSpaceId);
  const moderates = rights.moveMembers || rights.kickMembers || rights.banMembers;
  const dragged = (event: DragEvent) => {
    try {
      const value = JSON.parse(event.dataTransfer.getData(VOICE_MEMBER_DRAG)) as VoiceMemberTarget;
      return typeof value?.id === 'string' && typeof value.from === 'string' ? value : null;
    } catch {
      return null;
    }
  };
  // The cinema hall is a channel too, but it lives in its own "Sinema" row.
  const hallId = useCommunityCinema().hallId;
  const space = c.spaces.find((s) => s.id === c.activeSpaceId),
    voices = c.channels.filter((ch) => ch.type === 2 && ch.id !== hallId);
  const directory = useVoiceDirectory(voices.map((ch) => ch.id));
  const incomingRequests = useIncomingFriendRequests(location.pathname);
  // The same records the notifications page lists: mentions in this community and in DMs.
  const unreadNotifications = [...c.channels, ...c.dms].reduce(
    (sum, ch) => sum + (c.readStates[ch.id]?.mentionMessageIds?.length ?? 0),
    0,
  );
  const unreadDms = c.dms.some((dm) => c.unread[dm.id]);
  const navRow = (path: string, label: string, icon: ReactNode, extra?: ReactNode) => {
    const selected = location.pathname === path;
    return (
      <button
        className={`minimal-nav ${selected ? 'selected' : ''}`}
        aria-current={selected ? 'page' : undefined}
        onClick={() => navigate(path)}
      >
        {icon}
        <span title={label}>{label}</span>
        {extra}
      </button>
    );
  };
  const run = (task: Promise<unknown>) => void task.catch((e) => notify(uiError(e)));
  const enter = (id: string, name: string) => {
    navigate('/voice');
    run(c.openChannel(id));
    run(joinVoice(id, name));
  };
  return (
    <ChannelTools>
      <aside id="rooms-navigation" className="minimal-sidebar" aria-label={t('Odalar ve gezinme')}>
        <header title={space?.name}>
          <QuietMenu label={space?.name ?? 'Tayfa'}>
            {c.spaces.map((s) => (
              <button
                key={s.id}
                className="sidebar-space-option"
                aria-current={s.id === space?.id ? 'true' : undefined}
                title={s.name}
                onClick={() => {
                  navigate('/chat');
                  run(c.openSpace(s.id));
                }}
              >
                <span>{s.name}</span>
                {s.id === space?.id && <Check size={14} aria-hidden="true" />}
              </button>
            ))}
            <hr />
            <button onClick={createSpace}>{t('Topluluk oluştur')}</button>
            <button onClick={invite}>{t('Davet oluştur')}</button>
            {joinInvite && (
              <button onClick={() => setJoining(true)}>{t('Davet bağlantısıyla katıl')}</button>
            )}
            <button disabled={!space} onClick={() => navigate('/settings?tab=server-profile')}>
              {t('Sunucu ayarları')}
            </button>
            <button onClick={() => navigate('/files')}>{t('Dosyalar')}</button>
            <button onClick={() => navigate('/media')}>{t('Medyam')}</button>
            <button onClick={() => navigate('/agent?tab=schedules')}>
              {t('Planlanan görevler')}
            </button>
            <button onClick={help}>{t('Klavye kısayolları')}</button>
          </QuietMenu>
          <IconButton label={t('Ara')} onClick={search}>
            <Search size={17} />
          </IconButton>
        </header>
        <div className="minimal-room-list">
          <div className="sidebar-nav" role="group" aria-label={t('Kişisel')}>
            {navRow('/home', t('Ana sayfa'), <Home size={15} aria-hidden="true" />)}
            {navRow(
              '/friends',
              t('Arkadaşlar'),
              <Users size={15} aria-hidden="true" />,
              <NavBadge
                count={incomingRequests}
                label={t('{count} yeni arkadaşlık isteği', { count: incomingRequests ?? 0 })}
              />,
            )}
            {navRow(
              '/notifications',
              t('Bildirimler'),
              <Bell size={15} aria-hidden="true" />,
              <NavBadge
                count={unreadNotifications}
                label={t('{count} okunmamış bildirim', { count: unreadNotifications })}
              />,
            )}
            {navRow(
              '/messages',
              t('Mesajlar'),
              <MessageSquare size={15} aria-hidden="true" />,
              unreadDms && (
                <>
                  <i className="nav-dot" aria-hidden="true" />
                  <small className="sidebar-nav-sr">{t('Okunmamış mesaj var')}</small>
                </>
              ),
            )}
          </div>
          <HallSidebarRow
            selected={location.pathname === '/cinema'}
            onOpen={() => navigate('/cinema')}
          />
          <button
            className={`minimal-nav ${location.pathname.startsWith('/studio') ? 'selected' : ''}`}
            aria-current={location.pathname.startsWith('/studio') ? 'page' : undefined}
            onClick={() => navigate('/studio')}
          >
            <Music size={15} aria-hidden="true" />
            <span>{t('Stüdyo')}</span>
          </button>
          <SectionHeader
            type="text"
            label={t('Sohbetler')}
            createLabel={t('Sohbet kanalı oluştur')}
          />
          {c.channels
            .filter((ch) => ch.type === 0 && ch.id !== hallId)
            .map((ch) => (
              <button
                data-channel-id={ch.id}
                key={ch.id}
                className={`minimal-nav ${c.activeChannelId === ch.id && location.pathname === '/chat' ? 'selected' : ''}`}
                aria-current={
                  c.activeChannelId === ch.id && location.pathname === '/chat' ? 'page' : undefined
                }
                onClick={() => {
                  navigate('/chat');
                  run(c.openChannel(ch.id));
                }}
              >
                <Hash size={15} aria-hidden="true" />
                <span title={ch.name}>{ch.name}</span>
                {c.unread[ch.id] && <i className="nav-dot" />}
              </button>
            ))}
          <SectionHeader type="voice" label={t('Odalar')} createLabel={t('Ses odası oluştur')} />
          {voices.length > 0 && directory.error && (
            <small className="occupancy-unavailable sidebar-directory-state" role="status">
              {t('Üyeler alınamadı. Yeniden deneniyor…')}
            </small>
          )}
          {voices.map((ch) => {
            const occupants =
              r.channelId === ch.id && r.status === 'connected'
                ? r.participants
                : (directory.rooms.find((room) => room.channelId === ch.id)?.participants ?? []);
            return (
              <div
                key={ch.id}
                className={dropRoom === ch.id ? 'voice-drop-target' : undefined}
                onDragOver={(event) => {
                  if (!rights.moveMembers || !event.dataTransfer.types.includes(VOICE_MEMBER_DRAG))
                    return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropRoom(ch.id);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null))
                    setDropRoom((current) => (current === ch.id ? null : current));
                }}
                onDrop={(event) => {
                  setDropRoom(null);
                  const target = dragged(event);
                  if (!target || target.from === ch.id) return;
                  event.preventDefault();
                  void moveVoiceMember(target, ch.id)
                    .then(() =>
                      notify(
                        t('{name}, {room} odasına taşındı.', { name: target.name, room: ch.name }),
                      ),
                    )
                    .catch((e) => notify(uiError(e)));
                }}
              >
                <button
                  data-channel-id={ch.id}
                  className={`minimal-nav ${(r.channelId === ch.id || c.activeChannelId === ch.id) && location.pathname === '/voice' ? 'selected' : ''}`}
                  onClick={() => enter(ch.id, ch.name)}
                  onPointerEnter={() => prewarmVoice(ch.id)}
                  onFocus={() => prewarmVoice(ch.id)}
                >
                  <Volume2 size={15} aria-hidden="true" />
                  <span title={ch.name}>{ch.name}</span>
                  {r.channelId === ch.id && r.busy ? (
                    <small className="room-connecting">{t('Bağlanıyor…')}</small>
                  ) : (
                    r.channelId === ch.id &&
                    r.status === 'connected' && <i className="room-connected-dot" />
                  )}
                </button>
                {occupants.map((p) => {
                  const silenced = 'volume' in p && silencedHere(p);
                  return (
                    <button
                      data-voice-participant-id={p.id}
                      key={p.id}
                      className={`minimal-occupant ${'speaking' in p && p.speaking && !p.muted && !silenced ? 'speaking' : ''}`}
                      onClick={() => openPerson(p.id, p.name)}
                      draggable={rights.moveMembers && p.id !== c.user?.id}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = 'move';
                        event.dataTransfer.setData(
                          VOICE_MEMBER_DRAG,
                          JSON.stringify({ id: p.id, name: p.name, from: ch.id }),
                        );
                      }}
                      onDragEnd={() => setDropRoom(null)}
                      // Without moderation rights the shared volume menu opens on its own.
                      // With them, the member menu carries that volume too.
                      onContextMenu={(event) => {
                        if (!moderates || p.id === c.user?.id) return;
                        event.preventDefault();
                        event.stopPropagation();
                        setMemberMenu({
                          id: p.id,
                          name: p.name,
                          from: ch.id,
                          x: event.clientX,
                          y: event.clientY,
                        });
                      }}
                      onKeyDown={(event) => {
                        if (
                          !moderates ||
                          p.id === c.user?.id ||
                          (event.key !== 'ContextMenu' && !(event.key === 'F10' && event.shiftKey))
                        )
                          return;
                        event.preventDefault();
                        event.stopPropagation();
                        const rect = event.currentTarget.getBoundingClientRect();
                        setMemberMenu({
                          id: p.id,
                          name: p.name,
                          from: ch.id,
                          x: rect.left,
                          y: rect.bottom,
                        });
                      }}
                    >
                      <VoiceAvatar id={p.id} name={p.name} />
                      <span title={p.name}>{p.name}</span>
                      {'screen' in p && p.screen === true && (
                        <MonitorUp size={13} aria-label={t('Ekran paylaşıyor')} />
                      )}
                      {silenced && (
                        <VolumeX size={12} aria-label={t('Sesini kapattın, yalnızca sende')} />
                      )}
                      {/* Deafened people are also muted: show both, like Discord. */}
                      {(p.muted || ('deafened' in p && p.deafened)) && (
                        <MicOff size={12} aria-label={t('Mikrofon kapalı')} />
                      )}
                      {'deafened' in p && p.deafened && (
                        <HeadphoneOff size={12} aria-label={t('Sağırlaştırdı')} />
                      )}
                    </button>
                  );
                })}
                {r.channelId === ch.id && r.status === 'connected' && (
                  <RoomActivityRow roomId={ch.id} onOpen={(kind) => openActivity(kind, navigate)} />
                )}
                {/* A failed or loading directory is reported once, under the header. */}
                {!(r.channelId === ch.id && r.status === 'connected') &&
                  !directory.error &&
                  !directory.loading &&
                  directory.rooms &&
                  !directory.rooms.some((room) => room.channelId === ch.id) && (
                    <small className="occupancy-unavailable">{t('Üyeler alınamadı')}</small>
                  )}
              </div>
            );
          })}
          <ChannelListState createSpace={createSpace} />
        </div>
        <div className="minimal-self">
          {(r.channelId || r.busy || r.error) && (
            <div className="minimal-voice-status" role="status">
              <span>
                <strong>
                  {r.busy || r.status === 'connecting'
                    ? t('Bağlanıyor…')
                    : r.status === 'connected'
                      ? t('Ses bağlı')
                      : r.status === 'reconnecting'
                        ? t('Yeniden bağlanıyor…')
                        : t('Ses bağlı değil')}
                </strong>
                <small title={r.roomName ?? undefined}>{r.roomName}</small>
              </span>
              <IconButton label={t('Ses ayarları')} onClick={() => navigate('/settings?tab=audio')}>
                <SlidersHorizontal size={15} />
              </IconButton>
            </div>
          )}
          {r.channelId && (
            <div className="sidebar-media-actions">
              <IconButton
                disabled={r.status !== 'connected' || r.busy}
                label={r.camera ? t('Kamerayı kapat') : t('Kamerayı aç')}
                onClick={() => run(toggleCamera().then(() => navigate('/voice')))}
              >
                <Video size={17} />
              </IconButton>
              <IconButton
                disabled={r.status !== 'connected' || r.busy}
                label={r.sharing ? t('Paylaşımı durdur') : t('Ekran paylaş')}
                onClick={() =>
                  r.sharing
                    ? run(stopScreen())
                    : window.dispatchEvent(new Event('rooms:choose-capture'))
                }
              >
                <MonitorUp size={17} />
              </IconButton>
              <IconButton
                label={t('Etkinlikler')}
                onClick={() => window.dispatchEvent(new Event('rooms:open-activity-launcher'))}
              >
                <Gamepad2 size={17} />
              </IconButton>
              <IconButton
                label="Soundboard"
                onClick={() => window.dispatchEvent(new Event('rooms:open-soundboard'))}
              >
                <PartyPopper size={17} />
              </IconButton>
            </div>
          )}
          {r.error && (
            <div className="minimal-voice-error">
              <span>{r.error}</span>
              {r.channelId && (
                <button onClick={() => run(joinVoice(r.channelId!, r.roomName ?? t('Oda')))}>
                  {t('Yeniden dene')}
                </button>
              )}
            </div>
          )}
          {r.audioBlocked && (
            <button className="text-button" onClick={() => run(startRoomAudio())}>
              {t('Oda sesini aç')}
            </button>
          )}
          <div className="minimal-self-row">
            <button className="minimal-profile" onClick={() => navigate('/settings?tab=profile')}>
              {c.user && <VoiceAvatar id={c.user.id} name={c.user.displayName} />}
              <span title={c.user?.displayName}>{c.user?.displayName ?? t('Profil')}</span>
            </button>
            <UpdateNotice />
            <IconButton label={t('Ayarlar')} onClick={() => navigate('/settings')}>
              <Settings size={17} />
            </IconButton>
          </div>
          {(r.channelId || r.busy) && (
            <div className="minimal-voice-controls">
              <IconButton
                label={withShortcut(
                  r.muted ? t('Mikrofonu aç') : t('Mikrofonu kapat'),
                  prefs.muteKey,
                )}
                onContextMenu={openShortcuts}
                // While reconnecting the microphone can still be muted (not unmuted).
                disabled={
                  (r.status !== 'connected' && !(r.status === 'reconnecting' && !r.muted)) || r.busy
                }
                onClick={() => run(toggleMic())}
              >
                {r.muted ? <MicOff size={17} /> : <Mic size={17} />}
              </IconButton>
              <IconButton
                label={withShortcut(
                  r.deafened ? t('Sağırlaştırmayı kapat') : t('Sağırlaştır'),
                  prefs.deafenKey,
                )}
                onContextMenu={openShortcuts}
                aria-pressed={r.deafened}
                className={r.deafened ? 'muted-control' : ''}
                disabled={r.status !== 'connected' || r.busy}
                onClick={() => run(toggleDeafen())}
              >
                {r.deafened ? <HeadphoneOff size={17} /> : <Headphones size={17} />}
              </IconButton>
              <IconButton label={t('Sesten ayrıl')} onClick={() => run(leaveVoice())}>
                <PhoneOff size={17} />
              </IconButton>
            </div>
          )}
        </div>
      </aside>
      <SoundboardButton showTrigger={false} />
      {/* Like the soundboard, the corner cinema outlives page changes (e.g. joining voice). */}
      <HallBackground notify={notify} />
      <CinemaReminders />
      {memberMenu && (
        <VoiceMemberMenu
          target={memberMenu}
          x={memberMenu.x}
          y={memberMenu.y}
          rooms={voices}
          rights={rights}
          notify={notify}
          onProfile={() => openPerson(memberMenu.id, memberMenu.name)}
          onClose={() => setMemberMenu(null)}
        />
      )}
      {person && (
        <UserProfileDialog
          key={`${c.serverUrl}:${c.user?.id}:${person.id}`}
          user={person}
          onClose={() => setPerson(null)}
        />
      )}
      {joining && joinInvite && (
        <JoinWithInviteDialog onClose={() => setJoining(false)} onInvite={joinInvite} />
      )}
    </ChannelTools>
  );
}
