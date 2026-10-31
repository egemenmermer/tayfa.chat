import { describe, expect, it } from 'vitest';
import {
  createNotificationFixture,
  notificationVariants,
} from '../apps/desktop/src/dev/notification-fixture';
const channel = {
  serverUrl: 'https://demo.example.test',
  userId: 'demo',
  channelId: 'demo-channel',
};
describe('isolated S67 development fixtures', () => {
  it('supports exactly the inventoried states and rejects other captures', () => {
    expect(notificationVariants).toEqual(['default', 'muted', 'system_permission']);
    expect(() => createNotificationFixture('tray')).toThrow('Unsupported S67');
    expect(() => createNotificationFixture('unknown')).toThrow('Unsupported S67');
  });
  it('shows unavailable platform capability without claiming OS permission was observed', async () => {
    const fixture = createNotificationFixture('system_permission');
    expect((await fixture.notifications.status()).supported).toBe(false);
  });
  it('isolates mute state and permits actual controls to change only local fixture values', async () => {
    const first = createNotificationFixture('muted'),
      second = createNotificationFixture('default');
    expect(await first.notifications.channelStatus(channel)).toEqual({ muted: true });
    await first.notifications.setChannelMuted({ ...channel, muted: false });
    expect(await first.notifications.channelStatus(channel)).toEqual({ muted: false });
    expect(await second.notifications.channelStatus(channel)).toEqual({ muted: false });
  });
  it('updates independent notification and desktop preferences without any native bridge', async () => {
    const fixture = createNotificationFixture('default');
    await fixture.notifications.setSound(false);
    expect(await fixture.notifications.status()).toEqual({
      enabled: true,
      important: true,
      sound: false,
      pauseDuringVoice: true,
      supported: true,
    });
    await fixture.desktopWindow.setPreference('keepOpenOnClose', false);
    expect(await fixture.desktopWindow.status()).toEqual({
      keepOpenOnClose: false,
      warnOnVoiceClose: true,
      trayAvailable: true,
    });
  });
});
