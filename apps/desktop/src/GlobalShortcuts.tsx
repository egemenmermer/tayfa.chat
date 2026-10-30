import { useEffect, useRef } from 'react';
import { create } from 'zustand';
import { t } from './i18n';
import { friendlyActionError } from './shell-commands';
import { useRooms } from './store';
import { toggleDeafen, toggleMic, useRealtime } from './realtime';
import type { GlobalShortcutAction, GlobalShortcutResult } from './global-shortcut';

/** What the system said about the last registration; null until the main process answered. */
export const useShortcutStatus = create<{ status: GlobalShortcutResult | null }>(() => ({
  status: null,
}));
/** A key repeat or a double delivery must not toggle twice. */
const REPEAT_WINDOW_MS = 250;

/**
 * Keeps the system-wide mute and deafen shortcuts registered and applies them like the on-screen
 * buttons. Renders nothing; mounted once next to push-to-talk.
 */
export function GlobalShortcuts({ notify }: { notify(message: string): void }) {
  const muteKey = useRooms((s) => s.preferences.muteKey);
  const deafenKey = useRooms((s) => s.preferences.deafenKey);
  const { status } = useRealtime();
  const connected = status === 'connected';
  const live = useRef({ connected, notify });
  live.current = { connected, notify };
  const last = useRef(0);

  useEffect(() => {
    const bridge = window.rooms?.globalShortcuts;
    if (!bridge) return;
    let current = true;
    bridge
      .set({ mute: muteKey, deafen: deafenKey })
      .then((result) => {
        if (current) useShortcutStatus.setState({ status: result });
      })
      .catch(() => {
        if (!current) return;
        useShortcutStatus.setState({ status: null });
        live.current.notify(t('Kısayollar kaydedilemedi. Ayarlardan yeniden dene.'));
      });
    return () => {
      current = false;
    };
  }, [muteKey, deafenKey]);

  useEffect(
    () =>
      window.rooms?.globalShortcuts?.onTrigger((action: GlobalShortcutAction) => {
        const now = Date.now();
        if (now - last.current < REPEAT_WINDOW_MS) return;
        last.current = now;
        if (!live.current.connected) return;
        const run = action === 'mute' ? toggleMic : toggleDeafen;
        void run().catch((error) =>
          live.current.notify(
            friendlyActionError(
              error,
              action === 'mute'
                ? t('Mikrofon değiştirilemedi. Ses ayarlarını kontrol edip yeniden dene.')
                : t('Ses değiştirilemedi. Ses ayarlarını kontrol edip yeniden dene.'),
            ),
          ),
        );
      }),
    [],
  );
  return null;
}
