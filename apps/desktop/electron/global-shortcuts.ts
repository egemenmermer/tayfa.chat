import type { BrowserWindow, GlobalShortcut, IpcMain, IpcMainInvokeEvent } from 'electron';
import {
  GLOBAL_SHORTCUT_ACTIONS,
  checkShortcutRequest,
  shortcutProblem,
  toAccelerator,
  type GlobalShortcutAction,
  type GlobalShortcutResult,
  type ShortcutStatus,
} from '../src/global-shortcut';

export interface GlobalShortcutDeps {
  ipc: Pick<IpcMain, 'handle'>;
  shortcuts: Pick<GlobalShortcut, 'register' | 'unregister'>;
  /** Throws for any sender that is not the trusted main window frame. */
  assertSender(event: IpcMainInvokeEvent): void;
  window(): Pick<BrowserWindow, 'isDestroyed' | 'webContents'> | null;
}

/**
 * Registers the user's system-wide mute and deafen shortcuts. The renderer sends the preference;
 * this process validates it again, owns the OS registration, and tells the renderer which action
 * fired. Only accelerators registered here are ever unregistered.
 */
export function setupGlobalShortcuts(deps: GlobalShortcutDeps) {
  let owned: string[] = [];
  const release = () => {
    for (const accelerator of owned) deps.shortcuts.unregister(accelerator);
    owned = [];
  };
  const fire = (action: GlobalShortcutAction) => {
    const win = deps.window();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('rooms:global-shortcut', action);
  };
  const apply = (value: unknown): GlobalShortcutResult => {
    const request = checkShortcutRequest(value);
    if (!request) throw new Error('Invalid shortcut request');
    release();
    const result = {} as GlobalShortcutResult;
    const accepted: string[] = [];
    for (const action of GLOBAL_SHORTCUT_ACTIONS) {
      const shortcut = request[action];
      let status: ShortcutStatus = { state: 'none' };
      if (shortcut) {
        const problem = shortcutProblem(shortcut, accepted);
        const accelerator = problem ? null : toAccelerator(shortcut);
        if (problem || !accelerator) status = { state: 'failed', problem: problem ?? 'invalid' };
        else {
          let registered = false;
          try {
            registered = deps.shortcuts.register(accelerator, () => fire(action));
          } catch {
            registered = false;
          }
          if (registered) {
            owned.push(accelerator);
            accepted.push(shortcut);
            status = { state: 'active' };
          } else status = { state: 'failed', problem: 'taken' };
        }
      }
      result[action] = status;
    }
    return result;
  };
  deps.ipc.handle('rooms:global-shortcuts-set', (event, value: unknown) => {
    deps.assertSender(event);
    return apply(value);
  });
  return { dispose: release };
}
