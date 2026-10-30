import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { SocialMember, SocialUser } from '@rooms/social';
import { IconButton } from '@rooms/design';
import { useCommunity } from './community';
import { useRealtime } from './realtime';
import { VoiceAvatar } from './VoiceAvatar';
import { ReferenceIcon } from './ReferenceIcon';
import { t, uiError } from './i18n';
import { sample } from './dev/sample';
import { queryClient } from './query-client';
import { ROOM_MEMBERS_STALE_MS, roomMembersQuery } from './room-members';
import { directMessageFailed } from './FriendRequiredDialog';

const EMPTY: SocialMember[] = [];

async function fixtureMembers(user: SocialUser | null): Promise<SocialMember[]> {
  const fixture = await import('./dev/reference-fixtures');
  const next: SocialMember[] = fixture.getReferenceFriends().map((f) => ({
    user: f.user,
    status: f.status,
    statusText: fixture.getReferencePresenceText(f.user.id),
    roles: [],
  }));
  if (user)
    next.unshift({
      user,
      status: 'online',
      statusText: sample('Buradayım', "I'm here"),
      roles: [],
    });
  return next;
}

export function RoomMembers({
  onClose,
  notify,
}: {
  onClose(): void;
  notify(message: string): void;
}) {
  const c = useCommunity(),
    media = useRealtime(),
    navigate = useNavigate();
  const fixture = import.meta.env.DEV && new URLSearchParams(location.search).has('fixture');
  const enabled = fixture ? !!c.user : !!(c.activeSpaceId && window.rooms);
  const spaceKey = fixture ? 'fixture' : c.activeSpaceId;
  const query = useQuery(
    {
      ...roomMembersQuery(
        c.serverUrl,
        c.user?.id,
        spaceKey ?? '',
        fixture ? () => fixtureMembers(c.user) : undefined,
      ),
      enabled,
      // Cached members render at once; this keeps them fresh in the background while visible.
      refetchInterval: () => (document.hidden ? false : ROOM_MEMBERS_STALE_MS),
    },
    queryClient,
  );
  useEffect(() => {
    const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['room-members'] });
    window.addEventListener('rooms:community-management-invalidated', invalidate);
    return () => window.removeEventListener('rooms:community-management-invalidated', invalidate);
  }, []);
  const members = query.data ?? EMPTY;
  const error = query.error ? uiError(query.error) : '';
  const loading = query.isLoading;
  const visible = members.map((member) => ({
    ...member,
    status: c.status === 'connected' ? (c.presence[member.user.id] ?? member.status) : 'unknown',
  }));
  const online = visible.filter((m) => ['online', 'idle', 'dnd'].includes(m.status));
  const offline = visible.filter((m) => m.status === 'invisible');
  const unknown = visible.filter((m) => m.status === 'unknown');
  const group = (label: string, rows: typeof visible) =>
    rows.length > 0 && (
      <section className="room-member-group">
        <h6>
          {label} — {rows.length}
        </h6>
        {rows.map((member) => {
          const participant = media.participants.find((p) => p.id === member.user.id);
          return (
            <button
              className={`room-member-row ${member.status === 'invisible' ? 'offline' : ''}`}
              key={member.user.id}
              onClick={() => {
                if (member.user.id === c.user?.id) navigate('/settings?tab=profile');
                else
                  void c
                    .createDM(member.user.id)
                    .then(() => navigate('/chat'))
                    .catch((e) => directMessageFailed(e, member.user, notify));
              }}
            >
              <span className="room-member-photo">
                <VoiceAvatar id={member.user.id} name={member.user.displayName} />
                <i
                  className={`member-presence ${member.status}`}
                  aria-label={
                    member.status === 'online'
                      ? t('Çevrimiçi')
                      : member.status === 'invisible'
                        ? t('Çevrimdışı')
                        : member.status === 'unknown'
                          ? t('Durum bilinmiyor')
                          : t('Uzakta')
                  }
                />
              </span>
              <span>
                <strong>
                  {member.user.displayName || member.user.username}
                  {member.user.id === c.user?.id && <small>{t('sen')}</small>}
                </strong>
                <em>
                  {member.statusText ||
                    (participant
                      ? participant.muted
                        ? t('Mikrofon kapalı')
                        : participant.speaking
                          ? t('Konuşuyor')
                          : media.roomName
                      : member.statusText ||
                        (member.status === 'invisible'
                          ? t('Çevrimdışı')
                          : member.status === 'unknown'
                            ? t('Durum bilinmiyor')
                            : t('Çevrimiçi')))}
                </em>
              </span>
            </button>
          );
        })}
      </section>
    );
  return (
    <aside className="room-members-panel">
      <header>
        <span>{t('ODA ÜYELERİ')}</span>
        <IconButton label={t('Üye panelini kapat')} onClick={onClose}>
          <ReferenceIcon name="close" size={18} />
        </IconButton>
      </header>
      <div className="room-members-body">
        {loading && <p role="status">{t('Üyeler yükleniyor…')}</p>}
        {group(t('ÇEVRİMİÇİ'), online)}
        {group(t('ÇEVRİMDIŞI'), offline)}
        {group(t('DURUM BİLİNMİYOR'), unknown)}
        {!loading && !members.length && !error && <p>{t('Üye yok.')}</p>}
        {error && (
          <p role="alert" className="friends-error">
            {error}
          </p>
        )}
      </div>
    </aside>
  );
}
