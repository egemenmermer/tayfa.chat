/**
 * System-wide shortcuts for the voice toggles. The renderer owns the preference and asks the main
 * process (which owns the OS registration) to apply it; the main process reports what happened.
 * Keys use the push-to-talk format (`Ctrl+Shift+KeyM`); an empty string means no shortcut.
 */
export type GlobalShortcutAction = 'mute' | 'deafen';
export type GlobalShortcutProblem =
  'invalid' | 'unsupported' | 'needs-modifier' | 'reserved' | 'duplicate' | 'taken';
export type GlobalShortcutStatus =
  { state: 'none' } | { state: 'active' } | { state: 'failed'; problem: GlobalShortcutProblem };

export interface GlobalShortcutsBridge {
  /** Replaces the registered shortcuts and returns the outcome of each. */
  set(shortcuts: {
    mute: string;
    deafen: string;
  }): Promise<Record<GlobalShortcutAction, GlobalShortcutStatus>>;
  /** Fires when a registered shortcut is pressed, whichever app has focus. */
  onTrigger(listener: (action: GlobalShortcutAction) => void): () => void;
}
