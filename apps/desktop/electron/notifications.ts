import { app, ipcMain, Notification, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { readFileSync, writeFileSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SOCIAL_ID_PATTERN } from '@rooms/social';
import type { ChannelNotificationScope, ChannelNotificationInput } from '@rooms/contracts';
import { showWindow } from './window-state';
import { t } from '@rooms/i18n';
/** Opt-in, content-free notifications; never disclose messages or account/provider details. */
/**
 * Whether an incoming message notifies, and as what. Direct messages and mentions are
 * "important": they notify by default (rc.36) even with every-message notifications off.
 * Nothing shows while Tayfa is focused, for a muted channel, or right after another one.
 */
export function notifyKind(input: {
  enabled: boolean;
  important: boolean;
  mentioned: boolean;
  direct: boolean;
  muted: boolean;
  focused: boolean;
  supported: boolean;
  paused: boolean;
  now: number;
  lastMessage: number;
  lastImportant: number;
}): 'important' | 'message' | null {
  const important = input.mentioned || input.direct;
  if (input.muted || input.focused || !input.supported || input.paused) return null;
  if (!input.enabled && !(important && input.important)) return null;
  if (important) return input.now - input.lastImportant < 1500 ? null : 'important';
  return input.now - input.lastMessage < 5000 ? null : 'message';
}

export function setupNotifications(
  getWindow: () => BrowserWindow | null,
  assertSender: (event: IpcMainInvokeEvent) => void,
  getScope: () => ChannelNotificationScope | null = () => null,
) {
  const file = join(app.getPath('userData'), 'notifications.json');
  let enabled = false;
  // Direct messages and mentions notify unless the member turned them off.
  let important = true;
  let sound = false;
  let pauseDuringVoice = false;
  let voiceActiveUntil = 0;
  let lastShown = 0,
    lastMention = 0;
  let mutedKeys = new Set<string>();
  const channelKey = (scope: ChannelNotificationScope, channelId: string) =>
    createHash('sha256')
      .update(JSON.stringify([scope.serverUrl, scope.userId, channelId]))
      .digest('hex');
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    enabled = saved.enabled === true;
    important = saved.important !== false;
    sound = saved.sound === true;
    pauseDuringVoice = saved.pauseDuringVoice === true;
    if (Array.isArray(saved.mutedChannels))
      mutedKeys = new Set(
        saved.mutedChannels
          .filter((key: unknown) => typeof key === 'string' && /^[a-f0-9]{64}$/.test(key))
          .slice(0, 5000),
      );
  } catch {
    /* New profiles start opt-out. */
  }
  const status = () => ({
    enabled,
    important,
    sound,
    pauseDuringVoice,
    supported: Notification.isSupported(),
  });
  ipcMain.handle('rooms:notification-status', (event) => {
    assertSender(event);
    return status();
  });
  const save = (next: {
    enabled: boolean;
    important: boolean;
    sound: boolean;
    pauseDuringVoice: boolean;
  }) => {
    const temporary = file + '.tmp';
    try {
      writeFileSync(temporary, JSON.stringify({ ...next, mutedChannels: [...mutedKeys] }), {
        mode: 0o600,
      });
      renameSync(temporary, file);
    } finally {
      rmSync(temporary, { force: true });
    }
    enabled = next.enabled;
    important = next.important;
    sound = next.sound;
    pauseDuringVoice = next.pauseDuringVoice;
    return status();
  };
  ipcMain.handle('rooms:notification-opt-in', (event, value) => {
    assertSender(event);
    if (typeof value !== 'boolean') throw new Error('Invalid notification preference.');
    return save({ enabled: value, important, sound, pauseDuringVoice });
  });
  ipcMain.handle('rooms:notification-important', (event, value) => {
    assertSender(event);
    if (typeof value !== 'boolean') throw new Error('Invalid notification preference.');
    return save({ enabled, important: value, sound, pauseDuringVoice });
  });
  ipcMain.handle('rooms:notification-sound', (event, value) => {
    assertSender(event);
    if (typeof value !== 'boolean') throw new Error('Invalid notification preference.');
    return save({ enabled, important, sound: value, pauseDuringVoice });
  });
  ipcMain.handle('rooms:notification-pause-voice', (event, value) => {
    assertSender(event);
    if (typeof value !== 'boolean') throw new Error('Invalid notification preference.');
    return save({ enabled, important, sound, pauseDuringVoice: value });
  });
  const checkedChannel = (event: IpcMainInvokeEvent, input: unknown): ChannelNotificationInput => {
    assertSender(event);
    const window = getWindow();
    if (
      !app.isPackaged &&
      window &&
      new URL(window.webContents.getURL() || 'about:blank').searchParams.has('fixture')
    )
      throw new Error('Native channel preferences are disabled in development fixtures.');
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Invalid channel notification preference.');
    const value = input as ChannelNotificationInput,
      scope = getScope();
    if (
      Object.keys(value).some(
        (key) => !['serverUrl', 'userId', 'channelId', 'muted'].includes(key),
      ) ||
      typeof value.channelId !== 'string' ||
      !SOCIAL_ID_PATTERN.test(value.channelId) ||
      !scope ||
      value.serverUrl !== scope.serverUrl ||
      value.userId !== scope.userId
    )
      throw new Error('The account changed. Reopen channel notifications.');
    return value;
  };
  ipcMain.handle('rooms:notification-channel-status', (event, input) => {
    const value = checkedChannel(event, input);
    return { muted: mutedKeys.has(channelKey(value, value.channelId)) };
  });
  ipcMain.handle('rooms:notification-channel-mute', (event, input) => {
    const value = checkedChannel(event, input);
    if (typeof value.muted !== 'boolean')
      throw new Error('Invalid channel notification preference.');
    const key = channelKey(value, value.channelId),
      previous = mutedKeys,
      candidate = new Set(previous);
    if (value.muted) {
      if (!candidate.has(key) && candidate.size >= 5000)
        throw new Error('The channel preference limit has been reached.');
      candidate.add(key);
    } else candidate.delete(key);
    mutedKeys = candidate;
    try {
      save({ enabled, important, sound, pauseDuringVoice });
    } catch (error) {
      mutedKeys = previous;
      throw error;
    }
    return { muted: value.muted };
  });
  // A ringing private call shows even during voice (it is the point of being reachable) and
  // even with chat notifications off, like a reminder: a call nobody hears is a missed call.
  // It never shows while the window is focused, where the call card already rings.
  ipcMain.handle('rooms:notification-incoming-call', (event) => {
    assertSender(event);
    const window = getWindow();
    if (!Notification.isSupported() || window?.isFocused()) return;
    const notification = new Notification({
      title: 'Tayfa',
      body: t('Özel bir arama geliyor.'),
      silent: !sound,
    });
    notification.on('click', () => {
      const current = getWindow();
      if (!current) return;
      showWindow(current);
      current.focus();
    });
    notification.show();
  });
  // A programme reminder is something the member asked for: it shows even when chat
  // notifications are off, but not while the window is in front (the card is there).
  ipcMain.handle('rooms:notification-reminder', (event, input) => {
    assertSender(event);
    const value = input as { title?: unknown; detail?: unknown } | null;
    if (
      typeof value?.title !== 'string' ||
      typeof value.detail !== 'string' ||
      !value.title.trim() ||
      value.title.length > 200 ||
      value.detail.length > 200
    )
      throw new Error('Invalid reminder.');
    const window = getWindow();
    if (!Notification.isSupported() || window?.isFocused()) return;
    const notification = new Notification({
      title: value.title,
      body: value.detail,
      silent: !sound,
    });
    notification.on('click', () => {
      const current = getWindow();
      if (!current) return;
      showWindow(current);
      current.focus();
    });
    notification.show();
  });
  // A short renderer lease expires after crash/suspension and is never persisted.
  ipcMain.handle('rooms:notification-voice-active', (event, value) => {
    assertSender(event);
    if (typeof value !== 'boolean') throw new Error('Invalid voice notification state.');
    voiceActiveUntil = value ? Date.now() + 30000 : 0;
  });
  return {
    /**
     * A server alert for an owner or developer-role admin. It shows even with chat notifications
     * off: it is about the machine everyone uses, and only admins get it.
     */
    serverAlert: (text: string, open?: () => void) => {
      if (!Notification.isSupported()) return;
      const notification = new Notification({
        title: t('Tayfa · Sunucu uyarısı'),
        body: text.slice(0, 200),
        silent: !sound,
      });
      notification.on('click', () => {
        const current = getWindow();
        if (!current) return;
        showWindow(current);
        current.focus();
        open?.();
      });
      notification.show();
    },
    voiceActive: () => voiceActiveUntil > Date.now(),
    message: (
      scope?: ChannelNotificationScope,
      channelId?: string,
      mentioned = false,
      /** Opens the message's channel when the notification is clicked. */
      open?: () => void,
      /** A direct message or group conversation. */
      direct = false,
    ) => {
      const now = Date.now();
      // Mentions and DMs have their own, shorter throttle: a message just before must not
      // swallow them.
      const kind = notifyKind({
        enabled,
        important,
        mentioned,
        direct,
        muted: !!scope && !!channelId && mutedKeys.has(channelKey(scope, channelId)),
        focused: !!getWindow()?.isFocused(),
        supported: Notification.isSupported(),
        paused: pauseDuringVoice && voiceActiveUntil > now,
        now,
        lastMessage: lastShown,
        lastImportant: lastMention,
      });
      if (!kind) return;
      if (kind === 'important') lastMention = now;
      else lastShown = now;
      const notification = new Notification({
        title: 'Tayfa',
        body: direct
          ? t('Yeni bir özel mesajın var.')
          : mentioned
            ? t('Topluluğunda biri seni etiketledi.')
            : t('Topluluğunda yeni bir mesaj var.'),
        silent: !sound,
      });
      notification.on('click', () => {
        const current = getWindow();
        if (!current) return;
        showWindow(current);
        current.focus();
        open?.();
      });
      notification.show();
    },
  };
}
