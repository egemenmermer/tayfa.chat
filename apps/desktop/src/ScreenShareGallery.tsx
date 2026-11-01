import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import {
  Maximize,
  Minimize,
  Monitor,
  ExternalLink,
  PanelBottomClose,
  PanelBottomOpen,
  X,
  Volume2,
  VolumeX,
} from 'lucide-react';
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
  quality = 'source',
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
    [stripHidden, setStripHidden] = useState(false),
    stage = useRef<HTMLDivElement>(null),
    // The level each stream had before the speaker button muted it, to give it back.
    unmuted = useRef(new Map<string, number>());
  useEffect(() => setSelected(initialTrackId ?? null), [initialTrackId]);
  const active = tracks.find((track) => track.id === selected) ?? tracks[0];
  const participant = people.find((p) => p.id === active?.participantId);
  const watched = active && !active.local ? active.participantId : null;
  const received = useReceivedLines(stage, active?.id);
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
              <div className="room-screen-volume">
                <button
                  className={(participant?.screenVolume ?? 1) === 0 ? 'muted' : undefined}
                  aria-pressed={(participant?.screenVolume ?? 1) === 0}
                  aria-label={t('{name} yayınını sessize al', { name: name(active) })}
                  title={(participant?.screenVolume ?? 1) === 0 ? t('Sesi aç') : t('Sessize al')}
                  onClick={() => {
                    const id = active.participantId;
                    const level = participant?.screenVolume ?? 1;
                    if (level > 0) {
                      unmuted.current.set(id, level);
                      onVolume(id, 0);
                    } else onVolume(id, unmuted.current.get(id) ?? 1);
                  }}
                >
                  {(participant?.screenVolume ?? 1) === 0 ? (
                    <VolumeX size={16} />
                  ) : (
                    <Volume2 size={16} />
                  )}
                </button>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  aria-label={t('{name} yayın sesi', { name: name(active) })}
                  value={participant?.screenVolume ?? 1}
                  onChange={(event) => onVolume(active.participantId, Number(event.target.value))}
                />
              </div>
            )}
            {onQuality && active && !active.local && active.subscribed !== false && (
              <ScreenQualityPicker
                layers={active.layers ?? []}
                quality={quality}
                received={received}
                onChange={(value) => {
                  try {
                    onQuality(value);
                  } catch (e) {
                    notify(uiError(e));
                  }
                }}
              />
            )}
            {tracks.length > 1 && (
              <button
                aria-pressed={stripHidden}
                aria-label={stripHidden ? t('Diğer yayınları göster') : t('Diğer yayınları gizle')}
                title={stripHidden ? t('Diğer yayınları göster') : t('Diğer yayınları gizle')}
                onClick={() => setStripHidden((hidden) => !hidden)}
              >
                {stripHidden ? <PanelBottomOpen size={18} /> : <PanelBottomClose size={18} />}
              </button>
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
      {tracks.length > 1 && !stripHidden && (
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
  received = null,
  onChange,
}: {
  layers: readonly ScreenLayer[];
  quality: ScreenViewQuality;
  /** Lines of the picture that actually arrives, so a viewer can report what they get. */
  received?: number | null;
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
          const value = event.target.value;
          if (!single) onChange(value === 'auto' || value === 'source' ? value : Number(value));
        }}
      >
        {!single && <option value="auto">{t('Otomatik (pencereye göre)')}</option>}
        {!single && <option value="source">{t('Kaynak (en yüksek)')}</option>}
        {choices.map((lines) => (
          <option key={lines} value={String(lines)}>
            {`${lines}p`}
          </option>
        ))}
      </select>
      {received !== null && (
        <small className="room-screen-received" role="status">
          {t('Gelen: {lines}p', { lines: received })}
        </small>
      )}
      {single && (
        <span id={hint} className="room-screen-quality-hint">
          {explanation}
        </span>
      )}
    </label>
  );
}

/**
 * Lines of the watched stream as it is decoded here (720 for 1280×720), read from the stage's video
 * element once a second; null until a picture arrives.
 */
function useReceivedLines(stage: RefObject<HTMLDivElement | null>, trackId: string | undefined) {
  const [lines, setLines] = useState<number | null>(null);
  useEffect(() => {
    const read = () => {
      const video = stage.current?.querySelector('video');
      setLines(
        video && video.videoWidth > 0 ? Math.min(video.videoWidth, video.videoHeight) : null,
      );
    };
    read();
    const timer = setInterval(read, 1000);
    return () => clearInterval(timer);
  }, [stage, trackId]);
  return lines;
}
