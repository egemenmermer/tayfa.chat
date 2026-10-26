import { useEffect, useState } from 'react';
import {
  RiAddLine,
  RiAlertLine,
  RiArrowDownLine,
  RiArrowUpLine,
  RiDeleteBinLine,
  RiDraggable,
  RiHeadphoneLine,
  RiMicLine,
  RiMore2Fill,
  RiPianoLine,
  RiVolumeMuteLine,
} from '@remixicon/react';
import {
  defaultTrack,
  MAX_TRACK_NAME,
  MAX_TRACKS,
  TRACK_COLOR_COUNT,
  type StudioOp,
  type StudioProject,
  type StudioTrack,
  type StudioTrackKind,
} from '@rooms/studio';
import { Button } from '@boardui/base/button';
import {
  Dropdown,
  DropdownDivider,
  DropdownItem,
  DropdownPopover,
  DropdownTrigger,
} from '@boardui/base/dropdown';
import { IconButton } from '@boardui/base/icon-button';
import { Input } from '@boardui/base/input';
import { Select, SelectItem } from '@boardui/base/select';
import { Slider } from '@boardui/base/slider';
import { Tooltip, TooltipTrigger } from '@boardui/base/tooltip';
import { cx } from '@boardui/foundations/cx';
import { Focusable } from 'react-aria-components';
import {
  instrumentChoices,
  instrumentLabel,
  instrumentProblem,
  resolveInstrument,
} from '../engine/instruments';
import { t } from '../../i18n';
import { Explained } from './Explained';
import { trackColor, trackColorName, trackDisplayName, volumePercent } from './music';
import { newStudioId } from './model';

/** Height of one track row; the arrangement lanes beside the headers use the same height. */
export const STUDIO_TRACK_ROW_HEIGHT = 88;
/** The strip above the first row (count + add); the arrangement ruler has the same height. */
export const STUDIO_TRACK_HEADER_HEIGHT = 40;

const DRAG_TYPE = 'application/x-tayfa-studio-track';

export interface TrackHeadersProps {
  doc: StudioProject;
  readOnly: boolean;
  dispatch(ops: StudioOp[]): boolean;
  newId?: () => string;
}

/** The column of track headers: add, rename, instrument, mute/solo, volume, colour, reorder and delete. */
export function TrackHeaders({ doc, readOnly, dispatch, newId = newStudioId }: TrackHeadersProps) {
  const order = doc.trackOrder.filter((id) => doc.tracks[id]);
  const [dragging, setDragging] = useState<string | null>(null);
  const move = (id: string, index: number) => dispatch([{ op: 'track.move', id, index }]);
  const addTrack = (kind: StudioTrackKind) => {
    const used = new Set(order.map((id) => doc.tracks[id]!.color));
    const color =
      Array.from({ length: TRACK_COLOR_COUNT }, (_, i) => i).find((i) => !used.has(i)) ??
      order.length % TRACK_COLOR_COUNT;
    dispatch([{ op: 'track.create', track: defaultTrack(newId(), kind, { color }) }]);
  };
  return (
    <div className="flex flex-col" aria-label={t('Parçalar')} role="group">
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-separator-border px-3">
        <span className="text-caption-1-semibold text-text-secondary">
          {t('{count} parça', { count: order.length })}
        </span>
        <AddTrack
          reason={
            readOnly
              ? t('Bu projeyi düzenleme iznin yok.')
              : order.length >= MAX_TRACKS
                ? t('Bir projede en fazla {max} parça olabilir.', { max: MAX_TRACKS })
                : null
          }
          onAdd={addTrack}
        />
      </div>
      {!order.length && (
        <p className="px-3 py-4 text-body-regular text-text-tertiary">
          {readOnly
            ? t('Bu projede henüz parça yok.')
            : t('Henüz parça yok. “Parça ekle” ile bir enstrüman ya da davul ekle.')}
        </p>
      )}
      <ol aria-label={t('Parça listesi')}>
        {order.map((id, index) => (
          <TrackHeader
            key={id}
            track={doc.tracks[id]!}
            index={index}
            count={order.length}
            readOnly={readOnly}
            dragging={dragging === id}
            dispatch={dispatch}
            onMove={(to) => move(id, to)}
            onDragStart={() => setDragging(id)}
            onDragEnd={() => setDragging(null)}
            onDropTrack={(dragged) => {
              setDragging(null);
              if (dragged !== id && doc.tracks[dragged]) move(dragged, index);
            }}
          />
        ))}
      </ol>
    </div>
  );
}

