import { FriendRequestButton } from './FriendRequestButton';
import { RovingTabs, tabPanelProps, useFriendList } from './FriendsPage';
import { MESSAGE_MAX } from './message-limit';
import './reference-social.css';
import { dmCallUnavailable, startDmCall, useDmCall } from './dm-call';
import { useRealtime } from './realtime';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { EmptyState, IconButton, Modal, Notice } from '@rooms/design';
import type {
  SocialUser,
  SocialFriend,
  SocialAttachment,
  SocialChannel,
  SocialMessage,
} from '@rooms/social';
import {
  FileText,
  Search,
  Hash,
  Volume2,
  ArrowRight,
  Download,
  Image,
  Upload,
  Phone,
  Video,
  User,
  Eye,
  Home,
  MessageCircle,
  AlertCircle,
  Bell,
  Users,
  X,
  Gamepad2,
  ShieldAlert,
} from 'lucide-react';
import { useCommunity, type CommunityMessage } from './community';
import { CommunityChat } from './RealSocial';
import { VoiceAvatar } from './VoiceAvatar';
import { useChannelAccess } from './channel-access';
import { locale, t, uiError } from './i18n';
import type {
  SocialDetailFixture,
  SocialDetailFixtureId,
  SocialDetailQuickDestination,
} from './dev/social-detail-fixture';
import { preserveReferenceFixtureRoute } from './dev/fixture-navigation';

const fixtureOnly = () =>
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture');
const fixtureReason = t('Yerel görsel örnekte gerçek hesap işlemi kapalı');
type OpenMessage = (channelId: string, messageId: string) => void;
const nameOf = (user: SocialUser) => user.displayName || user.username;
const statusLabel = (status?: string) =>
  ({
    online: t('Çevrimiçi'),
    idle: t('Uzakta'),
    dnd: t('Rahatsız etmeyin'),
    invisible: t('Görünmez'),
    offline: t('Çevrimdışı'),
  })[status ?? ''] ?? t('Durum alınamadı');
const sizeOf = (size: number) =>
  size >= 1048576
    ? `${(size / 1048576).toLocaleString(locale, { maximumFractionDigits: 1 })} MB`
    : `${Math.ceil(size / 1024)} KB`;
const dateOf = (date: string) =>
  new Date(date).toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
const safeFileUrl = (url?: string) => {
  try {
    const parsed = new URL(url ?? '');
    return ['https:', 'http:'].includes(parsed.protocol) ? parsed.href : undefined;
  } catch {
    return undefined;
  }
};
/** Load samples only in an explicit DEV fixture, and only for the installed isolated identity. */
function useSocialDetailFixture(expected: SocialDetailFixtureId) {
  const c = useCommunity();
  const params = import.meta.env.DEV ? new URLSearchParams(location.search) : null;
  const requested = params?.get('fixture')?.trim().toUpperCase();
  const variant = params?.get('variant') ?? 'default';
  const key = `${requested ?? ''}:${variant}:${c.user?.id ?? ''}:${c.serverUrl}:${c.activeChannelId ?? ''}:${c.status}`;
  const [loaded, setLoaded] = useState<{
    key: string;
    fixture?: SocialDetailFixture;
    error?: string;
  } | null>(null);
  useEffect(() => {
    if (!import.meta.env.DEV || requested !== expected) return;
    let alive = true;
    void import('./dev/social-detail-fixture')
      .then((module) => {
        const fixture = module.getSocialDetailFixture(requested, variant);
        if (alive) setLoaded({ key, fixture });
      })
      .catch((error) => {
        if (alive) setLoaded({ key, error: uiError(error) });
      });
    return () => {
      alive = false;
    };
  }, [expected, requested, variant, key]);
  const current = loaded?.key === key ? loaded : null;
  const fixture = current?.fixture;
  const matches =
    fixture &&
    c.user?.id === fixture.publicState.user?.id &&
    c.serverUrl === fixture.publicState.serverUrl &&
    c.activeChannelId === fixture.publicState.activeChannelId &&
    c.status === fixture.publicState.status;
  return {
    key,
    fixture: matches ? fixture : null,
    loading: requested === expected && !current,
    error:
      current?.error ??
      (fixture && !matches
        ? t('Yerel örnek sosyal verileri henüz kurulmadı veya hesap/kanal değişti.')
        : ''),
  };
}
function FixtureOpening({ loading, error }: { loading: boolean; error: string }) {
  return (
    <p className={error ? 'ss-error' : 'ss-scope'} role={error ? 'alert' : 'status'}>
      {error || (loading ? t('Yerel örnek hazırlanıyor…') : '')}
    </p>
  );
}
/** The only fixture image is passive original artwork, never an arbitrary local/remote URL. */
function fixtureImageUrl(file: SocialAttachment, fixture: SocialDetailFixture | null) {
  if (!import.meta.env.DEV || !fixtureOnly() || !fixture || fixture.metadata.id !== 'S14')
    return undefined;
  const path = fixture.assets.attachments[file.id];
  return path?.startsWith('data:image/svg+xml,') &&
    file.url === path &&
    file.mime === 'image/svg+xml'
    ? path
    : undefined;
}
/** A pending operation belongs to one mounted account/server/channel and access epoch. */
function useSocialOperationScope() {
  const c = useCommunity(),
    checking = useChannelAccess((state) =>
      c.activeChannelId ? state.checks[c.activeChannelId] : undefined,
    );
  const alive = useRef(true),
    epoch = useRef(0),
    [revoked, setRevoked] = useState(false);
  useEffect(() => {
    alive.current = true;
    const invalidate = (event: Event) => {
      const ids = (event as CustomEvent<{ channelIds?: string[] }>).detail?.channelIds;
      if (ids && c.activeChannelId && !ids.includes(c.activeChannelId)) return;
      ++epoch.current;
      setRevoked(true);
    };
    window.addEventListener('rooms:channel-access-invalidated', invalidate);
    window.addEventListener('rooms:community-management-invalidated', invalidate);
    return () => {
      alive.current = false;
      ++epoch.current;
      window.removeEventListener('rooms:channel-access-invalidated', invalidate);
      window.removeEventListener('rooms:community-management-invalidated', invalidate);
    };
  }, [c.activeChannelId]);
  const capture = () => {
    const state = useCommunity.getState(),
      generation = epoch.current,
      bridge = window.rooms?.social;
    return {
      bridge,
      channelId: state.activeChannelId,
      sameAccount: () => {
        const now = useCommunity.getState();
        return (
          now.user?.id === state.user?.id &&
          now.serverUrl === state.serverUrl &&
          window.rooms?.social === bridge
        );
      },
      current: (channelId = state.activeChannelId) => {
        const now = useCommunity.getState();
        return (
          alive.current &&
          generation === epoch.current &&
          !fixtureOnly() &&
          now.status === 'connected' &&
          state.status === 'connected' &&
          now.user?.id === state.user?.id &&
          now.serverUrl === state.serverUrl &&
          now.activeChannelId === channelId &&
          window.rooms?.social === bridge &&
          !(channelId && useChannelAccess.getState().checks[channelId])
        );
      },
    };
  };
  return { capture, blocked: revoked || !!checking || c.status !== 'connected' };
}
function FileLink({ file }: { file: SocialAttachment }) {
  const url = fixtureOnly() ? undefined : safeFileUrl(file.url);
  return url ? (
    <a className="ss-file-link" href={url} target="_blank" rel="noreferrer">
      <Download size={17} />
      {t('İndir')}
    </a>
  ) : (
    <button
      disabled
      title={fixtureOnly() ? fixtureReason : t('Sunucu dosya bağlantısını sağlamadı')}
    >
      <Download size={17} />
      {t('İndir')}
    </button>
  );
}

