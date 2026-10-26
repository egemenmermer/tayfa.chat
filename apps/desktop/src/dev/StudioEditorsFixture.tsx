import { StrictMode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { BoardUiRoot } from '@boardui/foundations/root';
import { FakeEditorStore } from '../studio/editors/fake-port';
import { StudioEditors } from '../studio/editors/StudioEditors';
import { sample } from './sample';
import {
  STUDIO_EDITORS_FIXTURE_VARIANTS,
  studioEditorsFixtureClip,
  studioEditorsFixtureDoc,
  studioEditorsFixturePresence,
  type StudioEditorsFixtureVariant,
} from './studio-editors-fixture';

/** Draw-time readout of the piano roll (perf variant): average and worst of the measured draws. */
function usePerfMeter() {
  const samples = useRef<number[]>([]);
  const [summary, setSummary] = useState<{
    avg: number;
    max: number;
    drawn: number;
    count: number;
  } | null>(null);
  const onDrawn = (ms: number, drawn: number) => {
    samples.current.push(ms);
    const list = samples.current;
    if (list.length % 10 !== 0 && list.length > 2) return;
    const avg = list.reduce((sum, value) => sum + value, 0) / list.length;
    queueMicrotask(() => setSummary({ avg, max: Math.max(...list), drawn, count: list.length }));
  };
  return { summary, onDrawn };
}

function StudioEditorsFixture({ variant }: { variant: StudioEditorsFixtureVariant }) {
  const store = useMemo(() => {
    const created = new FakeEditorStore(studioEditorsFixtureDoc(variant), {
      presence: variant === 'empty' ? [] : studioEditorsFixturePresence(),
      loop: variant === 'empty' ? null : { startBeat: 16, endBeat: 32, enabled: true },
      canEdit: variant !== 'read-only',
    });
    created.playhead = 12;
    return created;
  }, [variant]);
  const port = useSyncExternalStore(store.subscribe, store.getPort);
  const perf = usePerfMeter();

  // Perf variant: 60 consecutive re-renders (a drag's worth of frames), one per animation frame.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (variant !== 'perf') return;
    let frames = 0;
    let handle = 0;
    const step = () => {
      frames += 1;
      setTick(frames);
      if (frames < 60) handle = requestAnimationFrame(step);
    };
    handle = requestAnimationFrame(step);
    return () => cancelAnimationFrame(handle);
  }, [variant]);

  return (
    <BoardUiRoot>
      <main className="flex h-screen flex-col bg-background-full">
        <header className="flex flex-wrap items-baseline gap-3 px-4 py-2">
          <h1 className="text-headline-semibold text-text-primary">
            {sample('Stüdyo düzenleyicileri', 'Studio editors')}
          </h1>
          <span className="rounded-full border border-border-button-default px-2 py-0.5 text-caption-2-semibold tracking-[0.08em] text-text-secondary">
            {sample('GELİŞTİRME ÖRNEĞİ', 'DEVELOPMENT SAMPLE')}
          </span>
          {perf.summary ? (
            <span
              data-testid="studio-perf"
              className="text-caption-1-regular text-text-tertiary tabular-nums"
            >
              {sample('Çizim', 'Draw')}: {perf.summary.avg.toFixed(2)} ms ⌀ ·{' '}
              {perf.summary.max.toFixed(2)} ms max · {perf.summary.drawn}{' '}
              {sample('nota çizildi', 'notes drawn')} · {perf.summary.count}{' '}
              {sample('kare', 'frames')}
            </span>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 border-t border-separator-border">
          <StudioEditors
            port={port}
            initialClipId={studioEditorsFixtureClip(variant)}
            onPianoRollDrawn={variant === 'perf' ? perf.onDrawn : undefined}
          />
        </div>
      </main>
    </BoardUiRoot>
  );
}

/** Mounts the editors fixture in place of the app shell (main.tsx, development only). */
export function renderStudioEditorsFixture(container: HTMLElement, variant: string) {
  const variants: readonly string[] = STUDIO_EDITORS_FIXTURE_VARIANTS.S94;
  const chosen = (variants.includes(variant) ? variant : 'default') as StudioEditorsFixtureVariant;
  document.documentElement.dataset.referenceFixture = `S94/${chosen}`;
  createRoot(container).render(
    <StrictMode>
      <StudioEditorsFixture variant={chosen} />
    </StrictMode>,
  );
}
