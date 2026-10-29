import { MinimalSidebar } from './MinimalSidebar';
import { QuietMenu } from './QuietMenu';
import { RoomConversation } from './RoomConversation';
import { Messages } from './Messages';
import { useConversationRestore } from './last-conversation';
import { RoomEventSounds } from './room-event-sounds';
import { GameTurnNotice } from './games/TurnNotice';
import './minimal-room.css';
import { ParticipantAudioMenu } from './ParticipantAudioMenu';
import { MusicDJ, MusicDJEntry, openMusicDJ } from './MusicDJ';
import { applyAppearancePreferences } from './appearance-preferences';
import { t, tr, uiError } from './i18n';
import {
  DirectMessageSurface,
  SocialSearchDialog,
  SharedFilesSurface,
  UserProfileDialog,
} from './SocialSurfaces';
import { RoomMembers } from './RoomMembers';
import { FriendsPage } from './FriendsPage';
import { FriendRequiredDialog } from './FriendRequiredDialog';
import DmCallRuntime from './DmCallRuntime';
import ConnectionStatusSurface, { StartupSplash, SystemState } from './SystemState';
import { useChannelAccess } from './channel-access';
import { ChannelAccessState, CommunityEditor } from './CommunitySettings';
import { SocialNotificationsPage, SocialReferenceOverlay } from './SocialReferenceEntry';
import {
  ReferenceAuthFrame,
  ReferenceOnboarding,
  defaultStartTab,
  type ReferenceOnboardingMode,
} from './ReferenceOnboarding';
import { InviteLanding } from './Invite';
import { SignupPendingScreen } from './SignupPending';
import { signupScreenVisible, useSignup } from './signup-state';
import { CommandPalette } from './CommandPalette';
import { friendlyActionError, shortcutRoutes } from './shell-commands';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, LayoutGrid, Menu, Music2, Search, Users, X } from 'lucide-react';
import { IconButton, LoadingView, Modal } from '@rooms/design';
import { useRooms } from './store';
import { badgeCount, useCommunity, initializeCommunity } from './community';
import { useModerationRights } from './VoiceModeration';
import { useRealtime, toggleMic } from './realtime';
import { PushToTalk } from './PushToTalk';
import { CommunitySpaces, CommunityInvite, RealVoiceDock } from './RealSocial';
import { Home } from './Home';
import { ConnectionPane } from './ConnectionPane';
import { ActivityLauncher } from './Activities';
import { RemoteControlRuntime } from './RemoteControl';
const PersonalPlaybackRuntime = lazy(() =>
  import('./PersonalMedia').then((module) => ({ default: module.PersonalPlaybackRuntime })),
);
const PersonalMedia = lazy(() =>
  import('./PersonalMedia').then((module) => ({ default: module.PersonalMedia })),
);
const RecoveryFixtureEntry = import.meta.env.DEV
  ? lazy(() => import('./dev/S04RecoveryEntry'))
  : null;
const PersonalMediaFixtureEntry = import.meta.env.DEV
  ? lazy(() => import('./dev/PersonalMediaEntry'))
  : null;
const CinemaHall = lazy(() => import('./cinema/CinemaHall'));
const StudioPage = lazy(() => import('./studio/ui/StudioPage'));
const Settings = lazy(() => import('./Settings'));
const AgentWorkspace = lazy(() => import('./Agent'));
const Together = lazy(() => import('./Together'));
const Games = lazy(() => import('./Games'));
export type Overlay =
  | 'launcher'
  | 'command'
  | 'create-space'
  | 'edit-space'
  | 'create-room'
  | 'help'
  | 'invite'
  | 'social-search'
  | 'profile'
  | null;
