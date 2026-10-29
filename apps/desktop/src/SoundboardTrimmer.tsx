import { useEffect, useMemo, useRef, useState } from 'react';
import { Play, Square } from 'lucide-react';
import { t } from './i18n';
import {
  clampSelection,
  formatSeconds,
  nudgeSelection,
  SOUNDBOARD_MAX_SECONDS,
  waveformPeaks,
  type TrimSelection,
} from './soundboard-trim';

const BUCKETS = 240;
/** Arrow keys move a handle 10 ms, Shift 100 ms, Page Up / Page Down one second. */
export function keyboardStep(event: { key: string; shiftKey: boolean }): number | null {
  const fine = event.shiftKey ? 0.1 : 0.01;
  switch (event.key) {
    case 'ArrowLeft':
    case 'ArrowDown':
      return -fine;
    case 'ArrowRight':
    case 'ArrowUp':
      return fine;
    case 'PageDown':
      return -1;
    case 'PageUp':
      return 1;
    default:
      return null;
  }
}

/** Waveform with two draggable / keyboard-adjustable handles and a preview of the selection. */
export function SoundboardTrimmer({
  buffer,
  selection,
  onChange,
  volume,
}: {
  buffer: AudioBuffer;
  selection: TrimSelection;
  onChange: (selection: TrimSelection) => void;
  volume: number;
}) {
  const duration = buffer.duration,
    track = useRef<HTMLDivElement>(null),
    drag = useRef<'start' | 'end' | null>(null),
    preview = useRef<{ context: AudioContext; source: AudioBufferSourceNode } | null>(null),
    [playing, setPlaying] = useState(false);
  const peaks = useMemo(() => {
    const channels: Float32Array[] = [];
    for (let i = 0; i < buffer.numberOfChannels; i++) channels.push(buffer.getChannelData(i));
    return waveformPeaks(channels, BUCKETS);
  }, [buffer]);
  const outline = useMemo(() => {
    if (!peaks.length) return '';
    const top = peaks.map((p, i) => `${i},${(32 - Math.max(p, 0.02) * 30).toFixed(1)}`),
      bottom = peaks.map((p, i) => `${i},${(32 + Math.max(p, 0.02) * 30).toFixed(1)}`).reverse();
    return `M${top.join(' L')} L${bottom.join(' L')} Z`;
  }, [peaks]);
  const latest = useRef({ selection, onChange });
  latest.current = { selection, onChange };

  const stop = () => {
    const active = preview.current;
    preview.current = null;
    setPlaying(false);
    if (!active) return;
    active.source.onended = null;
    try {
      active.source.stop();
    } catch {
      /* Already finished. */
    }
    void active.context.close().catch(() => {});
  };
  // A new file or leaving the form ends the preview.
  useEffect(() => stop, [buffer]);
  const play = () => {
    if (playing) return stop();
    const context = new AudioContext(),
      source = context.createBufferSource(),
      gain = context.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain).connect(context.destination);
    source.onended = () => {
      if (preview.current?.source === source) stop();
    };
    preview.current = { context, source };
    setPlaying(true);
    source.start(0, selection.start, selection.end - selection.start);
  };

  const timeAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return 0;
    return Math.min(Math.max((clientX - box.left) / box.width, 0), 1) * duration;
  };
  const move = (handle: 'start' | 'end', time: number) => {
    const { selection: current, onChange: emit } = latest.current;
    emit(clampSelection({ ...current, [handle]: time }, duration, handle));
  };
  const percent = (seconds: number) => `${(seconds / duration) * 100}%`;
  const length = selection.end - selection.start;
  const capped = duration > SOUNDBOARD_MAX_SECONDS && length >= SOUNDBOARD_MAX_SECONDS - 0.005;
  const handle = (which: 'start' | 'end') => (
    <div
      className="sb-trim-handle"
      data-handle={which}
      role="slider"
      tabIndex={0}
      aria-label={which === 'start' ? t('Kesme başlangıcı') : t('Kesme bitişi')}
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Number(duration.toFixed(2))}
      aria-valuenow={Number(selection[which].toFixed(2))}
      aria-valuetext={t('{seconds} sn', { seconds: formatSeconds(selection[which]) })}
      style={{ left: percent(selection[which]) }}
      onKeyDown={(e) => {
        const step = keyboardStep(e);
        if (step !== null) {
          e.preventDefault();
          onChange(nudgeSelection(selection, duration, which, step));
        } else if (e.key === 'Home' || e.key === 'End') {
          e.preventDefault();
          move(which, e.key === 'Home' ? 0 : duration);
        }
      }}
    />
  );
  return (
    <div className="sb-trim" role="group" aria-label={t('Sesi kırp')}>
      <div
        ref={track}
        className="sb-trim-track"
        onPointerDown={(e) => {
          // The nearest handle follows the pointer, wherever on the waveform it lands.
          const time = timeAt(e.clientX);
          const which =
            (e.target as HTMLElement).dataset?.handle === 'start' ||
            (e.target as HTMLElement).dataset?.handle === 'end'
              ? ((e.target as HTMLElement).dataset.handle as 'start' | 'end')
              : Math.abs(time - selection.start) <= Math.abs(time - selection.end)
                ? 'start'
                : 'end';
          drag.current = which;
          try {
            track.current?.setPointerCapture?.(e.pointerId);
          } catch {
            /* Dragging still works while the pointer stays over the track. */
          }
          move(which, time);
        }}
        onPointerMove={(e) => {
          if (drag.current) move(drag.current, timeAt(e.clientX));
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <svg
          className="sb-trim-wave"
          viewBox={`0 0 ${BUCKETS} 64`}
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <path d={outline} />
        </svg>
        <div className="sb-trim-dim" style={{ left: 0, width: percent(selection.start) }} />
        <div className="sb-trim-dim" style={{ left: percent(selection.end), right: 0 }} />
        <div
          className="sb-trim-window"
          style={{ left: percent(selection.start), width: percent(length) }}
        />
        {handle('start')}
        {handle('end')}
      </div>
      <div className="sb-form-row sb-trim-info">
        <button type="button" className="button secondary" aria-pressed={playing} onClick={play}>
          {playing ? <Square size={14} /> : <Play size={14} />}
          {playing ? t('Durdur') : t('Seçimi dinle')}
        </button>
        <span className="sb-trim-readout" aria-live="polite">
          {t('{from} – {to} sn · {length} sn', {
            from: formatSeconds(selection.start),
            to: formatSeconds(selection.end),
            length: formatSeconds(length),
          })}
        </span>
      </div>
      {duration > SOUNDBOARD_MAX_SECONDS && (
        <p className={capped ? 'sb-trim-hint sb-trim-limit' : 'sb-trim-hint'}>
          {t(
            'Dosya {total} sn. Soundboard sesi en fazla {max} sn olabilir; tutamaçlarla bir bölüm seç.',
            {
              total: duration.toFixed(1),
              max: SOUNDBOARD_MAX_SECONDS,
            },
          )}
        </p>
      )}
      <p className="sb-trim-hint">
        {t(
          'Tutamaç seçiliyken ok tuşları 0,01 sn, Shift ile 0,1 sn, Page Up / Down ile 1 sn kaydırır.',
        )}
      </p>
    </div>
  );
}
