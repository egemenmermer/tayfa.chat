import { expect, it, vi } from 'vitest';
import {
  checkShortcutRequest,
  normalizeGlobalShortcut,
  shortcutProblem,
  toAccelerator,
} from '../apps/desktop/src/global-shortcut';
import { setupGlobalShortcuts } from '../apps/desktop/electron/global-shortcuts';

it('maps recorded keys to Electron accelerators', () => {
  expect(toAccelerator('Ctrl+Alt+KeyM')).toBe('Control+Alt+M');
  expect(toAccelerator('Ctrl+Shift+Digit7')).toBe('Control+Shift+7');
  expect(toAccelerator('Meta+Shift+ArrowUp')).toBe('Shift+Super+Up');
  expect(toAccelerator('F9')).toBe('F9');
  expect(toAccelerator('Alt+Numpad3')).toBe('Alt+num3');
  expect(toAccelerator('Ctrl+Backquote')).toBe('Control+`');
});

it('rejects combinations that cannot or must not be registered', () => {
  expect(shortcutProblem('')).toBe('invalid');
  expect(shortcutProblem('Ctrl+ShiftLeft')).toBe('invalid');
  expect(shortcutProblem('Ctrl+Alt+Foo')).toBe('unsupported');
  expect(shortcutProblem('F25')).toBe('unsupported');
  expect(shortcutProblem('KeyM')).toBe('needs-modifier');
  expect(shortcutProblem('Shift+KeyM')).toBe('needs-modifier');
  expect(shortcutProblem('Ctrl+Shift+KeyM')).toBe('reserved');
  expect(shortcutProblem('Meta+Shift+KeyM')).toBe('reserved');
  expect(shortcutProblem('Ctrl+KeyK')).toBe('reserved');
  expect(shortcutProblem('Ctrl+Alt+Shift+KeyK')).toBe('reserved');
  expect(shortcutProblem('Alt+F4')).toBe('reserved');
  expect(shortcutProblem('Ctrl+Alt+KeyM', ['Ctrl+Alt+KeyM'])).toBe('duplicate');
  expect(shortcutProblem('Ctrl+Alt+KeyM', ['', 'Alt+Ctrl+KeyM'])).toBeNull();
  expect(shortcutProblem('Ctrl+Alt+KeyM')).toBeNull();
  expect(shortcutProblem('F9')).toBeNull();
  expect(toAccelerator('KeyM')).toBeNull();
});

it('normalizes stored values and screens IPC payloads', () => {
  expect(normalizeGlobalShortcut('Ctrl+Alt+KeyM')).toBe('Ctrl+Alt+KeyM');
  expect(normalizeGlobalShortcut('garbage+')).toBe('');
  expect(normalizeGlobalShortcut(42)).toBe('');
  expect(checkShortcutRequest({ mute: 'F9', deafen: '' })).toEqual({ mute: 'F9', deafen: '' });
  expect(checkShortcutRequest({ mute: 'F9' })).toBeNull();
  expect(checkShortcutRequest({ mute: 'F9', deafen: 3 })).toBeNull();
  expect(checkShortcutRequest({ mute: 'x'.repeat(65), deafen: '' })).toBeNull();
  expect(checkShortcutRequest(null)).toBeNull();
});

function harness(accepts: (accelerator: string) => boolean = () => true) {
  const handlers = new Map<string, (event: unknown, value?: unknown) => unknown>();
  const registered = new Map<string, () => void>();
  const send = vi.fn();
  const window = { isDestroyed: () => false, webContents: { isDestroyed: () => false, send } };
  const shortcuts = {
    register: vi.fn((accelerator: string, callback: () => void) => {
      if (!accepts(accelerator)) return false;
      registered.set(accelerator, callback);
      return true;
    }),
    unregister: vi.fn((accelerator: string) => void registered.delete(accelerator)),
  };
  const assertSender = vi.fn((event: { trusted?: boolean }) => {
    if (!event.trusted) throw new Error('Untrusted IPC sender');
  });
  const api = setupGlobalShortcuts({
    ipc: { handle: (channel: string, fn: never) => void handlers.set(channel, fn) },
    shortcuts,
    assertSender: assertSender as never,
    window: () => window,
  });
  const set = (value: unknown, trusted = true) =>
    handlers.get('rooms:global-shortcuts-set')!({ trusted }, value);
  return { api, set, registered, shortcuts, send, assertSender, window };
}

it('refuses an untrusted sender before touching the OS', () => {
  const h = harness();
  expect(() => h.set({ mute: 'Ctrl+Alt+KeyM', deafen: '' }, false)).toThrow('Untrusted IPC sender');
  expect(h.shortcuts.register).not.toHaveBeenCalled();
});

it('rejects a malformed request without changing existing registrations', () => {
  const h = harness();
  h.set({ mute: 'Ctrl+Alt+KeyM', deafen: '' });
  expect(() => h.set({ mute: 5 })).toThrow('Invalid shortcut request');
  expect([...h.registered.keys()]).toEqual(['Control+Alt+M']);
});

it('registers, re-registers on change, and reports each outcome', () => {
  const h = harness((accelerator) => accelerator !== 'Control+Alt+D');
  expect(h.set({ mute: 'Ctrl+Alt+KeyM', deafen: 'Ctrl+Alt+KeyD' })).toEqual({
    mute: { state: 'active' },
    deafen: { state: 'failed', problem: 'taken' },
  });
  expect([...h.registered.keys()]).toEqual(['Control+Alt+M']);
  expect(h.set({ mute: 'F9', deafen: '' })).toEqual({
    mute: { state: 'active' },
    deafen: { state: 'none' },
  });
  expect([...h.registered.keys()]).toEqual(['F9']);
  expect(h.shortcuts.unregister).toHaveBeenCalledWith('Control+Alt+M');
});

it('validates again in the main process and flags a duplicate pair', () => {
  const h = harness();
  expect(h.set({ mute: 'Ctrl+Shift+KeyM', deafen: 'KeyD' })).toEqual({
    mute: { state: 'failed', problem: 'reserved' },
    deafen: { state: 'failed', problem: 'needs-modifier' },
  });
  expect(h.set({ mute: 'Ctrl+Alt+KeyM', deafen: 'Ctrl+Alt+KeyM' })).toEqual({
    mute: { state: 'active' },
    deafen: { state: 'failed', problem: 'duplicate' },
  });
  expect(h.shortcuts.register).toHaveBeenCalledTimes(1);
});

it('tells the window which action fired and unregisters on dispose', () => {
  const h = harness();
  h.set({ mute: 'Ctrl+Alt+KeyM', deafen: 'Ctrl+Alt+KeyD' });
  h.registered.get('Control+Alt+D')!();
  h.registered.get('Control+Alt+M')!();
  expect(h.send.mock.calls).toEqual([
    ['rooms:global-shortcut', 'deafen'],
    ['rooms:global-shortcut', 'mute'],
  ]);
  const press = h.registered.get('Control+Alt+M')!;
  h.api.dispose();
  expect(h.registered.size).toBe(0);
  h.window.isDestroyed = () => true;
  press();
  expect(h.send).toHaveBeenCalledTimes(2);
});

it('treats a register() exception as an invalid accelerator', () => {
  const h = harness();
  h.shortcuts.register.mockImplementationOnce(() => {
    throw new Error('bad accelerator');
  });
  expect(h.set({ mute: 'Ctrl+Alt+KeyM', deafen: '' }).mute).toEqual({
    state: 'failed',
    problem: 'taken',
  });
});
