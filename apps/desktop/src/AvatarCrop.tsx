import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { create } from 'zustand';
import { Modal } from '@rooms/design';
import type { SocialUser } from '@rooms/social';
import { t } from './i18n';
import {
  AVATAR_OUTPUT,
  AVATAR_ZOOM_MAX,
  clampCrop,
  coverScale,
  cropSource,
  zoomAt,
  type CropView,
} from './avatar-crop';
import './avatar-crop.css';

const VIEWPORT = 280;
/** The upload limit of the main process; a larger PNG is sent as JPEG instead. */
const UPLOAD_MAX = 1_900_000;
export interface AvatarImage {
  name: string;
  mime: string;
  bytes: Uint8Array;
}
export interface CroppedAvatar {
  mime: string;
  bytes: Uint8Array;
}

const blobOf = (canvas: HTMLCanvasElement, mime: string, quality?: number) =>
  new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, quality));

/** Circle crop with drag, zoom slider, wheel and keyboard, like the usual avatar uploaders. */
export function AvatarCropDialog({
  src,
  onCancel,
  onSave,
}: {
  src: string;
  onCancel(): void;
  onSave(avatar: CroppedAvatar): void;
}) {
  const image = useRef<HTMLImageElement>(null),
    drag = useRef<{ id: number; x: number; y: number } | null>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null),
    [view, setView] = useState<CropView>({ zoom: 1, x: 0, y: 0 }),
    [saving, setSaving] = useState(false),
    [error, setError] = useState('');
  const update = (next: CropView) =>
    size && setView(clampCrop(size.width, size.height, VIEWPORT, next));
  const zoomTo = (zoom: number, pointX = 0, pointY = 0) =>
    size && setView(zoomAt(size.width, size.height, VIEWPORT, view, zoom, pointX, pointY));
  const scale = size ? coverScale(size.width, size.height, VIEWPORT) * view.zoom : 0;
  const save = async () => {
    if (!size || !image.current || saving) return;
    setSaving(true);
    setError('');
    try {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = AVATAR_OUTPUT;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('canvas');
      const { sx, sy, size: side } = cropSource(size.width, size.height, VIEWPORT, view);
      context.imageSmoothingQuality = 'high';
      context.drawImage(image.current, sx, sy, side, side, 0, 0, AVATAR_OUTPUT, AVATAR_OUTPUT);
      let blob = await blobOf(canvas, 'image/png');
      if (blob && blob.size > UPLOAD_MAX) blob = await blobOf(canvas, 'image/jpeg', 0.9);
      if (!blob) throw new Error('blob');
      onSave({ mime: blob.type, bytes: new Uint8Array(await blob.arrayBuffer()) });
    } catch {
      setError(t('Fotoğraf hazırlanamadı. Başka bir fotoğraf dene.'));
      setSaving(false);
    }
  };
  const keys = (event: KeyboardEvent) => {
    const step = event.shiftKey ? 40 : 10;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [step, 0],
      ArrowRight: [-step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    };
    if (moves[event.key]) {
      event.preventDefault();
      update({ ...view, x: view.x + moves[event.key]![0], y: view.y + moves[event.key]![1] });
    } else if (event.key === '+' || event.key === '=') zoomTo(view.zoom + 0.2);
    else if (event.key === '-') zoomTo(view.zoom - 0.2);
  };
  const point = (event: { clientX: number; clientY: number }, element: Element) => {
    const rect = element.getBoundingClientRect();
    return [
      event.clientX - rect.left - rect.width / 2,
      event.clientY - rect.top - rect.height / 2,
    ] as const;
  };
  return (
    <Modal
      title={t('Profil fotoğrafını ayarla')}
      className="avatar-crop"
      onClose={onCancel}
      footer={
        <>
          <button className="button secondary" onClick={onCancel}>
            {t('Vazgeç')}
          </button>
          <button className="button primary" disabled={!size || saving} onClick={() => void save()}>
            {saving ? t('Kaydediliyor…') : t('Kaydet')}
          </button>
        </>
      }
    >
      <div
        className="avatar-crop-stage"
        style={{ width: VIEWPORT, height: VIEWPORT }}
        role="application"
        aria-roledescription={t('Fotoğraf kırpma alanı')}
        aria-label={t(
          'Fotoğrafı sürükleyerek konumlandır; ok tuşları kaydırır, + ve − yakınlaştırır.',
        )}
        tabIndex={0}
        onKeyDown={keys}
        onPointerDown={(event: PointerEvent<HTMLDivElement>) => {
          event.currentTarget.setPointerCapture?.(event.pointerId);
          drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
        }}
        onPointerMove={(event) => {
          const from = drag.current;
          if (!from || from.id !== event.pointerId || !Number.isFinite(event.clientX)) return;
          drag.current = { ...from, x: event.clientX, y: event.clientY };
          update({
            ...view,
            x: view.x + event.clientX - from.x,
            y: view.y + event.clientY - from.y,
          });
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(event) => {
          const [x, y] = point(event, event.currentTarget);
          zoomTo(view.zoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1), x, y);
        }}
      >
        <img
          ref={image}
          src={src}
          alt=""
          draggable={false}
          onLoad={(event) => {
            const { naturalWidth: width, naturalHeight: height } = event.currentTarget;
            if (width && height) setSize({ width, height });
            else setError(t('Fotoğraf açılamadı. Başka bir fotoğraf dene.'));
          }}
          onError={() => setError(t('Fotoğraf açılamadı. Başka bir fotoğraf dene.'))}
          style={
            size
              ? {
                  width: size.width * scale,
                  height: size.height * scale,
                  transform: `translate(${VIEWPORT / 2 + view.x - (size.width * scale) / 2}px, ${
                    VIEWPORT / 2 + view.y - (size.height * scale) / 2
                  }px)`,
                }
              : { visibility: 'hidden' }
          }
        />
        <i className="avatar-crop-ring" aria-hidden="true" />
      </div>
      <label className="avatar-crop-zoom">
        <span>{t('Yakınlaştır')}</span>
        <input
          type="range"
          min={1}
          max={AVATAR_ZOOM_MAX}
          step={0.01}
          value={view.zoom}
          disabled={!size}
          onChange={(event) => zoomTo(Number(event.target.value))}
        />
      </label>
      {error && (
        <p className="avatar-crop-error" role="alert">
          {error}
        </p>
      )}
    </Modal>
  );
}

