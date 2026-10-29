import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { create } from 'zustand';
import {
  cleanSoundEmoji,
  parseSoundboardReaction,
} from '../../../packages/shared-contracts/src/soundboard';
import { onReaction } from './realtime';

/** One emoji drifting up from the bottom of the window. Geometry is fixed at creation. */
export interface FloatingEmoji {
  id: number;
  emoji: string;
  /** Horizontal start, percent of the window width. */
  x: number;
  /** Sideways drift over the whole rise, px. */
  drift: number;
  size: number;
  duration: number;
}
const MAX_FLOATING = 24;
/** Each item is dropped once its own animation is over. */
const timers = new Map<number, ReturnType<typeof setTimeout>>();
let serial = 0;
export const useFloatingEmoji = create<{ items: FloatingEmoji[] }>(() => ({ items: [] }));

/** The window's own reduced-motion switch wins when the user forced motion on in Settings. */
export function motionReduced() {
  try {
    if (document.documentElement.hasAttribute('data-motion')) return false;
    return !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/** Starts one floating emoji; nothing happens for anything that is not a single emoji. */
export function floatEmoji(value: unknown, random: () => number = Math.random) {
  const emoji = cleanSoundEmoji(value);
  if (!emoji || motionReduced()) return false;
  const item: FloatingEmoji = {
    id: ++serial,
    emoji,
    x: 8 + random() * 84,
    drift: Math.round((random() - 0.5) * 120),
    size: Math.round(30 + random() * 22),
    duration: Math.round(2200 + random() * 900),
  };
  useFloatingEmoji.setState((state) => ({ items: [...state.items, item].slice(-MAX_FLOATING) }));
  timers.set(
    item.id,
    setTimeout(() => {
      timers.delete(item.id);
      useFloatingEmoji.setState((state) => ({
        items: state.items.filter((entry) => entry.id !== item.id),
      }));
    }, item.duration + 100),
  );
  return true;
}

/** Shows what the voice room broadcasts when someone plays a sound; mounted once for the app. */
export function SoundboardFloaters() {
  const items = useFloatingEmoji((state) => state.items);
  useEffect(
    () =>
      onReaction((payload) => {
        const emoji = parseSoundboardReaction(payload);
        if (emoji) floatEmoji(emoji);
      }),
    [],
  );
  if (!items.length) return null;
  return createPortal(
    <div className="sb-floats" aria-hidden="true">
      {items.map((item) => (
        <span
          key={item.id}
          className="sb-float"
          style={
            {
              left: `${item.x}%`,
              fontSize: item.size,
              animationDuration: `${item.duration}ms`,
              '--sb-drift': `${item.drift}px`,
            } as React.CSSProperties
          }
        >
          {item.emoji}
        </span>
      ))}
    </div>,
    document.body,
  );
}
