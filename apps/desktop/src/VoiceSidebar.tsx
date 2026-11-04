import { openActivity } from './activity-route';
import { useEffect, useRef, useState } from 'react';
import { ChannelTools } from './ChannelTools';
import { useActivityRoom } from './activity';
import { useLocation, useNavigate } from 'react-router-dom';
import { ReferenceIcon } from './ReferenceIcon';
import {
  AudioLines,
  Hash,
  Headphones,
  Mic,
  HeadphoneOff,
  MicOff,
  PhoneOff,
  Settings,
  Plus,
  Search,
  Gamepad2,
  Bot,
  Film,
  PenLine,
  MessageCircle,
} from 'lucide-react';
import { IconButton } from '@rooms/design';
import { useCommunity } from './community';
import { useRealtime, joinVoice, leaveVoice, toggleMic, toggleDeafen } from './realtime';
import { useVoiceDirectory } from './voice-directory';
import { VoiceAvatar } from './VoiceAvatar';
import { t, uiError } from './i18n';
import { roomMuteShortcutLabel } from './shell-commands';
import { useModerationRights } from './VoiceModeration';
import { places } from './dev/sample';
// Name of the dev fixture's empty voice room.
const FIXTURE_VOICE_ROOM = places.lounge;
export function VoiceSidebar({
  notify,
  invite,
  search,
  editSpace,
}: {
  notify(message: string): void;
  invite(): void;
  search(): void;
  editSpace(): void;
}) {
  const c = useCommunity(),
    r = useRealtime(),
    navigate = useNavigate(),
    location = useLocation();
  const fixtureParams = import.meta.env.DEV ? new URLSearchParams(window.location.search) : null;
  const emptyVoiceFixture =
    fixtureParams?.get('fixture')?.toUpperCase() === 'S19' &&
    fixtureParams.get('variant') === 'empty';
  const emptyVoiceChannelId = emptyVoiceFixture
    ? (c.channels.find((ch) => ch.type === 2 && ch.name === FIXTURE_VOICE_ROOM)?.id ?? null)
    : null;
  const activity = useActivityRoom(c.user ? (r.channelId ?? emptyVoiceChannelId) : null);
  const primary = activity.status === 'connected' ? activity.room?.primary : null;
  const [menuOpen, setMenuOpen] = useState(false),
    menuRef = useRef<HTMLDivElement>(null),
    triggerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    setMenuOpen(false);
  }, [c.activeSpaceId]);
  useEffect(() => {
    if (!menuOpen) return;
    const menu = menuRef.current;
    menu?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    const close = () => {
      setMenuOpen(false);
      triggerRef.current?.focus();
    };
    const outside = (e: PointerEvent) => {
      if (!menu?.contains(e.target as Node) && !triggerRef.current?.contains(e.target as Node))
        setMenuOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopImmediatePropagation();
        close();
      }
      if (e.key === 'Tab') {
        setMenuOpen(false);
        triggerRef.current?.focus();
        return;
      }
      if (!menu?.contains(document.activeElement)) return;
      if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key)) {
        e.preventDefault();
        const items = [...menu!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        items[
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? items.length - 1
              : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
        ]?.focus();
      }
    };
    window.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
    };
  }, [menuOpen]);
  const currentSpace = c.spaces.find((s) => s.id === c.activeSpaceId);
  const communityAdmin =
    useModerationRights(c.activeSpaceId).communityAdmin || currentSpace?.ownerId === c.user?.id;
  const menuAction = (action: () => void) => {
    setMenuOpen(false);
    triggerRef.current?.focus();
    action();
  };
  const run = (task: Promise<unknown>) => void task.catch((e) => notify(uiError(e)));
  const text = c.channels.filter((ch) => ch.type === 0),
    voice = c.channels.filter((ch) => ch.type === 2);
  const directory = useVoiceDirectory(voice.map((ch) => ch.id));
  const occupants = (id: string) =>
    r.channelId === id && r.status === 'connected'
      ? r.participants
      : (directory.rooms.find((room) => room.channelId === id)?.participants ?? []).map((p) => ({
          ...p,
          speaking: false,
        }));
  return (
    <ChannelTools>
      <aside className="voice-channel-sidebar">
        <header className="community-menu-header">
          <button
            ref={triggerRef}
            className="community-menu-trigger"
            aria-label={t('Topluluk menüsü')}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={currentSpace?.name}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <strong>{currentSpace?.name ?? t('Topluluk')}</strong>
            <ReferenceIcon name="chevron-down" size={16} />
          </button>
          {menuOpen && (
            <div
              ref={menuRef}
              className="community-menu"
              role="menu"
              aria-label={t('Topluluk işlemleri')}
            >
              {c.spaces.map((space) => (
                <button
                  key={space.id}
                  role="menuitem"
                  onClick={() => menuAction(() => run(c.openSpace(space.id)))}
                >
                  {space.name}
                  {space.id === c.activeSpaceId && <ReferenceIcon name="check" size={14} />}
                </button>
              ))}
              <hr />
              <button role="menuitem" onClick={() => menuAction(invite)}>
                <ReferenceIcon name="user-plus" size={15} />
                {t('Davet oluştur')}
              </button>
              <button
                role="menuitem"
                disabled={!communityAdmin}
                title={!communityAdmin ? t('Topluluk sahibi düzenleyebilir.') : undefined}
                onClick={() => menuAction(editSpace)}
              >
                <ReferenceIcon name="settings" size={15} />
                {t('Topluluğu düzenle')}
              </button>
              <button role="menuitem" onClick={() => menuAction(() => navigate('/files'))}>
                <ReferenceIcon name="file" size={15} />
                {t('Dosyalar')}
              </button>
            </div>
          )}
        </header>
        <div className="voice-channel-scroll">
          <button className="sidebar-search channel-quick-search" onClick={search}>
            <ReferenceIcon name="search" size={15} />
            <span>{t('Bir şeye geç…')}</span>
            <kbd>⌘ K</kbd>
          </button>
          <div className="section-label" data-channel-type="text" tabIndex={0}>
            {t('SOHBET')}
            <button data-create-type="text" aria-label={t('Metin kanalı oluştur')}>
              <ReferenceIcon name="plus" size={14} />
            </button>
          </div>
          {text.map((ch) => (
            <button
              data-channel-id={ch.id}
              title={ch.name}
              className={`room-channel ${c.activeChannelId === ch.id && (location.pathname === '/chat' || location.pathname === '/files') ? 'selected' : ''}`}
              key={ch.id}
              onClick={() => {
                run(c.openChannel(ch.id));
                navigate('/chat');
              }}
            >
              <ReferenceIcon name="hash" size={19} />
              <span>{ch.name}</span>
              {!!c.unread[ch.id] && <i className="nav-dot" />}
            </button>
          ))}
          <div className="section-label" data-channel-type="voice" tabIndex={0}>
            {t('SES ODALARI')}
            <button data-create-type="voice" aria-label={t('Ses odası oluştur')}>
              <ReferenceIcon name="plus" size={14} />
            </button>
          </div>
          {voice.map((ch) => (
            <div key={ch.id}>
              <button
                data-channel-id={ch.id}
                title={ch.name}
                className={`room-channel ${r.channelId === ch.id && location.pathname !== '/voice' ? 'joined' : ''} ${(r.channelId === ch.id && location.pathname === '/voice') || (emptyVoiceFixture && ch.name === FIXTURE_VOICE_ROOM && location.pathname === '/voice') ? 'selected' : ''}`}
                disabled={r.busy}
                onClick={() => {
                  navigate('/voice');
                  if (r.channelId !== ch.id || r.status !== 'connected')
                    run(joinVoice(ch.id, ch.name));
                }}
              >
                <ReferenceIcon name="volume" size={19} />
                <span>{ch.name}</span>
                {(occupants(ch.id).length > 0 ||
                  (emptyVoiceFixture && ch.name === FIXTURE_VOICE_ROOM)) && (
                  <span className="channel-count">{occupants(ch.id).length}</span>
                )}
              </button>
              {occupants(ch.id).map((p) => (
                <button
                  data-voice-participant-id={p.id}
                  className={`channel-participant ${r.status === 'connected' && p.speaking && !p.muted ? 'speaking' : ''}`}
                  key={p.id}
                  onClick={() => {
                    navigate('/voice');
                    if (r.channelId !== ch.id) run(joinVoice(ch.id, ch.name));
                  }}
                >
                  <VoiceAvatar id={p.id} name={p.name} />
                  <span title={p.name}>{p.name}</span>
                  {p.deafened ? (
                    <HeadphoneOff size={13} aria-label={t('Sağırlaştırdı')} />
                  ) : p.muted ? (
                    <ReferenceIcon name="mic-off" size={13} />
                  ) : p.speaking && r.status === 'connected' ? (
                    <span className="sidebar-speaking-bars">
                      <i />
                      <i />
                      <i />
                    </span>
                  ) : null}
                </button>
              ))}
              {(r.channelId === ch.id || (emptyVoiceFixture && ch.name === FIXTURE_VOICE_ROOM)) &&
                primary && (
                  <button
                    className="sidebar-activity-link"
                    onClick={() => openActivity(primary.activity, navigate)}
                  >
                    <ReferenceIcon name="film" size={12} />
                    {t('{title} sürüyor', { title: primary.title })}
                    <i />
                  </button>
                )}
            </div>
          ))}
          {directory.error && (
            <p className="muted" role="status">
              {t('Oda üyelerine ulaşılamıyor.')}
            </p>
          )}
          {!voice.length && <p className="muted">{t('Ses odası yok.')}</p>}
          <div className="section-label">{t('BİRLİKTE')}</div>
          <button className="room-channel" onClick={() => navigate('/games')}>
            <ReferenceIcon name="gamepad" size={19} />
            <span>{t('Oyun alanı')}</span>
          </button>
          <button className="room-channel" onClick={() => navigate('/agent')}>
            <ReferenceIcon name="bot" size={19} />
            <span>{t('Oda asistanı')}</span>
          </button>
          <button className="room-channel" onClick={() => navigate('/together?tab=board')}>
            <ReferenceIcon name="whiteboard" size={19} />
            <span>Whiteboard</span>
          </button>
          <div className="section-label">{t('SANA ÖZEL')}</div>
          <button className="room-channel" onClick={() => navigate('/media')}>
            <ReferenceIcon name="film" size={19} />
            <span>{t('Medyam')}</span>
          </button>
          {c.dms.map((dm) => (
            <button
              key={dm.id}
              className={`room-channel ${c.activeChannelId === dm.id ? 'selected' : ''}`}
              onClick={() => {
                run(c.openChannel(dm.id));
                navigate('/chat');
              }}
            >
              <ReferenceIcon name="message" size={19} />
              <span>
                {dm.recipients?.map((p) => p.displayName || p.username).join(', ') || dm.name}
              </span>
            </button>
          ))}
        </div>
        {r.channelId && (
          <div className="sidebar-call">
            <div>
              <ReferenceIcon name="volume" size={18} />
              <span>
                <strong>
                  {r.status === 'connected'
                    ? t('Ses bağlı')
                    : r.status === 'reconnecting'
                      ? t('Yeniden bağlanıyor')
                      : r.busy
                        ? t('Bağlanıyor')
                        : t('Bağlantı kesildi')}
                </strong>
                <small>
                  {r.roomName} / {c.spaces.find((s) => s.id === c.activeSpaceId)?.name}
                </small>
              </span>
              <IconButton label={t('Sesten ayrıl')} onClick={() => run(leaveVoice())}>
                <ReferenceIcon name="logout" size={17} />
              </IconButton>
            </div>
            <div className="sidebar-call-actions">
              <button
                disabled={r.status !== 'connected'}
                onClick={() => navigate('/voice?view=video')}
              >
                <ReferenceIcon name="video" size={14} />
                Video
              </button>
              <button
                disabled={r.status !== 'connected'}
                onClick={() => navigate('/voice?view=share&choose=1')}
              >
                <ReferenceIcon name="monitor" size={14} />
                {t('Ekran')}
              </button>
            </div>
          </div>
        )}
        <footer>
          <button className="sidebar-self" onClick={() => navigate('/settings?tab=profile')}>
            {c.user && <VoiceAvatar id={c.user.id} name={c.user.displayName} />}
            <span>
              <strong>{c.user?.displayName || c.user?.username}</strong>
              <small>
                {c.status === 'connected'
                  ? t('Çevrimiçi')
                  : c.status === 'reconnecting'
                    ? t('Yeniden bağlanıyor')
                    : t('Bağlantı kesildi')}
              </small>
            </span>
          </button>
          <IconButton
            label={r.muted ? t('Mikrofonu aç') : t('Mikrofonu kapat')}
            shortcut={roomMuteShortcutLabel()}
            aria-pressed={!r.muted}
            disabled={r.status !== 'connected'}
            onClick={() => run(toggleMic())}
          >
            {r.muted ? (
              <ReferenceIcon name="mic-off" size={17} />
            ) : (
              <ReferenceIcon name="mic" size={17} />
            )}
          </IconButton>
          <IconButton
            label={r.deafened ? t('Sesi aç') : t('Sağırlaştır')}
            aria-pressed={r.deafened}
            className={r.deafened ? 'muted-control' : ''}
            disabled={r.status !== 'connected'}
            onClick={() => run(toggleDeafen())}
          >
            <ReferenceIcon name={r.deafened ? 'headphones-off' : 'headphones'} size={17} />
          </IconButton>
          <IconButton label={t('Ayarlar')} onClick={() => navigate('/settings')}>
            <ReferenceIcon name="settings" size={17} />
          </IconButton>
        </footer>
      </aside>
    </ChannelTools>
  );
}
