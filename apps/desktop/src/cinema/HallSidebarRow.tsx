import { Clapperboard } from 'lucide-react';
import { useActivityRoom } from '../activity';
import { t } from '../i18n';
import { VoiceAvatar } from '../VoiceAvatar';
import { useCommunityCinema } from './cinema-status';
import { useGuides, useNow } from './guide-cache';
import { hallProgress, isHallItem, programmeAt } from './hall-model';
import './hall-sidebar.css';

/**
 * The permanent "Sinema" entry under the community header. While the hall plays, it shows
 * what is on and who is watching, like a voice room shows who is talking.
 */
export function HallSidebarRow({ selected, onOpen }: { selected: boolean; onOpen(): void }) {
  const cinema = useCommunityCinema();
  if (!cinema.available || !cinema.status) return null;
  if (!cinema.hallId && !cinema.status.isOwner) return null;
  return cinema.hallId ? (
    <PlayingRow hallId={cinema.hallId} selected={selected} onOpen={onOpen} />
  ) : (
    <button className={`minimal-nav hall-nav ${selected ? 'selected' : ''}`} onClick={onOpen}>
      <Clapperboard size={15} />
      <span>{t('Sinema')}</span>
      <small className="hall-nav-hint">{t('Kur')}</small>
    </button>
  );
}

function PlayingRow({
  hallId,
  selected,
  onOpen,
}: {
  hallId: string;
  selected: boolean;
  onOpen(): void;
}) {
  const activity = useActivityRoom(hallId);
  const room = activity.status === 'connected' ? activity.room : null;
  const { current } = hallProgress(room);
  const item = isHallItem(current) ? current : null;
  const now = useNow(60_000);
  const guides = useGuides(hallId, item?.media.live ? [item.media.ref] : []);
  const onAir = item?.media.live ? programmeAt(guides[item.media.ref], now) : null;
  const viewers = room?.primary ? room.participants : [];
  const playing = !!current && !!room?.primary;
  const live = !!item?.media.live;
  const detail = playing ? [current!.media.title, onAir?.title].filter(Boolean).join(' · ') : null;
  return (
    <button
      className={`minimal-nav hall-nav ${selected ? 'selected' : ''} ${playing ? 'playing' : ''}`}
      onClick={onOpen}
      aria-label={
        playing
          ? t('Sinema: {detail}. {count} kişi izliyor.', {
              detail: detail ?? '',
              count: viewers.length,
            })
          : t('Sinema salonu')
      }
    >
      <span className="hall-nav-icon">
        <Clapperboard size={15} />
        {playing && live && <i className="hall-live-dot" />}
      </span>
      <span className="hall-nav-text">
        <span>{t('Sinema')}</span>
        {detail && <small>{detail}</small>}
      </span>
      {viewers.length > 0 && (
        <span className="hall-nav-viewers" aria-hidden="true">
          {viewers.slice(0, 3).map((person) => (
            <VoiceAvatar key={person.userId} id={person.userId} name={person.displayName} />
          ))}
          {viewers.length > 3 && <small>+{viewers.length - 3}</small>}
        </span>
      )}
    </button>
  );
}