const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** Stoat ids are ULIDs whose first ten characters are the creation time; other ids give no time. */
export function ulidTime(id?: string | null) {
  if (!id || !/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id)) return undefined;
  let ms = 0;
  for (const char of id.slice(0, 10)) ms = ms * 32 + CROCKFORD.indexOf(char);
  return ms;
}
/** Newest first; ULIDs sort as strings, numeric ids by length first. */
const newestFirst = (a: SocialChannel, b: SocialChannel) => {
  const x = a.lastMessageId ?? '',
    y = b.lastMessageId ?? '';
  return y.length - x.length || (y > x ? 1 : y < x ? -1 : 0);
};
const listTime = (ms: number) => {
  const date = new Date(ms);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString(locale, { day: 'numeric', month: 'short' });
};
const previewOf = (message: SocialMessage, own: boolean) => {
  const text =
    message.content.trim().split('\n')[0] ||
    (message.attachments?.length ? t('Dosya: {name}', { name: message.attachments[0]!.name }) : '');
  return own && text ? t('Sen: {text}', { text }) : text;
};
/**
 * Conversations with avatar, the last message (from the local conversation cache, no network
 * request), its time and the unread mark. Rows open the conversation in place.
 */
export function DirectMessageList({ onOpen }: { onOpen(channelId: string): void }) {
  const c = useCommunity(),
    navigate = useNavigate();
  const [cached, setCached] = useState<{ key: string; last: Record<string, SocialMessage> }>({
    key: '',
    last: {},
  });
  /* Only conversations with another person open from here (saved notes have no peer). */
  const dms = useMemo(
    () =>
      c.dms.filter((dm) => dm.recipients?.some((user) => user.id !== c.user?.id)).sort(newestFirst),
    [c.dms, c.user?.id],
  );
  const key = `${c.serverUrl}:${c.user?.id ?? ''}:${dms.map((dm) => `${dm.id}=${dm.lastMessageId ?? ''}`).join(',')}`;
  useEffect(() => {
    const bridge = window.rooms?.social;
    if (fixtureOnly() || !bridge?.cachedMessages || !c.user) return;
    const owner = { user: c.user.id, server: c.serverUrl };
    let active = true;
    void Promise.all(
      dms.map((dm) =>
        bridge
          .cachedMessages(dm.id)
          .then((messages) => [dm.id, messages.at(-1)] as const)
          .catch(() => [dm.id, undefined] as const),
      ),
    ).then((entries) => {
      const now = useCommunity.getState();
      if (!active || now.user?.id !== owner.user || now.serverUrl !== owner.server) return;
      const last: Record<string, SocialMessage> = {};
      for (const [id, message] of entries) if (message) last[id] = message;
      setCached({ key, last });
    });
    return () => {
      active = false;
    };
  }, [key]);
  if (!dms.length)
    return (
      <EmptyState
        icon={<MessageCircle size={36} />}
        title={t('Henüz özel konuşma yok')}
        action={
          <button
            className="button primary"
            onClick={() => navigate(preserveReferenceFixtureRoute('/friends'))}
          >
            {t('Arkadaşlarını aç')}
          </button>
        }
      >
        {t('Bir arkadaşının yanındaki mesaj simgesiyle konuşma başlat.')}
      </EmptyState>
    );
  return (
    <nav className="ss-dm-list" aria-label={t('Özel mesajlar')}>
      <h1>{t('Özel mesajlar')}</h1>
      <ul>
        {dms.map((dm) => {
          const peer = dm.recipients?.find((user) => user.id !== c.user?.id),
            name = peer ? nameOf(peer) : dm.name || t('Özel mesaj'),
            loaded = c.messages.filter((message) => message.channelId === dm.id).at(-1),
            candidate = loaded ?? (cached.key === key ? cached.last[dm.id] : undefined),
            last =
              candidate && (!dm.lastMessageId || candidate.id === dm.lastMessageId)
                ? candidate
                : undefined,
            unread = !!c.unread[dm.id],
            time = last ? Date.parse(last.timestamp) : ulidTime(dm.lastMessageId),
            preview = last
              ? previewOf(last, last.author.id === c.user?.id)
              : dm.lastMessageId
                ? unread
                  ? t('Yeni mesaj')
                  : ''
                : t('Henüz mesaj yok');
          return (
            <li key={dm.id}>
              <button
                className={`ss-dm-row ${unread ? 'unread' : ''}`}
                aria-current={c.activeChannelId === dm.id ? 'true' : undefined}
                onClick={() => onOpen(dm.id)}
              >
                <span className="ss-dm-row-avatar">
                  {peer ? (
                    <VoiceAvatar id={peer.id} name={name} />
                  ) : (
                    <MessageCircle size={22} aria-hidden="true" />
                  )}
                  {peer && <i className={`ss-dm-presence ${c.presence[peer.id] ?? 'offline'}`} />}
                </span>
                <span className="ss-dm-row-text">
                  <strong>{name}</strong>
                  {preview && <small>{preview}</small>}
                </span>
                <span className="ss-dm-row-meta">
                  {time !== undefined && !Number.isNaN(time) && (
                    <time dateTime={new Date(time).toISOString()}>{listTime(time)}</time>
                  )}
                  {unread && (
                    <i className="ss-dm-unread" role="img" aria-label={t('Okunmamış mesaj var')} />
                  )}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
/** Settings › Bildirimler with this conversation preselected in the per-channel mute row. */
export const dmNotificationsRoute = (channelId: string) =>
  `/settings?tab=desktop&channel=${encodeURIComponent(channelId)}`;

export function DirectMessageSurface({ notify }: { notify(message: string): void }) {
  const c = useCommunity(),
    detail = useSocialDetailFixture('S12');
  const access = useChannelAccess((state) =>
    c.activeChannelId ? state.checks[c.activeChannelId] : undefined,
  );
  if (detail.loading || detail.error)
    return <FixtureOpening loading={detail.loading} error={detail.error} />;
  return (
    <DirectMessageScope
      key={`${detail.key}:${access ?? 'allowed'}`}
      notify={notify}
      fixture={detail.fixture}
    />
  );
}
function DirectMessageScope({
  notify,
  fixture,
}: {
  notify(message: string): void;
  fixture: SocialDetailFixture | null;
}) {
  const c = useCommunity(),
    navigate = useNavigate();
  const scope = useSocialOperationScope();
  const intent = fixture?.ui.surface === 'dm' ? fixture.ui : null;
  const dm = useDmCall();
  useRealtime();
  const callReason = fixtureOnly()
    ? fixtureReason
    : scope.blocked
      ? t('Kanal erişimi yeniden doğrulanmalı.')
      : !window.rooms?.dmCalls
        ? t('Özel arama için masaüstü uygulamasını aç.')
        : dmCallUnavailable();
  const call = async (mode: 'audio' | 'video') => {
    if (!channel || callReason) return;
    const request = scope.capture();
    try {
      await startDmCall(channel.id, mode);
      if (request.current()) navigate('/dm-call');
    } catch (e) {
      if (request.current()) setError(uiError(e));
    }
  };
  const channel = c.dms.find((item) => item.id === c.activeChannelId);
  const peer = channel?.recipients?.find((item) => item.id !== c.user?.id);
  const [relationship, setRelationship] = useState<SocialFriend['relationship'] | null>(
    intent?.relationship ?? null,
  );
  const [relationshipReady, setRelationshipReady] = useState(intent?.relationshipReady ?? false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [profile, setProfile] = useState(false),
    [search, setSearch] = useState(false),
    [inspectorVisible, setInspectorVisible] = useState(true);
  useEffect(() => {
    if (fixtureOnly()) return;
    let active = true;
    setRelationship(null);
    setRelationshipReady(false);
    setError('');
    const request = scope.capture();
    if (peer && c.user && !scope.blocked)
      void request.bridge
        ?.friends()
        .then((items) => {
          if (active && request.current()) {
            setRelationship(items.find((item) => item.user.id === peer.id)?.relationship ?? null);
            setRelationshipReady(true);
          }
        })
        .catch((e) => {
          if (active && request.current()) setError(uiError(e));
        });
    return () => {
      active = false;
    };
  }, [peer?.id, c.user?.id, c.serverUrl, scope.blocked]);
  const changeRelationship = async () => {
    if (!peer || !window.rooms || fixtureOnly() || scope.blocked || busy) return;
    const request = scope.capture();
    setBusy(true);
    setError('');
    try {
      if (relationship === 'blocked') await request.bridge!.unblockUser(peer.id);
      else
        await request.bridge!.addFriend(
          `${peer.username}${peer.discriminator ? '#' + peer.discriminator : ''}`,
        );
      if (!request.current()) return;
      const items = await request.bridge!.friends();
      if (request.current())
        setRelationship(items.find((item) => item.user.id === peer.id)?.relationship ?? null);
    } catch (e) {
      if (request.current()) setError(uiError(e));
    } finally {
      if (request.current()) setBusy(false);
    }
  };
  if (!channel || !peer)
    return (
      <div className="ss-dm-home">
        <DirectMessageList
          onOpen={(id) => void c.openChannel(id).catch((e) => notify(uiError(e)))}
        />
      </div>
    );
  const files = c.messages
    .filter((message) => message.channelId === channel.id)
    .flatMap((message) => (message.attachments ?? []).map((file) => ({ file, message })));
  const peerDetails = fixture?.profileDetails?.[peer.id];
  const inspectorFiles = fixture
    ? (peerDetails?.sharedFiles ?? [])
    : files.slice(-5).map(({ file }) => file);
  const relationshipRestricted = relationshipReady && relationship !== 'friend';
  return (
    <div
      className={`ss-dm ${relationship === 'blocked' ? 'blocked' : ''} ${relationshipRestricted ? 'relationship-restricted' : ''}`}
    >
      <section className="ss-dm-main">
        <header className="ss-header">
          <span className="ss-header-avatar" aria-hidden="true">
            <VoiceAvatar id={peer.id} name={nameOf(peer)} />
          </span>
          <button onClick={() => setProfile(true)}>{nameOf(peer)}</button>
          <span>{statusLabel(c.presence[peer.id])}</span>
          <div>
            <IconButton
              disabled={!!callReason || relationship === 'blocked' || dm.busy}
              label={callReason ?? t('Sesli arama başlat')}
              onClick={() => void call('audio')}
            >
              <Phone size={19} />
            </IconButton>
            <IconButton
              disabled={!!callReason || relationship === 'blocked' || dm.busy}
              label={callReason ?? t('Görüntülü arama başlat')}
              onClick={() => void call('video')}
            >
              <Video size={19} />
            </IconButton>
            <IconButton
              label={t('Bu konuşmanın bildirimleri')}
              onClick={() =>
                navigate(preserveReferenceFixtureRoute(dmNotificationsRoute(channel.id)))
              }
            >
              <Bell size={19} />
            </IconButton>
            <IconButton
              label={inspectorVisible ? t('Üye panelini kapat') : t('Üye panelini aç')}
              aria-pressed={inspectorVisible}
              onClick={() => setInspectorVisible((value) => !value)}
            >
              <Users size={19} />
            </IconButton>
            <IconButton label={t('Yüklenen konuşmada ara')} onClick={() => setSearch(true)}>
              <Search size={19} />
            </IconButton>
          </div>
        </header>
        <div className="ss-dm-intro">
          <VoiceAvatar id={peer.id} name={nameOf(peer)} />
          <div>
            <strong>{t('{name} ile özel konuşman', { name: nameOf(peer) })}</strong>
            <small>{t('Bu konuşmayı yalnızca siz görebilirsiniz.')}</small>
          </div>
        </div>
        <CommunityChat
          notify={notify}
          composerPlaceholder={
            fixture?.metadata.id === 'S12'
              ? t('{name}’ye mesaj yaz', { name: nameOf(peer) })
              : undefined
          }
        />
        {relationshipReady && relationship !== 'friend' && (
          <div className={`ss-relationship ${relationship === 'blocked' ? 'warning' : ''}`}>
            {relationship === 'blocked' ? (
              <ShieldAlert size={18} aria-hidden="true" />
            ) : (
              <Users size={18} aria-hidden="true" />
            )}
            <span>
              {relationship === 'blocked'
                ? t('{name}’yi engelledin. Mesaj göndermek için engeli kaldır.', {
                    name: nameOf(peer),
                  })
                : relationship === 'outgoing'
                  ? t('Arkadaşlık isteğin gönderildi.')
                  : relationship === 'incoming'
                    ? t('Bu kişiden arkadaşlık isteği var.')
                    : t('Henüz arkadaş değilsiniz.')}
            </span>
            <button
              className="button primary"
              disabled={
                busy ||
                scope.blocked ||
                !window.rooms ||
                fixtureOnly() ||
                relationship === 'outgoing'
              }
              title={
                fixtureOnly()
                  ? fixtureReason
                  : scope.blocked
                    ? t('Kanal erişimi yeniden doğrulanmalı.')
                    : undefined
              }
              onClick={() => void changeRelationship()}
            >
              {busy
                ? t('Bekleniyor…')
                : relationship === 'blocked'
                  ? t('Engeli kaldır')
                  : relationship === 'incoming'
                    ? t('İsteği kabul et')
                    : t('Arkadaş ekle')}
            </button>
          </div>
        )}
        {error && (
          <Notice kind="error" className="ss-dm-error">
            {error}
          </Notice>
        )}
      </section>
      {inspectorVisible && (
        <aside className="ss-dm-inspector">
          <div className="ss-inspector-heading">
            <h6>{t('PROFİL')}</h6>
            <IconButton label={t('Üye panelini kapat')} onClick={() => setInspectorVisible(false)}>
              <X size={17} />
            </IconButton>
          </div>
          <button className="ss-peer" onClick={() => setProfile(true)}>
            <VoiceAvatar id={peer.id} name={nameOf(peer)} large />
            <h2>{nameOf(peer)}</h2>
            {!fixture && <p>@{peer.username}</p>}
            {peerDetails?.statusText && <p className="ss-peer-status">{peerDetails.statusText}</p>}
          </button>
          {peerDetails?.mutualSpaces?.length ? (
            <>
              <h6>{t('ORTAK TOPLULUK')}</h6>
              {peerDetails.mutualSpaces.map((space) => (
                <button
                  className={`ss-mutual-space ${fixture ? 'reference-match' : ''}`}
                  key={space.id}
                  onClick={() => navigate(preserveReferenceFixtureRoute('/spaces'))}
                >
                  <Home size={17} />
                  <span>{space.name}</span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </>
          ) : null}
          <h6>{t('PAYLAŞILANLAR')}</h6>
          {inspectorFiles.length ? (
            inspectorFiles.slice(-5).map((file) => (
              <div className="ss-shared-row" key={file.id}>
                <FileText size={20} />
                <span>{file.name}</span>
                {!fixture && <FileLink file={file} />}
              </div>
            ))
          ) : (
            <p>{t('Yüklenen mesajlarda dosya yok.')}</p>
          )}
          {!fixture && (
            <button
              className="button secondary"
              onClick={() => navigate(preserveReferenceFixtureRoute('/files'))}
            >
              {t('Dosyaları aç')}
            </button>
          )}
        </aside>
      )}
      {profile && <UserProfileDialog user={peer} onClose={() => setProfile(false)} />}{' '}
      {search && <SocialSearchDialog onClose={() => setSearch(false)} />}
    </div>
  );
}

interface SocialSearchProps {
  onClose(): void;
  initialMode?: 'messages' | 'files' | 'quick';
  initialQuery?: string;
  onOpenMessage?: OpenMessage;
}
export function SocialSearchDialog(props: SocialSearchProps) {
  const c = useCommunity(),
    detail = useSocialDetailFixture('S13');
  const access = useChannelAccess((state) =>
    c.activeChannelId ? state.checks[c.activeChannelId] : undefined,
  );
  const intent = detail.fixture?.ui.surface === 'search' ? detail.fixture.ui : null;
  if (detail.loading || detail.error)
    return (
      <Modal title={t('Arama')} onClose={props.onClose}>
        <FixtureOpening loading={detail.loading} error={detail.error} />
      </Modal>
    );
  return (
    <SocialSearchScope
      key={`${detail.key}:${access ?? 'allowed'}`}
      {...props}
      fixture={detail.fixture}
      initialMode={intent?.initialMode ?? props.initialMode}
      initialQuery={intent?.initialQuery ?? props.initialQuery}
    />
  );
}
function SocialSearchScope({
  onClose,
  initialMode = 'messages',
  initialQuery = '',
  onOpenMessage,
  fixture,
}: SocialSearchProps & { fixture: SocialDetailFixture | null }) {
  const c = useCommunity(),
    navigate = useNavigate();
  const scope = useSocialOperationScope();
  const [query, setQuery] = useState(initialQuery),
    [mode, setMode] = useState(initialMode),
    [author, setAuthor] = useState(''),
    [selected, setSelected] = useState(0),
    [error, setError] = useState('');
  const channels = [...c.channels, ...c.dms];
  const channel = channels.find((item) => item.id === c.activeChannelId);
  const needle = query.trim().toLocaleLowerCase(locale);
  const matches = (scope.blocked ? [] : c.messages)
    .filter(
      (message) =>
        message.channelId === c.activeChannelId &&
        (!author || message.author.id === author) &&
        (mode === 'files'
          ? message.attachments?.some((file) =>
              file.name.toLocaleLowerCase(locale).includes(needle),
            )
          : message.content.toLocaleLowerCase(locale).includes(needle)),
    )
    .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  const quickFixture =
    import.meta.env.DEV && fixtureOnly() && fixture?.ui.surface === 'search'
      ? fixture.ui.quickDestinations
      : undefined;
  const destinations: SocialDetailQuickDestination[] = scope.blocked
    ? []
    : quickFixture
      ? quickFixture.filter(
          (item) =>
            (!item.channelId || channels.some((channel) => channel.id === item.channelId)) &&
            item.keywords.some((keyword) => keyword.toLocaleLowerCase(locale).includes(needle)),
        )
      : channels
          .filter((item) => item.name.toLocaleLowerCase(locale).includes(needle))
          .map((item) => ({
            id: item.id,
            label: item.name,
            kind: item.type === 2 ? 'voice' : 'text',
            channelId: item.id,
            keywords: [item.name],
          }));
  const people = [
    ...new Map(
      (scope.blocked ? [] : c.messages).map((message) => [message.author.id, message.author]),
    ).values(),
  ];
  useEffect(() => setSelected(0), [query, mode]);
  const open = async (id: string, messageId?: string) => {
    if (scope.blocked) return;
    if (fixtureOnly()) {
      const state = useCommunity.getState(),
        target = [...state.channels, ...state.dms].find((item) => item.id === id);
      if (
        !target ||
        (messageId &&
          !state.messages.some((message) => message.id === messageId && message.channelId === id))
      ) {
        setError(t('Yerel örnekte bu kanal veya mesaj bulunamadı.'));
        return;
      }
      useCommunity.setState({
        activeSpaceId: target.spaceId ?? null,
        activeChannelId: id,
        messages: state.messages.filter((message) => message.channelId === id),
        loadingMessages: false,
        hasOlder: false,
        error: null,
      });
      navigate(
        preserveReferenceFixtureRoute(
          `${target.type === 2 ? '/voice' : '/chat'}${messageId ? `?message=${encodeURIComponent(messageId)}` : ''}`,
        ),
      );
      onClose();
      return;
    }
    const request = scope.capture();
    setError('');
    try {
      if (messageId && onOpenMessage) {
        if (request.current()) onOpenMessage(id, messageId);
      } else {
        if (id !== c.activeChannelId) await c.openChannel(id);
        if (!request.current(id)) return;
        navigate(
          preserveReferenceFixtureRoute(
            `/chat${messageId ? `?message=${encodeURIComponent(messageId)}` : ''}`,
          ),
        );
      }
      if (request.current(id)) onClose();
    } catch (e) {
      if (request.current()) setError(uiError(e));
    }
  };
  const openDestination = (destination: SocialDetailQuickDestination) => {
    if (scope.blocked) return;
    if (destination.channelId) {
      void open(destination.channelId);
      return;
    }
    if (import.meta.env.DEV && quickFixture && destination.route === '/games') {
      navigate(preserveReferenceFixtureRoute('/games'));
      onClose();
    }
  };
  const highlight = (value: string) => {
    if (!needle) return value;
    const index = value.toLocaleLowerCase(locale).indexOf(needle);
    return index < 0 ? (
      value
    ) : (
      <>
        {value.slice(0, index)}
        <mark>{value.slice(index, index + needle.length)}</mark>
        {value.slice(index + needle.length)}
      </>
    );
  };
  return (
    <Modal
      title={
        mode === 'quick'
          ? t('Nereye gitmek istersin?')
          : t('{name} içinde ara', {
              name: c.spaces.find((item) => item.id === c.activeSpaceId)?.name ?? t('Konuşma'),
            })
      }
      className={`ss-modal ss-search ${mode === 'files' ? 'ss-search-files' : ''} ${mode === 'quick' ? 'ss-search-quick' : ''} ${mode !== 'quick' && !matches.length ? 'ss-search-no-results' : ''}`}
      onClose={onClose}
    >
      <div className="ss-modal-body">
        <div className="ss-search-input">
          <input
            aria-label={t('Arama')}
            placeholder={t('Mesaj, dosya veya kanal ara')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (mode !== 'quick' || !destinations.length) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected(
                  (index) =>
                    (index + (event.key === 'ArrowDown' ? 1 : -1) + destinations.length) %
                    destinations.length,
                );
              }
              if (event.key === 'Enter') {
                event.preventDefault();
                openDestination(destinations[selected] ?? destinations[0]);
              }
            }}
          />
          <Search size={20} />
        </div>
        {mode !== 'quick' && (
          <div className="ss-search-filters">
            <span>
              {fixture?.metadata.id === 'S13'
                ? t('Kanal: tümü')
                : channel
                  ? t('Kanal: {name}', { name: channel.name })
                  : t('Kanal: seçilmedi')}
            </span>
            <select
              aria-label={t('Kişi filtresi')}
              value={author}
              onChange={(event) => setAuthor(event.target.value)}
            >
              <option value="">{t('Kişi: herkes')}</option>
              {people.map((person) => (
                <option key={person.id} value={person.id}>
                  {nameOf(person)}
                </option>
              ))}
            </select>
            <select
              aria-label={t('Arama türü')}
              value={mode}
              onChange={(event) => setMode(event.target.value as typeof mode)}
            >
              <option value="messages">{t('Tür: mesaj')}</option>
              <option value="files">{t('Tür: dosya')}</option>
              <option value="quick">{t('Kanal geçişi')}</option>
            </select>
          </div>
        )}
        {mode !== 'quick' && !fixture && (
          <p className="ss-scope">
            {t('Bu kanalda yüklenen {count} mesaj içinde aranıyor.', { count: c.messages.length })}
          </p>
        )}
        <div className="ss-search-results">
          {mode === 'quick'
            ? destinations.map((item, index) => (
                <button
                  key={item.id}
                  className={`ss-destination ${index === selected ? 'selected' : ''}`}
                  disabled={scope.blocked}
                  onFocus={() => setSelected(index)}
                  onClick={() => openDestination(item)}
                >
                  {item.kind === 'voice' ? (
                    <Volume2 size={19} />
                  ) : item.kind === 'games' ? (
                    <Gamepad2 size={19} />
                  ) : (
                    <Hash size={19} />
                  )}
                  <span>
                    {item.label}
                    {item.memberCount !== undefined
                      ? ` · ${t('{count} kişi', { count: item.memberCount })}`
                      : ''}
                  </span>
                </button>
              ))
            : matches.map((message) =>
                mode === 'files' ? (
                  (message.attachments ?? [])
                    .filter((file) => file.name.toLocaleLowerCase(locale).includes(needle))
                    .map((file) => (
                      <div className="ss-search-file" key={`${message.id}-${file.id}`}>
                        <FileText size={26} />
                        <div>
                          <strong>{highlight(file.name)}</strong>
                          <small>
                            {channel?.name} · {nameOf(message.author)} · {dateOf(message.timestamp)}
                          </small>
                        </div>
                        <button
                          disabled={scope.blocked}
                          onClick={() => void open(message.channelId, message.id)}
                        >
                          {t('Bağlamı aç')}
                        </button>
                      </div>
                    ))
                ) : (
                  <article className="ss-search-result" key={message.id}>
                    <VoiceAvatar id={message.author.id} name={nameOf(message.author)} />
                    <div>
                      <strong>{nameOf(message.author)}</strong>
                      <small>
                        {channel?.name} · {dateOf(message.timestamp)}
                      </small>
                      <p>{highlight(message.content)}</p>
                      <button
                        disabled={scope.blocked}
                        onClick={() => void open(message.channelId, message.id)}
                      >
                        <ArrowRight size={14} />
                        {t('Mesaja git')}
                      </button>
                    </div>
                  </article>
                ),
              )}
          {!(mode === 'quick' ? destinations.length : matches.length) && (
            <div className="ss-empty">
              <Search size={38} />
              <h2>{t('Bir eşleşme bulamadık.')}</h2>
              <p>{t('Farklı bir kelime veya daha az filtre deneyebilirsin.')}</p>
            </div>
          )}
        </div>
        {mode === 'quick' && <p className="ss-scope">{t('↑ ↓ Seç · Enter Aç · Esc Kapat')}</p>}
        {error && (
          <p className="ss-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="ss-modal-footer">
        <button onClick={onClose}>{t('Kapat')}</button>
      </footer>
    </Modal>
  );
}

function ReferencePdfIcon() {
  return (
    <svg
      className="ss-pdf-icon"
      width="58"
      height="58"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="4.2"
      strokeLinecap="square"
      strokeLinejoin="miter"
      aria-hidden="true"
    >
      <path d="M15 6h23l12 12v40H15z" />
      <path d="M38 7v13h12M23 34h20M23 43h20M23 52h13" />
    </svg>
  );
}
function ReferenceBoardIcon() {
  return (
    <svg
      className="ss-board-icon"
      width="58"
      height="58"
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="4.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="8" y="7" width="48" height="35" rx="2" />
      <path d="M17 59l6-17m24 17l-6-17M17 57h30M18 31l8-8 7 6 12-12" />
    </svg>
  );
}
export function SharedFilesSurface(props: {
  notify(message: string): void;
  onOpenMessage?: OpenMessage;
}) {
  const c = useCommunity(),
    detail = useSocialDetailFixture('S14'),
    access = useChannelAccess((state) =>
      c.activeChannelId ? state.checks[c.activeChannelId] : undefined,
    );
  if (detail.loading || detail.error)
    return <FixtureOpening loading={detail.loading} error={detail.error} />;
  return (
    <SharedFilesScope
      key={`${detail.key}:${access ?? 'allowed'}`}
      {...props}
      fixture={detail.fixture}
    />
  );
}
function SharedFilesScope({
  notify,
  onOpenMessage,
  fixture,
}: {
  notify(message: string): void;
  onOpenMessage?: OpenMessage;
  fixture: SocialDetailFixture | null;
}) {
  const c = useCommunity(),
    navigate = useNavigate();
  const intent = fixture?.ui.surface === 'files' ? fixture.ui : null;
  const scope = useSocialOperationScope(),
    uploadLock = useRef(false);
  const [tab, setTab] = useState('all'),
    [preview, setPreview] = useState<SocialAttachment | null>(() => {
      const candidate = c.messages
        .filter((message) => message.channelId === c.activeChannelId)
        .flatMap((message) => message.attachments ?? [])
        .find((file) => file.id === intent?.initialPreviewId);
      return candidate && fixtureImageUrl(candidate, fixture) ? candidate : null;
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(
      intent?.initialUploadState === 'failed' ? (intent.initialError ?? '') : '',
    );
  useEffect(() => {
    const clear = () => {
      setPreview(null);
      setError('');
    };
    window.addEventListener('rooms:channel-access-invalidated', clear);
    return () => window.removeEventListener('rooms:channel-access-invalidated', clear);
  }, []);
  const files = useMemo(
    () =>
      (scope.blocked ? [] : c.messages.filter((message) => message.channelId === c.activeChannelId))
        .flatMap((message) => (message.attachments ?? []).map((file) => ({ file, message })))
        .sort((a, b) => Date.parse(b.message.timestamp) - Date.parse(a.message.timestamp))
        .filter(
          ({ file }) =>
            tab === 'all' ||
            (tab === 'images' ? file.mime.startsWith('image/') : !file.mime.startsWith('image/')),
        ),
    [c.messages, tab, scope.blocked, c.activeChannelId],
  );
  const upload = async () => {
    if (
      !window.rooms ||
      !c.activeChannelId ||
      !c.user ||
      uploadLock.current ||
      scope.blocked ||
      fixtureOnly()
    )
      return;
    const request = scope.capture();
    uploadLock.current = true;
    setBusy(true);
    setError('');
    try {
      const file = await request.bridge!.chooseAttachment(request.channelId!);
      if (!file) return;
      if (!request.current()) {
        if (request.sameAccount() && !fixtureOnly())
          await request.bridge!.discardAttachment(file.id).catch(() => {});
        return;
      }
      await c.send('', [file]);
    } catch (e) {
      if (request.current()) setError(uiError(e));
    } finally {
      uploadLock.current = false;
      if (request.current()) setBusy(false);
    }
  };
  const scopedAction = async (action: () => Promise<void>) => {
    if (fixtureOnly() || scope.blocked) return;
    const request = scope.capture();
    try {
      await action();
    } catch (e) {
      if (request.current()) setError(uiError(e));
    }
  };
  const openContext = (channelId: string, messageId: string) => {
    if (!fixtureOnly() && !scope.blocked && scope.capture().current())
      onOpenMessage?.(channelId, messageId);
  };
  const closePreview = useCallback(() => setPreview(null), []);
  const imageUrl = (file: SocialAttachment) =>
    !scope.blocked && file.mime.startsWith('image/')
      ? fixtureOnly()
        ? fixtureImageUrl(file, fixture)
        : safeFileUrl(file.url)
      : undefined;
  const previewUrl = preview ? imageUrl(preview) : undefined;
  return (
    <section className="ss-files">
      <header className="ss-files-heading">
        <div>
          <h1>
            {fixture?.metadata.id === 'S14'
              ? t('Birbirimize bıraktıklarımız')
              : t('Paylaşılan dosyalar')}
          </h1>
          <p>
            {fixture?.metadata.id === 'S14'
              ? t('{name}’da paylaşılan dosyalar.', {
                  name:
                    c.spaces.find((space) => space.id === c.activeSpaceId)?.name ?? t('Topluluk'),
                })
              : t('{name} · Yüklenen mesajlar', {
                  name:
                    c.channels.find((item) => item.id === c.activeChannelId)?.name ??
                    c.dms.find((item) => item.id === c.activeChannelId)?.name ??
                    t('Kanal seç'),
                })}
          </p>
        </div>
        <button
          className="button primary"
          disabled={
            busy || scope.blocked || !c.activeChannelId || !c.user || !window.rooms || fixtureOnly()
          }
          title={
            scope.blocked
              ? t('Kanal erişimi yeniden doğrulanmalı.')
              : fixtureOnly()
                ? fixtureReason
                : !c.activeChannelId
                  ? t('Dosya paylaşmak için bir metin kanalı seç')
                  : undefined
          }
          onClick={() => void upload()}
        >
          <Upload size={18} />
          {t('Dosya yükle')}
        </button>
      </header>
      {(busy || (intent?.initialUploadState === 'unavailable' && !scope.blocked)) && (
        <div className="ss-upload" role="status">
          <FileText size={26} />
          <div>
            <strong>{t('Dosya yükleniyor…')}</strong>
            <progress aria-label={t('Dosya yüklemesi')} />
          </div>
        </div>
      )}
      {error && (
        <div className="ss-upload ss-error" role="alert">
          <AlertCircle size={18} />
          <span>{error}</span>
          <button
            onClick={() => {
              setError('');
              if (!fixtureOnly())
                notify(
                  t(
                    'Başarısız mesajı sohbetten yeniden gönderebilirsin; yeni yükleme için dosyayı tekrar seç.',
                  ),
                );
            }}
          >
            {t('Kapat')}
          </button>
        </div>
      )}
      <RovingTabs
        className="ss-tabs"
        label={t('Dosya türü')}
        idPrefix="ss-files"
        active={tab}
        tabs={[
          ['all', t('Tümü')],
          ['images', t('Görseller')],
          ['documents', t('Belgeler')],
        ]}
        onSelect={setTab}
      />
      <div {...tabPanelProps('ss-files', tab)}>
        <div className="ss-file-grid">
          {files.map(({ file, message }) => {
            const image = imageUrl(file),
              boardReference =
                !!fixture && fixture.metadata.id === 'S14' && file.id === 'demo-sunday-plan-png';
            return (
              <article className="ss-file-tile" key={`${message.id}-${file.id}`}>
                <button
                  className={`ss-file-preview ${image ? 'image' : ''} ${boardReference ? 'board' : ''}`}
                  disabled={!image}
                  title={
                    !image
                      ? boardReference
                        ? t('Örnek PNG içeriği sağlanmadı.')
                        : t('İzinli görsel önizleme kaynağı sağlanmadı')
                      : undefined
                  }
                  onClick={() => setPreview(file)}
                  aria-label={t('{name} önizle', { name: file.name })}
                >
                  {image ? (
                    <img src={image} alt={file.name} loading="lazy" />
                  ) : boardReference ? (
                    <ReferenceBoardIcon />
                  ) : file.mime === 'application/pdf' ? (
                    <ReferencePdfIcon />
                  ) : (
                    <FileText size={58} />
                  )}
                </button>
                <footer>
                  <h4>{file.name}</h4>
                  <p>
                    {nameOf(message.author)} ·{' '}
                    {fixture?.metadata.id === 'S14'
                      ? message.id === 'demo-detail-board-file'
                        ? t('Dün 19.15')
                        : t('Bugün 20.45')
                      : dateOf(message.timestamp)}{' '}
                    · {sizeOf(file.size)}
                  </p>
                  {boardReference ? (
                    <button
                      onClick={() => navigate(preserveReferenceFixtureRoute('/together?tab=board'))}
                      title={t(
                        'Uygulamadaki ortak Whiteboard alanını açar; örnek PNG içeriği dahil değildir.',
                      )}
                    >
                      <ArrowRight size={17} />
                      {t('Tahtayı aç')}
                    </button>
                  ) : message.delivery === 'failed' ? (
                    <button
                      disabled={fixtureOnly()}
                      title={fixtureOnly() ? fixtureReason : undefined}
                      onClick={() => void scopedAction(() => c.retryMessage(message.id))}
                    >
                      {t('Gönderimi yeniden dene')}
                    </button>
                  ) : message.delivery === 'pending' ? (
                    <span role="status">{t('Gönderiliyor…')}</span>
                  ) : image ? (
                    <button onClick={() => setPreview(file)}>
                      <Image size={17} />
                      {t('Önizle')}
                    </button>
                  ) : (
                    <FileLink file={file} />
                  )}{' '}
                  {onOpenMessage && !fixture && (
                    <button
                      disabled={fixtureOnly() || scope.blocked}
                      title={
                        fixtureOnly()
                          ? fixtureReason
                          : scope.blocked
                            ? t('Kanal erişimi yeniden doğrulanmalı.')
                            : undefined
                      }
                      onClick={() => openContext(message.channelId, message.id)}
                    >
                      {t('Bağlamı aç')}
                    </button>
                  )}
                </footer>
              </article>
            );
          })}
        </div>
        {!files.length && (
          <EmptyState icon={<FileText size={42} />} title={t('Dosya yok')}>
            {t('Seçili kanalda yüklenen mesajlarda bu türde dosya bulunamadı.')}
          </EmptyState>
        )}
      </div>
      {c.hasOlder && (
        <button
          className="button secondary"
          disabled={c.loadingMessages || scope.blocked || fixtureOnly()}
          title={fixtureOnly() ? fixtureReason : undefined}
          onClick={() => void scopedAction(() => c.loadOlder())}
        >
          {t('Önceki mesajların dosyalarını yükle')}
        </button>
      )}
      {preview && previewUrl && (
        <Modal title={preview.name} className="ss-modal ss-preview" onClose={closePreview}>
          <div className="ss-modal-body">
            <img src={previewUrl} alt={preview.name} />
            <p>
              {preview.name} · {sizeOf(preview.size)}
            </p>
          </div>
          <footer className="ss-modal-footer">
            <FileLink file={preview} />
          </footer>
        </Modal>
      )}
    </section>
  );
}

/**
 * Like Discord, a friend's profile ends with a one-line message box. Enter sends it in your direct
 * message with them and opens that conversation; nothing is sent to whichever channel is open.
 */
function ProfileQuickMessage({ person, onSent }: { person: SocialUser; onSent(): void }) {
  const c = useCommunity(),
    navigate = useNavigate(),
    list = useFriendList();
  const [text, setText] = useState(''),
    [sending, setSending] = useState(false),
    [error, setError] = useState('');
  if (!window.rooms?.social) return null;
  if (list.friends.find((friend) => friend.user.id === person.id)?.relationship !== 'friend')
    return null;
  const content = text.trim();
  const send = async () => {
    if (!content || sending) return;
    if (content.length > MESSAGE_MAX) {
      setError(
        t('Mesaj en fazla {max} karakter olabilir; bu {count} karakter.', {
          max: MESSAGE_MAX,
          count: content.length,
        }),
      );
      return;
    }
    const social = window.rooms?.social;
    if (!social) return;
    const account = c.user?.id,
      server = c.serverUrl;
    const sameAccount = () =>
      useCommunity.getState().user?.id === account && useCommunity.getState().serverUrl === server;
    setSending(true);
    setError('');
    try {
      // Opening the DM first would switch the open channel, which closes this profile; the message
      // goes to the DM channel itself and the conversation opens once it is delivered.
      const channel = await social.createDM(person.id);
      if (!sameAccount()) return;
      if (!channel.recipients?.some((user) => user.id === person.id))
        throw new Error(t('Özel mesaj açılamadı. Yeniden dene.'));
      await social.send(channel.id, content);
      if (!sameAccount()) return;
      setText('');
      onSent();
      navigate('/chat');
      await c.createDM(person.id);
    } catch (failure) {
      setError(uiError(failure));
    } finally {
      setSending(false);
    }
  };
  const name = nameOf(person);
  return (
    <form
      className="ss-profile-message"
      onSubmit={(event) => {
        event.preventDefault();
        void send();
      }}
    >
      <input
        aria-label={t('{name} için mesaj yaz', { name })}
        placeholder={t('{name} için mesaj yaz', { name })}
        value={text}
        maxLength={MESSAGE_MAX}
        disabled={sending}
        onChange={(event) => setText(event.target.value)}
      />
      <IconButton type="submit" label={t('Mesajı gönder')} disabled={!content || sending}>
        <ArrowRight size={16} />
      </IconButton>
      {error && <Notice kind="error">{error}</Notice>}
    </form>
  );
}
interface UserProfileProps {
  user?: SocialUser;
  onClose(): void;
  initialView?: 'profile' | 'expanded' | 'status' | 'invisible';
}
export function UserProfileDialog(props: UserProfileProps) {
  const c = useCommunity(),
    detail = useSocialDetailFixture('S15');
  const access = useChannelAccess((state) =>
    c.activeChannelId ? state.checks[c.activeChannelId] : undefined,
  );
  const accountScope = `${c.user?.id ?? ''}:${c.serverUrl}:${c.activeChannelId ?? ''}:${props.user?.id ?? ''}:${access ?? 'allowed'}:${c.status}`;
  const mountedScope = useRef(accountScope);
  const changed = mountedScope.current !== accountScope;
  useEffect(() => {
    if (changed) props.onClose();
  }, [changed, props.onClose]);
  if (changed) return null;
  if (detail.loading || detail.error)
    return (
      <Modal title={t('Profil')} onClose={props.onClose}>
        <FixtureOpening loading={detail.loading} error={detail.error} />
      </Modal>
    );
  const intent =
    detail.fixture?.ui.surface === 'profile' &&
    detail.fixture.ui.userId === (props.user ?? c.user)?.id
      ? detail.fixture.ui
      : null;
  return (
    <UserProfileScope
      key={`${accountScope}:${detail.key}`}
      {...props}
      initialView={intent?.initialView ?? props.initialView}
      fixtureMode={!!detail.fixture}
      fixtureDetails={detail.fixture?.profileDetails?.[(props.user ?? c.user)?.id ?? '']}
    />
  );
}
function UserProfileScope({
  user,
  onClose,
  initialView = 'profile',
  fixtureMode = false,
  fixtureDetails,
}: UserProfileProps & {
  fixtureMode?: boolean;
  fixtureDetails?: { statusText?: string; about?: string };
}) {
  const c = useCommunity(),
    navigate = useNavigate();
  const scope = useSocialOperationScope();
  const person = user ?? c.user,
    own = person?.id === c.user?.id;
  const [view, setView] = useState(initialView),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [stored, setStored] = useState<{ bio: string; statusText: string } | null>(null);
  /* Only the own profile has a read API; other people show what presence already provides. */
  useEffect(() => {
    if (!own || fixtureMode || fixtureOnly() || scope.blocked) return;
    const request = scope.capture();
    let active = true;
    void request.bridge
      ?.ownProfile?.()
      .then((profile) => {
        if (active && request.sameAccount())
          setStored({ bio: profile.bio.trim(), statusText: profile.statusText.trim() });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [own, fixtureMode, scope.blocked]);
  const about = fixtureDetails?.about ?? stored?.bio,
    statusText = fixtureDetails?.statusText ?? stored?.statusText;
  if (scope.blocked)
    return (
      <Modal title={t('Profil')} className="ss-modal ss-profile" onClose={onClose}>
        <div className="ss-modal-body">
          <p role="status">{t('Hesap ve kanal erişimi yeniden doğrulanmalı.')}</p>
        </div>
      </Modal>
    );
  if (!person)
    return (
      <Modal title={t('Profil')} className="ss-modal ss-profile" onClose={onClose}>
        <div className="ss-modal-body">
          <p>{t('Profil için giriş yap.')}</p>
        </div>
      </Modal>
    );
  const status = c.presence[person.id];
  const setStatus = async (next: 'online' | 'dnd' | 'invisible' | 'idle') => {
    if (fixtureOnly() || scope.blocked || busy || !own) return;
    const request = scope.capture();
    setBusy(true);
    setError('');
    try {
      await c.setPresence(next);
      if (!request.current()) return;
      useCommunity.setState((state) => ({ presence: { ...state.presence, [person.id]: next } }));
      setView(next === 'invisible' ? 'invisible' : 'profile');
    } catch (e) {
      if (request.current()) setError(uiError(e));
    } finally {
      if (request.current()) setBusy(false);
    }
  };
  const title =
    view === 'status'
      ? t('Durumunu seç')
      : view === 'invisible' && own && status === 'invisible'
        ? t('Görünmezsin')
        : t('{name} profili', { name: nameOf(person) });
  const statusOptions: Array<[string, string, string]> = [
    ['online', t('Çevrimiçi'), ''],
    ['idle', t('Uzakta'), ''],
    ['dnd', t('Rahatsız etmeyin'), t('Durumunu diğer üyelere bildir')],
    ['invisible', t('Görünmez'), t('Başkalarına çevrimdışı görün')],
  ];
  return (
    <Modal
      title={title}
      className={`ss-modal ss-profile ${view === 'profile' || view === 'expanded' ? 'with-banner' : ''}`}
      onClose={onClose}
    >
      <div className="ss-modal-body">
        {view === 'status' && own ? (
          <div className="ss-status-options">
            {statusOptions
              .filter(([key]) => !fixtureMode || key !== 'idle')
              .map(([key, label, help]) => (
                <button
                  key={key}
                  aria-pressed={status === key}
                  disabled={busy || scope.blocked || !window.rooms || fixtureOnly()}
                  title={
                    fixtureOnly()
                      ? fixtureReason
                      : scope.blocked
                        ? t('Kanal erişimi yeniden doğrulanmalı.')
                        : undefined
                  }
                  onClick={() => void setStatus(key as 'online' | 'idle' | 'dnd' | 'invisible')}
                >
                  <i className={key} />
                  <span>
                    <strong>{label}</strong>
                    {help && <small>{help}</small>}
                  </span>
                </button>
              ))}
          </div>
        ) : view === 'invisible' && own && status === 'invisible' ? (
          <>
            <div className="ss-invisible">
              <Eye size={18} />
              {t('Senin durumun: Görünmez')}
            </div>
            <div className="ss-offline-preview">
              <h6>{t('DİĞER ÜYELERİN GÖRDÜĞÜ')}</h6>
              <div>
                <VoiceAvatar id={person.id} name={nameOf(person)} />
                <span>
                  <strong>{nameOf(person)}</strong>
                  <small>{t('Çevrimdışı')}</small>
                </span>
              </div>
            </div>
            <p className="ss-scope">{t('Görünmez olduğunu yalnızca sen görürsün.')}</p>
          </>
        ) : (
          <>
            <div className="ss-profile-banner" />
            <div className="ss-profile-avatar">
              <VoiceAvatar id={person.id} name={nameOf(person)} large />
              <i className={status} />
            </div>
            <div className="ss-profile-name">
              <div>
                <h2>{nameOf(person)}</h2>
                <p>
                  {person.username} · {statusLabel(status)}
                </p>
              </div>
              {own && <span>{t('SEN')}</span>}
            </div>
            {statusText && <p className="ss-profile-status">{statusText}</p>}
            {own && c.spaces.length > 0 && (
              <>
                <h6>{t('BİRLİKTE OLDUĞUN YER')}</h6>
                {c.spaces.map((space) => (
                  <div className="ss-membership" key={space.id}>
                    <Home size={22} />
                    <span>{space.name}</span>
                    <small>{space.ownerId === person.id ? t('Sahip') : t('Üye')}</small>
                  </div>
                ))}
              </>
            )}
            {about && (
              <div className="ss-about">
                <h6>{t('HAKKINDA')}</h6>
                <p>{about}</p>
              </div>
            )}
            {!own && !fixtureMode && <ProfileQuickMessage person={person} onSent={onClose} />}
          </>
        )}
        {error && <Notice kind="error">{error}</Notice>}
      </div>
      <footer className="ss-modal-footer">
        {!own && !fixtureMode && <FriendRequestButton key={person.id} user={person} />}{' '}
        {own && view !== 'status' ? (
          <>
            <button className="button secondary" onClick={() => setView('status')}>
              {t('Durum değiştir')}
            </button>
            <button
              className="button primary"
              onClick={() => {
                onClose();
                navigate(preserveReferenceFixtureRoute('/settings?tab=profile'));
              }}
            >
              {t('Profili düzenle')}
            </button>
          </>
        ) : (
          <button className="button secondary" onClick={onClose}>
            {t('Kapat')}
          </button>
        )}
      </footer>
    </Modal>
  );
}
