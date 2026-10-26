import { useCallback, useEffect, useRef, useState, type Key, type ReactNode } from 'react';
import { RiZoomInLine, RiZoomOutLine } from '@remixicon/react';
import { Badge } from '@boardui/base/badge';
import { IconButton } from '@boardui/base/icon-button';
import { SegmentedControl, SegmentedControlItem } from '@boardui/base/segmented-control';
import { MAX_PRESENCE_NOTE_IDS } from '@rooms/studio';
import { t } from '../../i18n';
import { ArrangementTimeline, trackTitle } from './ArrangementTimeline';
import { chartToken } from './colors';
import { clamp, SNAP_IDS, type SnapId } from './grid';
import type { NewId } from './edit-ops';
import { PianoRoll } from './PianoRoll';
import type { EditorPort } from './port';
import { StepSequencer, type StepMode } from './StepSequencer';

const ARRANGE_ZOOM = { min: 6, max: 160, initial: 22 };
const ROLL_ZOOM = { min: 16, max: 400, initial: 72 };

/** Opaque contract ids (`[A-Za-z0-9_-]`). */
export const randomId: NewId = () =>
  (
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
  ).replace(/[^a-zA-Z0-9_-]/g, '');

export interface StudioEditorsProps {
  port: EditorPort;
  newId?: NewId;
  /** Opens this clip in the detail editor (fixtures, deep links). */
  initialClipId?: string | null;
  initialDetail?: DetailView;
  /** Draw track names in the arrangement; off when the shell's track headers sit beside it. */
  showLaneLabels?: boolean;
  /** Development measurement hook for the piano roll's draw time. */
  onPianoRollDrawn?(ms: number, drawn: number): void;
  /**
   * The shell's track headers, drawn left of the lanes and scrolled with them. Pass the header row
   * heights as `laneHeight`/`rulerHeight` so every header lines up with its lane.
   */
  laneHeaders?: ReactNode;
  laneHeight?: number;
  rulerHeight?: number;
  /** A mixer panel, offered as a tab beside the clip editor. */
  mixer?: ReactNode;
  /** Which lower panel shows first (fixtures). */
  initialPanel?: LowerPanel;
}

export type LowerPanel = 'clip' | 'mixer';

export type DetailView = 'piano' | 'steps';

function snapLabel(id: SnapId): string {
  return id === 'off' ? t('Serbest') : id;
}

/**
 * The arrangement timeline with the clip editor below it (piano roll, or drum steps for drum
 * tracks). Renders inside the shell's <BoardUiRoot>; all edits go through `port.dispatch`.
 */
