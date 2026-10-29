import { locale, t, uiError } from './i18n';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Globe, Link, LoaderCircle, ShieldCheck, Users } from 'lucide-react';
import { Modal } from '@rooms/design';
import { parseInviteLink, type InviteLink, type SocialInvite } from '@rooms/social';
import { useCommunity } from './community';
import { sameInviteServer } from './ConnectionPane';
import './onboarding.css';

export function InviteLanding({
  invite,
  onClose,
  notify,
}: {
  invite: { serverUrl: string; code: string };
  onClose(): void;
  notify(message: string): void;
}) {
  const c = useCommunity(),
    navigate = useNavigate();
  const [preview, setPreview] = useState<SocialInvite | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const sameServer = sameInviteServer(c.serverUrl, invite.serverUrl);
  let host = invite.serverUrl;
  try {
    host = new URL(invite.serverUrl).host;
  } catch {
    /* Native validation rejects malformed invitation URLs. */
  }

  useEffect(() => {
    let stale = false;
    setLoading(true);
    setError('');
    setPreview(null);
    const inspect = async () => {
      try {
        if (!window.rooms?.social)
          throw new Error(t('Daveti açmak için Tayfa masaüstü uygulamasını kullan.'));
        const value = await window.rooms.social.inspectInvite(invite.serverUrl, invite.code);
        if (!stale) setPreview(value);
      } catch (err) {
        if (!stale) setError(uiError(err));
      } finally {
        if (!stale) setLoading(false);
      }
    };
    void inspect();
    return () => {
      stale = true;
    };
  }, [invite.serverUrl, invite.code, attempt]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);

  // Signing out keeps this invitation pending; the app then opens Kayıt ol with it pre-filled.
  const switchServer = async () => {
    setBusy(true);
    try {
      await c.logout();
    } catch (err) {
      setError(uiError(err));
    } finally {
      setBusy(false);
    }
  };
  const accept = async () => {
    if (busy || loading || !preview) return;
    setBusy(true);
    setError('');
    try {
      await c.acceptInvite(invite.code);
      notify(t('Davet kabul edildi. Topluluğuna hoş geldin.'));
      onClose();
      // Land in the community the invite named; the list is the fallback when it is not known yet.
      const spaceId = preview.space?.id;
      if (spaceId && useCommunity.getState().spaces.some((space) => space.id === spaceId)) {
        navigate('/chat');
        await c.openSpace(spaceId).catch(() => {});
      } else navigate('/spaces');
    } catch (err) {
      setError(uiError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t('Topluluk daveti')} onClose={onClose} className="rooms-invitation">
      <div className="invitation-art" aria-hidden="true">
        <Users size={29} />
      </div>
      {loading ? (
        <p className="modal-description invitation-loading" role="status">
          <LoaderCircle size={16} className="spin" />
          {t('Davet kontrol ediliyor…')}
        </p>
      ) : (
        <div className="invitation-copy">
          <h3>
            {preview?.space?.name ?? (error ? t('Davet açılamadı.') : t('Özel topluluk daveti'))}
          </h3>
          {preview && (
            <p className="modal-description">
              {preview.channel?.name
                ? t('{channel} kanalına davetlisin.', { channel: preview.channel.name })
                : t('Dostlarının topluluğuna katılmak için davet edildin.')}
            </p>
          )}
        </div>
      )}
      <div className="connection-info">
        <Globe size={14} />
        <span>{host}</span>
      </div>
      {preview?.expiresAt && (
        <p className="modal-footnote">
          {t('Son kullanım: {date}', { date: new Date(preview.expiresAt).toLocaleString(locale) })}
        </p>
      )}
      {!sameServer && (
        <div className="settings-note">
          <ShieldCheck size={18} />
          <p>
            {t(
              'Farklı bir sunucuda oturumun açık. Bu davete katılmak için çıkış yap; ardından davetle kayıt olabilir ya da o sunucudaki hesabınla giriş yapabilirsin.',
            )}
          </p>
        </div>
      )}
      {error && (
        <div className="error-pane onboarding-error" ref={errorRef} tabIndex={-1} role="alert">
          <p>{error}</p>
          <button
            className="text-button invitation-retry"
            disabled={busy || loading}
            onClick={() => setAttempt((value) => value + 1)}
          >
            {t('Daveti yeniden kontrol et')}
            <ArrowRight size={13} />
          </button>
        </div>
      )}
      <button
        className="button primary full"
        disabled={loading || busy || !preview || !sameServer}
        onClick={() => void accept()}
      >
        {busy ? (
          <>
            <LoaderCircle size={16} className="spin" />
            {t('Katılınıyor…')}
          </>
        ) : (
          <>
            {t('Daveti kabul et')}
            <ArrowRight size={16} />
          </>
        )}
      </button>
      {!sameServer && (
        <button
          className="button secondary full"
          disabled={busy}
          onClick={() => void switchServer()}
        >
          {t('Çıkış yap ve davetle devam et')}
          <ArrowRight size={15} />
        </button>
      )}
    </Modal>
  );
}

/**
 * Signed-in entry for a link received outside the app (chat, mail, the web page): it only reads the
 * link; InviteLanding previews it and joins through the same server-side checks as a clicked link.
 */
export function JoinWithInviteDialog({
  onClose,
  onInvite,
}: {
  onClose(): void;
  onInvite(invite: InviteLink): void;
}) {
  const serverUrl = useCommunity((state) => state.serverUrl);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const link = parseInviteLink(value, { fallbackServer: serverUrl });
    if (!link) {
      setError(
        t(
          'Bu bir Tayfa davet bağlantısı değil. Seni davet eden kişinin gönderdiği bağlantıyı yapıştır.',
        ),
      );
      return;
    }
    onClose();
    onInvite(link);
  };
  return (
    <Modal title={t('Davet bağlantısıyla katıl')} onClose={onClose} className="rooms-invitation">
      <form onSubmit={submit}>
        <p className="modal-description">
          {t(
            'Arkadaşının gönderdiği davet bağlantısını yapıştır. Katılmadan önce topluluğu görürsün.',
          )}
        </p>
        <label className="field-label">
          {t('Davet bağlantısı')}
          <input
            required
            autoFocus
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            placeholder="https://…/davet/…"
            value={value}
            maxLength={4096}
            aria-invalid={error ? true : undefined}
            onChange={(event) => {
              setValue(event.target.value);
              setError('');
            }}
          />
        </label>
        {error && (
          <div className="error-pane onboarding-error" role="alert">
            <p>{error}</p>
          </div>
        )}
        <button type="submit" className="button primary full" disabled={!value.trim()}>
          <Link size={16} />
          {t('Daveti aç')}
        </button>
      </form>
    </Modal>
  );
}
