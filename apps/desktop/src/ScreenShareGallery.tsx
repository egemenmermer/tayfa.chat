import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Maximize, Minimize, Monitor, ExternalLink, X, Volume2, VolumeX } from 'lucide-react';
import {
  screenQualityChoices,
  screenQualitySelection,
  type MediaTrack,
  type MediaParticipant,
  type ScreenLayer,
  type ScreenViewQuality,
} from '@rooms/media';
import { t, uiError } from './i18n';
import './screen-share-gallery.css';
import { RemoteControlActions, RemoteViewerInput } from './RemoteControl';
import { OWN_SHARE_ATTRIBUTE } from './ShareMenu';
export function ScreenShareGallery({
  tracks,
  people,
  renderTrack,
  notify,
  initialTrackId,
  onWatch,
  onVolume,
  quality = 'auto',
  onQuality,
  onClose,
}: {
  onWatch?(participantId: string | null): void;
  onVolume?(participantId: string, volume: number): void;
  /** This viewer's remembered screen quality; the picker shows it on remote streams. */
  quality?: ScreenViewQuality;
  onQuality?(quality: ScreenViewQuality): void;
  onClose?(): void;
  initialTrackId?: string;
  tracks: MediaTrack[];
  people: MediaParticipant[];
  renderTrack(id: string, label: string): ReactNode;
  notify(message: string): void;
}) {
  const [selected, setSelected] = useState<string | null>(initialTrackId ?? null),
    [fullscreen, setFullscreen] = useState(false),
    stage = useRef<HTMLDivElement>(null);
  useEffect(() => setSelected(initialTrackId ?? null), [initialTrackId]);
  const active = tracks.find((track) => track.id === selected) ?? tracks[0];
  const participant = people.find((p) => p.id === active?.participantId);
  const watched = active && !active.local ? active.participantId : null;
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);
  useEffect(() => {
    // A provider without watch control (or a failed announce) must not take the whole view down.
    const watch = (id: string | null) => {
      try {
        onWatch?.(id);
      } catch (e) {
        notifyRef.current(uiError(e));
      }
    };
    watch(watched);
    return () => watch(null);
  }, [watched, onWatch]);
  const name = (track: MediaTrack) => {
    const person = people.find((p) => p.id === track.participantId)?.name ?? t('Katılımcı');
    return track.local ? t('{name} (sen)', { name: person }) : person;
  };
  useEffect(() => {
    const node = stage.current;
    const changed = () => setFullscreen(document.fullscreenElement === node);
    document.addEventListener('fullscreenchange', changed);
    return () => {
      document.removeEventListener('fullscreenchange', changed);
      if (document.pictureInPictureElement && node?.contains(document.pictureInPictureElement))
        void document.exitPictureInPicture().catch(() => {});
      if (document.fullscreenElement === node) void document.exitFullscreen().catch(() => {});
    };
  }, []);
  const separate = () => {
    const video = stage.current?.querySelector('video');
    if (!video || video.readyState < 2) {
      notify(t('Video henüz hazır değil.'));
      return;
    }
    void (
      document.pictureInPictureElement
        ? document.exitPictureInPicture()
        : video.requestPictureInPicture()
    ).catch((e) => notify(uiError(e)));
  };
  const maximize = () => {
    const node = stage.current;
    if (!node) return;
    void (
      document.fullscreenElement === node ? document.exitFullscreen() : node.requestFullscreen()
    ).catch((e) => notify(uiError(e)));
  };
  return (
    <div className="room-screen-gallery">
      <div
        ref={stage}
        className="room-screen-focus"
        data-screen-focus
        // Your own tile: right-click, or Shift+F10 / the menu key, opens the stream settings.
        {...(active?.local
          ? { [OWN_SHARE_ATTRIBUTE]: '', tabIndex: 0, 'aria-haspopup': 'menu' as const }
          : {})}
      >
        {active &&
          (active.subscribed === false ? (
            <p className="room-screen-waiting" role="status">
              {t('Yayın açılıyor…')}
            </p>
          ) : (
            renderTrack(active.id, t('{name} ekranı', { name: name(active) }))
          ))}
        <RemoteViewerInput track={active} videoRoot={stage} />
        <div className="room-screen-overlay">
          <span>
            <Monitor size={15} />
            {active ? name(active) : t('Paylaşım sona erdi')}
          </span>
          <div>
            {onVolume && active && !active.local && participant?.screenAudio === false && (
              <span
                className="room-screen-volume no-sound"
                role="status"
                title={t('Paylaşan sesi açmadı ya da sesi paylaşılamıyor.')}
              >
                <VolumeX size={16} />
                {t('Bu yayında ses yok')}
              </span>
            )}
            {onVolume && active && !active.local && participant?.screenAudio !== false && (
              <label className="room-screen-volume">
                <Volume2 size={16} />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  aria-label={t('{name} yayın sesi', { name: name(active) })}
                  value={participant?.screenVolume ?? 1}
                  onChange={(event) => onVolume(active.participantId, Number(event.target.value))}
                />
              </label>
            )}
            {onQuality && active && !active.local && active.subscribed !== false && (
              <ScreenQualityPicker
                layers={active.layers ?? []}
                quality={quality}
                onChange={(value) => {
                  try {
                    onQuality(value);
                  } catch (e) {
                    notify(uiError(e));
                  }
                }}
              />
            )}
            <button
              aria-label={t('Paylaşımı ayrı pencerede izle')}
              disabled={!active || !document.pictureInPictureEnabled}
              onClick={separate}
            >
              <ExternalLink size={18} />
            </button>
            <button
              aria-label={
                fullscreen ? t('Paylaşımı tam ekrandan çıkar') : t('Paylaşımı tam ekran izle')
              }
              disabled={!active || !document.fullscreenEnabled}
              onClick={maximize}
            >
              {fullscreen ? <Minimize size={18} /> : <Maximize size={18} />}
            </button>
            {onClose && (
              <button aria-label={t('İzlemeyi kapat')} onClick={onClose}>
                <X size={18} />
              </button>
            )}
          </div>
        </div>
      </div>
      <RemoteControlActions track={active} />
      {tracks.length > 1 && (
        <div className="room-screen-thumbnails" aria-label={t('Paylaşılan ekranlar')}>
          {tracks.map((track) => (
            <button
              key={track.id}
              aria-pressed={active?.id === track.id}
              aria-label={t('{name} ekranını büyüt', { name: name(track) })}
              onClick={() => setSelected(track.id)}
            >
              {track.subscribed === false ? (
                <Monitor size={22} aria-hidden="true" />
              ) : (
                renderTrack(track.id, t('{name} küçük önizleme', { name: name(track) }))
              )}
              <span>
                <Monitor size={13} />
                {name(track)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
/**
 * Viewer quality for a remote screen share: Otomatik or one of the layers the publisher sends.
 * A single-layer stream (simulcast off) shows that one quality and says why there is no choice.
 */
export function ScreenQualityPicker({
  layers,
  quality,
  onChange,
}: {
  layers: readonly ScreenLayer[];
  quality: ScreenViewQuality;
  onChange(quality: ScreenViewQuality): void;
}) {
  const hint = useId();
  const choices = screenQualityChoices(layers);
  if (!choices.length) return null;
  const single = choices.length === 1;
  const explanation = t('Bu yayın tek kalitede geliyor; seçilecek başka kalite yok.');
  return (
    <label className="room-screen-quality" title={single ? explanation : undefined}>
      <select
        aria-label={t('Görüntü kalitesi')}
        aria-describedby={single ? hint : undefined}
        // aria-disabled, not disabled: the explanation must stay reachable with the keyboard.
        aria-disabled={single || undefined}
        value={single ? String(choices[0]) : String(screenQualitySelection(layers, quality))}
        onChange={(event) => {
          if (!single)
            onChange(event.target.value === 'auto' ? 'auto' : Number(event.target.value));
        }}
      >
        {!single && <option value="auto">{t('Otomatik (en yüksek)')}</option>}
        {choices.map((lines) => (
          <option key={lines} value={String(lines)}>
            {`${lines}p`}
          </option>
        ))}
      </select>
      {single && (
        <span id={hint} className="room-screen-quality-hint">
          {explanation}
        </span>
      )}
    </label>
  );
}
