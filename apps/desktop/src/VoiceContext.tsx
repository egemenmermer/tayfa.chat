import { useState } from 'react';
import { IconButton } from '@rooms/design';
import { useRealtime, setParticipantVolume } from './realtime';
import { PersonVolumeSlider } from './PersonVolumeSlider';
import { ReferenceIcon } from './ReferenceIcon';
import { VoiceAvatar } from './VoiceAvatar';
import { t } from './i18n';

/** The room inspector reads the persistent transport; volumes are local playback only. */
export function VoiceContext({
  onClose,
  openLauncher,
  invite,
}: {
  onClose(): void;
  openLauncher(): void;
  invite(): void;
}) {
  const media = useRealtime();
  const [selected, setSelected] = useState<string | null>(null);
  const participant =
    media.participants.find((p) => p.id === selected && !p.local) ??
    media.participants.find((p) => p.speaking && !p.local) ??
    media.participants.find((p) => !p.local);
  const connected = media.status === 'connected';
  return (
    <aside className="voice-context-panel">
      <header>
        <span>{media.roomName || t('SES ODASI')}</span>
        <IconButton label={t('Oda panelini kapat')} onClick={onClose}>
          <ReferenceIcon name="close" size={18} />
        </IconButton>
      </header>
      <div className="voice-context-body">
        <div className="voice-context-title">
          <strong>{t('Odadakiler {count}', { count: media.participants.length })}</strong>
          <IconButton label={t('Arkadaş davet et')} onClick={invite}>
            <ReferenceIcon name="plus" size={18} />
          </IconButton>
        </div>
        {media.participants.map((p) => (
          <button
            key={p.id}
            data-voice-participant-id={p.id}
            className="voice-context-member"
            onClick={() => setSelected(p.id)}
            aria-pressed={participant?.id === p.id}
          >
            <span className="voice-context-avatar">
              <VoiceAvatar id={p.id} name={p.name} />
              {connected && <i />}
            </span>
            <span>
              <strong>{p.local ? t('{name} (sen)', { name: p.name }) : p.name}</strong>
              {p.muted ? (
                <small>{t('Mikrofon kapalı')}</small>
              ) : connected && p.speaking ? (
                <small>{t('Konuşuyor')}</small>
              ) : null}
            </span>
            <ReferenceIcon name={p.muted ? 'mic-off' : 'mic'} size={14} />
          </button>
        ))}
        {participant && (
          <section className="voice-context-volume">
            <h3>{t('Kişi sesi')}</h3>
            <div>
              <VoiceAvatar id={participant.id} name={participant.name} />
              <span>{participant.name}</span>
              <span>{t('%{percent}', { percent: Math.round(participant.volume * 100) })}</span>
            </div>
            <PersonVolumeSlider
              label={t('{name} kişisel ses seviyesi', { name: participant.name })}
              value={participant.volume}
              disabled={!connected}
              onChange={(value) => setParticipantVolume(participant.id, value)}
            />
            <p>{t('Yalnızca senin duyduğun ses değişir.')}</p>
          </section>
        )}
        <section className="voice-context-activity">
          <ReferenceIcon name="film" size={20} />
          <h3>{t('Bu akşam ne yapıyoruz?')}</h3>
          <p>{t('Film, YouTube ya da bir oyun. Sesli sohbet kaldığı yerden sürer.')}</p>
          <button className="button secondary" onClick={openLauncher}>
            {t('Etkinliklere göz at')}
          </button>
        </section>
      </div>
    </aside>
  );
}
