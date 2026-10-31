import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mock = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  saved: '{}',
  fail: false,
  shown: [] as Record<string, unknown>[],
  clicks: [] as (() => void)[],
  focused: false,
}));
vi.mock('electron', () => ({
  app: { getPath: () => '/fixture' },
  ipcMain: { handle: (name: string, handler: Function) => mock.handlers.set(name, handler) },
  Notification: class {
    static isSupported() {
      return true;
    }
    constructor(options: Record<string, unknown>) {
      mock.shown.push(options);
    }
    on(name: string, handler: () => void) {
      if (name === 'click') mock.clicks.push(handler);
    }
    show() {}
  },
}));
vi.mock('node:fs', () => ({
  readFileSync: () => mock.saved,
  writeFileSync: (_path: string, value: string) => {
    if (mock.fail) throw new Error('disk failure');
    mock.saved = value;
  },
  renameSync: vi.fn(),
  rmSync: vi.fn(),
}));
import { setupNotifications } from '../apps/desktop/electron/notifications';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
const event = {} as IpcMainInvokeEvent;
let scope = { serverUrl: 'https://rooms.example', userId: 'owner' };
const invoke = (name: string, value?: unknown) =>
  mock.handlers.get('rooms:notification-' + name)!(event, value);
function setup() {
  return setupNotifications(
    () =>
      ({
        isFocused: () => mock.focused,
        isMinimized: () => false,
        isVisible: () => true,
        show: () => {},
        focus: () => {},
        webContents: { getURL: () => 'https://rooms.example' },
      }) as unknown as BrowserWindow,
    (e) => {
      if (e !== event) throw new Error('untrusted');
    },
    () => scope,
  );
}
beforeEach(() => {
  mock.handlers.clear();
  mock.saved = '{}';
  mock.fail = false;
  mock.shown = [];
  mock.clicks = [];
  mock.focused = false;
  scope = { serverUrl: 'https://rooms.example', userId: 'owner' };
});
afterEach(() => vi.useRealTimers());
describe('native notification preferences', () => {
  it('persists account/server-scoped channel mutes without message contents or identifiers', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T07:00:00Z'));
    let service = setup();
    invoke('opt-in', true);
    const input = { ...scope, channelId: 'channel-1', muted: true };
    invoke('channel-mute', input);
    service = setup();
    expect(invoke('channel-status', input)).toEqual({ muted: true });
    service.message(scope, 'channel-1');
    expect(mock.shown).toHaveLength(0);
    service.message({ ...scope, userId: 'other' }, 'channel-1');
    expect(mock.shown).toHaveLength(1);
    vi.advanceTimersByTime(5001);
    service.message({ ...scope, serverUrl: 'https://other.example' }, 'channel-1');
    expect(mock.shown).toHaveLength(2);
    expect(mock.saved).not.toContain('owner');
    expect(mock.saved).not.toContain('channel-1');
    expect(mock.saved).not.toContain('rooms.example');
  });
  it('unmutes only the selected channel and does not consume the global notification rate limit when muted', () => {
    const service = setup();
    invoke('opt-in', true);
    const input = { ...scope, channelId: 'channel-1' };
    invoke('channel-mute', { ...input, muted: true });
    service.message(scope, 'channel-1');
    service.message(scope, 'channel-2');
    expect(mock.shown).toHaveLength(1);
    invoke('channel-mute', { ...input, muted: false });
    expect(invoke('channel-status', input)).toEqual({ muted: false });
  });
  it('rejects stale identity, invalid channel values and failed mute persistence without changing state', () => {
    setup();
    const input = { ...scope, channelId: 'channel-1', muted: true };
    expect(() => invoke('channel-mute', { ...input, userId: 'other' })).toThrow('account changed');
    expect(() => invoke('channel-mute', { ...input, channelId: '../private' })).toThrow();
    expect(() => invoke('channel-mute', { ...input, muted: 'yes' })).toThrow('Invalid channel');
    mock.fail = true;
    expect(() => invoke('channel-mute', input)).toThrow('disk failure');
    expect(invoke('channel-status', input)).toEqual({ muted: false });
  });

  it('pauses notifications during a refreshed voice lease and expires crash-stale state', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T06:00:00Z'));
    const service = setup();
    invoke('opt-in', true);
    invoke('pause-voice', true);
    invoke('voice-active', true);
    service.message();
    expect(mock.shown).toHaveLength(0);
    vi.advanceTimersByTime(20000);
    invoke('voice-active', true);
    vi.advanceTimersByTime(20000);
    service.message();
    expect(mock.shown).toHaveLength(0);
    vi.advanceTimersByTime(10001);
    service.message();
    expect(mock.shown).toHaveLength(1);
  });
  it('releases suppression on disconnect without persisting transient voice state', () => {
    const service = setup();
    invoke('opt-in', true);
    invoke('pause-voice', true);
    invoke('voice-active', true);
    invoke('voice-active', false);
    service.message();
    expect(mock.shown).toHaveLength(1);
    expect(JSON.parse(mock.saved)).toEqual({
      enabled: true,
      important: true,
      sound: false,
      pauseDuringVoice: true,
      mutedChannels: [],
    });
  });
  it('ignores voice state unless the owner enabled suppression', () => {
    const service = setup();
    invoke('opt-in', true);
    invoke('voice-active', true);
    service.message();
    expect(mock.shown).toHaveLength(1);
  });
  it('starts opt-out and silent and preserves content-free notification text', () => {
    const service = setup();
    service.message();
    expect(mock.shown).toHaveLength(0);
    invoke('opt-in', true);
    service.message();
    expect(mock.shown).toEqual([
      { title: 'Tayfa', body: 'Topluluğunda yeni bir mesaj var.', silent: true },
    ]);
  });
  it('enables system sound only by explicit preference and restores it', () => {
    setup();
    invoke('sound', true);
    invoke('opt-in', true);
    const service = setup();
    service.message();
    expect(invoke('status')).toEqual({
      enabled: true,
      important: true,
      sound: true,
      pauseDuringVoice: false,
      supported: true,
    });
    expect(mock.shown[0].silent).toBe(false);
  });
  it('does not opt in when changing sound and keeps focus/rate suppression', () => {
    const service = setup();
    invoke('sound', true);
    service.message();
    expect(mock.shown).toHaveLength(0);
    invoke('opt-in', true);
    mock.focused = true;
    service.message();
    expect(mock.shown).toHaveLength(0);
    mock.focused = false;
    service.message();
    service.message();
    expect(mock.shown).toHaveLength(1);
  });
  it('keeps previous preferences on persistence failure', () => {
    setup();
    mock.fail = true;
    expect(() => invoke('sound', true)).toThrow('disk failure');
    expect(invoke('status').sound).toBe(false);
  });
  it('rejects untrusted senders and non-boolean values', () => {
    setup();
    expect(() => mock.handlers.get('rooms:notification-sound')!({}, true)).toThrow('untrusted');
    for (const value of ['true', 1, null, {}])
      expect(() => invoke('sound', value)).toThrow('Invalid notification preference');
  });
});
it('uses content-free mention copy while preserving opt-out and channel mute preferences', () => {
  const service = setup();
  // Every-message notifications start off, and a plain message stays quiet.
  service.message(scope, 'chat');
  expect(mock.shown).toHaveLength(0);
  invoke('channel-mute', { ...scope, channelId: 'chat', muted: true });
  service.message(scope, 'chat', true);
  expect(mock.shown).toHaveLength(0);
  invoke('channel-mute', { ...scope, channelId: 'chat', muted: false });
  // A mention notifies by default, without its contents.
  service.message(scope, 'chat', true);
  expect(mock.shown).toEqual([
    { title: 'Tayfa', body: 'Topluluğunda biri seni etiketledi.', silent: true },
  ]);
});

