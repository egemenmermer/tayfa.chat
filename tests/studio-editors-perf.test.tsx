// @vitest-environment jsdom
// Draw-path cost of the piano roll with 2 000 notes, against a no-op 2D context: it measures the
// editor's own JavaScript per frame (culling, preview mapping, path calls), not GPU rasterising.
import { cleanup, render } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FakeEditorStore } from '../apps/desktop/src/studio/editors/fake-port';
import { PianoRoll } from '../apps/desktop/src/studio/editors/PianoRoll';
import { studioEditorsFixtureDoc } from '../apps/desktop/src/dev/studio-editors-fixture';

const restore: (() => void)[] = [];
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  const noop = new Proxy(
    {},
    {
      get: (_, key) => (key === 'measureText' ? () => ({ width: 10 }) : () => undefined),
      set: () => true,
    },
  );
  HTMLCanvasElement.prototype.getContext = (() => noop) as never;
  for (const [key, value] of [
    ['clientWidth', 1180],
    ['clientHeight', 1900],
  ] as const) {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, key);
    Object.defineProperty(HTMLElement.prototype, key, { configurable: true, get: () => value });
    restore.push(() => original && Object.defineProperty(HTMLElement.prototype, key, original));
  }
});
afterAll(() => {
  cleanup();
  for (const undo of restore) undo();
});

describe('piano roll performance', () => {
  it('draws 2 000 notes well inside a 60 fps frame', () => {
    const store = new FakeEditorStore(studioEditorsFixtureDoc('perf'));
    expect(Object.values(store.doc.notes).filter((n) => n.clipId === 'perf-clip')).toHaveLength(
      2000,
    );
    const samples: { ms: number; drawn: number }[] = [];
    const view = (zoom: number) => (
      <PianoRoll
        port={store.getPort()}
        clipId="perf-clip"
        snap="1/16"
        pxPerBeat={zoom}
        onZoom={() => {}}
        selectedNoteIds={new Set()}
        onSelectNotes={() => {}}
        newId={() => 'x'}
        onDrawn={(ms, drawn) => samples.push({ ms, drawn })}
      />
    );
    const { rerender } = render(view(16));
    // Zoomed out and a viewport tall enough for all 128 rows: every one of the 2 000 notes is drawn.
    for (let frame = 0; frame < 60; frame += 1) rerender(view(frame % 2 ? 9 : 8));
    const drawn = Math.max(...samples.map((s) => s.drawn));
    const times = samples.slice(5).map((s) => s.ms);
    const avg = times.reduce((a, b) => a + b, 0) / times.length;
    process.stdout.write(
      `piano roll: ${drawn} notes drawn, avg ${avg.toFixed(2)} ms, max ${Math.max(...times).toFixed(2)} ms over ${times.length} frames\n`,
    );
    expect(drawn).toBe(2000);
    expect(avg).toBeLessThan(16);
  });
});
