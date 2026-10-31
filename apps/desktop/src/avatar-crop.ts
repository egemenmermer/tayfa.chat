/** Side of the uploaded avatar in pixels. */
export const AVATAR_OUTPUT = 512;
export const AVATAR_ZOOM_MAX = 4;
/**
 * The crop as the dialog shows it: `zoom` 1 fits the image's short side to the square viewport,
 * and x/y move the image centre away from the viewport centre, in viewport pixels.
 */
export interface CropView {
  zoom: number;
  x: number;
  y: number;
}
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
/** Image pixels to viewport pixels at zoom 1: the image covers the whole square. */
export const coverScale = (width: number, height: number, viewport: number) =>
  viewport / Math.min(width, height);
/** Keeps the image covering the viewport, so the circle never shows an empty edge. */
export function clampCrop(width: number, height: number, viewport: number, view: CropView) {
  const zoom = clamp(view.zoom, 1, AVATAR_ZOOM_MAX),
    scale = coverScale(width, height, viewport) * zoom;
  const maxX = Math.max(0, (width * scale - viewport) / 2),
    maxY = Math.max(0, (height * scale - viewport) / 2);
  return { zoom, x: clamp(view.x, -maxX, maxX), y: clamp(view.y, -maxY, maxY) };
}
/** Zooms around a viewport point (relative to its centre), which stays over the same pixel. */
export function zoomAt(
  width: number,
  height: number,
  viewport: number,
  view: CropView,
  zoom: number,
  pointX = 0,
  pointY = 0,
) {
  const next = clamp(zoom, 1, AVATAR_ZOOM_MAX),
    ratio = next / view.zoom;
  return clampCrop(width, height, viewport, {
    zoom: next,
    x: pointX - (pointX - view.x) * ratio,
    y: pointY - (pointY - view.y) * ratio,
  });
}
/** The square of the image the viewport shows, in image pixels (what the avatar is drawn from). */
export function cropSource(width: number, height: number, viewport: number, view: CropView) {
  const crop = clampCrop(width, height, viewport, view),
    scale = coverScale(width, height, viewport) * crop.zoom,
    size = viewport / scale;
  return {
    sx: width / 2 - crop.x / scale - size / 2,
    sy: height / 2 - crop.y / scale - size / 2,
    size,
  };
}
