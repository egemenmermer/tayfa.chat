import { foldSearch } from './shell-commands';
import { HostOperations } from './HostOperations';
import { HallKeySettings } from './cinema/CinemaViewerSettings';
import { setWindowOnTop, useWindowOnTop } from './window-on-top';
import { mediaProvider } from './runtime-sources';
import { NoiseComparison } from './NoiseComparison';
import { createNoiseSuppressionNode, selectedInputLabel } from '@rooms/media';
import { locale, t, tr, uiError } from './i18n';
import { chooseCroppedAvatar } from './AvatarCrop';
import type { DesktopBridge } from '@rooms/contracts';
import { ChannelNotifications } from './ChannelNotifications';
import { DesktopWindowSettings } from './DesktopWindowSettings';
import { DesktopUpdates } from './Updates';
import { ChannelPermissionsSurface } from './ChannelPermissionsSurface';
import { CommunityManagementEntry } from './CommunityManagementEntry';
import { About, platformName } from './About';
import { queryClient } from './query-client';
import { LanguageSetting, TimeFormatSetting } from './LanguageSetting';
import { ServerProfile } from './ServerProfile';
import { CinemaSettings } from './cinema/CinemaSettings';
import { SettingsConnection } from './SettingsConnection';
import { AssistantManagement } from './AssistantManagement';
import { VoiceAvatar } from './VoiceAvatar';
import { PersonalSoundSettings } from './PersonalSoundSettings';
import { InputSensitivity, type InputMeterSource } from './InputSensitivity';
import {
  createMicGateNode,
  type MicGateNode,
} from '../../../packages/media-providers/src/mic-gate-node';
import { createMicLeveler } from '../../../packages/media-providers/src/mic-leveler';
import type { MicGateReport } from '../../../packages/media-providers/src/mic-gate';
import './reference-settings.css';
import { AgentReferenceSettingsContent, AgentSettings } from './Agent';
import { PersonalProviders } from './Providers';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Menu,
  ArrowLeft,
  Bookmark,
  Bot,
  Clapperboard,
  Clock3,
  Info,
  KeyRound,
  Sparkles,
  Users,
  Bell,
  Eye,
  LogOut,
  Sun,
  Video,
  VideoOff,
  ArrowDownToLine,
  ArrowRight,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  Fingerprint,
  Globe,
  Store,
  Keyboard,
  Link,
  Mic,
  Moon,
  Monitor,
  Palette,
  Play,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  Trash2,
  User,
  Volume2,
  X,
} from 'lucide-react';
import { Avatar, IconButton, Modal, Toggle } from '@rooms/design';
import { useRooms, withInputLevel } from './store';
import { PushToTalkKeyField } from './PushToTalkKeyField';
import { ShortcutKeyField } from './ShortcutKeyField';
import { useShortcutStatus } from './GlobalShortcuts';
import { formatPushToTalkKey, pushToTalkKey } from './push-to-talk-key';
import { ConnectionPane } from './ConnectionPane';
import { useModerationRights } from './VoiceModeration';
import { useCommunity } from './community';
import { useRealtime, setNoiseSuppression } from './realtime';
const tabs = [
  { id: 'profile', label: t('Hesap ve profil'), icon: User },
  { id: 'audio', label: t('Ses ve video'), icon: Mic },
  { id: 'appearance', label: t('Görünüm'), icon: Sun },
  { id: 'desktop', label: t('Bildirimler'), icon: Bell },
  { id: 'agent', label: t('Model bağlantılarım'), icon: KeyRound },
  { id: 'connections', label: t('Uygulama bağlantıları'), icon: Link },
  { id: 'room-memory', label: t('Oda hafızası'), icon: Bookmark },
  { id: 'schedules', label: t('Tek seferlik görevler'), icon: Clock3 },
  { id: 'services', label: t('Tayfa bağlantıları'), icon: Globe },
  { id: 'server-profile', label: t('Sunucu profili'), icon: Store },
  { id: 'cinema', label: t('Sinema'), icon: Clapperboard },
  { id: 'hostops', label: t('Sunucu makinesi'), icon: Monitor },
  { id: 'shortcuts', label: t('Klavye'), icon: Keyboard },
  { id: 'diagnostics', label: t('Tanılama'), icon: SlidersHorizontal },
  { id: 'community-management', label: t('Üyeler ve roller'), icon: Users },
  { id: 'channel-permissions', label: t('Kanal izinleri'), icon: ShieldCheck },
  { id: 'assistant-permissions', label: t('Asistan yetkileri'), icon: Bot },
  { id: 'automation', label: t('Otomasyon modu'), icon: Sparkles },
  { id: 'about', label: t('Güncelleme ve hakkında'), icon: Info },
];
const userTabIds = [
  'profile',
  'audio',
  'appearance',
  'desktop',
  'agent',
  'connections',
  'room-memory',
  'schedules',
  'services',
];
/**
 * What the settings search matches besides each tab's name: the rows on that tab, in their own
 * words (H07). Keep in step with the rows.
 */
