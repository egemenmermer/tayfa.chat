import type {
  GlobalShortcutAction,
  GlobalShortcutProblem as ShortcutProblem,
  GlobalShortcutStatus as ShortcutStatus,
} from '../../../packages/shared-contracts/src/global-shortcuts';
import { parsePushToTalkKey, serializePushToTalkKey, type PushToTalkKey } from './push-to-talk-key';

/**
 * System-wide shortcuts (mute and deafen toggles). They reuse the push-to-talk key format: one
 * main key by physical code plus exact modifiers, stored as `Ctrl+Shift+KeyM`. An empty string
 * means "no shortcut". The renderer validates while recording; the main process validates again
 * before it registers anything with the OS.
 */
export type {
  GlobalShortcutAction,
  GlobalShortcutProblem as ShortcutProblem,
  GlobalShortcutStatus as ShortcutStatus,
} from '../../../packages/shared-contracts/src/global-shortcuts';
export const GLOBAL_SHORTCUT_ACTIONS: readonly GlobalShortcutAction[] = ['mute', 'deafen'];

export interface GlobalShortcutRequest {
  mute: string;
  deafen: string;
}
export type GlobalShortcutResult = Record<GlobalShortcutAction, ShortcutStatus>;

const punctuation: Record<string, string> = {
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Backquote: '`',
};
const named: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Enter: 'Return',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  NumpadAdd: 'numadd',
  NumpadSubtract: 'numsub',
  NumpadMultiply: 'nummult',
  NumpadDivide: 'numdiv',
  NumpadDecimal: 'numdec',
};

/** Electron accelerator key for a physical key code, or null when Electron has no name for it. */
function acceleratorKey(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;
  const digit = /^Digit(\d)$/.exec(code);
  if (digit) return digit[1]!;
  const numpad = /^Numpad(\d)$/.exec(code);
  if (numpad) return `num${numpad[1]}`;
  const fn = /^F(\d{1,2})$/.exec(code);
  if (fn) return Number(fn[1]) >= 1 && Number(fn[1]) <= 24 ? code : null;
  return punctuation[code] ?? named[code] ?? null;
}

const isFunctionKey = (code: string) => /^F\d{1,2}$/.test(code);

/** Combinations Tayfa itself or the OS already uses; registering them would break something. */
function reserved(key: PushToTalkKey): boolean {
  const { code, ctrl, shift, alt, meta } = key;
  const command = ctrl || meta;
  if (command && shift && code === 'KeyM') return true; // built-in in-app mute shortcut
  if (command && !shift && !alt) {
    if (code === 'KeyK' || code === 'Comma' || /^Digit[1-5]$/.test(code)) return true;
  }
  if (ctrl && alt && shift && code === 'KeyK') return true; // remote-control emergency release
  if (alt && code === 'F4') return true;
  if (alt && code === 'Tab') return true;
  if (ctrl && alt && code === 'Delete') return true;
  if (meta && !ctrl && !alt && !shift && ['KeyL', 'KeyQ', 'Tab', 'Space', 'KeyD'].includes(code))
    return true;
  return false;
}

/**
 * Checks a stored shortcut. `others` are the other shortcuts Tayfa owns (the other toggle and
 * push-to-talk); an equal combination is a conflict. Returns null when the shortcut is usable.
 */
export function shortcutProblem(
  value: string,
  others: readonly string[] = [],
): ShortcutProblem | null {
  const key = parsePushToTalkKey(value);
  if (!key) return 'invalid';
  if (!acceleratorKey(key.code)) return 'unsupported';
  if (!key.ctrl && !key.alt && !key.meta && !isFunctionKey(key.code)) return 'needs-modifier';
  if (reserved(key)) return 'reserved';
  if (others.some((other) => other && sameShortcut(other, value))) return 'duplicate';
  return null;
}

function sameShortcut(a: string, b: string) {
  const left = parsePushToTalkKey(a);
  const right = parsePushToTalkKey(b);
  return !!left && !!right && serializePushToTalkKey(left) === serializePushToTalkKey(right);
}

/** Electron accelerator for a usable shortcut, or null. */
export function toAccelerator(value: string): string | null {
  if (shortcutProblem(value) !== null) return null;
  const key = parsePushToTalkKey(value)!;
  return [
    key.ctrl && 'Control',
    key.alt && 'Alt',
    key.shift && 'Shift',
    key.meta && 'Super',
    acceleratorKey(key.code),
  ]
    .filter(Boolean)
    .join('+');
}

/** Normalizes a persisted or received value: a valid shortcut as stored, anything else as ''. */
export function normalizeGlobalShortcut(value: unknown): string {
  const key = parsePushToTalkKey(value);
  return key ? serializePushToTalkKey(key) : '';
}

/** Validates the pair the renderer sends; each side is checked against the other. */
export function checkShortcutRequest(value: unknown): GlobalShortcutRequest | null {
  if (!value || typeof value !== 'object') return null;
  const { mute, deafen } = value as Record<string, unknown>;
  if (typeof mute !== 'string' || typeof deafen !== 'string') return null;
  if (mute.length > 64 || deafen.length > 64) return null;
  return { mute, deafen };
}
