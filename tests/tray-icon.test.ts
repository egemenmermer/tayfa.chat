import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ nativeImage: {} }));
const { tintBitmap } = await import('../apps/desktop/electron/tray-icon');

describe('Windows tray glyph', () => {
  it('recolours the black template glyph and keeps its shape (alpha)', () => {
    // Two BGRA pixels: an opaque black stroke and a transparent background.
    const bitmap = Buffer.from([0, 0, 0, 255, 0, 0, 0, 0]);
    expect([...tintBitmap(bitmap, 0xff)]).toEqual([255, 255, 255, 255, 255, 255, 255, 0]);
    expect([...tintBitmap(bitmap, 0x1f)]).toEqual([31, 31, 31, 255, 31, 31, 31, 0]);
    // The source is left untouched for the next theme change.
    expect([...bitmap]).toEqual([0, 0, 0, 255, 0, 0, 0, 0]);
  });
});
