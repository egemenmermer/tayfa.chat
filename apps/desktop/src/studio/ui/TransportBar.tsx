import { useEffect, useState, type ReactNode } from 'react';
import {
  RiArrowGoBackLine,
  RiArrowGoForwardLine,
  RiDownloadLine,
  RiRhythmLine,
  RiPlayFill,
  RiRepeatLine,
  RiStopFill,
} from '@remixicon/react';
import type { StudioOp, StudioProject, StudioTimeSignature } from '@rooms/studio';
import { Button } from '@boardui/base/button';
import { Dropdown, DropdownPopover, DropdownTrigger } from '@boardui/base/dropdown';
import { IconButton } from '@boardui/base/icon-button';
import { Input } from '@boardui/base/input';
import { Select, SelectItem } from '@boardui/base/select';
import { RangeSlider } from '@boardui/base/slider';
import { cx } from '@boardui/foundations/cx';
import { barBeats } from '../engine/schedule';
import { t } from '../../i18n';
import { Explained } from './Explained';
import {
  formatPosition,
  parseSignature,
  parseTempo,
  projectBars,
  signatureChoices,
  signatureKey,
} from './music';
import type { StudioTransport } from './transport';

/** Loop on/off and its range in whole bars (1-based, end exclusive), kept per client. */
export interface LoopSetting {
  on: boolean;
  startBar: number;
  endBar: number;
}

/** The last position the engine reported; a fresh `position()` call would differ on every read while playing. */
function usePlayhead(transport: StudioTransport) {
  const [state, setState] = useState(() => ({
    beat: transport.position(),
    playing: transport.playing(),
  }));
  useEffect(() => {
    setState({ beat: transport.position(), playing: transport.playing() });
    return transport.onPosition((beat, playing) => setState({ beat, playing }));
  }, [transport]);
  return state;
}

const toggleClass = (on: boolean) =>
  cx(on && 'bg-button-ghost-background text-button-ghost-foreground hover:bg-button-ghost-hover');

export interface TransportBarProps {
  doc: StudioProject;
  readOnly: boolean;
  transport: StudioTransport;
  dispatch(ops: StudioOp[]): boolean;
  canUndo: boolean;
  canRedo: boolean;
  undo(): void;
  redo(): void;
  loop: LoopSetting;
  onLoopChange(loop: LoopSetting): void;
  metronome: boolean;
  onMetronomeChange(on: boolean): void;
  onError(message: string): void;
  /** ST-ui-c's export control; until then a disabled placeholder explains why. */
  exportSlot?: ReactNode;
  presence?: ReactNode;
}

export function TransportBar(props: TransportBarProps) {
  const { doc, readOnly, transport, dispatch } = props;
  const editReason = readOnly ? t('Bu projeyi düzenleme iznin yok.') : null;
  const bars = projectBars(doc.lengthBeats, doc.timeSignature);

  return (
    <div
      role="toolbar"
      aria-label={t('Çalma kontrolleri')}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-separator-border bg-background-secondary-default px-4 py-2"
    >
      <PlayControls transport={transport} signature={doc.timeSignature} onError={props.onError} />

      <div className="flex items-center gap-1">
        <IconButton
          size="small"
          icon={RiRepeatLine}
          aria-label={t('Döngü')}
          aria-pressed={props.loop.on}
          className={toggleClass(props.loop.on)}
          onClick={() => props.onLoopChange({ ...props.loop, on: !props.loop.on })}
        />
        <LoopRange bars={bars} loop={props.loop} onChange={props.onLoopChange} />
        <IconButton
          size="small"
          icon={RiRhythmLine}
          aria-label={t('Metronom')}
          aria-pressed={props.metronome}
          className={toggleClass(props.metronome)}
          onClick={() => props.onMetronomeChange(!props.metronome)}
        />
      </div>

      <div className="flex items-center gap-2">
        <TempoField
          tempo={doc.tempo}
          reason={editReason}
          onCommit={(tempo) => dispatch([{ op: 'project.set', field: 'tempo', value: tempo }])}
        />
        <Select
          size="sm"
          isDisabled={readOnly}
          aria-label={t('Ölçü birimi')}
          className="w-[84px]"
          selectedKey={signatureKey(doc.timeSignature)}
          onSelectionChange={(key) => {
            const next = parseSignature(String(key));
            if (next && signatureKey(next) !== signatureKey(doc.timeSignature))
              dispatch([{ op: 'project.set', field: 'timeSignature', value: next }]);
          }}
        >
          {signatureChoices(doc.timeSignature).map((choice) => (
            <SelectItem
              key={signatureKey(choice)}
              id={signatureKey(choice)}
              textValue={signatureKey(choice)}
            >
              {signatureKey(choice)}
            </SelectItem>
          ))}
        </Select>
      </div>

      <span className="flex-1" />
      {props.presence}

      <div className="flex items-center gap-1">
        <Explained reason={editReason ?? (!props.canUndo && t('Geri alınacak değişiklik yok.'))}>
          <IconButton
            size="small"
            icon={RiArrowGoBackLine}
            aria-label={t('Geri al')}
            aria-keyshortcuts="Meta+Z Control+Z"
            onClick={() => props.undo()}
          />
        </Explained>
        <Explained reason={editReason ?? (!props.canRedo && t('Yinelenecek değişiklik yok.'))}>
          <IconButton
            size="small"
            icon={RiArrowGoForwardLine}
            aria-label={t('Yinele')}
            aria-keyshortcuts="Shift+Meta+Z Shift+Control+Z"
            onClick={() => props.redo()}
          />
        </Explained>
      </div>
      {props.exportSlot ?? (
        <Explained
          reason={t(
            'Dışa aktarma henüz hazır değil; bir sonraki sürümle WAV olarak kaydedebileceksin.',
          )}
        >
          <Button size="small" variant="secondary" leadingIcon={RiDownloadLine}>
            {t('Dışa aktar')}
          </Button>
        </Explained>
      )}
    </div>
  );
}

