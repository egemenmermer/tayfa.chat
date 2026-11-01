import { app, ipcMain } from 'electron';
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  configureI18n,
  isLocalePreference,
  parseLocale,
  resolveLocale,
  type Locale,
  type LocalePreference,
} from '@rooms/i18n';
import { en } from '../src/locales/en';

export interface LocaleState {
  preference: LocalePreference;
  resolved: Locale;
}

function localeFile() {
  return join(app.getPath('userData'), 'locale.json');
}

export function readLocalePreference(file: string): LocalePreference {
  try {
    const value = (JSON.parse(readFileSync(file, 'utf8')) as { preference?: unknown }).preference;
    return isLocalePreference(value) ? value : 'system';
  } catch {
    return 'system';
  }
}

/** ROOMS_LOCALE pins the language for test runs whose machines are set up in English. */
export function currentLocale(
  preference: LocalePreference,
  systemLanguages: readonly string[],
  pinned = process.env.ROOMS_LOCALE,
): LocaleState {
  return {
    preference,
    resolved: parseLocale(pinned) ?? resolveLocale(preference, systemLanguages),
  };
}

/** The region format (Windows "Regional format", macOS Region), which decides the clock. */
function systemRegion(): string | undefined {
  try {
    return app.getSystemLocale() || undefined;
  } catch {
    return undefined;
  }
}

function systemLanguages(): string[] {
  const preferred = app.getPreferredSystemLanguages();
  return preferred.length ? preferred : [app.getLocale()];
}

/**
 * Applies the saved language to the main process and serves it to the window. Call after `ready`.
 * `changed` rebuilds native menus; the window reloads itself after a change.
 */
export function setupLocale(
  assertSender: (event: Electron.IpcMainInvokeEvent) => void,
  changed: () => void,
): void {
  let state = currentLocale(readLocalePreference(localeFile()), systemLanguages());
  configureI18n({ locale: state.resolved, catalog: en });
  // Read synchronously by the preload so the first render is already in the right language.
  ipcMain.on('rooms:locale', (event) => {
    event.returnValue = { ...state, region: systemRegion() };
  });
  ipcMain.handle('rooms:set-locale', (event, preference: unknown) => {
    assertSender(event);
    if (!isLocalePreference(preference)) throw new Error('Invalid language');
    const file = localeFile();
    writeFileSync(`${file}.tmp`, JSON.stringify({ preference }), { mode: 0o600 });
    renameSync(`${file}.tmp`, file);
    state = currentLocale(preference, systemLanguages());
    configureI18n({ locale: state.resolved, catalog: en });
    changed();
  });
}