const useAvatarCrop = create<{
  request: { image: AvatarImage; resolve(avatar: CroppedAvatar | null): void } | null;
}>(() => ({ request: null }));
/** Opens the crop dialog for a picked photo; null when the user cancels. */
export function requestAvatarCrop(image: AvatarImage) {
  return new Promise<CroppedAvatar | null>((resolve) => {
    useAvatarCrop.getState().request?.resolve(null);
    useAvatarCrop.setState({ request: { image, resolve } });
  });
}
/** Mounted once at the root, so every "change photo" button shares one dialog. */
export function AvatarCropHost() {
  const request = useAvatarCrop((state) => state.request);
  const src = useMemo(
    () =>
      request
        ? URL.createObjectURL(
            new Blob([request.image.bytes as Uint8Array<ArrayBuffer>], {
              type: request.image.mime,
            }),
          )
        : null,
    [request],
  );
  useEffect(() => () => void (src && URL.revokeObjectURL(src)), [src]);
  if (!request || !src) return null;
  const finish = (avatar: CroppedAvatar | null) => {
    useAvatarCrop.setState({ request: null });
    request.resolve(avatar);
  };
  return (
    <AvatarCropDialog
      key={src}
      src={src}
      onCancel={() => finish(null)}
      onSave={(avatar) => finish(avatar)}
    />
  );
}
/**
 * Picks a photo, lets the user place it in the circle and uploads the crop. Null when cancelled.
 * A desktop without the crop bridge uploads the picked file as before.
 */
export async function chooseCroppedAvatar(): Promise<SocialUser | null> {
  const social = window.rooms?.social;
  if (!social) throw new Error(t('Masaüstü uygulaması gerekli.'));
  if (!social.pickAvatarFile || !social.uploadAvatar) return social.chooseAvatar();
  const image = await social.pickAvatarFile();
  if (!image) return null;
  const avatar = await requestAvatarCrop(image);
  if (!avatar) return null;
  return social.uploadAvatar(avatar.bytes, avatar.mime);
}
