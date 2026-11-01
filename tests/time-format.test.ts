import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  changeTimeFormat,
  hourCycleFor,
  storedTimeFormat,
  withHourCycle,
} from '../apps/desktop/src/time-format';

const clock = (tag: string) =>
  new Date(Date.UTC(2026, 10, 1, 14, 30)).toLocaleTimeString(tag, {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
  });

describe('time format (H12)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('follows the region format, not the interface language, by default', () => {
    // English Windows with a Turkish region: 24-hour.
    expect(hourCycleFor('system', 'tr-TR', 'en-US')).toBe('h23');
    expect(hourCycleFor('system', 'en-US', 'tr-TR')).toBe('h12');
    // No region (browser build) or an odd tag: the interface language decides.
    expect(hourCycleFor('system', undefined, 'en-US')).toBe('h12');
    expect(hourCycleFor('system', '??', 'tr-TR')).toBe('h23');
  });

  it('lets the viewer pin either clock', () => {
    expect(hourCycleFor('24', 'en-US', 'en-US')).toBe('h23');
    expect(hourCycleFor('12', 'tr-TR', 'tr-TR')).toBe('h12');
  });

  it('formats English times with a 24-hour clock through the tag', () => {
    expect(clock(withHourCycle('en-US', 'h23'))).toBe('14:30');
    expect(clock(withHourCycle('en-US', 'h12'))).toMatch(/^02:30\sPM$/);
    expect(clock(withHourCycle('tr-TR', 'h23'))).toBe('14:30');
  });

  it('stores the choice and reloads; unknown stored values mean system', () => {
    const store = new Map<string, string>();
    const reload = vi.fn();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    });
    vi.stubGlobal('location', { reload });
    expect(storedTimeFormat()).toBe('system');
    changeTimeFormat('24');
    expect(storedTimeFormat()).toBe('24');
    expect(reload).toHaveBeenCalledTimes(1);
    store.set('rooms.timeFormat', 'nonsense');
    expect(storedTimeFormat()).toBe('system');
  });
});