function AddTrack({
  reason,
  onAdd,
}: {
  reason: string | null;
  onAdd(kind: StudioTrackKind): void;
}) {
  const [open, setOpen] = useState(false);
  if (reason)
    return (
      <Explained reason={reason}>
        <Button size="small" variant="secondary" leadingIcon={RiAddLine}>
          {t('Parça ekle')}
        </Button>
      </Explained>
    );
  const pick = (kind: StudioTrackKind) => {
    setOpen(false);
    onAdd(kind);
  };
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger className="flex h-8 items-center gap-1 rounded-lg border border-border-button-default bg-background-primary-default px-2 text-body-medium text-text-primary hover:bg-background-primary-hover">
        <RiAddLine className="size-4 text-foreground-icon-secondary" aria-hidden />
        {t('Parça ekle')}
      </DropdownTrigger>
      <DropdownPopover aria-label={t('Parça türü')} placement="bottom end">
        <DropdownItem onSelect={() => pick('instrument')}>
          <RiPianoLine className="size-4 text-foreground-icon-secondary" aria-hidden />
          <span className="text-body-medium">{t('Enstrüman')}</span>
        </DropdownItem>
        <DropdownItem onSelect={() => pick('drums')}>
          <DrumIcon />
          <span className="text-body-medium">{t('Davul')}</span>
        </DropdownItem>
        <DropdownDivider />
        <div role="note" aria-disabled className="flex items-start gap-2 p-2 text-text-tertiary">
          <RiMicLine className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span className="flex flex-col">
            <span className="text-body-medium">{t('Ses kaydı')}</span>
            <span className="text-caption-1-regular">
              {t('Kayıt yakında: mikrofon ve ses kartı kaydı sonraki aşamada geliyor.')}
            </span>
          </span>
        </div>
      </DropdownPopover>
    </Dropdown>
  );
}

function DrumIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-4 text-foreground-icon-secondary" aria-hidden>
      <ellipse cx="12" cy="8" rx="8" ry="3" fill="none" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M4 8v8c0 1.7 3.6 3 8 3s8-1.3 8-3V8"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
    </svg>
  );
}

interface TrackHeaderProps {
  track: StudioTrack;
  index: number;
  count: number;
  readOnly: boolean;
  dragging: boolean;
  dispatch(ops: StudioOp[]): boolean;
  onMove(index: number): void;
  onDragStart(): void;
  onDragEnd(): void;
  onDropTrack(id: string): void;
}