const tabKeywords: Partial<Record<string, string[]>> = {
  profile: [t('Görünen ad'), t('Hakkında'), t('Fotoğraf'), t('Durum'), t('Şifre'), t('Çıkış yap')],
  audio: [
    t('Ses girişi'),
    t('Mikrofon seviyesi'),
    t('Ses çıkışı'),
    t('Oda giriş ve çıkış sesleri'),
    t('Mikrofon, sağırlaştırma ve yayın sesleri'),
    t('Kişisel giriş sesleri'),
    t('Efekt ses düzeyi'),
    t('Bas konuş'),
    t('Bas konuş tuşu'),
    t('Mikrofonu aç / kapat'),
    t('Sesi kapat'),
    t('Gürültü azaltma'),
    t('Ses seviyesini dengele'),
    t('Kamera'),
  ],
  appearance: [
    t('Dil / Language'),
    t('Saat biçimi'),
    t('Yoğunluk'),
    t('Metin boyutu'),
    t('Hareketi azalt'),
    t('Şeffaflığı azalt'),
    t('Vurgu'),
    t('Üye paneli'),
  ],
  desktop: [
    t('Masaüstü bildirimleri'),
    t('Özel mesajlar ve etiketlenmeler'),
    t('Bildirim sesleri'),
    t('Görüşmedeyken bildirimleri duraklat'),
    t('Oturum açınca başlat'),
    t('Pencereyi üstte tut'),
    t('Tam ekran'),
  ],
  shortcuts: [
    t('Ses kısayolları'),
    t('Mikrofonu aç / kapat'),
    t('Sesi kapat'),
    t('Bas konuş tuşu'),
    t('Uygulama kısayolları'),
  ],
  about: [t('Güncellemeleri denetle')],
};
/** The tab's name or the first row that matches a folded query; null when nothing does. */
export function settingsMatch(id: string, query: string): string | null {
  const wanted = foldSearch(query.trim());
  if (!wanted) return null;
  const entry = tabs.find((item) => item.id === id);
  if (entry && foldSearch(entry.label).includes(wanted)) return entry.label;
  return tabKeywords[id]?.find((keyword) => foldSearch(keyword).includes(wanted)) ?? null;
}
function Heading({ title }: { title: string }) {
  return (
    <div className="ref-settings-heading">
      <span>{t('KULLANICI AYARLARI')}</span>
      <h1>{title}</h1>
    </div>
  );
}
function ReferenceAccount({ notify, onClose }: { notify(message: string): void; onClose(): void }) {
  const c = useCommunity(),
    realtime = useRealtime();
  const [name, setName] = useState(c.user?.displayName ?? ''),
    [bio, setBio] = useState(''),
    [status, setStatus] = useState(''),
    [presence, setPresence] = useState<'online' | 'idle' | 'dnd' | 'invisible' | ''>(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(false),
    [logout, setLogout] = useState(false);
  // What the server holds, so the fields start from it, Vazgeç returns to it, and emptying a
  // field clears it on the server.
  const stored = useRef({ bio: '', statusText: '' });
  useEffect(() => {
    let active = true;
    // A new account must never start from the previous one's profile: if the read below fails,
    // saving an emptied field would otherwise clear a bio this account never had loaded.
    stored.current = { bio: '', statusText: '' };
    setName(c.user?.displayName ?? '');
    setBio('');
    setStatus('');
    setPresence('');
    void window.rooms?.social
      ?.ownProfile?.()
      .then((profile) => {
        if (!active) return;
        stored.current = { bio: profile.bio, statusText: profile.statusText };
        setBio(profile.bio);
        setStatus(profile.statusText);
        setPresence(profile.presence);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [c.user?.id]);
  const reset = () => {
    setName(c.user?.displayName ?? '');
    setBio(stored.current.bio);
    setStatus(stored.current.statusText);
    setSaved(false);
  };
  if (!c.user)
    return (
      <>
        <Heading title={t('Hesap ve profil')} />
        <ConnectionPane />
      </>
    );
  return (
    <>
      <Heading title={t('Hesap ve profil')} />
      {saved && (
        <div className="ref-settings-callout success" role="status">
          <Check size={17} />
          {t('Profil değişikliklerin sunucuda kaydedildi.')}
        </div>
      )}
      <div className="ref-profile-columns">
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setSaved(false);
            try {
              const nextBio = bio.trim(),
                nextStatus = status.trim();
              // Send only what changed; an emptied field is sent empty so the server clears it.
              const user = await window.rooms!.social.updateProfile({
                displayName: name.trim(),
                ...(nextBio !== stored.current.bio ? { bio: nextBio } : {}),
                ...(nextStatus !== stored.current.statusText ? { statusText: nextStatus } : {}),
              });
              stored.current = { bio: nextBio, statusText: nextStatus };
              useCommunity.setState({ user });
              setSaved(true);
            } catch (e) {
              setError(uiError(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="ref-settings-grid">
            <label className="field-label">
              {t('Görünen ad')}
              <input
                required
                maxLength={32}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <label className="field-label">
              {t('Kullanıcı adı')}
              <input readOnly value={c.user.username} />
            </label>
          </div>
          <label className="field-label">
            {t('Durum mesajı')}
            <input
              maxLength={128}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setSaved(false);
              }}
              placeholder={t('Yeni durum mesajı')}
            />
          </label>
          <label className="field-label">
            {t('Hakkında')}
            <textarea
              maxLength={2000}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder={t('Yeni profil açıklaması')}
            />
          </label>
          <Row
            title={t('Görünürlük')}
            description={
              presence === 'invisible'
                ? t('Diğer üyelere çevrimdışı görünüyorsun.')
                : t('Durumunu sunucuna bildir.')
            }
          >
            <select
              aria-label={t('Görünürlük')}
              value={presence}
              disabled={busy || !window.rooms}
              onChange={async (e) => {
                const next = e.target.value as 'online' | 'idle' | 'dnd' | 'invisible';
                setBusy(true);
                setError('');
                try {
                  await c.setPresence(next);
                  setPresence(next);
                } catch (e) {
                  setError(uiError(e));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <option value="" disabled>
                {t('Durum seç')}
              </option>
              <option value="online">{t('Çevrimiçi')}</option>
              <option value="idle">{t('Uzakta')}</option>
              <option value="dnd">{t('Rahatsız etmeyin')}</option>
              <option value="invisible">{t('Görünmez')}</option>
            </select>
          </Row>
          {presence === 'invisible' && (
            <div className="ref-settings-callout">
              <Eye size={16} />
              {t('Görünmezlik yalnızca sana gösterilir.')}
            </div>
          )}
          {error && (
            <div className="ref-settings-callout error" role="alert">
              {error}
            </div>
          )}
          <div className="button-row">
            <button className="button primary" disabled={busy || !name.trim() || !window.rooms}>
              {busy ? t('Kaydediliyor…') : t('Değişiklikleri kaydet')}
            </button>
            <button type="button" className="button secondary" disabled={busy} onClick={reset}>
              {t('Vazgeç')}
            </button>
          </div>
        </form>
        <aside>
          <span className="ref-preview-label">{t('PROFİL ÖNİZLEMESİ')}</span>
          <div className="ref-profile-preview">
            <div className="ref-profile-banner" />
            <div className="ref-profile-body">
              <div className="ref-profile-avatar">
                <VoiceAvatar id={c.user.id} name={name || c.user.displayName} large />
                <button
                  className="text-button"
                  disabled={busy || !window.rooms}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    try {
                      const user = await chooseCroppedAvatar();
                      if (user) {
                        useCommunity.setState({ user });
                        notify(t('Avatar sunucuda güncellendi.'));
                      }
                    } catch (e) {
                      setError(uiError(e));
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  {t('Avatarı değiştir')}
                </button>
              </div>
              <h2>{name || c.user.displayName}</h2>
              <small>@{c.user.username}</small>
              {status && <p>{status}</p>}
              <div className="ref-settings-divider" />
              <div className="ref-settings-inline">
                <User size={14} />
                {presence === 'invisible'
                  ? t('Görünmez · yalnızca sen görürsün')
                  : presence === 'online'
                    ? t('Çevrimiçi')
                    : presence === 'idle'
                      ? t('Uzakta')
                      : presence === 'dnd'
                        ? t('Rahatsız etmeyin')
                        : t('Görünürlük durumu alınamadı')}
              </div>
            </div>
          </div>
        </aside>
      </div>
      <div className="ref-settings-bottom">
        <span>
          {t('Bu cihaz · {platform}', {
            platform: window.rooms ? platformName(window.rooms.platform) : t('Tarayıcı'),
          })}
        </span>
        <button className="text-button" onClick={() => setLogout(true)}>
          <LogOut size={16} />
          {t('Oturumu kapat')}
        </button>
      </div>
      {logout && (
        <Modal
          title={t('Tayfa’dan çıkış yap?')}
          className="ref-settings-confirm"
          onClose={() => {
            if (!busy) setLogout(false);
          }}
        >
          <p>
            {t('Bu cihazdaki oturumun kapanacak.')}
            {realtime.status === 'connected'
              ? ` ${t('{roomName} ses görüşmesinden ayrılacaksın.', { roomName: realtime.roomName ?? '' })}`
              : ''}
          </p>
          <div className="ref-settings-inline">
            <Avatar name={c.user.displayName} />
            <strong>{c.user.displayName}</strong>
          </div>
          <div className="button-row">
            <button className="button secondary" disabled={busy} onClick={() => setLogout(false)}>
              {t('Vazgeç')}
            </button>
            <button
              className="button danger"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await c.logout();
                  onClose();
                } catch (e) {
                  setError(uiError(e));
                  setLogout(false);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <LogOut size={16} />
              {t('Çıkış yap')}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
/** The connection states in words, as the sign-in pane shows them. */
/**
 * Focus the open category without letting the browser re-center the list: the first group
 * stays at the top unless the selected item would be hidden, then it scrolls just into view.
 */
function focusSelectedCategory(nav: HTMLElement | null) {
  const selected = nav?.querySelector<HTMLButtonElement>('button.selected');
  if (!selected) return;
  selected.focus({ preventScroll: true });
  const list = selected.closest<HTMLElement>('.ref-settings-nav-scroll');
  if (!list) return;
  const bottom =
    selected.getBoundingClientRect().bottom - list.getBoundingClientRect().top + list.scrollTop;
  if (bottom <= list.clientHeight) list.scrollTop = 0;
  else selected.scrollIntoView({ block: 'nearest' });
}
function connectionLabel(status: string) {
  return status === 'connected'
    ? tr('Connected')
    : status === 'reconnecting'
      ? tr('Reconnecting…')
      : status === 'connecting'
        ? tr('Connecting…')
        : status === 'not-configured'
          ? tr('Not configured')
          : tr('Disconnected');
}
function Row({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-row">
      <div>
        <h4>{title}</h4>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}
type CommunityRights = Awaited<
  ReturnType<NonNullable<NonNullable<Window['rooms']>['social']['communityCapabilities']>>
>;
/**
 * This account's rights in the active community, read through the same cache as
 * useModerationRights. Null while unknown, offline or signed out, so admin tabs stay hidden.
 */
function useCommunityRights(
  spaceId: string | null,
  userId: string | undefined,
  serverUrl: string | undefined,
): CommunityRights | null {
  const key = JSON.stringify([serverUrl, userId, spaceId]);
  const [rights, setRights] = useState<{ key: string; value: CommunityRights } | null>(null),
    [epoch, setEpoch] = useState(0);
  useEffect(() => {
    const read = window.rooms?.social?.communityCapabilities;
    if (!spaceId || !userId || !read) return;
    let active = true;
    void queryClient
      .fetchQuery({
        queryKey: ['community-capabilities', key],
        staleTime: 60_000,
        queryFn: () => read(spaceId),
      })
      .then((value) => {
        if (active) setRights({ key, value });
      })
      .catch(() => {
        /* Unknown rights hide the admin tabs; the server still checks every action. */
      });
    return () => {
      active = false;
    };
  }, [key, spaceId, userId, epoch]);
  useEffect(() => {
    // Role changes arrive as channel access invalidations; rights are read again after them.
    const forget = () => {
      queryClient.removeQueries({ queryKey: ['community-capabilities', key] });
      setEpoch((n) => n + 1);
    };
    window.addEventListener('rooms:channel-access-invalidated', forget);
    return () => window.removeEventListener('rooms:channel-access-invalidated', forget);
  }, [key]);
  return rights?.key === key ? rights.value : null;
}
/**
 * Community tabs a member sees in the nav. Each surface still checks rights itself, and deep links
 * from other screens (assistant history, channel menu) keep opening them.
 */
export function communityTabs(
  rights: CommunityRights | null,
  ownerOrAdmin: boolean,
  hostAccess: boolean,
) {
  const admin = ownerOrAdmin || !!rights?.communityAdmin;
  return [
    ...(admin || rights?.manageServer ? ['server-profile'] : []),
    ...(admin ? ['cinema'] : []),
    ...(admin ||
    rights?.manageRoles ||
    rights?.assignRoles ||
    rights?.kickMembers ||
    rights?.banMembers
      ? ['community-management']
      : []),
    ...(admin || rights?.manageChannels || rights?.managePermissions
      ? ['channel-permissions']
      : []),
    // The assistant service lets only community admins manage grants and automation.
    ...(admin ? ['assistant-permissions', 'automation'] : []),
    // The machine behind the server is for the owner, admins and delegated operators.
    ...(admin || hostAccess ? ['hostops'] : []),
  ];
}
export default function Settings({
  notify,
  onClose,
  onInvite,
}: {
  notify(message: string): void;
  onClose(): void;
  onInvite?(): void;
}) {
  const community = useCommunity();
  const rights = useCommunityRights(
    community.activeSpaceId,
    community.user?.id,
    community.serverUrl,
  );
  const owner =
    !!community.user?.id &&
    community.spaces.find((space) => space.id === community.activeSpaceId)?.ownerId ===
      community.user.id;
  const communityAdmin = useModerationRights(community.activeSpaceId).communityAdmin || owner;
  // A member the owner delegated monitor/terminal access to is not an admin, but the host list
  // answers only for hosts they may use, so a non-empty list is what shows them the tab.
  const [delegatedHosts, setDelegatedHosts] = useState(false);
  useEffect(() => {
    let active = true;
    setDelegatedHosts(false);
    if (communityAdmin || !community.user?.id) return;
    void window.rooms?.hostOps
      ?.hosts?.()
      .then((hosts) => {
        if (active) setDelegatedHosts(hosts.length > 0);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [communityAdmin, community.user?.id, community.serverUrl]);
  const realtime = useRealtime();
  const [params, setParams] = useSearchParams();
  const tab = tabs.some((entry) => entry.id === params.get('tab'))
    ? params.get('tab')!
    : 'appearance';
  const savedPreferences = useRooms((state) => state.preferences);
  const [p, setDraftPreferences] = useState(() => ({ ...savedPreferences }));
  const registered = useShortcutStatus((state) => state.status);
  const globalShortcutsAvailable = !!window.rooms?.globalShortcuts;
  // The system's answer describes the saved shortcuts, so a draft that differs shows none yet.
  const shortcutStatus = {
    mute: p.muteKey === savedPreferences.muteKey ? registered?.mute : null,
    deafen: p.deafenKey === savedPreferences.deafenKey ? registered?.deafen : null,
  };
  // Mute and deafen shortcuts, editable both under Voice and under Keyboard.
  const voiceShortcutRows = (
    <>
      <Row
        title={t('Mikrofonu aç / kapat')}
        description={
          globalShortcutsAvailable
            ? t('Başka bir uygulamadayken de çalışır.')
            : t('Sistem genelinde kısayollar yalnızca masaüstü uygulamasında çalışır.')
        }
      >
        <ShortcutKeyField
          label={t('Mikrofonu aç / kapat')}
          value={p.muteKey}
          onChange={(value) => setPreference('muteKey', value)}
          others={[p.deafenKey, ...(p.pushToTalk ? [p.pushToTalkKey] : [])]}
          status={shortcutStatus?.mute}
        />
      </Row>
      <Row
        title={t('Sesi kapat')}
        description={t('Hoparlörü kapatır ve açar; başka bir uygulamadayken de çalışır.')}
      >
        <ShortcutKeyField
          label={t('Sesi kapat')}
          value={p.deafenKey}
          onChange={(value) => setPreference('deafenKey', value)}
          others={[p.muteKey, ...(p.pushToTalk ? [p.pushToTalkKey] : [])]}
          status={shortcutStatus?.deafen}
        />
      </Row>
    </>
  );
  // What the draft started from. Other writers change the store while Settings is open
  // (the microphone keeps microphoneOn, the members panel keeps memberPanel); comparing with
  // this instead of the live store keeps their changes out of "unsaved" and out of Save.
  const baseline = useRef({ ...savedPreferences });
  const setPreference = <K extends keyof typeof p>(key: K, value: (typeof p)[K]) =>
    setDraftPreferences((current) => ({ ...current, [key]: value }));
  const changedKeys = (Object.keys(p) as (keyof typeof p)[]).filter(
    (key) => JSON.stringify(p[key]) !== JSON.stringify(baseline.current[key]),
  );
  const dirty = changedKeys.length > 0;
  const resetDraft = () => {
    baseline.current = { ...useRooms.getState().preferences };
    setDraftPreferences({ ...baseline.current });
  };
  const [saving, setSaving] = useState(false),
    [confirmDiscard, setConfirmDiscard] = useState(false);
  const approvedClose = useRef(false);
  useEffect(() => {
    resetDraft();
    setConfirmDiscard(false);
    approvedClose.current = false;
  }, [community.user?.id, community.serverUrl]);
  useEffect(() => {
    const request = (event: Event) => {
      if (dirty && !approvedClose.current) {
        event.preventDefault();
        setConfirmDiscard(true);
      }
    };
    window.addEventListener('rooms:settings-close-request', request);
    return () => window.removeEventListener('rooms:settings-close-request', request);
  }, [dirty]);
  const savePreferences = async () => {
    if (saving) return false;
    const accountId = community.user?.id,
      serverUrl = community.serverUrl;
    const before = { ...useRooms.getState().preferences };
    setSaving(true);
    setError('');
    try {
      if (realtime.status === 'connected') {
        await setNoiseSuppression(p.noiseSuppression, p.noiseSuppressionMode);
        await mediaProvider().deviceSelection(p.inputId, p.outputId);
        await mediaProvider().selectCamera?.(p.cameraId);
      }
      if (
        useCommunity.getState().user?.id !== accountId ||
        useCommunity.getState().serverUrl !== serverUrl
      )
        throw new Error(t('Oturum değişti. Ayarları yeniden aç.'));
      const next = { ...useRooms.getState().preferences };
      for (const key of changedKeys) Object.assign(next, { [key]: p[key] });
      useRooms.getState().setPreferences(next);
      baseline.current = { ...next };
      setDraftPreferences({ ...next });
      notify(t('Ayarlar kaydedildi.'));
      return true;
    } catch (failure) {
      try {
        useRooms.getState().setPreferences(before);
      } catch {
        /* Preserve the error when device storage is unavailable. */
      }
      setError(uiError(failure));
      if (realtime.status === 'connected') {
        await setNoiseSuppression(before.noiseSuppression, before.noiseSuppressionMode).catch(
          () => {},
        );
        await mediaProvider()
          .deviceSelection(before.inputId, before.outputId)
          .catch(() => {});
      }
    } finally {
      setSaving(false);
    }
    return false;
  };
  const [error, setError] = useState('');
  // Diagnostics show the running build, not a version typed into the source.
  const [appInfo, setAppInfo] = useState<{
    version: string;
    arch: string;
    electron: string;
  } | null>(null);
  useEffect(() => {
    let active = true;
    void window.rooms
      ?.applicationInfo?.()
      .then((value) => active && setAppInfo(value))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  const [narrowSettings, setNarrowSettings] = useState(
    () => window.matchMedia('(max-width: 959px)').matches,
  );
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [search, setSearch] = useState('');
  const navigationRef = useRef<HTMLElement | null>(null),
    navigationButton = useRef<HTMLButtonElement | null>(null);
  const closeNavigation = () => {
    setNavigationOpen(false);
    requestAnimationFrame(() => navigationButton.current?.focus());
  };
  useEffect(() => {
    const media = window.matchMedia('(max-width: 959px)');
    const update = () => {
      setNarrowSettings(media.matches);
      setNavigationOpen(false);
    };
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!navigationOpen) return;
    focusSelectedCategory(navigationRef.current);
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        setNavigationOpen(false);
        requestAnimationFrame(() => navigationButton.current?.focus());
      } else if (event.key === 'Tab') {
        const buttons = [
          ...(navigationRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
            []),
        ].filter((button) => button.getClientRects().length);
        const first = buttons[0],
          last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [navigationOpen]);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const micEpoch = useRef(0);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const timer = requestAnimationFrame(() =>
      focusSelectedCategory(
        document.querySelector<HTMLElement>('.settings-reference-surface .settings-tabs'),
      ),
    );
    return () => {
      cancelAnimationFrame(timer);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const cameraEpoch = useRef(0);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  // Named after the selected microphone, or the one the room hears when the list cannot tell.
  const inputName =
      selectedInputLabel(devices, p.inputId) ??
      (realtime.status === 'connected' ? (realtime.inputDevice ?? null) : null),
    inputLevel = (inputName ? p.inputLevels[inputName] : undefined) ?? 100;
  const inputPercent = useRef(100);
  inputPercent.current = inputLevel;
  useEffect(() => {
    if (testLevel.current) testLevel.current.gain.value = inputLevel / 100;
  }, [inputLevel]);
  useEffect(() => {
    testGate.current?.configure({ auto: p.inputSensitivityAuto, threshold: p.inputSensitivity });
  }, [p.inputSensitivityAuto, p.inputSensitivity]);
  const roomMeter = useCallback<InputMeterSource>(
    (listener) => mediaProvider().subscribeInputMeter?.(listener) ?? (() => {}),
    [],
  );
  const cameraId = p.cameraId;
  const [cameraStream, setCameraStream] = useState<MediaStream | null>(null);
  const cameraRef = useRef<MediaStream | null>(null);
  const cameraVideo = useRef<HTMLVideoElement | null>(null);
  const stopCamera = useCallback(() => {
    cameraEpoch.current++;
    cameraRef.current?.getTracks().forEach((track) => track.stop());
    cameraRef.current = null;
    setCameraStream(null);
  }, []);
  const toggleCamera = async () => {
    if (cameraRef.current) {
      stopCamera();
      return;
    }
    setError('');
    const epoch = ++cameraEpoch.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: cameraId ? { deviceId: { exact: cameraId } } : true,
      });
      if (!mounted.current || epoch !== cameraEpoch.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      cameraRef.current = stream;
      setCameraStream(stream);
      void refreshDevices();
      stream.getVideoTracks()[0]?.addEventListener('ended', () => {
        stopCamera();
        setError(t('Kamera bağlantısı kesildi. Cihaz listesini yenile.'));
      });
    } catch (e) {
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? t('Kamera izni kapalı. Sistem gizlilik ayarlarından Tayfa’ya kamera izni ver.')
          : t('Kamera kullanılamıyor. Cihaz listesini yenile ve başka bir kamera seç.'),
      );
    }
  };
  useEffect(() => {
    if (cameraVideo.current) cameraVideo.current.srcObject = cameraStream;
  }, [cameraStream]);
  const [micState, setMicState] = useState(tr('Not requested'));
  const onTop = useWindowOnTop();
  const [autoStart, setAutoStart] = useState(false);
  const [notifications, setNotifications] = useState<{
    enabled: boolean;
    important: boolean;
    sound: boolean;
    pauseDuringVoice: boolean;
    supported: boolean;
  } | null>(null);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [notificationFixture, setNotificationFixture] = useState<{
    notifications: DesktopBridge['notifications'];
    desktopWindow: DesktopBridge['desktopWindow'];
    variant: string;
  } | null>(null);
  const fixtureId = import.meta.env.DEV
    ? new URLSearchParams(location.search).get('fixture')
    : null;
  const notificationApi =
    notificationFixture?.notifications ?? (!fixtureId ? window.rooms?.notifications : undefined);
  useEffect(() => {
    if (fixtureId !== 'S67') return;
    let current = true;
    void import('./dev/notification-fixture').then((module) => {
      const fixture = module.createNotificationFixture(
        new URLSearchParams(location.search).get('variant') || 'default',
      );
      if (current) setNotificationFixture(fixture);
    });
    return () => {
      current = false;
    };
  }, [fixtureId]);
  useEffect(() => {
    let current = true;
    void notificationApi
      ?.status()
      .then((value) => {
        if (current) setNotifications(value);
      })
      .catch((e) => {
        if (current) setError(uiError(e));
      });
    return () => {
      current = false;
    };
  }, [notificationApi]);
  useEffect(() => {
    void window.rooms
      ?.loginItemStatus()
      .then(setAutoStart)
      .catch((e) => setError(uiError(e)));
  }, []);
  const streamRef = useRef<MediaStream | null>(null);
  const audioRef = useRef<AudioContext | null>(null);
  const denoiserRef = useRef<Awaited<ReturnType<typeof createNoiseSuppressionNode>> | null>(null);
  const frame = useRef(0);
  const mounted = useRef(true);
  // The microphone test runs the same input gate as a room, so its meter shows what would be sent.
  const testGate = useRef<MicGateNode | null>(null);
  const testLevel = useRef<GainNode | null>(null);
  const testListeners = useRef(new Set<(report: MicGateReport) => void>());
  const testMeter = useCallback<InputMeterSource>((listener) => {
    testListeners.current.add(listener);
    return () => {
      testListeners.current.delete(listener);
    };
  }, []);
  const stopMic = useCallback(() => {
    micEpoch.current++;
    testGate.current?.destroy();
    testGate.current = null;
    testLevel.current = null;
    denoiserRef.current?.disconnect();
    denoiserRef.current?.destroy();
    denoiserRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (audioRef.current) void audioRef.current.close();
    audioRef.current = null;
    cancelAnimationFrame(frame.current);
    setTesting(false);
    setLevel(0);
  }, []);
  const refreshDevices = useCallback(async () => {
    try {
      setDevices(await navigator.mediaDevices.enumerateDevices());
      setDevicesLoaded(true);
    } catch {
      setError(tr('Audio devices are unavailable. Open the desktop app and try again.'));
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refreshDevices();
    const changed = () => void refreshDevices();
    navigator.mediaDevices?.addEventListener('devicechange', changed);
    return () => {
      mounted.current = false;
      stopMic();
      stopCamera();
      navigator.mediaDevices?.removeEventListener('devicechange', changed);
    };
  }, [refreshDevices, stopMic, stopCamera]);
  useEffect(() => {
    if (tab !== 'audio') {
      stopMic();
      stopCamera();
    }
  }, [tab, stopMic, stopCamera]);
  const startMic = async () => {
    if (testing) {
      stopMic();
      return;
    }
    setError('');
    setMicState(tr('Requesting permission\u2026'));
    const epoch = ++micEpoch.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: p.inputId ? { exact: p.inputId } : undefined,
          echoCancellation: true,
          noiseSuppression: false,
          // As in a room: the browser AGC runs unless strong noise removal replaces it.
          autoGainControl: !p.noiseSuppression || p.noiseSuppressionMode !== 'strong',
          channelCount: 1,
          sampleRate: 48000,
        },
        video: false,
      });
      if (!mounted.current || epoch !== micEpoch.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const context = new AudioContext({ sampleRate: 48000 });
      audioRef.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      const source = context.createMediaStreamSource(stream);
      if (p.noiseSuppression) {
        const denoiser = await createNoiseSuppressionNode(context, p.noiseSuppressionMode, {
          error: () => {
            if (epoch !== micEpoch.current) return;
            stopMic();
            setError(t('Gürültü filtresi durdu. Mikrofon denemesini yeniden başlat.'));
          },
        });
        if (!mounted.current || epoch !== micEpoch.current) {
          denoiser.destroy();
          return;
        }
        denoiserRef.current = denoiser;
        source.connect(denoiser);
        denoiser.connect(analyser);
      } else source.connect(analyser);
      const gate = await createMicGateNode(
        context,
        { auto: p.inputSensitivityAuto, threshold: p.inputSensitivity },
        { onLevel: (report) => testListeners.current.forEach((listener) => listener(report)) },
      );
      if (!mounted.current || epoch !== micEpoch.current) {
        gate?.destroy();
        return;
      }
      if (gate) {
        // Same order as the room: level, filter, leveler (filter on), gate. A silent sink keeps it running.
        const levelNode = context.createGain(),
          sink = context.createGain(),
          leveler = p.noiseSuppression && p.micLeveler ? createMicLeveler(context) : null;
        levelNode.gain.value = inputPercent.current / 100;
        sink.gain.value = 0;
        (denoiserRef.current ?? source).connect(levelNode);
        if (leveler) {
          levelNode.connect(leveler.input);
          leveler.output.connect(gate);
        } else levelNode.connect(gate);
        gate.connect(sink).connect(context.destination);
        testGate.current = gate;
        testLevel.current = levelNode;
      }
      await context.resume();
      if (!mounted.current || epoch !== micEpoch.current) return;
      const values = new Uint8Array(analyser.frequencyBinCount);
      let last = 0;
      const tick = (now: number) => {
        if (now - last > 100) {
          analyser.getByteFrequencyData(values);
          setLevel(
            Math.min(
              100,
              (values.reduce((a, b) => a + b, 0) / values.length) *
                1.8 *
                (inputPercent.current / 100),
            ),
          );
          last = now;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
      setTesting(true);
      setMicState(tr('Granted \u00B7 local meter only'));
      void refreshDevices();
      stream.getAudioTracks()[0]?.addEventListener('ended', () => {
        stopMic();
        setError(tr('Microphone disconnected. Choose an available input device and retry.'));
      });
    } catch (err) {
      if (!mounted.current || epoch !== micEpoch.current) return;
      stopMic();
      setMicState(tr('Unavailable'));
      setError(
        err instanceof DOMException && err.name === 'NotAllowedError'
          ? tr(
              'Microphone access was denied. Allow Tayfa in macOS System Settings \u2192 Privacy & Security \u2192 Microphone, then retry.',
            )
          : tr('The selected microphone is unavailable. Refresh devices and choose another input.'),
      );
    }
  };
  const speakerTest = async () => {
    setError('');
    const context = new AudioContext() as AudioContext & {
      setSinkId?(id: string): Promise<void>;
    };
    try {
      if (p.outputId) {
        if (!context.setSinkId) throw new Error('Output selection unavailable');
        await context.setSinkId(p.outputId);
      }
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      gain.gain.setValueAtTime(0, context.currentTime);
      gain.gain.linearRampToValueAtTime(0.08, context.currentTime + 0.05);
      gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.55);
      oscillator.frequency.value = 440;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.6);
      oscillator.onended = () => void context.close();
      notify(t('Ses çalınıyor.'));
    } catch {
      void context.close();
      setError(tr('The selected output could not be used. Choose System default and retry.'));
    }
  };
  const exportDiagnostics = async () => {
    if (window.rooms) {
      notify(
        (await window.rooms.exportDiagnostics())
          ? tr('Sanitized diagnostics exported.')
          : tr('Export cancelled.'),
      );
    } else {
      const blob = new Blob(
        [
          JSON.stringify(
            {
              app: 'ROOMS',
              mode: 'browser-preview',
              spacebar: 'not-configured',
              sfu: 'not-configured',
              activityService: 'not-configured',
              mic: micState,
            },
            null,
            2,
          ),
        ],
        { type: 'application/json' },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'rooms-diagnostics.json';
      a.click();
      URL.revokeObjectURL(url);
      notify(tr('Sanitized diagnostics exported.'));
    }
  };
  return (
    <div className={`settings-page reference-settings page-enter ref-tab-${tab}`}>
      <div className="settings-dismiss">
        <IconButton label={t('Ayarları kapat')} onClick={onClose}>
          <X size={22} />
        </IconButton>
        <kbd>ESC</kbd>
      </div>
      <div className="settings-layout">
        {narrowSettings && (
          <div className="settings-narrow-connection">
            <SettingsConnection notify={notify} />
          </div>
        )}
        <nav
          ref={navigationRef}
          id="settings-categories"
          className={`settings-tabs ${navigationOpen ? 'drawer-open' : ''}`}
          inert={narrowSettings && !navigationOpen}
          onClick={(event) => {
            if (
              narrowSettings &&
              (event.target as HTMLElement).closest('.ref-settings-nav-group button')
            )
              closeNavigation();
          }}
          aria-label={tr('Settings categories')}
        >
          <div className="ref-nav-title">
            <strong>{t('Ayarlar')}</strong>
          </div>
          <input
            type="search"
            className="ref-settings-search"
            placeholder={t('Ayarlarda ara')}
            aria-label={t('Ayarlarda ara')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              const first = navigationRef.current?.querySelector<HTMLButtonElement>(
                '.ref-settings-nav-group button[data-tab]',
              );
              first?.click();
            }}
          />
          <div className="ref-settings-nav-scroll">
            {[
              {
                label: t('KULLANICI AYARLARI'),
                ids: userTabIds,
              },
              {
                label:
                  community.spaces
                    .find((space) => space.id === community.activeSpaceId)
                    ?.name.toLocaleUpperCase(locale) || t('TOPLULUK'),
                ids: communityTabs(rights, communityAdmin, delegatedHosts),
              },
              { label: 'Tayfa', ids: ['shortcuts', 'diagnostics', 'about'] },
            ]
              .map((group) => ({
                ...group,
                ids: search.trim()
                  ? group.ids.filter((id) => settingsMatch(id, search))
                  : group.ids,
              }))
              .filter((group) => group.ids.length)
              .map((group) => (
                <div className="ref-settings-nav-group" key={group.label}>
                  <span className="ref-nav-group">{group.label}</span>
                  {group.ids.map((id) => {
                    const entry = tabs.find((item) => item.id === id)!;
                    const matched = search.trim() ? settingsMatch(id, search) : null;
                    return (
                      <button
                        key={entry.id}
                        data-tab={entry.id}
                        className={tab === entry.id ? 'selected' : ''}
                        aria-current={tab === entry.id ? 'page' : undefined}
                        onClick={() => {
                          setParams({ tab: entry.id });
                          setError('');
                        }}
                      >
                        <entry.icon size={17} />
                        {entry.label}
                        {matched && matched !== entry.label && (
                          <small className="ref-settings-search-hit">{matched}</small>
                        )}
                      </button>
                    );
                  })}
                  {group.label === 'Tayfa' && (
                    <button onClick={onClose}>
                      <ArrowLeft size={17} />
                      {t('Sohbete dön')}
                    </button>
                  )}
                </div>
              ))}
            {search.trim() &&
              ![
                ...userTabIds,
                ...communityTabs(rights, communityAdmin, delegatedHosts),
                'shortcuts',
                'diagnostics',
                'about',
              ].some((id) => settingsMatch(id, search)) && (
                <p className="ref-settings-search-empty" role="status">
                  {t('Bu aramayla eşleşen ayar yok.')}
                </p>
              )}
          </div>
          <SettingsConnection notify={notify} />
        </nav>
        {narrowSettings && navigationOpen && (
          <button
            className="settings-navigation-scrim"
            tabIndex={-1}
            aria-label={t('Ayar menüsünü kapat')}
            onClick={closeNavigation}
          />
        )}
        <main className="ref-settings-main" inert={narrowSettings && navigationOpen}>
          <header className="ref-settings-toolbar">
            <button
              ref={navigationButton}
              className="settings-navigation-toggle"
              aria-label={t('Ayar kategorileri')}
              aria-expanded={navigationOpen}
              aria-controls="settings-categories"
              onClick={() => setNavigationOpen(true)}
            >
              <Menu size={20} />
            </button>
            <Settings2 size={22} />
            <strong>{tabs.find((entry) => entry.id === tab)?.label}</strong>
            {[
              'server-profile',
              'cinema',
              'community-management',
              'channel-permissions',
              'assistant-permissions',
              'automation',
              'hostops',
            ].includes(tab) && (
              <span className="ref-settings-community-name">
                {community.spaces.find((space) => space.id === community.activeSpaceId)?.name ||
                  t('Topluluk')}
              </span>
            )}
          </header>
          <div className="settings-content">
            {tab === 'appearance' && (
              <>
                <Heading title={t('Görünüm ve erişilebilirlik')} />
                <LanguageSetting />
                <TimeFormatSetting />
                <div className="ref-settings-grid">
                  <section>
                    <h2>{t('Yoğunluk')}</h2>
                    <p className="ref-settings-description">
                      {t('Mesajlar ve kanallar arasındaki boşluğu seç.')}
                    </p>
                    <div className="ref-density-options">
                      {[false, true].map((compact) => (
                        <button
                          key={String(compact)}
                          aria-pressed={p.compact === compact}
                          className={`ref-density ${compact ? 'compact' : ''} ${p.compact === compact ? 'selected' : ''}`}
                          onClick={() => setPreference('compact', compact)}
                        >
                          <span>
                            {Array.from({ length: compact ? 5 : 3 }, (_, i) => (
                              <i key={i} />
                            ))}
                          </span>
                          {compact ? t('Kompakt') : t('Rahat')}
                        </button>
                      ))}
                    </div>
                  </section>
                  <section>
                    <h2>{t('Metin boyutu')}</h2>
                    <p className="ref-settings-description">
                      {t('Sohbet mesajlarının metin boyutu.')}
                    </p>
                    <div className="ref-font-size-control">
                      <span>14</span>
                      <input
                        type="range"
                        aria-label={t('Sohbet metni boyutu')}
                        aria-valuetext={t('{size} piksel', { size: p.chatFontSize })}
                        min={14}
                        max={18}
                        step={1}
                        value={p.chatFontSize}
                        onChange={(event) =>
                          setPreference('chatFontSize', Number(event.target.value))
                        }
                      />
                      <span>18</span>
                    </div>
                    <output className="ref-settings-note" aria-live="polite">
                      {p.chatFontSize} px
                    </output>
                  </section>
                </div>
                <div className="ref-settings-grid ref-appearance-surfaces">
                  <section>
                    <h2>{t('Hareket ve yüzeyler')}</h2>
                    <Row
                      title={t('Hareketi azalt')}
                      description={t('Animasyonlar ve geçiş hareketleri azaltılır.')}
                    >
                      <Toggle
                        label={t('Hareketi azalt')}
                        value={p.reduceMotion}
                        onChange={(v) => setPreference('reduceMotion', v)}
                      />
                    </Row>
                    <Row
                      title={t('Şeffaflığı azalt')}
                      description={t('Cam paneller ve açılır yüzeyler opak görünür.')}
                    >
                      <Toggle
                        label={t('Şeffaflığı azalt')}
                        value={p.reduceTransparency}
                        onChange={(v) => setPreference('reduceTransparency', v)}
                      />
                    </Row>
                    <Row
                      title={t('Sistem tercihlerimi kullan')}
                      description={t(
                        'Sistemin desteklediği hareket ve şeffaflık azaltma tercihlerini izler.',
                      )}
                    >
                      <Toggle
                        label={t('Sistem tercihlerimi kullan')}
                        value={p.followSystemAccessibility}
                        onChange={(value) => setPreference('followSystemAccessibility', value)}
                      />
                    </Row>
                  </section>
                  <aside className="ref-chat-preview">
                    <span className="ref-preview-label">{t('METİN ÖNİZLEMESİ')}</span>
                    <div className="ref-settings-inline">
                      <Avatar name={community.user?.displayName || 'Tayfa'} />
                      <div>
                        <strong>{community.user?.displayName || 'Tayfa'}</strong>
                        <p>{t('Metin ve durum işaretleri.')}</p>
                      </div>
                    </div>
                  </aside>
                </div>
                <section className="ref-settings-section">
                  <h2>{t('Klavye ve odak')}</h2>
                  <p className="ref-settings-description">
                    {t('Tab ile ilerle, Shift + Tab ile geri dön. Escape açık paneli kapatır.')}
                  </p>
                  <div className="ref-settings-inline">
                    <button
                      className="button primary ref-focus-sample"
                      onClick={(e) => e.currentTarget.focus()}
                    >
                      {t('Odaklı düğme')}
                    </button>
                    <kbd>Tab</kbd>
                    <span className="ref-settings-note">
                      {t('Odak çevre çizgisiyle gösterilir.')}
                    </span>
                  </div>
                </section>
                <Row
                  title={t('Vurgu')}
                  description={p.accent === 'sage' ? t('Adaçayı') : t('Lila')}
                >
                  <div className="accent-options">
                    <button
                      aria-label={t('Lila vurgusu')}
                      title={t('Lila')}
                      aria-pressed={p.accent === 'pearl'}
                      className={`accent pearl ${p.accent === 'pearl' ? 'chosen' : ''}`}
                      onClick={() => setPreference('accent', 'pearl')}
                    >
                      {p.accent === 'pearl' && <Check size={13} />}
                    </button>
                    <button
                      aria-label={t('Adaçayı vurgusu')}
                      title={t('Adaçayı')}
                      aria-pressed={p.accent === 'sage'}
                      className={`accent sage ${p.accent === 'sage' ? 'chosen' : ''}`}
                      onClick={() => setPreference('accent', 'sage')}
                    >
                      {p.accent === 'sage' && <Check size={13} />}
                    </button>
                  </div>
                </Row>
                <Row
                  title={t('Üye paneli')}
                  description={t('Sohbetin yanında topluluk üyelerini gösterir.')}
                >
                  <Toggle
                    label={t('Üye panelini göster')}
                    value={p.memberPanel}
                    onChange={(v) => setPreference('memberPanel', v)}
                  />
                </Row>
                <div className="ref-settings-bottom">
                  <Eye size={14} />
                  {t('Koyu tema')}
                </div>
              </>
            )}
            {tab === 'audio' && (
              <>
                <Heading title={t('Ses ve video')} />
                {devicesLoaded &&
                  !devices.some((d) => d.kind === 'audioinput' || d.kind === 'videoinput') &&
                  !error && (
                    <div className="ref-settings-callout warning" role="status">
                      {t(
                        'Mikrofon veya kamera bulunamadı. Cihaz bağladıktan sonra listeyi yenile.',
                      )}
                    </div>
                  )}
                {error && (
                  <div className="ref-settings-callout warning" role="alert">
                    {error}
                  </div>
                )}
                <div className="ref-settings-grid">
                  <section>
                    <h2>{t('Ses girişi')}</h2>
                    <label className="field-label">
                      {t('Mikrofon')}
                      <select
                        aria-label={t('Mikrofon')}
                        value={p.inputId}
                        onChange={(e) => {
                          stopMic();
                          setPreference('inputId', e.target.value);
                        }}
                      >
                        <option value="">{t('Sistem varsayılanı')}</option>
                        {p.inputId && !devices.some((d) => d.deviceId === p.inputId) && (
                          <option value={p.inputId}>{t('Seçili mikrofon kullanılamıyor')}</option>
                        )}
                        {devices
                          .filter((d) => d.kind === 'audioinput' && d.deviceId !== 'default')
                          .map((d, i) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || t('Mikrofon {number}', { number: i + 1 })}
                            </option>
                          ))}
                      </select>
                    </label>
                    {realtime.status === 'connected' && realtime.inputDevice && (
                      <p className="ref-settings-note" role="status">
                        {t('Odada duyulan mikrofon: {device}', { device: realtime.inputDevice })}
                      </p>
                    )}
                    {inputName ? (
                      <Row
                        title={t('Mikrofon seviyesi')}
                        description={t(
                          '{device} için hatırlanır; bu mikrofona geçince kendiliğinden uygulanır.',
                          { device: inputName },
                        )}
                      >
                        <label className="personal-sound-level">
                          <input
                            type="range"
                            aria-label={t('Mikrofon seviyesi')}
                            aria-valuetext={`${inputLevel}%`}
                            min={0}
                            max={200}
                            step={5}
                            value={inputLevel}
                            onChange={(e) =>
                              setPreference(
                                'inputLevels',
                                withInputLevel(p.inputLevels, inputName, Number(e.target.value)),
                              )
                            }
                          />
                          <span>{inputLevel}%</span>
                        </label>
                      </Row>
                    ) : (
                      <p className="ref-settings-note">
                        {t(
                          'Mikrofon seviyesi, mikrofonun adı görünce ayarlanabilir. Mikrofonu dene veya bir ses odasına katıl.',
                        )}
                      </p>
                    )}
                    <InputSensitivity
                      auto={p.inputSensitivityAuto}
                      threshold={p.inputSensitivity}
                      onAuto={(value) => setPreference('inputSensitivityAuto', value)}
                      onThreshold={(value) => setPreference('inputSensitivity', value)}
                      source={
                        testing
                          ? testMeter
                          : realtime.status === 'connected' && !realtime.muted
                            ? roomMeter
                            : null
                      }
                    />
                    <Row
                      title={t('Giriş seviyesi')}
                      description={t('Mikrofon denemesinde ölçülen yerel seviye.')}
                    >
                      <span>{Math.round(level)}%</span>
                    </Row>
                    <div
                      className="ref-level-meter"
                      role="meter"
                      aria-label={t('Mikrofon giriş seviyesi')}
                      aria-valuenow={Math.round(level)}
                      aria-valuemin={0}
                      aria-valuemax={100}
                    >
                      {Array.from({ length: 30 }, (_, i) => (
                        <i key={i} className={testing && i < level * 0.3 ? 'on' : ''} />
                      ))}
                    </div>
                    <div className="ref-settings-inline spread">
                      <button className="button secondary" onClick={() => void startMic()}>
                        {testing ? <Square size={16} /> : <Mic size={16} />}{' '}
                        {testing ? t('Denemeyi bitir') : t('Mikrofonu dene')}
                      </button>
                      <span className="ref-settings-note">{micState}</span>
                    </div>
                  </section>
                  <section>
                    <h2>{t('Ses çıkışı')}</h2>
                    <Row
                      title={t('Oda giriş ve çıkış sesleri')}
                      description={t('Yalnızca bulunduğun odadaki hareketler.')}
                    >
                      <Toggle
                        label={t('Oda giriş ve çıkış sesleri')}
                        value={p.roomEventSounds}
                        onChange={(value) => setPreference('roomEventSounds', value)}
                      />
                    </Row>
                    <Row
                      title={t('Mikrofon, sağırlaştırma ve yayın sesleri')}
                      description={t(
                        'Mikrofonunu veya sesini açıp kapattığında, odanda bir yayın başlayıp bittiğinde ve biri yayınını izlemeye başlayıp bıraktığında kısa bir ses.',
                      )}
                    >
                      <Toggle
                        label={t('Mikrofon, sağırlaştırma ve yayın sesleri')}
                        value={p.voiceCues}
                        onChange={(value) => setPreference('voiceCues', value)}
                      />
                    </Row>
                    <Row
                      title={t('Kişisel giriş sesleri')}
                      description={
                        p.roomEventSounds
                          ? t('Kapalıyken herkes için klasik ses çalar.')
                          : t('Önce oda giriş ve çıkış seslerini aç.')
                      }
                    >
                      <Toggle
                        label={t('Kişisel giriş sesleri')}
                        disabled={!p.roomEventSounds}
                        value={p.personalSounds}
                        onChange={(value) => setPreference('personalSounds', value)}
                      />
                    </Row>
                    <Row
                      title={t('Efekt ses düzeyi')}
                      description={t(
                        'Giriş ve çıkış seslerinin bu cihazdaki düzeyi. Konuşmaları etkilemez.',
                      )}
                    >
                      <label className="personal-sound-level">
                        <input
                          type="range"
                          aria-label={t('Efekt ses düzeyi')}
                          aria-valuetext={`${Math.round(p.soundEffectsLevel * 100)}%`}
                          min={0}
                          max={1}
                          step={0.05}
                          value={p.soundEffectsLevel}
                          onChange={(e) =>
                            setPreference('soundEffectsLevel', Number(e.target.value))
                          }
                        />
                        <span>{Math.round(p.soundEffectsLevel * 100)}%</span>
                      </label>
                    </Row>
                    <label className="field-label">
                      {t('Hoparlör veya kulaklık')}
                      <select
                        aria-label={t('Hoparlör veya kulaklık')}
                        value={p.outputId}
                        onChange={(e) => setPreference('outputId', e.target.value)}
                      >
                        <option value="">{t('Sistem varsayılanı')}</option>
                        {p.outputId && !devices.some((d) => d.deviceId === p.outputId) && (
                          <option value={p.outputId}>{t('Seçili hoparlör kullanılamıyor')}</option>
                        )}
                        {devices
                          .filter((d) => d.kind === 'audiooutput' && d.deviceId !== 'default')
                          .map((d, i) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || t('Hoparlör {number}', { number: i + 1 })}
                            </option>
                          ))}
                      </select>
                    </label>
                    <Row
                      title={t('Çıkış seviyesi')}
                      description={t('Sistem ses ayarlarından yönetilir.')}
                    >
                      <Volume2 size={16} />
                    </Row>
                    <button className="button secondary" onClick={() => void speakerTest()}>
                      <Volume2 size={16} />
                      {t('Test sesini çal')}
                    </button>
                    <p className="ref-settings-note">{t('Test sesi yalnızca bu cihazda çalar.')}</p>
                  </section>
                </div>
                <PersonalSoundSettings outputId={p.outputId} level={p.soundEffectsLevel} />
                <div className="ref-settings-grid ref-audio-lower">
                  <section>
                    <h2>{t('Konuşma davranışı')}</h2>
                    <Row
                      title={t('Bas konuş')}
                      description={t(
                        'Tuşu basılı tut, bırakınca mikrofon kapanır. Yalnızca Tayfa odaktayken çalışır.',
                      )}
                    >
                      <Toggle
                        label={t('Bas konuş')}
                        value={p.pushToTalk}
                        onChange={(v) => setPreference('pushToTalk', v)}
                      />
                    </Row>
                    <Row
                      title={t('Bas konuş tuşu')}
                      description={t('Basılı tuttuğun sürece mikrofonun açık kalır.')}
                    >
                      <PushToTalkKeyField
                        value={p.pushToTalkKey}
                        onChange={(value) => setPreference('pushToTalkKey', value)}
                      />
                    </Row>
                    <p className="ref-settings-note">
                      {t(
                        'Bas konuş, başka bir uygulamadayken çalışmaz: sistem tuşun bırakıldığını bildirmiyor. Başka uygulamadayken konuşmak için aşağıdaki mikrofon kısayolunu kullan.',
                      )}
                    </p>
                    {voiceShortcutRows}
                    <p className="ref-settings-note">
                      {t('Ses odalarına katılırken mikrofon her zaman kapalı başlar.')}
                    </p>
                    <Row
                      title={t('Gürültü azaltma')}
                      description={t('Mikrofonundan gönderilen sesi bu cihazda temizler.')}
                    >
                      <Toggle
                        label={t('Gürültü azaltma')}
                        value={p.noiseSuppression}
                        onChange={(value) => {
                          stopMic();
                          setPreference('noiseSuppression', value);
                        }}
                      />
                    </Row>
                    <Row
                      title={t('Filtre modu')}
                      description={t(
                        'Güçlü mod, konuşma algılama ile ani arka plan seslerini de bastırır.',
                      )}
                    >
                      <select
                        aria-label={t('Gürültü filtresi modu')}
                        disabled={!p.noiseSuppression}
                        value={p.noiseSuppressionMode}
                        onChange={(event) => {
                          stopMic();
                          setPreference(
                            'noiseSuppressionMode',
                            event.target.value === 'standard' ? 'standard' : 'strong',
                          );
                        }}
                      >
                        <option value="strong">{t('Güçlü')}</option>
                        <option value="standard">{t('Standart')}</option>
                      </select>
                    </Row>
                    <Row
                      title={t('Ses seviyesini dengele')}
                      description={
                        p.noiseSuppression
                          ? t(
                              'Gürültü azaltmadan sonra kısık ve yüksek konuşmayı birbirine yaklaştırır.',
                            )
                          : t(
                              'Gürültü azaltma kapalıyken sistemin otomatik kazancı çalışır; dengeleme kullanılmaz.',
                            )
                      }
                    >
                      <Toggle
                        label={t('Ses seviyesini dengele')}
                        value={p.micLeveler}
                        disabled={!p.noiseSuppression}
                        onChange={(value) => {
                          stopMic();
                          setPreference('micLeveler', value);
                        }}
                      />
                    </Row>
                    <p className="ref-settings-note" role="status">
                      {realtime.noiseProcessing?.status === 'failed'
                        ? t('Filtre hatası · mikrofon kapatıldı')
                        : realtime.noiseProcessing?.status === 'starting'
                          ? t('Filtre hazırlanıyor…')
                          : realtime.noiseProcessing?.status === 'active' && !realtime.muted
                            ? realtime.noiseProcessing.mode !== 'strong'
                              ? t('Standart filtre etkin')
                              : realtime.noiseProcessing.stats?.speechGateOpen === false
                                ? t('Güçlü filtre etkin · konuşma bekleniyor')
                                : t('Güçlü filtre etkin')
                            : t('Mikrofon yayını kapalı')}
                    </p>
                  </section>
                  <section>
                    <h2>{t('Kamera')}</h2>
                    <label className="field-label">
                      {t('Kamera')}
                      <select
                        aria-label={t('Kamera')}
                        value={cameraId}
                        onChange={(e) => {
                          stopCamera();
                          setPreference('cameraId', e.target.value);
                        }}
                      >
                        <option value="">{t('Sistem varsayılanı')}</option>
                        {cameraId &&
                          !devices.some(
                            (d) => d.kind === 'videoinput' && d.deviceId === cameraId,
                          ) && (
                            <option value={cameraId}>
                              {t('Seçili kamera bağlı değil (varsayılan kullanılır)')}
                            </option>
                          )}
                        {devices
                          .filter((d) => d.kind === 'videoinput')
                          .map((d, i) => (
                            <option key={d.deviceId} value={d.deviceId}>
                              {d.label || t('Kamera {number}', { number: i + 1 })}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button className="button secondary" onClick={() => void toggleCamera()}>
                      <Video size={16} />
                      {cameraStream ? t('Önizlemeyi kapat') : t('Kamerayı dene')}
                    </button>
                    <p className="ref-settings-note">
                      {t(
                        'Seçtiğin kamera odalarda ve özel görüşmelerde kullanılır. Kamera denemesi odaya yayınlanmaz.',
                      )}
                    </p>
                    <div className="ref-camera-preview">
                      {cameraStream ? (
                        <video
                          ref={cameraVideo}
                          autoPlay
                          muted
                          playsInline
                          aria-label={t('Yerel kamera önizlemesi')}
                        />
                      ) : (
                        <>
                          <VideoOff size={33} />
                          <span>{t('Kamera kapalı')}</span>
                        </>
                      )}
                    </div>
                  </section>
                </div>
                <NoiseComparison
                  inputId={p.inputId}
                  mode={p.noiseSuppressionMode}
                  microphoneLive={!realtime.muted}
                />
                <div className="ref-settings-bottom">
                  <button className="text-button" onClick={() => void refreshDevices()}>
                    <RefreshCw size={14} />
                    {t('Cihaz listesini yenile')}
                  </button>
                  <span>
                    {realtime.status === 'connected'
                      ? t('{roomName} · Ses bağlı', { roomName: realtime.roomName ?? '' })
                      : t('Ses odasına bağlı değil')}
                  </span>
                </div>
              </>
            )}
            {tab === 'server-profile' && <ServerProfile notify={notify} />}
            {tab === 'cinema' && <CinemaSettings notify={notify} />}
            {tab === 'hostops' && <HostOperations />}
            {tab === 'connections' && <AgentReferenceSettingsContent view="connections" />}
            {tab === 'room-memory' && <AgentReferenceSettingsContent view="memory" />}
            {tab === 'schedules' && <AgentReferenceSettingsContent view="schedules" />}
            {tab === 'services' && (
              <>
                <h3>{t('Bağlantılar')}</h3>
                <ConnectionPane />
                <PersonalProviders notify={notify} />
                {[
                  {
                    name: 'LiveKit',
                    description: tr('Voice, video & screen sharing'),
                    note:
                      realtime.status === 'connected'
                        ? t(
                            '{roomName} odasına bağlı. Mikrofonu, kamerayı ve paylaşımı odandan yönet.',
                            { roomName: realtime.roomName ?? '' },
                          )
                        : tr(
                            'Sign in, open a voice channel, and join with your mic off. Screen capture starts only after you select a source.',
                          ),
                  },
                ].map((c) => (
                  <section className="connection-card compact-connection" key={c.name}>
                    <div className="connection-card-heading">
                      <span className="connection-icon">
                        <Link size={20} />
                      </span>
                      <div>
                        <h4>{c.name}</h4>
                        <p>{c.description}</p>
                      </div>
                      <span className="connection-status">
                        {c.name === 'LiveKit'
                          ? realtime.status === 'connected'
                            ? tr('Connected')
                            : community.user
                              ? tr('Ready to join')
                              : tr('Sign in first')
                          : tr('Not configured')}
                      </span>
                    </div>
                    <p className="connection-disclosure">{c.note}</p>
                  </section>
                ))}
              </>
            )}
            {tab === 'agent' && <AgentReferenceSettingsContent view="models" />}
            {tab === 'automation' && <AgentSettings notify={notify} view="automation" />}
            {tab === 'profile' && <ReferenceAccount notify={notify} onClose={onClose} />}

            {tab === 'shortcuts' && (
              <>
                <Heading title={t('Klavye')} />
                <section className="ref-settings-section">
                  <h2>{t('Ses kısayolları')}</h2>
                  {voiceShortcutRows}
                  <Row
                    title={t('Bas konuş tuşu')}
                    description={t('Basılı tuttuğun sürece mikrofonun açık kalır.')}
                  >
                    <PushToTalkKeyField
                      value={p.pushToTalkKey}
                      onChange={(value) => setPreference('pushToTalkKey', value)}
                    />
                  </Row>
                </section>
                <h2>{t('Uygulama kısayolları')}</h2>
                {[
                  [tr('Find a room or command'), '⌘ / Ctrl K'],
                  [tr('Home / Spaces / Chat / Voice / Cinema'), '⌘ / Ctrl 1–5'],
                  [tr('Open settings'), '⌘ / Ctrl ,'],
                  [t('Mikrofonu aç / kapat'), '⌘ / Ctrl Shift M'],
                  [tr('Play / pause local media'), 'Space'],
                  [tr('Seek local media 5 seconds'), '← / →'],
                  [tr('Close topmost dialog'), 'Esc'],
                  [t('Mesaj gönder'), 'Enter'],
                  [tr('New line'), 'Shift Enter'],
                ].map(([a, b]) => (
                  <div className="shortcut-row" key={a}>
                    <span>{a}</span>
                    <kbd>{b}</kbd>
                  </div>
                ))}
                <HallKeySettings />
              </>
            )}
            {tab === 'desktop' && (
              <>
                <Heading title={t('Bildirimler ve masaüstü')} />
                {notificationFixture?.variant === 'system_permission' && (
                  <div className="ref-settings-callout warning" role="status">
                    {t('Geliştirme örneği · sistem bildirimleri kullanılamıyor.')}
                  </div>
                )}
                <div className="ref-notification-columns">
                  <section>
                    <h2>{t('Bildirimler')}</h2>
                    <Row
                      title={t('Masaüstü bildirimleri')}
                      description={
                        notifications?.supported
                          ? t('Tayfa arka plandayken yeni mesajı haber verir.')
                          : t('Sistem bildirimleri bu ortamda kullanılamıyor.')
                      }
                    >
                      <Toggle
                        label={t('Masaüstü bildirimleri')}
                        value={notifications?.enabled ?? false}
                        disabled={!notifications?.supported || notificationBusy}
                        onChange={async (value) => {
                          setNotificationBusy(true);
                          try {
                            setNotifications(await notificationApi!.setOptIn(value));
                          } catch (e) {
                            setError(uiError(e));
                          } finally {
                            setNotificationBusy(false);
                          }
                        }}
                      />
                    </Row>
                    <Row
                      title={t('Özel mesajlar ve etiketlenmeler')}
                      description={t(
                        'Biri sana özel mesaj attığında ya da seni etiketlediğinde, diğer mesajlar kapalı olsa da haber verir.',
                      )}
                    >
                      <Toggle
                        label={t('Özel mesajlar ve etiketlenmeler')}
                        value={notifications?.important ?? true}
                        disabled={!notifications?.supported || notificationBusy}
                        onChange={async (value) => {
                          setNotificationBusy(true);
                          try {
                            setNotifications(await notificationApi!.setImportant(value));
                          } catch (e) {
                            setError(uiError(e));
                          } finally {
                            setNotificationBusy(false);
                          }
                        }}
                      />
                    </Row>
                    <Row
                      title={t('Bildirim sesleri')}
                      description={t('Sistem bildirim sesini kullanır.')}
                    >
                      <Toggle
                        label={t('Bildirim sesleri')}
                        value={notifications?.sound ?? false}
                        disabled={
                          !notifications?.supported ||
                          (!notifications.enabled && !notifications.important) ||
                          notificationBusy
                        }
                        onChange={async (value) => {
                          setNotificationBusy(true);
                          try {
                            setNotifications(await notificationApi!.setSound(value));
                          } catch (e) {
                            setError(uiError(e));
                          } finally {
                            setNotificationBusy(false);
                          }
                        }}
                      />
                    </Row>
                    <Row
                      title={t('Görüşmedeyken bildirimleri duraklat')}
                      description={t('Ses bağlantısı sürerken masaüstü bildirimlerini göstermez.')}
                    >
                      <Toggle
                        label={t('Görüşmedeyken bildirimleri duraklat')}
                        value={notifications?.pauseDuringVoice ?? false}
                        disabled={!notifications?.supported || notificationBusy}
                        onChange={async (value) => {
                          setNotificationBusy(true);
                          try {
                            setNotifications(await notificationApi!.setPauseDuringVoice(value));
                          } catch (e) {
                            setError(uiError(e));
                          } finally {
                            setNotificationBusy(false);
                          }
                        }}
                      />
                    </Row>
                    <ChannelNotifications bridge={notificationFixture?.notifications} />
                  </section>
                  <aside>
                    <span className="ref-preview-label">{t('BİLDİRİM BİÇİMİ')}</span>
                    <div className="ref-notification-preview">
                      <Bell size={22} />
                      <div>
                        <strong>Tayfa</strong>
                        <p>{t('Mesaj içeriği gizli.')}</p>
                      </div>
                    </div>
                    <div className="ref-settings-divider" />
                    <span className="ref-preview-label">{t('MASAÜSTÜ')}</span>
                    <div className="ref-desktop-summary">
                      <strong>Tayfa</strong>
                      <p>
                        {realtime.status === 'connected'
                          ? t('{roomName} · Ses bağlı', { roomName: realtime.roomName ?? '' })
                          : t('Ses odasına bağlı değil')}
                      </p>
                    </div>
                  </aside>
                </div>
                <section className="ref-settings-section">
                  <h2>{t('Masaüstü davranışı')}</h2>
                  <Row
                    title={t('Oturum açınca başlat')}
                    description={
                      window.rooms
                        ? t('Paketlenmiş {platform} uygulamasında kullanılabilir.', {
                            platform: platformName(window.rooms.platform),
                          })
                        : t('Bu tercih masaüstü uygulamasını gerektirir.')
                    }
                  >
                    <Toggle
                      label={t('Oturum açınca başlat')}
                      value={autoStart}
                      disabled={!window.rooms}
                      onChange={async (v) => {
                        try {
                          const applied = await window.rooms!.setLoginItem(v);
                          setAutoStart(applied);
                          if (v && !applied)
                            notify(t('Geliştirme uygulamasında başlangıç kaydı kullanılamıyor.'));
                        } catch (e) {
                          setError(uiError(e));
                        }
                      }}
                    />
                  </Row>
                  <DesktopWindowSettings bridge={notificationFixture?.desktopWindow} />
                  <Row
                    title={t('Pencereyi üstte tut')}
                    description={window.rooms ? '' : t('Masaüstü uygulamasını gerektirir.')}
                  >
                    <Toggle
                      label={t('Pencereyi üstte tut')}
                      value={onTop}
                      disabled={!window.rooms}
                      onChange={async (v) => {
                        try {
                          await setWindowOnTop(v);
                        } catch (e) {
                          setError(uiError(e));
                        }
                      }}
                    />
                  </Row>
                  <Row title={t('Tam ekran')} description="">
                    <button
                      className="button secondary"
                      onClick={async () => {
                        try {
                          if (window.rooms) await window.rooms.windowAction('fullscreen');
                          else if (document.fullscreenElement) await document.exitFullscreen();
                          else await document.documentElement.requestFullscreen();
                        } catch (e) {
                          setError(uiError(e));
                        }
                      }}
                    >
                      {t('Tam ekranı değiştir')}
                    </button>
                  </Row>
                </section>
                <DesktopUpdates />
              </>
            )}
            {tab === 'community-management' && (
              <CommunityManagementEntry
                onCreateInvite={onInvite}
                onBack={onClose}
                onChannelPermissions={() => setParams({ tab: 'channel-permissions' })}
              />
            )}
            {tab === 'channel-permissions' && (
              <ChannelPermissionsSurface
                channelId={params.get('channel') ?? community.activeChannelId}
              />
            )}
            {tab === 'about' && <About notify={notify} />}
            {tab === 'assistant-permissions' && <AssistantManagement />}
            {tab === 'diagnostics' && (
              <>
                <Heading title={t('Tanılama')} />
                <div className="diagnostic-list">
                  {[
                    [
                      tr('Application'),
                      appInfo
                        ? `Tayfa ${appInfo.version} / ${appInfo.arch}`
                        : tr('Browser preview'),
                    ],
                    [
                      tr('Runtime'),
                      appInfo ? `Electron ${appInfo.electron}` : tr('Browser preview'),
                    ],
                    [
                      tr('Platform'),
                      window.rooms ? platformName(window.rooms.platform) : tr('Browser'),
                    ],
                    [tr('Social / gateway'), connectionLabel(community.status)],
                    ['WebRTC / SFU', connectionLabel(realtime.status)],
                    [
                      tr('Activity service'),
                      t('Durum, seçili odanın etkinlik ekranında gösterilir'),
                    ],
                    [
                      tr('Provider connections'),
                      t('Kişisel kaynaklar için Bağlantılar ekranını aç'),
                    ],
                    [tr('Microphone permission'), micState],
                    [
                      tr('Bitrate / packet loss / ping'),
                      realtime.status === 'connected'
                        ? `${realtime.diagnostics.bitrate === null ? '—' : Math.round(realtime.diagnostics.bitrate / 1000) + ' kbps'} / ${realtime.diagnostics.packetLoss === null ? '—' : (realtime.diagnostics.packetLoss * 100).toFixed(1) + '%'} / ${realtime.diagnostics.rtt === null ? '—' : Math.round(realtime.diagnostics.rtt) + ' ms'}`
                        : tr('Unavailable \u2014 no active transport'),
                    ],
                    [
                      t('Video / codec'),
                      realtime.diagnostics.video
                        ? `${realtime.diagnostics.video.width} × ${realtime.diagnostics.video.height} / ${realtime.diagnostics.video.framesPerSecond ?? '—'} fps / ${realtime.diagnostics.video.codec ?? '—'} / ${realtime.diagnostics.video.direction === 'sent' ? t('gönderilen') : t('alınan')}`
                        : '—',
                    ],
                    [
                      tr('Data mode'),
                      community.user ? t('Gerçek topluluk hesabı') : t('Giriş yapılmadı'),
                    ],
                  ].map(([a, b]) => (
                    <div key={a}>
                      <span>{a}</span>
                      <strong>{b}</strong>
                    </div>
                  ))}
                </div>
                <button className="button secondary" onClick={() => void exportDiagnostics()}>
                  <ArrowDownToLine size={16} />
                  {tr('Export sanitized diagnostics')}
                </button>
              </>
            )}
            {error && tab !== 'audio' && (
              <div className="error-pane" role="alert">
                <strong>{tr('Let\u2019s check that.')}</strong>
                <p>{error}</p>
              </div>
            )}
          </div>
          {dirty && (
            <div
              className="settings-save-bar"
              role="region"
              aria-label={t('Kaydedilmemiş ayarlar')}
            >
              <span>{t('Kaydedilmemiş değişiklikler')}</span>
              <button
                className="button secondary"
                disabled={saving}
                onClick={() => {
                  resetDraft();
                  setError('');
                }}
              >
                {t('Vazgeç')}
              </button>
              <button
                className="button primary"
                disabled={saving}
                onClick={() => void savePreferences()}
              >
                {saving ? t('Kaydediliyor…') : t('Kaydet')}
              </button>
            </div>
          )}
        </main>
      </div>
      {confirmDiscard && (
        <Modal title={t('Değişiklikler kaydedilmedi')} onClose={() => setConfirmDiscard(false)}>
          <p>{t('Ayarları kaydetmeden çıkmak istiyor musun?')}</p>
          <div className="button-row">
            <button className="button secondary" onClick={() => setConfirmDiscard(false)}>
              {t('Düzenlemeye dön')}
            </button>
            <button
              className="button danger"
              disabled={saving}
              onClick={() => {
                approvedClose.current = true;
                onClose();
              }}
            >
              {t('Kaydetmeden çık')}
            </button>
            <button
              className="button primary"
              disabled={saving}
              onClick={() =>
                void savePreferences().then((saved) => {
                  if (saved) setConfirmDiscard(false);
                })
              }
            >
              {t('Kaydet')}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
