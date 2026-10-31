import type { DesktopBridge } from '@rooms/contracts';
export const notificationVariants = ['default', 'muted', 'system_permission'] as const;
export function createNotificationFixture(variant: string) {
  if (!import.meta.env.DEV) throw new Error('Notification fixtures are unavailable in production.');
  if (!notificationVariants.includes(variant as (typeof notificationVariants)[number]))
    throw new Error(`Unsupported S67 variant: ${variant}`);
  let state = {
    enabled: true,
    important: true,
    sound: true,
    pauseDuringVoice: true,
    supported: variant !== 'system_permission',
  };
  let desktop = { keepOpenOnClose: true, warnOnVoiceClose: true, trayAvailable: true };
  const channels = new Map<string, boolean>();
  const notifications: DesktopBridge['notifications'] = {
    status: async () => ({ ...state }),
    setOptIn: async (value) => ({ ...(state = { ...state, enabled: value }) }),
    setImportant: async (value) => ({ ...(state = { ...state, important: value }) }),
    setSound: async (value) => ({ ...(state = { ...state, sound: value }) }),
    setPauseDuringVoice: async (value) => ({ ...(state = { ...state, pauseDuringVoice: value }) }),
    setVoiceActive: async () => {},
    channelStatus: async (input) => ({
      muted: channels.get(input.channelId) ?? variant === 'muted',
    }),
    setChannelMuted: async (input) => {
      channels.set(input.channelId, input.muted);
      return { muted: input.muted };
    },
  };
  const desktopWindow: DesktopBridge['desktopWindow'] = {
    status: async () => ({ ...desktop }),
    setPreference: async (key, value) => ({ ...(desktop = { ...desktop, [key]: value }) }),
  };
  return { notifications, desktopWindow, variant };
}
