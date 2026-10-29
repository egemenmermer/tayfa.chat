// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import {
  PersonVolumeSlider,
  clampPersonVolume,
  PERSON_VOLUME_MAX,
} from '../apps/desktop/src/PersonVolumeSlider';
afterEach(cleanup);
it('spans 0 to 200% in 5% steps and reports the percentage', () => {
  const change = vi.fn();
  render(<PersonVolumeSlider label="Bob volume" value={1.5} onChange={change} />);
  const slider = screen.getByLabelText('Bob volume') as HTMLInputElement;
  expect(slider.min).toBe('0');
  expect(slider.max).toBe('2');
  expect(slider.step).toBe('0.05');
  expect(slider.value).toBe('1.5');
  expect(slider.getAttribute('aria-valuetext')).toBe('150%');
  fireEvent.change(slider, { target: { value: '2' } });
  expect(change).toHaveBeenLastCalledWith(2);
  fireEvent.change(slider, { target: { value: '0' } });
  expect(change).toHaveBeenLastCalledWith(0);
});
it('moves by 25% with PageUp and PageDown inside the 0-200% range', () => {
  const change = vi.fn();
  render(<PersonVolumeSlider label="v" value={1.9} onChange={change} />);
  const slider = screen.getByLabelText('v');
  fireEvent.keyDown(slider, { key: 'PageUp' });
  expect(change).toHaveBeenLastCalledWith(PERSON_VOLUME_MAX);
  fireEvent.keyDown(slider, { key: 'PageDown' });
  expect(change).toHaveBeenLastCalledWith(1.65);
  change.mockClear();
  fireEvent.keyDown(slider, { key: 'ArrowRight' });
  expect(change).not.toHaveBeenCalled();
});
it('resets to 100% by button or double click, and hides the button at 100%', () => {
  const change = vi.fn();
  const view = render(<PersonVolumeSlider label="v" value={0.3} onChange={change} />);
  fireEvent.click(screen.getByRole('button'));
  expect(change).toHaveBeenLastCalledWith(1);
  change.mockClear();
  fireEvent.doubleClick(screen.getByLabelText('v'));
  expect(change).toHaveBeenLastCalledWith(1);
  view.rerender(<PersonVolumeSlider label="v" value={1} onChange={change} />);
  expect(screen.queryByRole('button')).toBeNull();
});
it('clamps stray values', () => {
  expect(clampPersonVolume(3)).toBe(2);
  expect(clampPersonVolume(-1)).toBe(0);
  expect(clampPersonVolume(Number.NaN)).toBe(1);
  expect(clampPersonVolume(1.0500000000000003)).toBe(1.05);
});
