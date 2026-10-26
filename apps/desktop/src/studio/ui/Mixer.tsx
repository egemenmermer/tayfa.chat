import { useEffect, useState } from 'react';
import type { StudioOp, StudioProject, StudioTrack } from '@rooms/studio';
import { Slider } from '@boardui/base/slider';
import { Switch } from '@boardui/base/switch';
import { t } from '../../i18n';
import { trackColor, trackDisplayName, volumePercent } from './music';

type MixerField =
  | 'volume'
  | 'pan'
  | 'sends.reverb'
  | 'sends.delay'
  | 'eq.low'
  | 'eq.mid'
  | 'eq.high';

export interface StudioMixerProps {
  doc: StudioProject;
  readOnly: boolean;
  dispatch(ops: StudioOp[]): boolean;
}

export function panLabel(pan: number): string {
  const amount = Math.round(Math.abs(pan) * 100);
  if (amount === 0) return t('Orta');
  return pan < 0 ? t('Sol {n}', { n: amount }) : t('Sağ {n}', { n: amount });
}

const decibels = (value: number) => `${value > 0 ? '+' : ''}${Math.round(value)} dB`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * Channel strips for every track: volume, pan, mute/solo, reverb/delay sends and a three-band EQ. Each control
 * sends one `track.set` when the drag ends, so a drag is one undo step and one batch. There is no level meter:
 * the engine does not expose one yet, and a fake meter would mislead.
 */
export function StudioMixer({ doc, readOnly, dispatch }: StudioMixerProps) {
  const order = doc.trackOrder.filter((id) => doc.tracks[id]);
  if (!order.length)
    return (
      <div className="flex flex-1 items-center justify-center p-6 text-center text-body-regular text-text-tertiary">
        {t('Mikserde gösterilecek parça yok. Önce bir parça ekle.')}
      </div>
    );
  return (
    <div
      role="group"
      aria-label={t('Mikser')}
      className="flex min-h-0 flex-1 gap-2 overflow-auto p-3"
    >
      {order.map((id, index) => (
        <ChannelStrip
          key={id}
          track={doc.tracks[id]!}
          name={trackDisplayName(doc.tracks[id]!, index + 1)}
          readOnly={readOnly}
          dispatch={dispatch}
        />
      ))}
    </div>
  );
}

function ChannelStrip({
  track,
  name,
  readOnly,
  dispatch,
}: {
  track: StudioTrack;
  name: string;
  readOnly: boolean;
  dispatch(ops: StudioOp[]): boolean;
}) {
  const set = (field: MixerField | 'mute' | 'solo', value: number | boolean) =>
    dispatch([{ op: 'track.set', id: track.id, field, value } as StudioOp]);
  const knob = (
    field: MixerField,
    label: string,
    value: number,
    range: [number, number, number],
    format: (value: number) => string,
  ) => (
    <MixerSlider
      key={field}
      label={label}
      trackName={name}
      value={value}
      min={range[0]}
      max={range[1]}
      step={range[2]}
      readOnly={readOnly}
      format={format}
      onCommit={(next) => set(field, next)}
    />
  );
  return (
    <section
      aria-label={t('{name} kanalı', { name })}
      className="flex w-[200px] shrink-0 flex-col gap-2 rounded-xl border border-border-button-default bg-background-secondary-default p-3"
    >
      <header className="flex min-w-0 items-center gap-2">
        <span
          aria-hidden
          className="size-2.5 shrink-0 rounded-full"
          style={{ background: trackColor(track.color) }}
        />
        <h3 className="min-w-0 truncate text-body-medium text-text-primary" title={name}>
          {name}
        </h3>
      </header>
      {knob('volume', t('Ses'), track.volume, [0, 1.5, 0.01], volumePercent)}
      {knob('pan', t('Pan'), track.pan, [-1, 1, 0.01], panLabel)}
      <div className="flex items-center gap-3">
        <Switch
          size="sm"
          isSelected={track.mute}
          isDisabled={readOnly}
          onChange={(on) => set('mute', on)}
        >
          <span className="text-caption-1-medium text-text-secondary">{t('Sustur')}</span>
        </Switch>
        <Switch
          size="sm"
          isSelected={track.solo}
          isDisabled={readOnly}
          onChange={(on) => set('solo', on)}
        >
          <span className="text-caption-1-medium text-text-secondary">{t('Solo')}</span>
        </Switch>
      </div>
      <h4 className="text-caption-2-semibold text-text-tertiary">{t('Efektler')}</h4>
      {knob('sends.reverb', t('Yankı'), track.sends.reverb, [0, 1, 0.01], percent)}
      {knob('sends.delay', t('Gecikme'), track.sends.delay, [0, 1, 0.01], percent)}
      <h4 className="text-caption-2-semibold text-text-tertiary">{t('Ekolayzer')}</h4>
      {knob('eq.low', t('Bas'), track.eq.low, [-12, 12, 0.5], decibels)}
      {knob('eq.mid', t('Orta frekans'), track.eq.mid, [-12, 12, 0.5], decibels)}
      {knob('eq.high', t('Tiz'), track.eq.high, [-12, 12, 0.5], decibels)}
    </section>
  );
}

function MixerSlider({
  label,
  trackName,
  value,
  min,
  max,
  step,
  readOnly,
  format,
  onCommit,
}: {
  label: string;
  trackName: string;
  value: number;
  min: number;
  max: number;
  step: number;
  readOnly: boolean;
  format(value: number): string;
  onCommit(value: number): void;
}) {
  // Local value while dragging; the document value wins again once the drag ends or another member edits.
  const [local, setLocal] = useState(value);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (!dragging) setLocal(value);
  }, [value, dragging]);
  const name = t('{track}: {control}', { track: trackName, control: label });
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-caption-1-medium text-text-secondary">{label}</span>
        <span className="shrink-0 font-mono text-caption-1-medium text-text-tertiary tabular-nums">
          {format(local)}
        </span>
      </div>
      <Slider
        thumbLabel={name}
        aria-label={name}
        showTooltip={false}
        minValue={min}
        maxValue={max}
        step={step}
        value={local}
        isDisabled={readOnly}
        onChange={(next) => {
          setDragging(true);
          setLocal(next);
        }}
        onChangeEnd={(next) => {
          setDragging(false);
          if (Math.abs(next - value) > 1e-9) onCommit(next);
        }}
      />
    </div>
  );
}
