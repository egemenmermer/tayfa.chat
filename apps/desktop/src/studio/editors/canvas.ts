import { useEffect, useRef, type RefObject } from 'react';
import type { EditorPort } from './port';

/** Sizes the canvas backing store for the device pixel ratio and returns a context in CSS pixels. */
export function prepareCanvas(
  canvas: HTMLCanvasElement | null,
  width: number,
  height: number,
): CanvasRenderingContext2D | null {
  if (!canvas || width <= 0 || height <= 0) return null;
  const ratio = window.devicePixelRatio || 1;
  const w = Math.round(width * ratio);
  const h = Math.round(height * ratio);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    // jsdom has no canvas; the editors render their DOM without drawing.
    return null;
  }
  if (!ctx) return null;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
}

/** Tracks the element's content box size. */
export function useElementSize(
  ref: RefObject<HTMLElement | null>,
  onSize: (w: number, h: number) => void,
) {
  const callback = useRef(onSize);
  callback.current = onSize;
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const report = () => callback.current(element.clientWidth, element.clientHeight);
    report();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(report);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
}

/**
 * Moves the local playhead line every animation frame from `port.position()` without re-rendering:
 * `toX` maps beats to the line's x in the element's coordinate space (null hides it).
 */
export function usePlayheadLine(
  line: RefObject<HTMLElement | null>,
  port: EditorPort,
  toX: (beat: number) => number | null,
) {
  const state = useRef({ port, toX });
  state.current = { port, toX };
  useEffect(() => {
    let frame = 0;
    let last = '';
    const tick = () => {
      const element = line.current;
      if (element) {
        const x = state.current.toX(state.current.port.position());
        const next = x === null ? 'none' : `translateX(${Math.round(x)}px)`;
        if (next !== last) {
          last = next;
          if (x === null) element.style.display = 'none';
          else {
            element.style.display = '';
            element.style.transform = next;
          }
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [line]);
}
