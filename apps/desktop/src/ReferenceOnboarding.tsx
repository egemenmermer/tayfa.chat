import { defaultServer } from './default-server';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Mail,
  Mic,
  Monitor,
  Square,
  Users,
  Video,
} from 'lucide-react';
import { inviteAppLink, inviteShareLink, parseInviteLink, type SocialInvite } from '@rooms/social';
import type { SocialBridge, SocialPasswordRecoveryCapabilities } from '@rooms/contracts';
import { PasswordResetPane } from './PasswordResetPane';
import { ConnectionPane, sameInviteServer } from './ConnectionPane';
import { SelfHostSteps } from './SelfHostSteps';
import { START_PANEL_ID, StartTabs, startTabId } from './StartTabs';
import { VoiceAvatar } from './VoiceAvatar';
import { useCommunity } from './community';
import { useRooms } from './store';
import { t, uiError } from './i18n';
import { chooseCroppedAvatar } from './AvatarCrop';
import './reference-onboarding.css';

export type ReferenceOnboardingMode =
  'welcome' | 'signin' | 'register' | 'selfhost' | 'recovery' | 'invite' | 'profile' | 'devices';

export const SESSION_EXPIRED_MESSAGE = t('Oturumunun süresi doldu. Çıkış yapıp yeniden giriş yap.');

/**
 * Tab the start screen opens on: someone who has used a server before (or whose session expired)
 * most likely wants to sign in again. An invitation means signing up, unless this device already
 * used the invitation's server: then the account exists and signing in joins the community.
 */
export function defaultStartTab(params: URLSearchParams): 'register' | 'signin' {
  const saved = useRooms.getState().preferences.serverUrl.trim();
  if (params.get('invite')) {
    const server = params.get('server');
    return saved && server && sameInviteServer(saved, server) ? 'signin' : 'register';
  }
  const c = useCommunity.getState();
  const expired = !c.user && c.status === 'error' && c.error === SESSION_EXPIRED_MESSAGE;
  return expired || saved ? 'signin' : 'register';
}
export interface ReferenceOnboardingProps {
  mode: ReferenceOnboardingMode;
  onNavigate(mode: ReferenceOnboardingMode): void;
  onComplete?(): void;
  /** No longer used: the avatar pick and the mic test run inline. App can stop passing it. */
  onOpenSettings?(tab: 'profile' | 'audio'): void;
}

const OS_NAMES: Record<string, string> = { darwin: 'macOS', win32: 'Windows', linux: 'Linux' };

/** Human OS name for the running desktop app, or null outside it. */
export function platformName(platform = window.rooms?.platform): string | null {
  return (platform && OS_NAMES[platform]) || null;
}

const MIC_DENIED = () =>
  t('Mikrofon izni kapalı. Sistem ayarlarının gizlilik bölümünden Tayfa’ya mikrofon izni ver.');

/**
 * First-run microphone check: pick the input (the same preference voice rooms use) and watch a
 * local level meter. Nothing is sent anywhere; the stream stops on "end", on a device change and
 * when the step unmounts.
 */
