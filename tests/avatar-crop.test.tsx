// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { clampCrop, cropSource, zoomAt } from '../apps/desktop/src/avatar-crop';
import { AvatarCropHost, chooseCroppedAvatar } from '../apps/desktop/src/AvatarCrop';

afterEach(() => {
  cleanup();
  delete (window as { rooms?: unknown }).rooms;
  vi.unstubAllGlobals();
});

it('keeps the circle covered and crops the square it shows', () => {
  // 1000x500 in a 280 viewport: zoom 1 fits the height, so only a sideways move is possible.
  expect(clampCrop(1000, 500, 280, { zoom: 1, x: 999, y: 50 })).toEqual({ zoom: 1, x: 140, y: 0 });
  const centre = cropSource(1000, 500, 280, { zoom: 1, x: 0, y: 0 });
  expect([centre.sx, centre.sy, centre.size].map(Math.round)).toEqual([250, 0, 500]);
  // Moved fully right: the left edge of the photo.
  expect(cropSource(1000, 500, 280, { zoom: 1, x: 140, y: 0 }).sx).toBeCloseTo(0);
  // Zoom 2 at the centre: half the side, still centred.
  const zoomed = cropSource(1000, 500, 280, { zoom: 2, x: 0, y: 0 });
  expect([zoomed.sx, zoomed.sy, zoomed.size].map(Math.round)).toEqual([375, 125, 250]);
  expect(clampCrop(400, 400, 280, { zoom: 9, x: 0, y: 0 }).zoom).toBe(4);
  expect(clampCrop(400, 400, 280, { zoom: 0.2, x: 0, y: 0 }).zoom).toBe(1);
});

it('zooms around the pointer, which stays over the same pixel', () => {
  const before = { zoom: 1, x: 0, y: 0 };
  const after = zoomAt(400, 400, 280, before, 2, 70, -35);
  const pixel = (view: typeof before, px: number) => (px - view.x) / view.zoom;
  expect(pixel(after, 70)).toBeCloseTo(pixel(before, 70));
  expect(after.y).toBeCloseTo(-35 - (-35 - 0) * 2);
});

it('crops a picked photo in the dialog and uploads only the result; cancel uploads nothing', async () => {
  vi.stubGlobal(
    'URL',
    class extends URL {
      static createObjectURL = () => 'blob:photo';
      static revokeObjectURL = vi.fn();
    },
  );
  const drawn: number[][] = [];
  HTMLCanvasElement.prototype.getContext = (() => ({
    drawImage: (...args: unknown[]) => drawn.push(args.slice(1) as number[]),
  })) as never;
  HTMLCanvasElement.prototype.toBlob = function (done: BlobCallback, type?: string) {
    // jsdom's Blob has no arrayBuffer(); Chromium's does.
    done({ type, size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer } as Blob);
  };
  const updated = { id: 'me', username: 'me', displayName: 'Ben', avatar: 'new' };
  const social = {
    chooseAvatar: vi.fn(),
    pickAvatarFile: vi.fn(async () => ({
      name: 'me.png',
      mime: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    })),
    uploadAvatar: vi.fn(async () => updated),
  };
  (window as { rooms?: unknown }).rooms = { social };
  render(<AvatarCropHost />);
  const load = () => {
    const image = document.querySelector('.avatar-crop-stage img') as HTMLImageElement;
    Object.defineProperty(image, 'naturalWidth', { value: 1000 });
    Object.defineProperty(image, 'naturalHeight', { value: 500 });
    fireEvent.load(image);
  };
  let result: Promise<unknown> = Promise.resolve();
  await act(async () => {
    result = chooseCroppedAvatar();
  });
  load();
  fireEvent.click(screen.getByRole('button', { name: 'Vazgeç' }));
  expect(await result).toBeNull();
  expect(social.uploadAvatar).not.toHaveBeenCalled();
  expect(document.querySelector('.avatar-crop')).toBeNull();

  await act(async () => {
    result = chooseCroppedAvatar();
  });
  load();
  fireEvent.change(screen.getByRole('slider', { name: 'Yakınlaştır' }), { target: { value: '2' } });
  const stage = document.querySelector('.avatar-crop-stage') as HTMLElement;
  // Arrow keys move the photo (jsdom pointer events carry no coordinates); past the edge it stops.
  for (let i = 0; i < 12; i++) fireEvent.keyDown(stage, { key: 'ArrowLeft', shiftKey: true });
  fireEvent.click(screen.getByRole('button', { name: 'Kaydet' }));
  expect(await result).toEqual(updated);
  // Zoom 2 dragged fully right: the left half of the photo's height, 512 px out.
  expect(drawn.map((call) => call.map(Math.round))).toEqual([[0, 125, 250, 250, 0, 0, 512, 512]]);
  expect(social.uploadAvatar).toHaveBeenCalledWith(expect.any(Uint8Array), 'image/png');
  await waitFor(() => expect(document.querySelector('.avatar-crop')).toBeNull());
});

it('falls back to the one-step picker on a desktop without the crop bridge', async () => {
  const chooseAvatar = vi.fn(async () => null);
  (window as { rooms?: unknown }).rooms = { social: { chooseAvatar } };
  expect(await chooseCroppedAvatar()).toBeNull();
  expect(chooseAvatar).toHaveBeenCalledTimes(1);
});

it('shows the native photo errors in Turkish', async () => {
  const { uiError } = await import('../apps/desktop/src/i18n');
  expect(uiError(new Error('Choose a PNG, JPEG or WebP photo under 10 MB.'))).toBe(
    '10 MB’tan küçük bir PNG, JPEG ya da WebP fotoğraf seç.',
  );
});
