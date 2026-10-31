import { VoiceAvatar } from './VoiceAvatar';
import { locale, t, uiError } from './i18n';
import { chooseCroppedAvatar } from './AvatarCrop';
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  Check,
  MessageCircle,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { Avatar, IconButton, Modal } from '@rooms/design';
import type { SocialFriend } from '@rooms/social';
import { useCommunity } from './community';
import { useRealtime } from './realtime';
const friendStatus: Record<SocialFriend['status'], string> = {
  online: t('Çevrimiçi'),
  idle: t('Uzakta'),
  dnd: t('Rahatsız etmeyin'),
  invisible: t('Çevrimdışı'),
  unknown: t('Durum bilinmiyor'),
};
const relation: Record<SocialFriend['relationship'], string> = {
  friend: t('Arkadaş'),
  incoming: t('Gelen istek'),
  outgoing: t('İstek gönderildi'),
  blocked: t('Engellendi'),
};
export function FriendsPanel({
  notify,
  onClose,
}: {
  notify(message: string): void;
  onClose?(): void;
}) {
  const c = useCommunity(),
    r = useRealtime(),
    navigate = useNavigate();
  const [friends, setFriends] = useState<SocialFriend[]>([]),
    [show, setShow] = useState(false),
    [username, setUsername] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('fixture')) {
      setFriends((await import('./dev/reference-fixtures')).getReferenceFriends());
      return;
    }
    if (!window.rooms?.social || !c.user) {
      if (import.meta.env.DEV && new URLSearchParams(location.search).has('fixture')) {
        const fixtures = await import('./dev/reference-fixtures');
        setFriends(fixtures.getReferenceFriends());
      } else setFriends([]);
      return;
    }
    try {
      setFriends(await window.rooms.social.friends());
      setError('');
    } catch (e) {
      setError(uiError(e));
    }
  }, [c.user?.id]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    return () => clearInterval(timer);
  }, [refresh]);
  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (e) {
      setError(uiError(e));
    } finally {
      setBusy(false);
    }
  };
  const visibleFriends = friends
    .filter((friend) => friend.relationship !== 'blocked')
    .map((friend) => {
      const live = c.presence[friend.user.id];
      const status: SocialFriend['status'] =
        c.status !== 'connected'
          ? 'unknown'
          : live && Object.hasOwn(friendStatus, live)
            ? (live as SocialFriend['status'])
            : friend.status;
      return { ...friend, status };
    })
    .sort((left, right) => {
      const rank: Record<SocialFriend['status'], number> = {
        online: 0,
        idle: 1,
        dnd: 2,
        invisible: 3,
        unknown: 4,
      };
      return (
        rank[left.status] - rank[right.status] ||
        (left.user.displayName || left.user.username).localeCompare(
          right.user.displayName || right.user.username,
          locale,
        )
      );
    });
  return (
    <aside className="friends-panel">
      <div className="friends-title">
        <h3>{t('Dostların')}</h3>
        {onClose && (
          <IconButton label={t('Üye panelini kapat')} onClick={onClose}>
            <X size={18} />
          </IconButton>
        )}
        <IconButton label={t('Arkadaş ekle')} onClick={() => setShow(true)}>
          <Plus size={16} />
        </IconButton>
      </div>
      <div className="section-label">
        <span>{t('ARKADAŞLARIN')}</span>
        <IconButton label={t('Arkadaşları yenile')} onClick={() => void refresh()}>
          <RefreshCw size={12} />
        </IconButton>
      </div>
      {visibleFriends.length ? (
        visibleFriends.map((f) => (
          <div className="friend-relationship" key={f.user.id}>
            <button
              className="friend-row"
              onClick={() => {
                if (f.relationship === 'friend')
                  void c
                    .createDM(f.user.id)
                    .then(() => navigate('/chat'))
                    .catch((e) => notify(uiError(e)));
                else setShow(true);
              }}
            >
              <VoiceAvatar id={f.user.id} name={f.user.displayName || f.user.username} />
              <div>
                <strong>{f.user.displayName || f.user.username}</strong>
                <small>
                  {f.relationship === 'friend' ? friendStatus[f.status] : relation[f.relationship]}
                </small>
              </div>
              {f.relationship === 'friend' && <MessageCircle size={13} />}
            </button>
            {f.relationship === 'incoming' && (
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    window.rooms!.social.addFriend(
                      `${f.user.username}${f.user.discriminator ? '#' + f.user.discriminator : ''}`,
                    ),
                  )
                }
              >
                <Check size={12} />
                {t('Kabul et')}
              </button>
            )}
          </div>
        ))
      ) : (
        <div className="friends-empty">
          <Users size={23} />
          <p>{t('Arkadaş yok')}</p>
          <button className="text-button" onClick={() => setShow(true)}>
            {t('Arkadaş ekle')}
            <Plus size={12} />
          </button>
        </div>
      )}
      {r.participants.length > 0 && (
        <>
          <div className="section-label">
            <span>{t('SES ODAN')}</span>
            <span>{r.participants.length}</span>
          </div>
          {r.participants.map((p) => (
            <button className="friend-row" key={p.id} onClick={() => navigate('/voice')}>
              <Avatar name={p.name} />
              <div>
                <strong>{p.name}</strong>
                <small>
                  {p.muted ? t('Mikrofon kapalı') : p.speaking ? t('Konuşuyor') : t('Dinliyor')}
                </small>
              </div>
            </button>
          ))}
        </>
      )}
      {error && (
        <p className="friends-error" role="status">
          {error}
        </p>
      )}
      {show && (
        <Modal title={t('Arkadaş ekle')} onClose={() => setShow(false)}>
          <p className="modal-description">
            {t('Arkadaşının tam Stoat kullanıcı adını ve varsa numarasını gir.')}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await window.rooms!.social.addFriend(username.trim());
                setUsername('');
                notify(t('Arkadaşlık isteği sunucuya gönderildi.'));
              });
            }}
          >
            <label className="field-label">
              {t('KULLANICI ADI')}
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                placeholder={t('kullanici#1234')}
                maxLength={80}
              />
            </label>
            <button className="button primary full" disabled={busy || !username.trim()}>
              <Plus size={16} />
              {t('Arkadaşlık isteği gönder')}
            </button>
          </form>
          <div className="friends-management">
            {friends.map((f) => (
              <div className="model-row" key={f.user.id}>
                <VoiceAvatar id={f.user.id} name={f.user.displayName || f.user.username} />
                <div>
                  <strong>{f.user.displayName || f.user.username}</strong>
                  <small>{relation[f.relationship]}</small>
                </div>
                {f.relationship === 'incoming' && (
                  <button
                    className="button secondary small"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        window.rooms!.social.addFriend(
                          `${f.user.username}${f.user.discriminator ? '#' + f.user.discriminator : ''}`,
                        ),
                      )
                    }
                  >
                    {t('Kabul et')}
                  </button>
                )}
                <IconButton
                  label={
                    f.relationship === 'outgoing'
                      ? t('Arkadaşlık isteğini iptal et')
                      : f.relationship === 'incoming'
                        ? t('İsteği reddet')
                        : t('Arkadaşlık bağlantısını kaldır')
                  }
                  disabled={busy}
                  onClick={() => void run(() => window.rooms!.social.removeFriend(f.user.id))}
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
            ))}
          </div>
          {error && (
            <div className="error-pane" role="alert">
              {error}
            </div>
          )}
        </Modal>
      )}
    </aside>
  );
}
export function AccountProfile({ notify }: { notify(message: string): void }) {
  const c = useCommunity();
  const [name, setName] = useState(c.user?.displayName ?? ''),
    [bio, setBio] = useState(''),
    [status, setStatus] = useState(''),
    [presence, setPresence] = useState<'online' | 'idle' | 'dnd' | 'invisible'>('online'),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <>
      <h3>{t('Profil')}</h3>
      <div className="profile-photo-control">
        {c.user && <VoiceAvatar id={c.user.id} name={c.user.displayName} large />}
        <button
          className="button secondary small"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void chooseCroppedAvatar()
              .then((photo) => {
                if (photo) notify(t('Fotoğraf güncellendi.'));
              })
              .catch((e) => setError(uiError(e)))
              .finally(() => setBusy(false));
          }}
        >
          {t('Fotoğraf değiştir')}
        </button>
        <small>PNG, JPEG, WebP · 10 MB</small>
      </div>
      <div className="profile-preview">
        <Avatar name={c.user?.displayName || c.user?.username || t('Sen')} size="large" />
        <div>
          <h3>{c.user?.displayName}</h3>
          <span className="small-tag">{t('STOAT HESABIN')}</span>
        </div>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          void window
            .rooms!.social.updateProfile({
              displayName: name.trim(),
              ...(bio.trim() ? { bio: bio.trim() } : {}),
              ...(status.trim() ? { statusText: status.trim() } : {}),
            })
            .then((user) => {
              useCommunity.setState({ user });
              notify(t('Profilin sunucuda güncellendi.'));
            })
            .catch((e) => setError(uiError(e)))
            .finally(() => setBusy(false));
        }}
      >
        <label className="field-label">
          {t('GÖRÜNEN AD')}
          <input required maxLength={32} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="field-label">
          {t('HAKKINDA · DEĞİŞTİRMEK İÇİN YAZ')}
          <textarea
            maxLength={2000}
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={t('Hakkında')}
          />
        </label>
        <label className="field-label">
          {t('DURUM MESAJI · DEĞİŞTİRMEK İÇİN YAZ')}
          <input
            maxLength={128}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            placeholder={t('Durum')}
          />
        </label>
        <button className="button primary" disabled={busy || !name.trim()}>
          <Check size={16} />
          {t('Profili kaydet')}
        </button>
      </form>
      <div className="settings-row">
        <div>
          <h4>{t('Görünürlük')}</h4>
          <p>{t('Durumunu sunucuna bildir. Görünmezken çevrimiçi olarak gösterilmezsin.')}</p>
        </div>
        <select
          aria-label={t('Topluluk görünürlüğü')}
          value={presence}
          onChange={(e) => {
            const value = e.target.value as typeof presence;
            setBusy(true);
            void c
              .setPresence(value)
              .then(() => {
                setPresence(value);
                notify(t('Görünürlük sunucuda güncellendi.'));
              })
              .catch((e) => setError(uiError(e)))
              .finally(() => setBusy(false));
          }}
          disabled={busy}
        >
          <option value="online">{t('Çevrimiçi')}</option>
          <option value="idle">{t('Uzakta')}</option>
          <option value="dnd">{t('Rahatsız etmeyin')}</option>
          <option value="invisible">{t('Görünmez')}</option>
        </select>
      </div>
      {error && (
        <div className="error-pane" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
