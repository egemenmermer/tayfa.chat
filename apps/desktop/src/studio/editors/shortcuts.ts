// Keyboard commands of the editors. Each editor root is focusable and handles keys only while it (or
// a child) has focus, so the shell's own shortcuts (Space, Cmd/Ctrl+Z) and typing elsewhere are
// never captured.

export type EditorCommand =
  | { kind: 'delete' }
  | { kind: 'nudge'; beats: -1 | 1; pitch: 0; coarse: boolean }
  | { kind: 'nudge'; beats: 0; pitch: -1 | 1; coarse: boolean }
  | { kind: 'duplicate' }
  | { kind: 'select-all' }
  | { kind: 'copy' }
  | { kind: 'paste' }
  | { kind: 'clear-selection' };

export interface KeyLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  isComposing?: boolean;
  target: EventTarget | null;
}

const TEXT_ROLES = new Set(['textbox', 'combobox', 'searchbox', 'spinbutton']);

/** True when the key belongs to a text field, select or editable element. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== 'function') return false;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  const tag = element.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  const role = element.getAttribute('role');
  return role !== null && TEXT_ROLES.has(role);
}

/** Maps a key event to an editor command, or null when the editor should not handle it. */
export function editorCommand(event: KeyLike, isMac: boolean): EditorCommand | null {
  if (event.isComposing || isTypingTarget(event.target)) return null;
  const mod = isMac ? event.metaKey : event.ctrlKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (mod && !event.altKey) {
    if (key === 'd' && !event.shiftKey) return { kind: 'duplicate' };
    if (key === 'a' && !event.shiftKey) return { kind: 'select-all' };
    if (key === 'c' && !event.shiftKey) return { kind: 'copy' };
    if (key === 'v' && !event.shiftKey) return { kind: 'paste' };
    return null;
  }
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  switch (key) {
    case 'Delete':
    case 'Backspace':
      return { kind: 'delete' };
    case 'Escape':
      return { kind: 'clear-selection' };
    case 'ArrowLeft':
      return { kind: 'nudge', beats: -1, pitch: 0, coarse: event.shiftKey };
    case 'ArrowRight':
      return { kind: 'nudge', beats: 1, pitch: 0, coarse: event.shiftKey };
    case 'ArrowUp':
      return { kind: 'nudge', beats: 0, pitch: 1, coarse: event.shiftKey };
    case 'ArrowDown':
      return { kind: 'nudge', beats: 0, pitch: -1, coarse: event.shiftKey };
    default:
      return null;
  }
}

export function isMacPlatform(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
}
