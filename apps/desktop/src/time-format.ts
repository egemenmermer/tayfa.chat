/**
 * The 12- or 24-hour clock. 'system' follows the computer's region format rather than the
 * interface language, so English Windows with a Turkish region shows 14:30, not 2:30 PM (H12).
 * The choice is fixed for the life of the page, like the language.
 */
export type TimeFormat = 'system' | '24' | '12';
export type HourCycle = 'h23' | 'h12';

const TIME_FORMAT_KEY = 'rooms.timeFormat';

export const isTimeFormat = (value: unknown): value is TimeFormat =>
  value === 'system' || value === '24' || value === '12';

export function storedTimeFormat(): TimeFormat {
  try {
    const value = globalThis.localStorage?.getItem(TIME_FORMAT_KEY);
    return isTimeFormat(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** The clock a locale uses by default, or null when the tag is unusable. */
function regionCycle(tag: string | undefined): HourCycle | null {
  if (!tag) return null;
  try {
    const cycle = new Intl.DateTimeFormat(tag, { hour: 'numeric' }).resolvedOptions().hourCycle;
    if (cycle === 'h23' || cycle === 'h24') return 'h23';
    if (cycle === 'h11' || cycle === 'h12') return 'h12';
  } catch {
    /* An odd tag from the system falls back to the interface language. */
  }
  return null;
}

/**
 * The clock to use. `region` is the system's region format (Electron's `getSystemLocale`), which
 * the browser build does not have; then the interface language decides.
 */
export function hourCycleFor(
  format: TimeFormat,
  region: string | undefined,
  ui: string,
): HourCycle {
  if (format === '24') return 'h23';
  if (format === '12') return 'h12';
  return regionCycle(region) ?? regionCycle(ui) ?? 'h23';
}

/** An Intl tag that formats times with the given clock: `en-US` + h23 → `en-US-u-hc-h23`. */
export const withHourCycle = (tag: string, cycle: HourCycle) => `${tag}-u-hc-${cycle}`;

/** Saves the choice and reloads so every clock on every surface uses it; throws if it cannot save. */
export function changeTimeFormat(format: TimeFormat) {
  globalThis.localStorage.setItem(TIME_FORMAT_KEY, format);
  globalThis.location?.reload();
}