export default function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const lastNonDJPath = useRef(
    location.pathname === '/youtube' ? '/home' : location.pathname + location.search,
  );
  useEffect(() => {
    if (location.pathname !== '/youtube')
      lastNonDJPath.current = location.pathname + location.search;
  }, [location.pathname, location.search]);
  const { preferences: p, setPreference } = useRooms();
  const community = useCommunity();
  const signup = useSignup();
  // Only this device's own request, and only while signed out: never blocks an account.
  const showSignup = signupScreenVisible(signup, !!community.user);
  useEffect(() => {
    void useSignup.getState().load();
  }, []);
  const followedSignup = useRef(false);
  useEffect(() => {
    // The approved request just became an account: continue with the new-account steps.
    if (showSignup) followedSignup.current = true;
    else if (followedSignup.current && community.user) {
      followedSignup.current = false;
      navigate('/setup/profile', { replace: true });
    } else if (!signup.pending) followedSignup.current = false;
  }, [showSignup, community.user, signup.pending, navigate]);
  const communityAdmin = useModerationRights(community.activeSpaceId).communityAdmin;
  const realtime = useRealtime();
  useEffect(() => {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture')) return;
    const bridge = window.rooms?.notifications;
    if (!bridge?.setVoiceActive) return;
    const active = realtime.status === 'connected' || realtime.status === 'reconnecting';
    const send = () => void bridge.setVoiceActive(active).catch(() => {});
    send();
    const timer = active ? setInterval(send, 10000) : undefined;
    return () => {
      if (timer) clearInterval(timer);
      void bridge.setVoiceActive(false).catch(() => {});
    };
  }, [realtime.status]);
  const activeSpace = community.activeSpaceId;
  const channelAccess = useChannelAccess((state) =>
    community.activeChannelId ? state.checks[community.activeChannelId] : undefined,
  );
  const channel =
    community.channels.find((c) => c.id === community.activeChannelId)?.name ??
    community.dms.find((c) => c.id === community.activeChannelId)?.name ??
    tr('Messages');
  const [startupReady, setStartupReady] = useState(
    () =>
      !window.rooms ||
      !!(import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture')),
  );
  // The Dock badge follows unread mentions and conversations.
  useEffect(() => {
    if (!window.rooms?.setBadge) return;
    let last = -1;
    const update = (state: ReturnType<typeof useCommunity.getState>) => {
      const count = badgeCount(state);
      if (count === last) return;
      last = count;
      void window.rooms?.setBadge?.(count).catch(() => {});
    };
    update(useCommunity.getState());
    const unsubscribe = useCommunity.subscribe(update);
    return () => {
      unsubscribe();
      void window.rooms?.setBadge?.(0).catch(() => {});
    };
  }, []);
  // A clicked server alert opens Sunucu makinesi.
  useEffect(() => {
    const open = () => navigate('/settings?tab=hostops');
    window.addEventListener('rooms:open-server-settings', open);
    return () => window.removeEventListener('rooms:open-server-settings', open);
  }, [navigate]);
  // A clicked desktop notification opens its channel or conversation.
  useEffect(() => {
    const open = (event: Event) => {
      const channelId = (event as CustomEvent<string>).detail;
      const state = useCommunity.getState();
      if (![...state.channels, ...state.dms].some((channel) => channel.id === channelId)) return;
      void state.openChannel(channelId).then(() => navigate('/chat'));
    };
    window.addEventListener('rooms:open-channel', open);
    return () => window.removeEventListener('rooms:open-channel', open);
  }, [navigate]);
  // The saved session's server came back after launch: leave the sign-in screen.
  useEffect(() => {
    const restored = () => {
      if (location.pathname.startsWith('/setup/')) navigate('/home', { replace: true });
    };
    window.addEventListener('rooms:session-restored', restored);
    return () => window.removeEventListener('rooms:session-restored', restored);
  }, [location.pathname, navigate]);
  useEffect(() => {
    if (import.meta.env.DEV && new URLSearchParams(window.location.search).has('fixture')) return;
    let current = true;
    void initializeCommunity()
      .then(() => {
        if (current && !useCommunity.getState().user && ['/home', '/'].includes(location.pathname))
          navigate('/setup/welcome', { replace: true });
      })
      .finally(() => {
        if (current) setStartupReady(true);
      });
    return () => {
      current = false;
    };
  }, [navigate]);
  const sourceRequest = useRef<string | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (
      location.pathname !== '/voice' ||
      params.get('choose') !== '1' ||
      sourceRequest.current === location.key
    )
      return;
    sourceRequest.current = location.key;
    window.dispatchEvent(new Event('rooms:choose-capture'));
    params.delete('choose');
    navigate({ pathname: '/voice', search: params.toString() }, { replace: true });
  }, [location.pathname, location.search, location.key, navigate]);
  const [channelNavOpen, setChannelNavOpen] = useState(false);
  useEffect(() => {
    if (!channelNavOpen) return;
    const sidebar = document.getElementById('rooms-navigation'),
      origin = document.activeElement as HTMLElement | null;
    const items = () =>
      [
        ...(sidebar?.querySelectorAll<HTMLElement>(
          'summary,button:not(:disabled),[tabindex="0"]',
        ) ?? []),
      ].filter((el) => el.getClientRects().length);
    items()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const targets = items(),
        first = targets[0],
        last = targets.at(-1);
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    window.addEventListener('keydown', trap);
    return () => {
      window.removeEventListener('keydown', trap);
      origin?.focus();
    };
  }, [channelNavOpen]);
  const [narrowContext, setNarrowContext] = useState(
    () => matchMedia('(max-width:1279px)').matches,
  );
  const [contextDrawerOpen, setContextDrawerOpen] = useState(false);
  const localFixture = import.meta.env.DEV
    ? (document.documentElement.dataset.referenceFixture ?? '')
    : '';
  const contextVisible = contextDrawerOpen;
  useEffect(() => {
    const show = () => setOverlay('launcher');
    window.addEventListener('rooms:open-activity-launcher', show);
    return () => window.removeEventListener('rooms:open-activity-launcher', show);
  }, []);
  const toggleContext = useCallback(() => {
    setContextDrawerOpen((value) => !value);
  }, []);
  const closeContext = useCallback(() => {
    setContextDrawerOpen(false);
    if (!narrowContext) setPreference('showFriends', false);
  }, [narrowContext, setPreference]);
  useEffect(() => {
    const query = matchMedia('(max-width:1279px)');
    const resize = () => {
      setNarrowContext(query.matches);
      setContextDrawerOpen(false);
    };
    query.addEventListener('change', resize);
    return () => query.removeEventListener('change', resize);
  }, []);
  useEffect(() => {
    setChannelNavOpen(false);
    setContextDrawerOpen(false);
  }, [location.pathname, community.activeChannelId]);
  useConversationRestore(startupReady);
  const [overlay, setOverlay] = useState<Overlay>(null);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const fixture = new URLSearchParams(window.location.search).get('fixture')?.toUpperCase();
    if (fixture === 'S13') setOverlay('social-search');
    if (fixture === 'S15') setOverlay('profile');
  }, []);
  const [nativeInvite, setNativeInvite] = useState<{
    serverUrl: string;
    code: string;
  } | null>(null);
  const closeInvite = useCallback(() => setNativeInvite(null), []);
  useEffect(() => {
    if (!window.rooms) return;
    void window.rooms
      .pendingInvite()
      .then((value) => {
        if (value) setNativeInvite(value);
      })
      .catch(() => {});
    return window.rooms.onInvite((value) => setNativeInvite(value));
  }, []);
  // Signed out, an invitation link opens Kayıt ol (or Giriş yap on a device that used its server)
  // with the link already filled in; signing in then joins the community.
  useEffect(() => {
    if (!startupReady || !nativeInvite || community.user) return;
    const params = new URLSearchParams({
      server: nativeInvite.serverUrl,
      invite: nativeInvite.code,
    });
    setNativeInvite(null);
    navigate(`/setup/${defaultStartTab(params)}?${params}`, { replace: true });
  }, [startupReady, nativeInvite, community.user, navigate]);
  const [toast, setToast] = useState('');
  const notify = useCallback((message: string) => setToast(message), []);
  useEffect(() => {
    // Modules without a component (voice, updates) report through this event.
    const show = (event: Event) => {
      const message = (event as CustomEvent<unknown>).detail;
      if (typeof message === 'string' && message) setToast(message.slice(0, 300));
    };
    window.addEventListener('rooms:toast', show);
    return () => window.removeEventListener('rooms:toast', show);
  }, []);
  const close = useCallback(() => setOverlay(null), []);

  useEffect(() => {
    const clear = () => {
      setOverlay((current) =>
        current === 'social-search' || current === 'profile' ? null : current,
      );
    };
    window.addEventListener('rooms:channel-access-invalidated', clear);
    return () => window.removeEventListener('rooms:channel-access-invalidated', clear);
  }, []);
  const settingsPage = location.pathname === '/settings';
  const returnFromSettings = useRef('/home');
  useEffect(() => {
    if (!settingsPage) returnFromSettings.current = location.pathname + location.search;
  }, [settingsPage, location.pathname, location.search]);
  const closeSettings = useCallback(() => {
    const allowed = window.dispatchEvent(
      new Event('rooms:settings-close-request', { cancelable: true }),
    );
    if (allowed) navigate(returnFromSettings.current, { replace: true });
    return allowed;
  }, [navigate]);
  const visiblePath = settingsPage ? returnFromSettings.current.split('?')[0]! : location.pathname;
  const hallView = visiblePath === '/cinema';
  const voiceView = visiblePath === '/voice';
  const mediaView = visiblePath === '/media';
  const dmView =
    ['/chat', '/dm'].includes(visiblePath) &&
    community.dms.some((dm) => dm.id === community.activeChannelId);
  const communityView =
    !dmView &&
    !!community.user &&
    (voiceView ||
      [
        '/chat',
        '/status',
        '/files',
        '/games',
        '/together',
        '/agent',
        '/youtube',
        '/media',
      ].includes(visiblePath));
  useLayoutEffect(() => {
    const main = document.querySelector('.main-view');
    if (main) main.scrollTop = 0;
  }, [visiblePath]);
  const open = (value: Overlay) => {
    setOverlay(value === 'create-room' ? 'invite' : value);
  };
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const editing = target.closest('input,textarea,[contenteditable="true"]');
      if (
        settingsPage &&
        (e.metaKey || e.ctrlKey) &&
        (e.key.toLowerCase() === 'k' || /^[1-5]$/.test(e.key))
      ) {
        e.preventDefault();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        // The cinema hall's own "Aç…" palette owns ⌘K there.
        if (hallView) return;
        e.preventDefault();
        setOverlay((current) => (current === 'command' ? null : 'command'));
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault();
        close();
        navigate('/settings');
      }
      if (!editing && (e.metaKey || e.ctrlKey) && /^[1-5]$/.test(e.key)) {
        e.preventDefault();
        close();
        navigate(shortcutRoutes[Number(e.key) - 1]!.path);
      }
      if (e.key === 'Escape' && contextDrawerOpen) {
        e.preventDefault();
        setContextDrawerOpen(false);
        return;
      }
      if (e.key === 'Escape' && channelNavOpen) {
        e.preventDefault();
        setChannelNavOpen(false);
        return;
      }
      if (e.key === 'Escape' && !overlay && !nativeInvite) {
        if (settingsPage) {
          e.preventDefault();
          closeSettings();
          return;
        }
        if (document.fullscreenElement) void document.exitFullscreen();
      }
      if (!editing && (e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        if (realtime.channelId)
          void toggleMic().catch((error) =>
            notify(
              friendlyActionError(
                error,
                t('Mikrofon değiştirilemedi. Ses ayarlarını kontrol edip yeniden dene.'),
              ),
            ),
          );
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    navigate,
    close,
    overlay,
    nativeInvite,
    settingsPage,
    closeSettings,
    realtime.channelId,
    notify,
    channelNavOpen,
    contextDrawerOpen,
    hallView,
  ]);
  useEffect(() => applyAppearancePreferences(p), [p]);
  const visibleParams = new URLSearchParams(
    settingsPage ? (returnFromSettings.current.split('?')[1] ?? '') : location.search,
  );
  // The chat heading names a channel conversation, so the toolbar does not repeat it.
  const chatHeadingVisible =
    !!community.user &&
    !dmView &&
    !channelAccess &&
    (visiblePath === '/chat' || (voiceView && visibleParams.get('view') === 'chat'));
  const titles: Record<string, string> = {
    '/home': t('Ana sayfa'),
    '/friends': t('Arkadaşlar'),
    '/messages': t('Mesajlar'),
    '/media': t('Medyam'),
    '/spaces': tr('Your spaces'),
    '/chat': channel.startsWith('dm-') ? channel.slice(3) : `# ${channel}`,
    '/voice': tr('The lounge'),
    '/cinema': t('Sinema'),
    '/settings': tr('Settings'),
    '/notifications': t('Bildirimler'),
    '/agent': t('Asistan'),
    '/together': visibleParams.get('tab') === 'board' ? t('Beyaz tahta') : t('Anketler'),
    '/games': t('Oyunlar'),
    '/youtube': 'DJ',
  };
  const breadcrumb = ['/chat', '/voice'].includes(visiblePath)
    ? voiceView
      ? (realtime.roomName ?? channel)
      : channel
    : (titles[visiblePath] ?? (visiblePath.startsWith('/studio') ? t('Stüdyo') : 'Tayfa'));
  const setupName = visiblePath.startsWith('/setup/') ? visiblePath.slice(7) : null;
  const setupModes: ReferenceOnboardingMode[] = [
    'welcome',
    'signin',
    'register',
    'recovery',
    'selfhost',
    'invite',
    'profile',
    'devices',
  ];
  const setupMode = setupModes.find((mode) => mode === setupName);
  // The start tabs share one mounted screen so switching tabs keeps keyboard focus on the tab list.
  const setupKey =
    setupMode === 'register' || setupMode === 'signin' || setupMode === 'selfhost'
      ? 'start'
      : setupMode;
  if (!startupReady)
    return (
      <div className="app onboarding-mode">
        <div className="window-chrome">
          <span className="window-wordmark">
            <img src="./reference-brand/brand/logo-symbol-white.svg" alt="" />
            Tayfa
          </span>
        </div>
        <StartupSplash />
      </div>
    );
  // Approved sign-up this device started; dismissible, and gone once signed in.
  if (showSignup)
    return (
      <div className="app onboarding-mode">
        <div className="window-chrome">
          <span className="window-wordmark">
            <img src="./reference-brand/brand/logo-symbol-white.svg" alt="" />
            Tayfa
          </span>
        </div>
        <ReferenceAuthFrame mode="register">
          <SignupPendingScreen />
        </ReferenceAuthFrame>
      </div>
    );
  if (setupMode === 'welcome' || (setupMode === 'invite' && !community.user))
    return (
      <Navigate
        replace
        to={`/setup/${defaultStartTab(new URLSearchParams(location.search))}${location.search}`}
      />
    );
  if (setupMode)
    return (
      <div className="app onboarding-mode">
        <div className="window-chrome">
          <span className="window-wordmark">
            <img src="./reference-brand/brand/logo-symbol-white.svg" alt="" />
            Tayfa
          </span>
        </div>
        {RecoveryFixtureEntry && localFixture.startsWith('S04/') ? (
          <Suspense fallback={null}>
            <RecoveryFixtureEntry variant={localFixture.split('/')[1] || 'default'} />
          </Suspense>
        ) : (
          <ReferenceOnboarding
            key={`${setupKey}-${settingsPage}`}
            mode={setupMode}
            onNavigate={(mode) => navigate(`/setup/${mode}${location.search}`)}
            onComplete={() => navigate('/home')}
            onOpenSettings={(tab) => navigate(`/settings?tab=${tab}`)}
          />
        )}
        {settingsPage && (
          <Modal
            title={t('Ayarlar')}
            hideHeading
            onClose={closeSettings}
            className="settings-modal"
          >
            <Suspense fallback={<LoadingView />}>
              <Settings
                notify={notify}
                onClose={closeSettings}
                onInvite={() => {
                  if (closeSettings()) open('invite');
                }}
              />
            </Suspense>
          </Modal>
        )}
        {nativeInvite && community.user && (
          <InviteLanding invite={nativeInvite} onClose={closeInvite} notify={notify} />
        )}
        <FriendRequiredDialog notify={notify} />
        {toast && (
          <div role="status" className="toast">
            {toast}
          </div>
        )}
      </div>
    );
  return (
    <div
      className={`app minimal-room-ui ${hallView ? 'hall-mode' : ''} ${voiceView ? 'voice-mode' : ''} ${mediaView ? 'personal-media-mode' : ''} ${communityView ? 'community-mode' : ''} ${visiblePath === '/chat' || visiblePath === '/dm' ? 'chat-mode' : ''} ${realtime.channelId ? 'voice-active' : ''} ${channelNavOpen ? 'channel-nav-open' : ''} ${contextDrawerOpen ? 'context-drawer-open' : ''}`}
    >
      {<PushToTalk notify={notify} />}
      <div className="window-chrome">
        <div className="traffic-space">
          {import.meta.env.DEV && !window.rooms && !localFixture && (
            <span className="browser-preview">{tr('DESKTOP PREVIEW')}</span>
          )}
        </div>
        <span className="window-wordmark">
          <img src="./reference-brand/brand/logo-symbol-white.svg" alt="" />
          Tayfa
        </span>
        {import.meta.env.DEV && localFixture ? (
          <span className="window-private">
            <span
              className="demo-indicator"
              title={`Development-only visual fixture: ${localFixture}`}
            >
              {t('DEMO · Yerel örnek')}
            </span>
          </span>
        ) : null}
      </div>
      <div className={`app-layout ${settingsPage ? 'settings-background' : ''}`}>
        <button
          className="compact-nav-toggle"
          aria-label={channelNavOpen ? t('Kanal listesini kapat') : t('Kanal listesini aç')}
          aria-controls="rooms-navigation"
          aria-expanded={channelNavOpen}
          onClick={() => setChannelNavOpen((value) => !value)}
        >
          <Menu size={20} />
        </button>
        {channelNavOpen && (
          <button
            className="compact-nav-scrim"
            aria-label={t('Kanal listesini kapat')}
            onClick={() => setChannelNavOpen(false)}
          />
        )}
        {community.user && (
          <MinimalSidebar
            notify={notify}
            invite={() => open('invite')}
            joinInvite={setNativeInvite}
            createSpace={() => open('create-space')}
            editSpace={() => open('edit-space')}
            search={() => open('command')}
            help={() => open('help')}
          />
        )}
        <div className="workspace">
          <header className="toolbar minimal-toolbar">
            <div className="breadcrumb">
              {!chatHeadingVisible && <span title={breadcrumb}>{breadcrumb}</span>}
            </div>
            <div className="toolbar-actions">
              {!['/chat', '/home', '/messages'].includes(visiblePath) && (
                <IconButton
                  label={t('Sohbete dön')}
                  className="toolbar-icon"
                  onClick={() => {
                    if (voiceView && realtime.channelId)
                      void community
                        .openChannel(realtime.channelId)
                        .then(() => navigate('/chat'))
                        .catch((e) => notify(uiError(e)));
                    else navigate('/chat');
                  }}
                >
                  <ArrowLeft size={19} />
                </IconButton>
              )}
              <IconButton
                label={community.user ? 'DJ' : t('DJ için önce giriş yap.')}
                className="toolbar-icon"
                disabled={!community.user}
                onClick={openMusicDJ}
              >
                <Music2 size={19} />
              </IconButton>
              <IconButton
                label={t('Etkinlikler')}
                className="toolbar-icon"
                onClick={() => open('launcher')}
              >
                <LayoutGrid size={19} />
              </IconButton>
              <IconButton
                label={dmView ? t('Kişi bilgisi') : t('Üyeler')}
                className="toolbar-icon"
                disabled={!community.user}
                onClick={() => (dmView ? open('profile') : toggleContext())}
              >
                <Users size={19} />
              </IconButton>
              <IconButton
                label={t('Mesajlarda ara')}
                className="toolbar-icon"
                onClick={() => open('social-search')}
              >
                <Search size={19} />
              </IconButton>
              <QuietMenu label={t('Oda işlemleri')} compact>
                <button onClick={() => navigate('/files')}>{t('Dosyalar')}</button>
                <button onClick={() => open('invite')}>{t('Davet oluştur')}</button>
              </QuietMenu>
            </div>
          </header>
          {community.user && (community.status !== 'connected' || community.error) && (
            <div className={`connection-banner ${community.error ? 'error' : ''}`} role="status">
              <button className="connection-status-link" onClick={() => navigate('/status')}>
                {community.error ??
                  (community.status === 'reconnecting'
                    ? tr('Reconnecting to your community. Your last conversation is still here.')
                    : community.status === 'connecting'
                      ? tr('Connecting to your private community\u2026')
                      : tr('Your community connection is interrupted.'))}
              </button>
              <button className="text-button" onClick={() => navigate('/settings?tab=connections')}>
                {tr('Connection settings')}
                <ArrowRight size={12} />
              </button>
              {community.error && (
                <IconButton label={tr('Dismiss community error')} onClick={community.clearError}>
                  <X size={13} />
                </IconButton>
              )}
            </div>
          )}
          <div className="workspace-body">
            <main className="main-view">
              <Suspense fallback={<LoadingView label={tr('Opening your room\u2026')} />}>
                <Routes location={settingsPage ? returnFromSettings.current : location}>
                  <Route path="/status" element={<ConnectionStatusSurface />} />
                  <Route path="/home" element={<Home open={open} notify={notify} />} />
                  <Route path="/messages" element={<Messages notify={notify} />} />
                  <Route
                    path="/friends"
                    element={
                      community.user ? <FriendsPage notify={notify} /> : <ConnectionRequired />
                    }
                  />
                  <Route
                    path="/spaces"
                    element={
                      community.user ? <CommunitySpaces notify={notify} /> : <ConnectionRequired />
                    }
                  />
                  <Route
                    path="/notifications"
                    element={community.user ? <SocialNotificationsPage /> : <ConnectionRequired />}
                  />
                  <Route
                    path="/chat"
                    element={
                      community.user ? (
                        channelAccess ? (
                          channelAccess === 'checking' || channelAccess === 'unavailable' ? (
                            <SystemState
                              kind={channelAccess === 'checking' ? 'loading' : 'unavailable'}
                              onRetry={() => {
                                if (community.activeChannelId)
                                  void community.openChannel(community.activeChannelId);
                              }}
                              onReturn={() => navigate('/home')}
                            />
                          ) : (
                            <ChannelAccessState
                              kind="denied"
                              voiceConnected={realtime.status === 'connected'}
                              voiceRoomName={realtime.roomName ?? undefined}
                              onReturn={() => navigate('/home')}
                            />
                          )
                        ) : dmView ? (
                          <DirectMessageSurface notify={notify} />
                        ) : (
                          <RoomConversation notify={notify} openLauncher={() => open('launcher')} />
                        )
                      ) : (
                        <ConnectionRequired />
                      )
                    }
                  />
                  <Route
                    path="/voice"
                    element={
                      community.user ? (
                        <RoomConversation notify={notify} openLauncher={() => open('launcher')} />
                      ) : (
                        <ConnectionRequired />
                      )
                    }
                  />
                  <Route path="/dm-call" element={<></>} />
                  <Route
                    path="/dm"
                    element={
                      community.user ? (
                        <DirectMessageSurface notify={notify} />
                      ) : (
                        <ConnectionRequired />
                      )
                    }
                  />
                  <Route
                    path="/files"
                    element={
                      community.user ? (
                        <SharedFilesSurface
                          notify={notify}
                          onOpenMessage={(channelId, messageId) => {
                            void community
                              .openChannel(channelId)
                              .then(() =>
                                navigate(`/chat?message=${encodeURIComponent(messageId)}`),
                              )
                              .catch((error) =>
                                notify(
                                  friendlyActionError(
                                    error,
                                    t(
                                      'Bu mesajın kanalı açılamadı. Kanal listesinden yeniden dene.',
                                    ),
                                  ),
                                ),
                              );
                          }}
                        />
                      ) : (
                        <ConnectionRequired />
                      )
                    }
                  />
                  <Route
                    path="/media"
                    element={
                      PersonalMediaFixtureEntry && /^S3[3-9]\//.test(localFixture) ? (
                        <PersonalMediaFixtureEntry notify={notify} />
                      ) : (
                        <PersonalMedia notify={notify} />
                      )
                    }
                  />
                  <Route
                    path="/cinema"
                    element={
                      community.user ? <CinemaHall notify={notify} /> : <ConnectionRequired />
                    }
                  />
                  {['/studio', '/studio/:roomId', '/studio/:roomId/:projectId'].map((path) => (
                    <Route
                      key={path}
                      path={path}
                      element={community.user ? <StudioPage /> : <ConnectionRequired />}
                    />
                  ))}
                  <Route path="/polls" element={<Navigate to="/together?tab=polls" replace />} />
                  <Route path="/agent" element={<AgentWorkspace notify={notify} />} />
                  <Route path="/together" element={<Together />} />
                  <Route path="/games" element={<Games />} />
                  <Route
                    path="/youtube"
                    element={<MusicDJEntry returnTo={lastNonDJPath.current} />}
                  />
                  <Route path="*" element={<Navigate to="/home" replace />} />
                </Routes>
              </Suspense>
              <Suspense fallback={null}>
                <PersonalPlaybackRuntime notify={notify} />
              </Suspense>
              <DmCallRuntime />
            </main>
            {contextDrawerOpen && (
              <button
                className="context-panel-scrim"
                aria-label={t('Üye panelini kapat')}
                onClick={closeContext}
              />
            )}
            {community.user && contextVisible && !dmView && !settingsPage && (
              <RoomMembers notify={notify} onClose={closeContext} />
            )}
          </div>{' '}
        </div>
      </div>
      <RealVoiceDock
        showControls={voiceView && !settingsPage}
        openLauncher={() => open('launcher')}
        notify={notify}
      />
      {/* Route independent: registers the shared screen and answers control requests. */}
      <RemoteControlRuntime />
      <MusicDJ showTrigger={false} />
      <RoomEventSounds />
      <GameTurnNotice />
      <ParticipantAudioMenu />

      {settingsPage && (
        <section className="settings-modal settings-reference-surface" aria-label={t('Ayarlar')}>
          <Suspense fallback={<LoadingView />}>
            <Settings
              notify={notify}
              onClose={closeSettings}
              onInvite={() => {
                if (closeSettings()) open('invite');
              }}
            />
          </Suspense>
        </section>
      )}
      {nativeInvite && community.user && (
        <InviteLanding invite={nativeInvite} onClose={closeInvite} notify={notify} />
      )}
      {(overlay === 'create-space' || overlay === 'edit-space') && (
        <CommunityEditor
          mode={overlay === 'edit-space' ? 'edit' : 'create'}
          space={community.spaces.find((s) => s.id === activeSpace)}
          canEdit={
            community.spaces.find((s) => s.id === activeSpace)?.ownerId === community.user?.id ||
            communityAdmin
          }
          onClose={close}
          onSave={
            window.rooms && community.user
              ? async (name) => {
                  const result =
                    overlay === 'edit-space'
                      ? await window.rooms!.social.renameSpace(activeSpace!, name)
                      : await window.rooms!.social.createSpace(name);
                  await community.refresh();
                  return result;
                }
              : undefined
          }
          onSaved={(space) => {
            void community.openSpace(space.id);
          }}
        />
      )}
      <SocialReferenceOverlay
        onClose={() => {
          close();
          navigate('/chat');
        }}
      />
      {overlay === 'social-search' && <SocialSearchDialog onClose={close} />}
      {overlay === 'profile' && (
        <UserProfileDialog
          user={
            dmView
              ? community.dms
                  .find((dm) => dm.id === community.activeChannelId)
                  ?.recipients?.find((person) => person.id !== community.user?.id)
              : undefined
          }
          onClose={close}
        />
      )}
      {overlay === 'launcher' && <ActivityLauncher onClose={close} />}
      {overlay === 'command' && <CommandPalette onClose={close} />}

      {overlay === 'help' && (
        <Modal title={t('Klavye kısayolları')} onClose={close}>
          {[
            [tr('Command palette'), '⌘ / Ctrl K'],
            ...shortcutRoutes.map(
              ({ label }, index) => [label, `⌘ / Ctrl ${index + 1}`] as [string, string],
            ),
            [t('Ayarlar'), '⌘ / Ctrl ,'],
            [tr('Mute your room mic'), '⌘ / Ctrl Shift M'],
            [tr('Push to talk (when enabled)'), 'Ctrl Shift Space'],
            [tr('Play / pause (Cinema)'), 'Space'],
            [tr('Seek backward / forward'), '← / →'],
            [tr('Close an overlay'), 'Esc'],
            [tr('Send a message'), 'Enter'],
            [tr('New line in a message'), 'Shift Enter'],
          ].map(([label, key]) => (
            <div className="shortcut-row" key={label}>
              <span>{label}</span>
              <kbd>{key}</kbd>
            </div>
          ))}
          <p className="modal-footnote">
            {tr('Playback keys never interrupt typing in a message.')}
          </p>
        </Modal>
      )}
      {overlay === 'invite' && <CommunityInvite onClose={close} notify={notify} />}

      <FriendRequiredDialog notify={notify} />
      {toast && (
        <div role="status" className="toast glass">
          <span>{toast}</span>
          <IconButton label={tr('Dismiss notification')} onClick={() => setToast('')}>
            <X size={14} />
          </IconButton>
        </div>
      )}
    </div>
  );
}
function ConnectionRequired() {
  return (
    <div className="home-page page-enter">
      <ConnectionPane />
    </div>
  );
}