function TempoField({
  tempo,
  reason,
  onCommit,
}: {
  tempo: number;
  reason: string | null;
  onCommit(tempo: number): void;
}) {
  const [text, setText] = useState(String(tempo));
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(String(tempo));
  }, [tempo, editing]);
  const commit = () => {
    setEditing(false);
    const next = parseTempo(text);
    if (next === null || next === tempo) setText(String(tempo));
    else onCommit(next);
  };
  const field = (
    <Input
      size="small"
      aria-label={t('Tempo (BPM)')}
      className="w-[96px]"
      inputMode="numeric"
      value={text}
      isReadOnly={!!reason}
      leadingAddon={<span className="ps-1.5 text-caption-1-medium text-text-tertiary">BPM</span>}
      onChange={(value) => {
        setEditing(true);
        setText(value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') {
          setEditing(false);
          setText(String(tempo));
        }
      }}
    />
  );
  return field;
}

function LoopRange({
  bars,
  loop,
  onChange,
}: {
  bars: number;
  loop: LoopSetting;
  onChange(loop: LoopSetting): void;
}) {
  const end = Math.min(loop.endBar, bars + 1);
  const start = Math.min(loop.startBar, end - 1);
  return (
    <Dropdown>
      <DropdownTrigger
        aria-label={t('Döngü aralığı: {start}–{end}. ölçü', { start, end: end - 1 })}
        className={cx(
          'flex h-8 items-center rounded-lg border border-border-button-default bg-background-primary-default px-2 font-mono text-caption-1-medium tabular-nums hover:bg-background-primary-hover',
          loop.on ? 'text-text-primary' : 'text-text-tertiary',
        )}
      >
        {start}–{end - 1}
      </DropdownTrigger>
      <DropdownPopover aria-label={t('Döngü aralığı')} placement="bottom start">
        <div className="flex w-[260px] flex-col gap-2 p-2">
          <RangeSlider
            label={t('Döngü aralığı (ölçü)')}
            minValue={1}
            maxValue={bars + 1}
            step={1}
            value={[start, end]}
            thumbLabels={[t('Döngü başlangıcı'), t('Döngü sonu')]}
            formatValue={(value, index) => (index === 1 ? value - 1 : value)}
            onChange={(values) => {
              const [nextStart = start, nextEnd = end] = values;
              if (nextEnd > nextStart) onChange({ on: true, startBar: nextStart, endBar: nextEnd });
            }}
          />
          <p className="text-caption-1-regular text-text-tertiary">
            {t('Döngü yalnızca senin dinlediğini etkiler.')}
          </p>
        </div>
      </DropdownPopover>
    </Dropdown>
  );
}

/** Loop region in beats for the engine, or null when the loop is off. */
export function loopRegion(loop: LoopSetting, doc: Pick<StudioProject, 'timeSignature'>) {
  if (!loop.on) return null;
  const perBar = barBeats(doc.timeSignature);
  return { startBeat: (loop.startBar - 1) * perBar, endBeat: (loop.endBar - 1) * perBar };
}

/** Play/stop and the position readout: the only part of the bar that renders at the engine's ~30 Hz. */
function PlayControls({
  transport,
  signature,
  onError,
}: {
  transport: StudioTransport;
  signature: StudioTimeSignature;
  onError(message: string): void;
}) {
  const { beat, playing } = usePlayhead(transport);
  return (
    <div className="flex items-center gap-1.5">
      {playing ? (
        <Button size="small" leadingIcon={RiStopFill} onClick={() => transport.stop()}>
          {t('Durdur')}
        </Button>
      ) : (
        <Button
          size="small"
          leadingIcon={RiPlayFill}
          onClick={() =>
            void transport
              .play()
              .catch((error: unknown) =>
                onError(
                  error instanceof Error && error.name === 'AbortError'
                    ? t('Çalma durduruldu.')
                    : t('Ses başlatılamadı. Ses çıkış aygıtını denetleyip yeniden dene.'),
                ),
              )
          }
        >
          {t('Çal')}
        </Button>
      )}
      <output
        aria-label={t('Konum (ölçü:vuruş)')}
        className="min-w-[56px] rounded-lg bg-background-inner-default px-2 py-1 text-center font-mono text-body-medium text-text-primary tabular-nums"
      >
        {formatPosition(beat, signature)}
      </output>
    </div>
  );
}
