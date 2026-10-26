import { openRoomActivity } from './MusicDJ';
import './reference-voice.css';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@rooms/design';
import { ReferenceIcon } from './ReferenceIcon';
import { useCommunity } from './community';
import { useRealtime, stopScreen } from './realtime';
import { useActivityRoom } from './activity';
import { t, uiError } from './i18n';
import { gameNames } from './Kiraathane';
import { endsActivity } from '../../../packages/activity-protocol/src/index';
import { AppDirectory } from './AppDirectory';
import { activityRoute } from './activity-route';

export function ActivityLauncher({ onClose }: { onClose(): void }) {
  const community = useCommunity(),
    voice = useRealtime(),
    navigate = useNavigate();
  const roomId = voice.channelId ?? community.activeChannelId;
  const activity = useActivityRoom(roomId);
  const [error, setError] = useState('');
  const primary = activity.room?.primary;
  const self = activity.room?.participants.find((p) => p.userId === community.user?.id);
  const forbidden = !primary && self?.canControl === false;
  // Anyone may join; only the host ends a shared player for everyone.
  const canEnd =
    !!primary && endsActivity(primary, community.user?.id, self ? self.canControl : true);
  const open = (path: string) => {
    openRoomActivity(path, navigate);
    onClose();
  };
  const route = primary ? activityRoute(primary.activity) : null;
  // Nothing running: the searchable catalogue of everything the room can start.
  if (!primary && !forbidden)
    return (
      <Modal title={t('Etkinlikler')} hideHeading onClose={onClose} className="appdir-modal">
        <AppDirectory apps={false} onClose={onClose} />
      </Modal>
    );
  return (
    <Modal
      title={
        primary
          ? t('Devam eden etkinlik')
          : forbidden
            ? t('Etkinlik başlatılamıyor')
            : t('Etkinlikler')
      }
      onClose={onClose}
      className={`launcher-modal reference-launcher-modal ${primary ? 'has-active-activity' : ''} ${forbidden ? 'is-forbidden' : ''}`}
    >
      {primary ? (
        <>
          <div className="reference-active-activity">
            <span className="reference-activity-mark">
              <ReferenceIcon
                name={
                  !route || primary.activity === 'hall'
                    ? 'film'
                    : primary.activity === 'screen'
                      ? 'monitor'
                      : 'cards'
                }
                size={23}
              />
            </span>
            <div>
              <strong>
                {(gameNames as Record<string, string>)[primary.title] ?? primary.title}
              </strong>
              <small>
                {!route
                  ? t('Eski Sinema · bu sürümde açılmıyor')
                  : primary.activity === 'hall'
                    ? t('Sinema salonu')
                    : primary.activity === 'screen'
                      ? t('Ekran paylaşımı')
                      : t('Oyunlar')}
              </small>
            </div>
            <span className="reference-live-pill">{t('Etkin')}</span>
          </div>
          {!route && (
            <p className="modal-description">
              {t('Bu oturum eski Sinema’dan kalma ve bu sürümde açılmıyor.')}{' '}
              {canEnd
                ? t('Bitirirsen odada yeni bir etkinlik başlatabilirsin.')
                : t('Oturumun hostu bitirince odada yeni bir etkinlik başlatabilirsin.')}
            </p>
          )}
          <div className="button-row">
            {canEnd && (
              <button
                className="button secondary"
                disabled={activity.busy}
                onClick={() => {
                  setError('');
                  void (async () => {
                    if (primary.activity === 'screen' && voice.sharing) await stopScreen();
                    await activity.send({ type: 'end' });
                  })().catch((e) => setError(uiError(e)));
                }}
              >
                {activity.busy ? t('Bitiriliyor…') : t('Etkinliği bitir')}
              </button>
            )}
            {route ? (
              <button className="button primary" onClick={() => open(route)}>
                {self ? t('Aç') : t('Katıl')}
              </button>
            ) : (
              <button className="button secondary" onClick={onClose}>
                {t('Kapat')}
              </button>
            )}
          </div>
        </>
      ) : forbidden ? (
        <>
          <div className="reference-media-notice" role="alert">
            <ReferenceIcon name="lock" size={18} />
            <span>
              {t(
                'Bu odada etkinlik başlatma yetkin yok. Biri etkinlik açınca buradan katılabilir veya bir oda yöneticisinden yardım isteyebilirsin.',
              )}
            </span>
          </div>
          <p className="modal-description">
            {t('Sesli sohbetin ve erişebildiğin kanallar çalışmaya devam eder.')}
          </p>
        </>
      ) : null}
      {forbidden && (
        <button className="button secondary" onClick={() => open('/games')}>
          <ReferenceIcon name="cards" size={16} />
          {t('Oyunlar')}
        </button>
      )}
      {error && (
        <div className="reference-media-notice" role="alert">
          {error}
        </div>
      )}
      {!primary && (
        <div className="button-row reference-launcher-footer">
          <button className="button secondary" onClick={onClose}>
            {t('Kapat')}
          </button>
        </div>
      )}
    </Modal>
  );
}
