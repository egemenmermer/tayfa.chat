import { locale, t, uiError } from './i18n';

/** ⌘/Ctrl 1–5, in order. The help dialog lists the same table. */
export const shortcutRoutes: ReadonlyArray<{ path: string; label: string }> = [
  { path: '/home', label: t('Ana sayfa') },
  { path: '/messages', label: t('Mesajlar') },
  { path: '/chat', label: t('Sohbet') },
  { path: '/voice', label: t('Ses odası') },
  { path: '/cinema', label: t('Sinema') },
];

/** Case- and accent-insensitive search key; ı/İ match i/I in either interface language. */
export function foldSearch(value: string) {
  return value.toLocaleLowerCase(locale).normalize('NFD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');
}

/**
 * A mapped service error when there is one; otherwise a friendly line for the action, so raw
 * browser, media or IPC text never reaches a toast.
 */
export function friendlyActionError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const message = uiError(error);
  // uiError passes unknown text through and turns unknown codes into a generic line.
  const generic = [uiError(''), uiError('X')];
  return !raw || raw.includes(message) || generic.includes(message) ? fallback : message;
}

type ShortcutEvent = Pick<
  KeyboardEvent,
  'key' | 'code' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey' | 'repeat' | 'defaultPrevented'
>;

/**
 * The built-in room mute shortcut, ⌘/Ctrl Shift M. It also works while typing, as in Discord:
 * the combination means nothing to a text field, and text channels keep the composer focused.
 * Shortcut recorders swallow the event first, so recording a key never toggles the mic.
 */
export function isRoomMuteShortcut(event: ShortcutEvent) {
  if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return false;
  if (event.repeat || event.defaultPrevented) return false;
  return event.key.toLowerCase() === 'm' || event.code === 'KeyM';
}