export function OnboardingMicTest({ onGranted }: { onGranted?(): void }) {
  const inputId = useRooms((state) => state.preferences.inputId);
  const setPreference = useRooms((state) => state.setPreference);
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices;
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState('');
  const epoch = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const audio = useRef<AudioContext | null>(null);
  const frame = useRef(0);
  const stop = useCallback(() => {
    epoch.current++;
    cancelAnimationFrame(frame.current);
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (audio.current) void audio.current.close().catch(() => {});
    audio.current = null;
    setTesting(false);
    setLevel(0);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const list = await media?.enumerateDevices();
      if (list) setDevices(list);
    } catch {
      // The picker keeps "System default"; the test itself reports a missing device.
    }
  }, [media]);
  useEffect(() => {
    if (!media) return;
    void refresh();
    const changed = () => void refresh();
    media.addEventListener?.('devicechange', changed);
    return () => {
      media.removeEventListener?.('devicechange', changed);
      stop();
    };
  }, [media, refresh, stop]);
  if (!media?.getUserMedia) return null;
  const start = async () => {
    if (testing) {
      stop();
      return;
    }
    stop();
    setError('');
    const current = epoch.current;
    try {
      const next = await media.getUserMedia({
        audio: inputId ? { deviceId: { exact: inputId } } : true,
        video: false,
      });
      if (current !== epoch.current) {
        next.getTracks().forEach((track) => track.stop());
        return;
      }
      stream.current = next;
      const context = new AudioContext();
      audio.current = context;
      const analyser = context.createAnalyser();
      analyser.fftSize = 256;
      context.createMediaStreamSource(next).connect(analyser);
      const values = new Uint8Array(analyser.frequencyBinCount);
      let last = 0;
      const tick = (now: number) => {
        if (current !== epoch.current) return;
        if (now - last > 100) {
          analyser.getByteFrequencyData(values);
          setLevel(Math.min(100, (values.reduce((a, b) => a + b, 0) / values.length) * 1.8));
          last = now;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
      setTesting(true);
      onGranted?.();
      // Device names are only readable once permission is granted.
      void refresh();
      next.getAudioTracks()[0]?.addEventListener('ended', () => {
        if (current !== epoch.current) return;
        stop();
        setError(t('Seçili mikrofon kullanılamıyor. Başka bir mikrofon seç.'));
      });
    } catch (e) {
      if (current !== epoch.current) return;
      stop();
      setError(
        e instanceof DOMException && e.name === 'NotAllowedError'
          ? MIC_DENIED()
          : t('Seçili mikrofon kullanılamıyor. Başka bir mikrofon seç.'),
      );
    }
  };
  // Before permission, Chromium may list unnamed inputs with an empty id: "System default" covers them.
  const inputs = devices.filter(
    (d) => d.kind === 'audioinput' && d.deviceId && d.deviceId !== 'default',
  );
  const percent = Math.round(level);
  return (
    <div className="ref-auth-device-card">
      <label className="field-label">
        {t('Mikrofon')}
        <select
          value={inputId}
          onChange={(e) => {
            stop();
            setPreference('inputId', e.target.value);
          }}
        >
          <option value="">{t('Sistem varsayılanı')}</option>
          {inputId && !inputs.some((d) => d.deviceId === inputId) && (
            <option value={inputId}>{t('Seçili mikrofon kullanılamıyor')}</option>
          )}
          {inputs.map((d, i) => (
            <option key={d.deviceId} value={d.deviceId}>
              {d.label || t('Mikrofon {number}', { number: i + 1 })}
            </option>
          ))}
        </select>
      </label>
      <div
        className="ref-auth-meter"
        role="meter"
        aria-label={t('Mikrofon giriş seviyesi')}
        aria-valuenow={percent}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        {Array.from({ length: 20 }, (_, i) => (
          <i key={i} className={testing && i < level / 5 ? 'on' : ''} />
        ))}
      </div>
      <p className="ref-auth-help">
        {testing
          ? t('Konuş; çubuklar sesinle birlikte hareket etmeli.')
          : t('Ses yalnızca bu cihazda ölçülür, kimseye gönderilmez.')}
      </p>
      <button type="button" className="button secondary full" onClick={() => void start()}>
        {testing ? <Square size={15} /> : <Mic size={15} />}
        {testing ? t('Denemeyi bitir') : t('Mikrofonu dene')}
      </button>
      {error && (
        <div className="ref-auth-notice warning" role="alert">
          {error}
        </div>
      )}
    </div>
  );
}

/** Account-neutral recovery request; reset link ingress is a separate main-only operation. */
export function PasswordRecoveryPane({
  serverUrl,
  onBack,
  onReset,
  bridge,
}: {
  serverUrl: string;
  onBack(): void;
  onReset?(): void;
  bridge?: Pick<SocialBridge, 'passwordRecoveryCapabilities' | 'requestPasswordRecovery'> | null;
}) {
  const social = bridge === undefined ? window.rooms?.social : bridge;
  const [email, setEmail] = useState('');
  const [capabilities, setCapabilities] = useState<SocialPasswordRecoveryCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const notice = useRef<HTMLDivElement>(null);
  const load = async () => {
    const epoch = ++generation.current;
    setLoading(true);
    setCapabilities(null);
    setError('');
    setAccepted(false);
    setBusy(false);
    if (!serverUrl.trim()) {
      setLoading(false);
      setError(t('Giriş ekranından sunucu adresini seç.'));
      return;
    }
    try {
      if (!social?.passwordRecoveryCapabilities)
        throw new Error(t('Kurtarma isteği yalnızca masaüstü uygulamasında kullanılabilir.'));
      const result = await social.passwordRecoveryCapabilities(serverUrl);
      if (epoch === generation.current) setCapabilities(result);
    } catch {
      if (epoch === generation.current)
        setError(
          t(
            'Sunucunun kurtarma ayarları alınamadı. Bağlantını ve giriş ekranındaki sunucu adresini kontrol et.',
          ),
        );
    } finally {
      if (epoch === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    setEmail('');
    void load();
    return () => {
      generation.current++;
    };
  }, [serverUrl, social]);
  useEffect(() => {
    if (accepted || error) notice.current?.focus();
  }, [accepted, error]);
  const reason = loading
    ? t('Sunucu ayarları alınıyor…')
    : !social?.requestPasswordRecovery
      ? t('Kurtarma isteği yalnızca masaüstü uygulamasında kullanılabilir.')
      : !capabilities
        ? t('Sunucunun kurtarma ayarları doğrulanamadı.')
        : !capabilities.emailEnabled
          ? t('Sunucuda kurtarma e-postası yapılandırılmamış.')
          : capabilities.captcha.required
            ? t('Sunucu hCaptcha doğrulaması istiyor. Kurtarmayı Stoat web uygulamasından başlat.')
            : null;
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (reason || busy || !email.trim() || !social) return;
    const epoch = ++generation.current;
    setBusy(true);
    setError('');
    try {
      await social.requestPasswordRecovery({ serverUrl, email: email.trim() });
      if (epoch === generation.current) {
        setEmail('');
        setAccepted(true);
      }
    } catch {
      if (epoch === generation.current)
        setError(t('Kurtarma isteği tamamlanamadı. Biraz bekleyip yeniden dene.'));
    } finally {
      if (epoch === generation.current) setBusy(false);
    }
  };
  return (
    <div className="ref-auth-recovery" aria-busy={loading || busy}>
      <h2>{t('Şifre kurtarma')}</h2>
      {accepted ? (
        <div className="ref-auth-notice recovery-accepted" role="status" tabIndex={-1} ref={notice}>
          <Mail size={18} />
          <span>
            {t(
              'İstek kabul edildi. Hesap uygunsa sunucunun e-posta kurtarma bağlantısıyla devam edebilirsin.',
            )}
          </span>
        </div>
      ) : (
        <>
          <p className="ref-auth-help">{t('Kayıtlı e-posta adresi')}</p>
          <form onSubmit={(event) => void submit(event)}>
            <label className="field-label">
              {t('E-posta adresi')}
              <input
                required
                type="email"
                autoComplete="email"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={254}
                value={email}
                disabled={busy}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {reason && (
              <div className="ref-auth-notice" role="status">
                <Mail size={17} />
                <span>{reason}</span>
              </div>
            )}
            <button
              className="button primary full"
              disabled={!!reason || busy || !email.trim()}
              title={reason ?? undefined}
            >
              {busy ? t('İstek gönderiliyor…') : t('Kurtarma isteği gönder')}
              <ArrowRight size={16} />
            </button>
          </form>
          {error && (
            <div className="ref-auth-notice error" role="alert" tabIndex={-1} ref={notice}>
              {error}
            </div>
          )}
          {!loading && !capabilities && (
            <button className="button secondary full" onClick={() => void load()}>
              {t('Yeniden bağlan')}
            </button>
          )}
        </>
      )}
      {onReset && (
        <button className="button secondary full" disabled={busy} onClick={onReset}>
          {t('Kurtarma bağlantım var')}
        </button>
      )}
      <button className="ref-auth-back" onClick={onBack}>
        <ArrowLeft size={14} />
        {t('Giriş ekranına dön')}
      </button>
    </div>
  );
}

export function ReferenceAuthFrame({
  mode,
  children,
}: {
  mode: ReferenceOnboardingMode;
  children: React.ReactNode;
}) {
  return (
    <main className={`ref-onboarding mode-${mode}`}>
      <div className="ref-auth-content">
        <aside className="ref-auth-art" aria-label="Tayfa">
          <div className="ref-auth-wordmark">
            <img src="./reference-brand/brand/logo-symbol-lilac.svg" alt="" />
            Tayfa
          </div>
          <div className="ref-auth-sculpture" aria-hidden="true">
            <div className="ref-auth-portal" />
          </div>
        </aside>
        <div className="ref-auth-panel">{children}</div>
      </div>
    </main>
  );
}

/** Reference geometry with real native account operations; no prototype scenario state. */
export function ReferenceOnboarding({ mode, onNavigate, onComplete }: ReferenceOnboardingProps) {
  const c = useCommunity();
  const recoveryServer = useRooms((state) => state.preferences.serverUrl.trim() || defaultServer);
  const [recoveryView, setRecoveryView] = useState<'request' | 'reset'>('request');
  const resetBridge = window.rooms?.social;
  const resetAvailable =
    !!resetBridge &&
    [
      resetBridge.importPasswordRecoveryLink,
      resetBridge.confirmPasswordRecovery,
      resetBridge.cancelPasswordRecovery,
    ].every((method) => typeof method === 'function');
  const recoveryScope = `${c.serverUrl}:${c.user?.id ?? 'signed-out'}:${c.status}`;
  const sessionExpired = !c.user && c.status === 'error' && c.error === SESSION_EXPIRED_MESSAGE;
  const [params, setParams] = useSearchParams();
  const [link, setLink] = useState(() => {
    const code = params.get('invite') || '',
      from = params.get('server') || '';
    return (from && (inviteShareLink(from, code) ?? inviteAppLink(from, code))) || code;
  });
  const [server, setServer] = useState(
    () => params.get('server') || c.serverUrl || useRooms.getState().preferences.serverUrl,
  );
  const [invite, setInvite] = useState<SocialInvite | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState(c.user?.displayName || c.user?.username || '');
  const [status, setStatus] = useState('');
  const [permissions, setPermissions] = useState<{
    microphone: string;
    camera: string;
    screen: string;
  } | null>(null);
  const request = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    setName(c.user?.displayName || c.user?.username || '');
  }, [c.user?.id, c.user?.displayName, c.user?.username]);
  const permissionEpoch = useRef(0);
  const loadPermissions = useCallback(() => {
    const epoch = ++permissionEpoch.current;
    const media = window.rooms?.media;
    if (!media?.captureStatus) return;
    void media
      .captureStatus()
      .then((status) => {
        if (epoch === permissionEpoch.current) setPermissions(status);
      })
      .catch((e) => {
        if (epoch === permissionEpoch.current) setError(uiError(e));
      });
  }, []);
  useEffect(() => {
    setBusy(false);
    setError('');
    setRecoveryView('request');
    if (mode === 'devices') loadPermissions();
    return () => {
      permissionEpoch.current++;
      request.current++;
    };
  }, [mode, loadPermissions]);
  const inspect = async () => {
    if (busy || !link.trim()) return;
    const parsed = parseInviteLink(link, {
      fallbackServer: params.get('server') || c.serverUrl || defaultServer,
    });
    setError('');
    setInvite(null);
    if (!parsed) {
      setError(
        t(
          'Bu bir Tayfa davet bağlantısı değil. Seni davet eden kişinin gönderdiği bağlantıyı yapıştır.',
        ),
      );
      return;
    }
    const epoch = ++request.current;
    setBusy(true);
    try {
      if (!window.rooms)
        throw new Error(t('Davetler yalnızca masaüstü uygulamasında doğrulanabilir.'));
      const result = await window.rooms.social.inspectInvite(parsed.serverUrl, parsed.code);
      if (epoch !== request.current) return;
      setServer(parsed.serverUrl);
      setInvite(result);
      const next = new URLSearchParams(params);
      next.set('invite', parsed.code);
      next.set('server', parsed.serverUrl);
      setParams(next, { replace: true });
    } catch (e) {
      if (epoch === request.current) setError(uiError(e));
    } finally {
      if (epoch === request.current) setBusy(false);
    }
  };
  const join = async () => {
    if (busy || !invite || !c.user) return;
    setBusy(true);
    setError('');
    try {
      await c.acceptInvite(invite.code);
      const next = new URLSearchParams(params);
      next.delete('invite');
      setParams(next, { replace: true });
      // Someone already signed in joined another community: no first-run steps again.
      if (onComplete) onComplete();
      else onNavigate('profile');
    } catch (e) {
      setError(uiError(e));
    } finally {
      setBusy(false);
    }
  };
  const avatarAvailable = typeof window.rooms?.social?.chooseAvatar === 'function';
  const pickAvatar = async () => {
    if (busy || !c.user || !avatarAvailable) return;
    const epoch = ++request.current;
    setBusy(true);
    setError('');
    try {
      // Null means the picker was cancelled.
      const user = await chooseCroppedAvatar();
      if (user && epoch === request.current) useCommunity.setState({ user });
    } catch (e) {
      if (epoch === request.current) setError(uiError(e));
    } finally {
      if (epoch === request.current) setBusy(false);
    }
  };
  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !c.user || !name.trim()) return;
    setBusy(true);
    setError('');
    try {
      if (!window.rooms)
        throw new Error(t('Profil yalnızca masaüstü uygulamasında kaydedilebilir.'));
      const user = await window.rooms.social.updateProfile({
        displayName: name.trim(),
        ...(status.trim() ? { statusText: status.trim() } : {}),
      });
      useCommunity.setState({ user });
      onNavigate('devices');
    } catch (e) {
      setError(uiError(e));
    } finally {
      setBusy(false);
    }
  };
  const expires = invite?.expiresAt ? Date.parse(invite.expiresAt) : NaN;
  const expired = Number.isFinite(expires) && expires <= Date.now();
  const sameServer = sameInviteServer(c.serverUrl || '', server || '');
  const os = platformName();
  return (
    <ReferenceAuthFrame mode={mode}>
      {mode === 'signin' || mode === 'register' || mode === 'selfhost' ? (
        <div className="ref-start">
          <StartTabs active={mode} onSelect={onNavigate} />
          <div role="tabpanel" id={START_PANEL_ID} aria-labelledby={startTabId(mode)}>
            {mode === 'selfhost' ? (
              <SelfHostSteps onSignIn={() => onNavigate('signin')} />
            ) : (
              <ConnectionPane
                referenceMode={mode}
                sessionExpired={sessionExpired}
                // Profile and device steps are for a new account; signing in goes to the app.
                onAuthenticated={() =>
                  mode === 'register' || !onComplete ? onNavigate('profile') : onComplete()
                }
                onRecovery={() => onNavigate('recovery')}
              />
            )}
          </div>
        </div>
      ) : (
        <section className="ref-auth-form" aria-busy={busy}>
          {(mode === 'profile' || mode === 'devices') && (
            <div className="ref-auth-steps">
              <span aria-hidden="true">
                <i className="active" />
                <i className={mode === 'devices' ? 'active' : ''} />
              </span>
              <span>
                {mode === 'profile'
                  ? t('{step}/2 · Profil', { step: 1 })
                  : t('{step}/2 · Cihazlar', { step: 2 })}
              </span>
            </div>
          )}
          {mode === 'recovery' &&
            (recoveryView === 'reset' ? (
              <PasswordResetPane
                key={recoveryScope + recoveryServer}
                serverUrl={recoveryServer}
                scopeKey={recoveryScope}
                bridge={resetAvailable ? resetBridge : null}
                onBack={() => onNavigate('signin')}
                onNewRequest={() => setRecoveryView('request')}
              />
            ) : (
              <PasswordRecoveryPane
                serverUrl={recoveryServer}
                onBack={() => onNavigate('signin')}
                onReset={() => setRecoveryView('reset')}
              />
            ))}
          {mode === 'invite' && (
            <>
              <h2>{expired ? t('Davetin süresi doldu') : t('Topluluk daveti')}</h2>
              <p>
                {invite
                  ? t('Topluluk davetini incele.')
                  : t('Arkadaşından gelen davet bağlantısını yapıştır.')}
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void inspect();
                }}
              >
                <fieldset disabled={busy}>
                  <label className="field-label">
                    {t('Davet bağlantısı')}
                    <input
                      required
                      autoComplete="off"
                      autoCapitalize="none"
                      maxLength={4096}
                      spellCheck={false}
                      value={link}
                      placeholder="https://…/davet/…"
                      onChange={(e) => {
                        setLink(e.target.value);
                        setInvite(null);
                        setError('');
                      }}
                    />
                  </label>
                  <button className="button secondary full" disabled={busy || !link.trim()}>
                    {busy ? t('Davet açılıyor…') : t('Daveti aç')}
                    <ChevronRight size={16} />
                  </button>
                </fieldset>
              </form>
              {invite && (
                <div className="ref-auth-invite">
                  <span className="ref-auth-community-icon">
                    <Users size={25} />
                  </span>
                  <h3>{invite.space?.name || invite.channel?.name || t('Topluluk')}</h3>
                  {invite.channel?.name && <p>#{invite.channel.name}</p>}
                  {expired ? (
                    <div className="ref-auth-notice">{t('Arkadaşından yeni bir davet iste.')}</div>
                  ) : c.user ? (
                    <>
                      <button
                        className="button primary full"
                        disabled={busy || !sameServer}
                        onClick={() => void join()}
                      >
                        {t('Daveti kabul et')}
                        <ArrowRight size={16} />
                      </button>
                      {!sameServer && (
                        <>
                          <p className="ref-auth-help">
                            {t(
                              'Bu davet başka bir sunucuda. Çıkış yapınca davetle kayıt olabilir ya da o sunucudaki hesabınla giriş yapabilirsin.',
                            )}
                          </p>
                          {/* Signed out, App sends /setup/invite with these params to Kayıt ol. */}
                          <button
                            className="button secondary full"
                            disabled={busy}
                            onClick={() => {
                              setBusy(true);
                              void c
                                .logout()
                                .catch((e) => setError(uiError(e)))
                                .finally(() => setBusy(false));
                            }}
                          >
                            {t('Çıkış yap ve davetle devam et')}
                            <ArrowRight size={16} />
                          </button>
                        </>
                      )}
                    </>
                  ) : (
                    <button className="button primary full" onClick={() => onNavigate('register')}>
                      {t('Kayıt ol ve katıl')}
                      <ArrowRight size={16} />
                    </button>
                  )}
                </div>
              )}
              <button
                className="ref-auth-back"
                disabled={busy || !onComplete}
                onClick={() => onComplete?.()}
              >
                <ArrowLeft size={14} />
                {t('Geri dön')}
              </button>
            </>
          )}
          {mode === 'profile' && (
            <>
              <h2>{t('Profil')}</h2>
              {c.user ? (
                <form onSubmit={(e) => void saveProfile(e)}>
                  <fieldset disabled={busy}>
                    <div className="ref-auth-avatar">
                      <VoiceAvatar id={c.user.id} name={name || c.user.username} large />
                      {avatarAvailable && (
                        <button
                          type="button"
                          className="button secondary"
                          onClick={() => void pickAvatar()}
                        >
                          {t('Avatar seç')}
                        </button>
                      )}
                    </div>
                    <label className="field-label">
                      {t('Görünen ad')}
                      <input
                        required
                        maxLength={32}
                        autoComplete="nickname"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                      />
                    </label>
                    <label className="field-label">
                      {t('Durum')}
                      <input
                        maxLength={128}
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                      />
                    </label>
                    <p className="ref-auth-help">
                      {t('Bunları daha sonra profilinden değiştirebilirsin.')}
                    </p>
                    <button className="button primary full" disabled={busy || !name.trim()}>
                      {busy ? t('Kaydediliyor…') : t('Devam et')}
                      <ArrowRight size={16} />
                    </button>
                    <button
                      type="button"
                      className="ref-auth-back"
                      onClick={() => onNavigate('devices')}
                    >
                      {t('Şimdilik atla')}
                    </button>
                  </fieldset>
                </form>
              ) : (
                <>
                  <div className="ref-auth-notice">
                    {t('Profilini hazırlamak için önce hesabına giriş yap.')}
                  </div>
                  <button className="button primary full" onClick={() => onNavigate('signin')}>
                    {t('Giriş yap')}
                  </button>
                </>
              )}
            </>
          )}
          {mode === 'devices' && (
            <>
              <h2>{t('Cihazlar')}</h2>
              <p>{t('İzinleri yalnızca ilgili özelliği kullandığında isteyeceğiz.')}</p>
              {permissions?.microphone === 'denied' && (
                <div className="ref-auth-notice warning">{MIC_DENIED()}</div>
              )}
              <div className="ref-auth-permission">
                <Mic size={22} />
                <div>
                  <strong>{t('Mikrofon')}</strong>
                  <p>
                    {permissions?.microphone === 'granted'
                      ? t('İzin verildi')
                      : permissions?.microphone === 'denied'
                        ? t('İzin kapalı')
                        : t('Sesli konuşmak için')}
                  </p>
                </div>
              </div>
              <div className="ref-auth-permission">
                <Video size={22} />
                <div>
                  <strong>{t('Kamera')}</strong>
                  <p>{t('İlk görüntülü görüşmede seçebilirsin.')}</p>
                </div>
                <span>{t('İsteğe bağlı')}</span>
              </div>
              <div className="ref-auth-permission">
                <Monitor size={22} />
                <div>
                  <strong>{t('Ekran paylaşımı')}</strong>
                  <p>{t('Paylaşımı başlatırken izin istenir.')}</p>
                </div>
                <span>{t('İsteğe bağlı')}</span>
              </div>
              <OnboardingMicTest onGranted={loadPermissions} />
              <button
                className="button primary full"
                disabled={!onComplete}
                title={
                  onComplete ? undefined : t('Topluluk bağlantısı bu görünümde henüz bağlanmadı.')
                }
                onClick={onComplete}
              >
                {t('Topluluğuma gir')}
                <ArrowRight size={16} />
              </button>
              {os && (
                <p className="ref-auth-footer">
                  {t('Sistem izinleri {os} tarafından gösterilir.', { os })}
                </p>
              )}
            </>
          )}
          {error && (
            <div className="ref-auth-notice error" ref={errorRef} tabIndex={-1} role="alert">
              {error}
            </div>
          )}
        </section>
      )}
    </ReferenceAuthFrame>
  );
}
