import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ScreenShareQuality } from '@rooms/media';
import { ReferenceIcon } from './ReferenceIcon';
import { useRealtime, changeScreenQuality, setScreenSound, stopScreen } from './realtime';
import { mediaBridge } from './runtime-sources';
import { t, uiError } from './i18n';
import './share-menu.css';

export const SHARE_AUDIO_KEY = 'rooms-share-audio-v1';
/** The sharer's last "Sesi de paylaş" choice on this computer; null when never changed. */
export function readShareAudioChoice(): boolean | null {
  try {
    const value = localStorage.getItem(SHARE_AUDIO_KEY);
    return value === '1' ? true : value === '0' ? false : null;
  } catch {
    return null;
  }
}
export function rememberShareAudioChoice(value: boolean) {
  try {
    localStorage.setItem(SHARE_AUDIO_KEY, value ? '1' : '0');
  } catch {
    /* The choice still applies to this share. */
  }
}
/** The presets of the share picker, in the same order. */
export const SHARE_QUALITIES: readonly ScreenShareQuality[] = [
  '720p30',
  '1080p30',
  '1080p60',
  '1440p60',
  '4k30',
];
/** Elements that open the menu: the sharer's own tile and the dock's share controls. */
export const OWN_SHARE_ATTRIBUTE = 'data-own-share-menu';
const SELECTOR = `[${OWN_SHARE_ATTRIBUTE}]`;
const WIDTH = 280;

type CaptureStatus = {
  systemAudio: boolean;
  systemAudioReason?: 'macos-version' | 'os';
} | null;

/** Why this computer cannot share sound; the same wording as the share picker. */
function soundUnavailable(status: NonNullable<CaptureStatus>) {
  return status.systemAudioReason === 'macos-version'
    ? t('Bu Mac sesi paylaşamaz: macOS 14.2 veya üstü gerekir. Görüntü sessiz paylaşılır.')
    : t('Bu işletim sistemi sesi paylaşamaz. Görüntü sessiz paylaşılır.');
}

/**
 * Right-click (or Shift+F10 / the menu key) on your own stream tile or share controls: change the
 * shared screen, the quality or the sound, or stop, without ending the share. Mounted once; viewers
 * and people who are not sharing never get it.
 */
export function OwnShareMenu({ notify }: { notify(message: string): void }) {
  const r = useRealtime();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState<CaptureStatus>(null);
  const menu = useRef<HTMLDivElement>(null),
    origin = useRef<HTMLElement | null>(null),
    live = useRef(r);
  live.current = r;
  const notifyRef = useRef(notify);
  notifyRef.current = notify;
  const connected = r.status === 'connected';
  const allowed = r.sharing && connected;

  useEffect(() => {
    const open = (event: MouseEvent | KeyboardEvent) => {
      if (
        event instanceof KeyboardEvent &&
        event.key !== 'ContextMenu' &&
        !(event.key === 'F10' && event.shiftKey)
      )
        return;
      const element = (event.target as HTMLElement | null)?.closest?.<HTMLElement>(SELECTOR);
      // Only the sharer, only while sharing in a connected room.
      if (!element || !live.current.sharing || live.current.status !== 'connected') return;
      event.preventDefault();
      event.stopPropagation();
      origin.current = element;
      const rect = element.getBoundingClientRect(),
        pointer = event instanceof MouseEvent && (event.clientX || event.clientY);
      setAt({
        x: Math.max(8, Math.min(innerWidth - WIDTH - 8, pointer ? event.clientX : rect.left)),
        y: Math.max(40, Math.min(innerHeight - 330, pointer ? event.clientY : rect.bottom)),
      });
    };
    document.addEventListener('contextmenu', open);
    document.addEventListener('keydown', open);
    return () => {
      document.removeEventListener('contextmenu', open);
      document.removeEventListener('keydown', open);
    };
  }, []);

  useEffect(() => {
    if (at && !allowed) setAt(null);
  }, [at, allowed]);

  useEffect(() => {
    if (!at) return;
    let current = true;
    setStatus(null);
    void mediaBridge()
      .captureStatus()
      .then((value) => current && setStatus(value))
      .catch(() => {});
    menu.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const close = () => {
      setAt(null);
      origin.current?.focus?.();
    };
    const outside = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node)) setAt(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = [
        ...(menu.current?.querySelectorAll<HTMLElement>('button:not(:disabled)') ?? []),
      ];
      if (!items.length) return;
      e.preventDefault();
      const index = items.indexOf(document.activeElement as HTMLElement);
      const step = e.key === 'ArrowDown' ? 1 : -1;
      items[(index + step + items.length) % items.length]!.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => {
      current = false;
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
    };
  }, [at !== null]);

  if (!at || !allowed) return null;

  const run = async (operation: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await operation();
      setAt(null);
    } catch (error) {
      // The share keeps running as it was; say why the change did not happen.
      notifyRef.current(uiError(error));
    } finally {
      setBusy(false);
    }
  };
  const soundOn = !!r.sharingAudio,
    soundSupported = status?.systemAudio === true;
  const soundNote = !status
    ? t('Ses paylaşımı denetleniyor…')
    : !status.systemAudio
      ? soundUnavailable(status)
      : null;
  return createPortal(
    <div
      ref={menu}
      role="menu"
      aria-label={t('Yayın ayarları')}
      aria-busy={busy || undefined}
      className="own-share-menu"
      style={{ left: at.x, top: at.y }}
    >
      <button
        role="menuitem"
        disabled={busy}
        onClick={() => {
          setAt(null);
          window.dispatchEvent(new Event('rooms:choose-capture'));
        }}
      >
        <ReferenceIcon name="monitor" size={15} />
        {t('Ekranı veya pencereyi değiştir')}
      </button>
      <div role="group" aria-label={t('Paylaşım kalitesi')} className="own-share-menu-group">
        <span className="own-share-menu-label">{t('Paylaşım kalitesi')}</span>
        {SHARE_QUALITIES.map((quality) => (
          <button
            key={quality}
            role="menuitemradio"
            aria-checked={r.sharingQuality === quality}
            disabled={busy}
            onClick={() =>
              r.sharingQuality === quality
                ? setAt(null)
                : void run(() => changeScreenQuality(quality))
            }
          >
            <span className="own-share-menu-check">
              {r.sharingQuality === quality && <ReferenceIcon name="check" size={14} />}
            </span>
            {quality}
          </button>
        ))}
      </div>
      <button
        role="menuitemcheckbox"
        aria-checked={soundOn}
        aria-describedby={soundNote ? 'own-share-sound-note' : undefined}
        disabled={busy || !soundSupported}
        onClick={() =>
          void run(async () => {
            const result = await setScreenSound(!soundOn);
            rememberShareAudioChoice(!soundOn);
            if (!soundOn && !result.audio)
              notifyRef.current(
                t(
                  'Ses paylaşılamadı, yalnızca görüntü gidiyor. Bilgisayarda bir hoparlör ya da kulaklık seçili olmalı.',
                ),
              );
          })
        }
      >
        <span className="own-share-menu-check">
          {soundOn && <ReferenceIcon name="check" size={14} />}
        </span>
        {t('Sesi de paylaş')}
      </button>
      {soundNote && (
        <small id="own-share-sound-note" className="own-share-menu-note">
          {soundNote}
        </small>
      )}
      <button
        role="menuitem"
        className="own-share-menu-stop"
        disabled={busy}
        onClick={() => void run(() => stopScreen())}
      >
        <ReferenceIcon name="x" size={15} />
        {t('Yayını durdur')}
      </button>
    </div>,
    document.body,
  );
}
