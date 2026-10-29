// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRooms } from '../apps/desktop/src/store';
import {
  InputSensitivity,
  meterPercent,
  type InputMeterSource,
} from '../apps/desktop/src/InputSensitivity';
import type { MicGateReport } from '../packages/media-providers/src/mic-gate';

const original = useRooms.getState().preferences;
afterEach(() => {
  cleanup();
  useRooms.setState({ preferences: original });
  localStorage.clear();
  vi.useRealTimers();
});

describe('input sensitivity preferences', () => {
  it('defaults to automatic with the leveler on', () => {
    expect(original).toMatchObject({
      inputSensitivityAuto: true,
      inputSensitivity: -34,
      micLeveler: true,
    });
  });
  it('keeps a manual threshold within the sendable range and survives a restart', async () => {
    useRooms.getState().setPreference('inputSensitivity', -90);
    expect(useRooms.getState().preferences.inputSensitivity).toBe(-38);
    useRooms.getState().setPreference('inputSensitivityAuto', false);
    useRooms.getState().setPreference('inputSensitivity', -25.4);
    useRooms.getState().setPreference('micLeveler', false);
    const saved = localStorage.getItem('rooms-local-v1')!;
    useRooms.setState({ preferences: original });
    localStorage.setItem('rooms-local-v1', saved);
    await useRooms.persist.rehydrate();
    expect(useRooms.getState().preferences).toMatchObject({
      inputSensitivityAuto: false,
      inputSensitivity: -25,
      micLeveler: false,
    });
  });
  it('drops damaged stored values', async () => {
    localStorage.setItem(
      'rooms-local-v1',
      JSON.stringify({
        state: {
          preferences: { inputSensitivityAuto: 'no', inputSensitivity: 'loud', micLeveler: 1 },
        },
        version: 1,
      }),
    );
    await useRooms.persist.rehydrate();
    expect(useRooms.getState().preferences).toMatchObject({
      inputSensitivityAuto: true,
      inputSensitivity: -34,
      micLeveler: true,
    });
  });
});

function meterSource() {
  let emit: (report: MicGateReport) => void = () => {};
  const source: InputMeterSource = (listener) => {
    emit = listener;
    return () => {
      emit = () => {};
    };
  };
  return { source, send: (report: MicGateReport) => act(() => emit(report)) };
}

describe('input sensitivity control', () => {
  it('manual mode: slider, threshold line and whether the live level would be sent', () => {
    const onThreshold = vi.fn();
    const { source, send } = meterSource();
    render(
      <InputSensitivity
        auto={false}
        threshold={-30}
        onAuto={() => {}}
        onThreshold={onThreshold}
        source={source}
      />,
    );
    const slider = screen.getByRole('slider', { name: 'Giriş hassasiyeti eşiği' });
    expect(slider).toHaveProperty('min', '-38');
    expect(slider).toHaveProperty('max', '-10');
    fireEvent.change(slider, { target: { value: '-20' } });
    expect(onThreshold).toHaveBeenCalledWith(-20);
    expect(screen.getByTestId('input-sensitivity-threshold').style.left).toBe(
      `${meterPercent(-30)}%`,
    );
    const meter = screen.getByRole('meter');
    send({ open: false, level: -45, threshold: -30 });
    expect(meter.getAttribute('aria-valuetext')).toBe('-45 dB · gönderilmiyor');
    send({ open: true, level: -22, threshold: -30 });
    expect(meter.getAttribute('aria-valuetext')).toBe('-22 dB · gönderiliyor');
    expect(meter.className).toContain('sending');
  });
  it('automatic mode hides the slider and shows the threshold the gate found', () => {
    const onAuto = vi.fn();
    const { source, send } = meterSource();
    render(
      <InputSensitivity
        auto
        threshold={-30}
        onAuto={onAuto}
        onThreshold={() => {}}
        source={source}
      />,
    );
    expect(screen.queryByRole('slider')).toBeNull();
    send({ open: false, level: -50, threshold: -36 });
    expect(screen.getByText(/Otomatik eşik: -36 dB/)).toBeTruthy();
    expect(screen.getByTestId('input-sensitivity-threshold').style.left).toBe(
      `${meterPercent(-36)}%`,
    );
    fireEvent.click(screen.getByRole('switch', { name: 'Otomatik giriş hassasiyeti' }));
    expect(onAuto).toHaveBeenCalledWith(false);
  });
  it('says how to see a level when no microphone runs, and forgets a stopped source', () => {
    vi.useFakeTimers();
    const { source, send } = meterSource();
    const { rerender } = render(
      <InputSensitivity
        auto={false}
        threshold={-30}
        onAuto={() => {}}
        onThreshold={() => {}}
        source={null}
      />,
    );
    expect(screen.getByText(/mikrofonu dene ya da odada mikrofonunu aç/)).toBeTruthy();
    rerender(
      <InputSensitivity
        auto={false}
        threshold={-30}
        onAuto={() => {}}
        onThreshold={() => {}}
        source={source}
      />,
    );
    send({ open: true, level: -20, threshold: -30 });
    expect(screen.getByText('Bu seviye gönderilir.')).toBeTruthy();
    act(() => {
      vi.advanceTimersByTime(700);
    });
    expect(screen.getByRole('meter').getAttribute('aria-valuetext')).toBe('Ölçüm yok');
  });
});