export function StudioEditors({
  port,
  newId = randomId,
  initialClipId = null,
  initialDetail,
  showLaneLabels = true,
  onPianoRollDrawn,
  laneHeaders,
  laneHeight,
  rulerHeight,
  mixer,
  initialPanel = 'clip',
}: StudioEditorsProps) {
  const [lower, setLower] = useState<LowerPanel>(initialPanel);
  const headers = useRef<HTMLDivElement>(null);
  const lanes = useRef<HTMLDivElement | null>(null);
  const { doc, canEdit } = port;
  const [snap, setSnap] = useState<SnapId>('1/16');
  const [arrangeZoom, setArrangeZoom] = useState(ARRANGE_ZOOM.initial);
  const [rollZoom, setRollZoom] = useState(ROLL_ZOOM.initial);
  const [selectedClips, setSelectedClips] = useState<Set<string>>(
    () => new Set(initialClipId ? [initialClipId] : []),
  );
  const [activeClipId, setActiveClipId] = useState<string | null>(initialClipId);
  const [selectedNotes, setSelectedNotes] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<DetailView | null>(initialDetail ?? null);
  const [stepMode, setStepMode] = useState<StepMode>('steps');
  const [hint, setHint] = useState<string | null>(null);

  const activeClip = activeClipId ? doc.clips[activeClipId] : undefined;
  const activeTrack = activeClip ? doc.tracks[activeClip.trackId] : undefined;
  const isDrums = activeTrack?.kind === 'drums';
  const view: DetailView = isDrums ? (detail ?? 'steps') : 'piano';

  // A clip deleted by someone else closes the editor; notes that vanished leave the selection.
  useEffect(() => {
    if (activeClipId && !doc.clips[activeClipId]) setActiveClipId(null);
    setSelectedNotes((current) => {
      const kept = [...current].filter((id) => doc.notes[id]);
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [doc, activeClipId]);

  useEffect(() => {
    port.setSelection({
      ...(activeClipId ? { clipId: activeClipId } : {}),
      noteIds: [...selectedNotes].slice(0, MAX_PRESENCE_NOTE_IDS),
    });
    // The port object changes with every doc; publish only when the selection changes.
  }, [activeClipId, selectedNotes]);

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), 4000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const activate = useCallback((id: string | null) => {
    if (id) setLower('clip');
    setActiveClipId((current) => {
      if (current !== id) setSelectedNotes(new Set());
      return id;
    });
  }, []);

  const zoomArrange = (factor: number) =>
    setArrangeZoom((z) => clamp(z * factor, ARRANGE_ZOOM.min, ARRANGE_ZOOM.max));
  const zoomRoll = (factor: number) =>
    setRollZoom((z) => clamp(z * factor, ROLL_ZOOM.min, ROLL_ZOOM.max));
  const single = (keys: Set<Key>) => [...keys][0] as string | undefined;

  return (
    <section
      className="flex h-full min-h-0 flex-col bg-background-canvas"
      aria-label={t('Stüdyo düzenleyicileri')}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-separator-border px-3 py-2">
        <span className="text-caption-1-medium text-text-tertiary">{t('Izgara')}</span>
        <SegmentedControl
          aria-label={t('Izgaraya yasla')}
          selectedKeys={[snap]}
          onSelectionChange={(keys) => {
            const next = single(keys);
            if (next) setSnap(next as SnapId);
          }}
        >
          {SNAP_IDS.map((id) => (
            <SegmentedControlItem key={id} id={id}>
              {snapLabel(id)}
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
        <div className="flex items-center gap-1">
          <IconButton
            icon={RiZoomOutLine}
            size="small"
            aria-label={t('Uzaklaştır')}
            title={t('Uzaklaştır')}
            disabled={arrangeZoom <= ARRANGE_ZOOM.min}
            onClick={() => zoomArrange(1 / 1.4)}
          />
          <IconButton
            icon={RiZoomInLine}
            size="small"
            aria-label={t('Yakınlaştır')}
            title={t('Yakınlaştır')}
            disabled={arrangeZoom >= ARRANGE_ZOOM.max}
            onClick={() => zoomArrange(1.4)}
          />
        </div>
        <span className="flex-1" />
        {hint ? (
          <span role="status" className="text-caption-1-medium text-text-secondary">
            {hint}
          </span>
        ) : null}
        {!canEdit ? (
          <Badge
            color="neutral"
            title={t('Bu projede düzenleme iznin yok; yalnızca dinleyebilirsin.')}
          >
            {t('Salt okunur')}
          </Badge>
        ) : null}
      </div>

      <div className="flex min-h-[160px] flex-[1_1_44%]">
        {laneHeaders ? (
          <div
            ref={headers}
            className="w-[clamp(260px,32vw,320px)] shrink-0 overflow-hidden border-e border-separator-border bg-background-secondary-default"
            onWheel={(event) => {
              if (lanes.current) lanes.current.scrollTop += event.deltaY;
            }}
          >
            {/* Room for the timeline's horizontal scrollbar, so the last header can line up too. */}
            <div className="pb-4">{laneHeaders}</div>
          </div>
        ) : null}
        <div className="flex min-w-0 flex-1 flex-col">
          <ArrangementTimeline
            port={port}
            snap={snap}
            pxPerBeat={arrangeZoom}
            onZoom={zoomArrange}
            selectedClipIds={selectedClips}
            onSelectClips={setSelectedClips}
            activeClipId={activeClipId}
            onActivateClip={activate}
            onHint={setHint}
            newId={newId}
            showLaneLabels={laneHeaders ? false : showLaneLabels}
            laneHeight={laneHeight}
            rulerHeight={rulerHeight}
            scrollerRef={lanes}
            onScrollTop={(top) => {
              if (headers.current) headers.current.scrollTop = top;
            }}
          />
        </div>
      </div>

      <div className="flex min-h-[200px] flex-[1_1_56%] flex-col border-t border-separator-border-strong">
        {mixer ? (
          <div className="flex items-center gap-2 border-b border-separator-border px-3 py-1.5">
            <SegmentedControl
              aria-label={t('Alt panel')}
              selectedKeys={[lower]}
              onSelectionChange={(keys) => {
                const next = single(keys);
                if (next) setLower(next as LowerPanel);
              }}
            >
              <SegmentedControlItem id="clip">{t('Klip düzenleyici')}</SegmentedControlItem>
              <SegmentedControlItem id="mixer">{t('Mikser')}</SegmentedControlItem>
            </SegmentedControl>
          </div>
        ) : null}
        {mixer && lower === 'mixer' ? (
          mixer
        ) : activeClip && activeTrack ? (
          <>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-full"
                style={{ background: `var(${chartToken(activeTrack.color)})` }}
              />
              <span className="min-w-0 truncate text-body-medium text-text-primary">
                {activeClip.name || trackTitle(doc, activeTrack.id)}
              </span>
              {isDrums ? (
                <SegmentedControl
                  aria-label={t('Düzenleyici')}
                  selectedKeys={[view]}
                  onSelectionChange={(keys) => {
                    const next = single(keys);
                    if (next) setDetail(next as DetailView);
                  }}
                >
                  <SegmentedControlItem id="steps">{t('Adımlar')}</SegmentedControlItem>
                  <SegmentedControlItem id="piano">{t('Piyano rulosu')}</SegmentedControlItem>
                </SegmentedControl>
              ) : null}
              {view === 'steps' ? (
                <SegmentedControl
                  aria-label={t('Adım modu')}
                  selectedKeys={[stepMode]}
                  onSelectionChange={(keys) => {
                    const next = single(keys);
                    if (next) setStepMode(next as StepMode);
                  }}
                >
                  <SegmentedControlItem id="steps">{t('Vuruş')}</SegmentedControlItem>
                  <SegmentedControlItem id="accent">{t('Vurgu')}</SegmentedControlItem>
                </SegmentedControl>
              ) : (
                <div className="flex items-center gap-1">
                  <IconButton
                    icon={RiZoomOutLine}
                    size="small"
                    aria-label={t('Notaları uzaklaştır')}
                    title={t('Notaları uzaklaştır')}
                    disabled={rollZoom <= ROLL_ZOOM.min}
                    onClick={() => zoomRoll(1 / 1.4)}
                  />
                  <IconButton
                    icon={RiZoomInLine}
                    size="small"
                    aria-label={t('Notaları yakınlaştır')}
                    title={t('Notaları yakınlaştır')}
                    disabled={rollZoom >= ROLL_ZOOM.max}
                    onClick={() => zoomRoll(1.4)}
                  />
                </div>
              )}
              <span className="flex-1" />
              <span className="text-caption-1-regular text-text-tertiary">
                {view === 'steps'
                  ? t('Tıkla veya sürükle: adım ekle/sil · Shift+tık: vurgu')
                  : t('Çift tık: nota ekle/sil · Sürükle: taşı · Alt+sürükle: kopyala')}
              </span>
            </div>
            {view === 'steps' ? (
              <StepSequencer port={port} clipId={activeClip.id} mode={stepMode} newId={newId} />
            ) : (
              <PianoRoll
                port={port}
                clipId={activeClip.id}
                snap={snap}
                pxPerBeat={rollZoom}
                onZoom={zoomRoll}
                selectedNoteIds={selectedNotes}
                onSelectNotes={setSelectedNotes}
                newId={newId}
                onDrawn={onPianoRollDrawn}
              />
            )}
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 px-6 text-center">
            <p className="text-body-medium text-text-secondary">
              {t('Düzenlemek için bir klip seç')}
            </p>
            <p className="text-caption-1-regular text-text-tertiary">
              {canEdit
                ? t('Bir parçada boş yere çift tıkla veya sürükle: yeni klip oluşur.')
                : t('Bu projede düzenleme iznin yok; klipleri açıp inceleyebilirsin.')}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