function TrackHeader({
  track,
  index,
  count,
  readOnly,
  dragging,
  dispatch,
  onMove,
  onDragStart,
  onDragEnd,
  onDropTrack,
}: TrackHeaderProps) {
  const name = trackDisplayName(track, index + 1);
  const [confirming, setConfirming] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [over, setOver] = useState(false);
  const set = <F extends 'name' | 'instrument' | 'volume' | 'mute' | 'solo' | 'color'>(
    field: F,
    value: StudioTrack[F],
  ) => dispatch([{ op: 'track.set', id: track.id, field, value } as StudioOp]);
  return (
    <li
      aria-label={name}
      style={{ height: STUDIO_TRACK_ROW_HEIGHT }}
      className={cx(
        'relative flex flex-col justify-center gap-1.5 border-b border-separator-border py-2 pe-2 ps-3',
        dragging && 'opacity-50',
        over && 'bg-background-secondary-hover',
      )}
      onDragOver={(event) => {
        if (readOnly || !event.dataTransfer.types.includes(DRAG_TYPE)) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        setOver(false);
        const dragged = event.dataTransfer.getData(DRAG_TYPE);
        if (dragged) {
          event.preventDefault();
          onDropTrack(dragged);
        }
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 start-0 w-1"
        style={{ background: trackColor(track.color) }}
      />
      <div className="flex min-w-0 items-center gap-1">
        <span
          draggable={!readOnly}
          title={readOnly ? undefined : t('Sıralamak için sürükle')}
          onDragStart={(event) => {
            event.dataTransfer.setData(DRAG_TYPE, track.id);
            event.dataTransfer.effectAllowed = 'move';
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          className={cx(
            'flex size-5 shrink-0 items-center justify-center text-foreground-icon-tertiary',
            !readOnly && 'cursor-grab',
          )}
        >
          <RiDraggable className="size-4" aria-hidden />
        </span>
        <ColorPicker
          color={track.color}
          disabled={readOnly}
          onPick={(color) => color !== track.color && set('color', color)}
        />
        <TrackName
          name={name}
          raw={track.name}
          readOnly={readOnly}
          onRename={(next) => set('name', next)}
        />
        <IconButton
          size="small"
          icon={RiVolumeMuteLine}
          aria-label={t('Sustur')}
          aria-pressed={track.mute}
          disabled={readOnly}
          className={cx(
            'size-7',
            track.mute && 'bg-background-tertiary-error text-text-error-primary',
          )}
          onClick={() => set('mute', !track.mute)}
        />
        <IconButton
          size="small"
          icon={RiHeadphoneLine}
          aria-label={t('Solo dinle')}
          aria-pressed={track.solo}
          disabled={readOnly}
          className={cx(
            'size-7',
            track.solo &&
              'bg-button-ghost-background text-button-ghost-foreground hover:bg-button-ghost-hover',
          )}
          onClick={() => set('solo', !track.solo)}
        />
        {!readOnly && (
          <Dropdown isOpen={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownTrigger
              aria-label={t('{name} için diğer işlemler', { name })}
              className="flex size-7 shrink-0 items-center justify-center rounded-lg hover:bg-background-primary-hover"
            >
              <RiMore2Fill className="size-4 text-foreground-icon-secondary" aria-hidden />
            </DropdownTrigger>
            <DropdownPopover aria-label={name} placement="bottom end">
              {index > 0 && (
                <DropdownItem
                  onSelect={() => {
                    setMenuOpen(false);
                    onMove(index - 1);
                  }}
                >
                  <RiArrowUpLine className="size-4 text-foreground-icon-secondary" aria-hidden />
                  <span className="text-body-medium">{t('Yukarı taşı')}</span>
                </DropdownItem>
              )}
              {index < count - 1 && (
                <DropdownItem
                  onSelect={() => {
                    setMenuOpen(false);
                    onMove(index + 1);
                  }}
                >
                  <RiArrowDownLine className="size-4 text-foreground-icon-secondary" aria-hidden />
                  <span className="text-body-medium">{t('Aşağı taşı')}</span>
                </DropdownItem>
              )}
              {count > 1 && <DropdownDivider />}
              <DropdownItem
                onSelect={() => {
                  setMenuOpen(false);
                  setConfirming(true);
                }}
              >
                <RiDeleteBinLine className="size-4 text-foreground-icon-error" aria-hidden />
                <span className="text-body-medium text-text-destructive">{t('Parçayı sil')}</span>
              </DropdownItem>
            </DropdownPopover>
          </Dropdown>
        )}
      </div>
      {confirming ? (
        <div
          role="group"
          aria-label={t('Silmeyi onayla')}
          className="flex items-center gap-1.5 ps-6"
        >
          <span className="min-w-0 flex-1 truncate text-caption-1-medium text-text-secondary">
            {t('Parça ve notaları herkes için silinsin mi?')}
          </span>
          <Button
            size="xs"
            variant="secondary"
            className="h-6 px-2"
            onClick={() => setConfirming(false)}
          >
            {t('Vazgeç')}
          </Button>
          <Button
            size="xs"
            variant="danger"
            className="h-6 px-2"
            onClick={() => {
              setConfirming(false);
              dispatch([{ op: 'track.delete', id: track.id }]);
            }}
          >
            {t('Sil')}
          </Button>
        </div>
      ) : (
        <div className="flex min-w-0 items-center gap-2 ps-6">
          <InstrumentPicker
            track={track}
            readOnly={readOnly}
            onPick={(ref) => ref !== track.instrument && set('instrument', ref)}
          />
          <VolumeSlider
            volume={track.volume}
            readOnly={readOnly}
            label={t('{name} ses düzeyi', { name })}
            onCommit={(volume) => set('volume', volume)}
          />
        </div>
      )}
    </li>
  );
}

function TrackName({
  name,
  raw,
  readOnly,
  onRename,
}: {
  name: string;
  raw: string;
  readOnly: boolean;
  onRename(name: string): void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(raw);
  if (editing) {
    const finish = (save: boolean) => {
      setEditing(false);
      const next = text.trim().slice(0, MAX_TRACK_NAME);
      if (save && next !== raw.trim()) onRename(next);
    };
    return (
      <Input
        size="small"
        autoFocus
        aria-label={t('Parça adı')}
        className="min-w-0 flex-1"
        value={text}
        maxLength={MAX_TRACK_NAME}
        onChange={setText}
        onBlur={() => finish(true)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') finish(true);
          if (event.key === 'Escape') finish(false);
        }}
      />
    );
  }
  return (
    <button
      type="button"
      className="min-w-0 flex-1 truncate rounded-md px-1 py-0.5 text-start text-body-semibold text-text-primary enabled:hover:bg-background-primary-hover"
      title={readOnly ? name : t('{name} · yeniden adlandırmak için tıkla', { name })}
      aria-label={readOnly ? name : t('{name} adını değiştir', { name })}
      disabled={readOnly}
      onClick={() => {
        setText(raw || name);
        setEditing(true);
      }}
    >
      {name}
    </button>
  );
}

function ColorPicker({
  color,
  disabled,
  onPick,
}: {
  color: number;
  disabled: boolean;
  onPick(color: number): void;
}) {
  const [open, setOpen] = useState(false);
  const swatch = (
    <span
      aria-hidden
      className="block size-3.5 rounded-full border border-border-button-default"
      style={{ background: trackColor(color) }}
    />
  );
  if (disabled)
    return <span className="flex size-6 shrink-0 items-center justify-center">{swatch}</span>;
  return (
    <Dropdown isOpen={open} onOpenChange={setOpen}>
      <DropdownTrigger
        aria-label={t('Parça rengi: {color}', { color: trackColorName(color) })}
        className="flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-background-primary-hover"
      >
        {swatch}
      </DropdownTrigger>
      <DropdownPopover aria-label={t('Parça rengi')} placement="bottom start">
        <div className="grid grid-cols-6 gap-1.5 p-1">
          {Array.from({ length: TRACK_COLOR_COUNT }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={trackColorName(i)}
              aria-pressed={i === color}
              title={trackColorName(i)}
              onClick={() => {
                setOpen(false);
                onPick(i);
              }}
              className={cx(
                'size-6 rounded-full border-2',
                i === color ? 'border-text-primary' : 'border-transparent',
              )}
              style={{ background: trackColor(i) }}
            />
          ))}
        </div>
      </DropdownPopover>
    </Dropdown>
  );
}

function InstrumentPicker({
  track,
  readOnly,
  onPick,
}: {
  track: StudioTrack;
  readOnly: boolean;
  onPick(ref: string): void;
}) {
  const resolution = resolveInstrument(track.instrument);
  const problem = instrumentProblem(resolution);
  const choices = instrumentChoices().filter((choice) => choice.drums === (track.kind === 'drums'));
  const known = choices.some((choice) => choice.ref === track.instrument);
  const fixed = track.kind === 'audio';
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Select
        size="sm"
        aria-label={t('Enstrüman')}
        className="min-w-0 flex-1"
        isDisabled={readOnly || fixed}
        selectedKey={track.instrument}
        onSelectionChange={(key) => key != null && onPick(String(key))}
      >
        {[
          ...(known ? [] : [{ ref: track.instrument, label: instrumentLabel(track.instrument) }]),
          ...choices,
        ].map((choice) => (
          <SelectItem key={choice.ref} id={choice.ref} textValue={choice.label}>
            {choice.label}
          </SelectItem>
        ))}
      </Select>
      {problem && (
        <TooltipTrigger>
          <Focusable>
            <span
              role="img"
              tabIndex={0}
              aria-label={problem}
              className="flex size-6 shrink-0 items-center justify-center rounded-md text-foreground-icon-error"
            >
              <RiAlertLine className="size-4" aria-hidden />
            </span>
          </Focusable>
          <Tooltip placement="top">{problem}</Tooltip>
        </TooltipTrigger>
      )}
    </div>
  );
}

function VolumeSlider({
  volume,
  readOnly,
  label,
  onCommit,
}: {
  volume: number;
  readOnly: boolean;
  label: string;
  onCommit(volume: number): void;
}) {
  const [value, setValue] = useState(volume);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setValue(volume);
  }, [volume, dragging]);
  return (
    <div className="flex w-[104px] shrink-0 items-center gap-1.5">
      <Slider
        className="min-w-0 flex-1"
        thumbLabel={label}
        aria-label={label}
        showTooltip={false}
        minValue={0}
        maxValue={1.5}
        step={0.01}
        value={value}
        isDisabled={readOnly}
        onChange={(next) => {
          setDragging(true);
          setValue(next);
        }}
        onChangeEnd={(next) => {
          setDragging(false);
          if (Math.abs(next - volume) > 1e-9) onCommit(next);
        }}
      />
      <span className="w-9 text-end font-mono text-caption-1-medium text-text-secondary tabular-nums">
        {volumePercent(value)}
      </span>
    </div>
  );
}