it('notifies direct messages and mentions by default until the member turns them off', () => {
  const service = setup();
  vi.useFakeTimers();
  try {
    service.message(scope, 'dm-1', false, undefined, true);
    expect(mock.shown.at(-1)).toEqual({
      title: 'Tayfa',
      body: 'Yeni bir özel mesajın var.',
      silent: true,
    });
    // Not while Tayfa is in front, and not twice within 1.5 s.
    mock.focused = true;
    vi.advanceTimersByTime(2000);
    service.message(scope, 'dm-1', false, undefined, true);
    mock.focused = false;
    service.message(scope, 'dm-1', false, undefined, true);
    service.message(scope, 'dm-1', false, undefined, true);
    expect(mock.shown).toHaveLength(2);
    expect(invoke('important', false)).toMatchObject({ important: false });
    vi.advanceTimersByTime(2000);
    service.message(scope, 'dm-1', false, undefined, true);
    service.message(scope, 'chat', true);
    expect(mock.shown).toHaveLength(2);
    expect(JSON.parse(mock.saved)).toMatchObject({ important: false });
  } finally {
    vi.useRealTimers();
  }
});
describe('notification delivery', () => {
  it('shows a server alert for admins even with chat notifications off', () => {
    const service = setup();
    service.serverAlert('Tayfa sunucusu: Disk %92 dolu');
    expect(mock.shown).toEqual([
      { title: 'Tayfa · Sunucu uyarısı', body: 'Tayfa sunucusu: Disk %92 dolu', silent: true },
    ]);
  });
  it('shows a programme reminder even with chat notifications off, but not in front', () => {
    setup();
    const remind = (value: unknown) =>
      mock.handlers.get('rooms:notification-reminder')!(event, value);
    expect(() => remind({ title: '', detail: 'x' })).toThrow('Invalid reminder.');
    mock.focused = true;
    remind({ title: 'Haberler başladı', detail: 'TRT 1 · 20:00' });
    expect(mock.shown).toHaveLength(0);
    mock.focused = false;
    remind({ title: 'Haberler başladı', detail: 'TRT 1 · 20:00' });
    expect(mock.shown).toEqual([
      { title: 'Haberler başladı', body: 'TRT 1 · 20:00', silent: true },
    ]);
  });
  it('announces an incoming private call without content, only when the window is not in front', () => {
    setup();
    invoke('opt-in', true);
    mock.focused = true;
    invoke('incoming-call');
    expect(mock.shown).toHaveLength(0);
    mock.focused = false;
    invoke('incoming-call');
    expect(mock.shown).toEqual([{ title: 'Tayfa', body: 'Özel bir arama geliyor.', silent: true }]);
  });
  it('rings the system notification for a private call even when chat notifications were never enabled', () => {
    setup();
    invoke('incoming-call');
    expect(mock.shown).toEqual([{ title: 'Tayfa', body: 'Özel bir arama geliyor.', silent: true }]);
    mock.focused = true;
    invoke('incoming-call');
    expect(mock.shown).toHaveLength(1);
  });
  it('shows a mention right after another message and opens its channel on click', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T07:00:00Z'));
    const service = setup();
    invoke('opt-in', true);
    service.message(scope, 'general');
    vi.advanceTimersByTime(2000);
    const open = vi.fn();
    service.message(scope, 'general', true, open);
    expect(mock.shown).toHaveLength(2);
    expect(mock.shown[1]!.body).toBe('Topluluğunda biri seni etiketledi.');
    mock.clicks[1]!();
    expect(open).toHaveBeenCalled();
    // Ordinary messages keep the 5 s throttle.
    service.message(scope, 'general');
    expect(mock.shown).toHaveLength(2);
  });
});
