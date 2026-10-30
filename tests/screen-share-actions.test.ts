// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import { useCommunity } from '../apps/desktop/src/community';
const f = vi.hoisted(() => ({
  sharing: false,
  grant: vi.fn(),
  leave: vi.fn(),
  presenter: vi.fn(),
  select: vi.fn(),
  clear: vi.fn(),
  sources: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  publish: vi.fn(),
  stopScreen: vi.fn(),
  changeSource: vi.fn(),
  changeQuality: vi.fn(),
  sound: vi.fn(),
}));
vi.mock('../apps/desktop/src/runtime-sources', () => ({
  mediaBridge: () => ({
    grant: f.grant,
    leave: f.leave,
    presenter: f.presenter,
    selectCaptureSource: f.select,
    clearCaptureSource: f.clear,
    captureSources: f.sources,
  }),
  mediaProvider: () => ({
    snapshot: () => ({ status: 'connected', muted: true, deafened: false, sharing: f.sharing }),
    subscribeState: () => () => {},
    connectRoom: f.connect,
    disconnect: f.disconnect,
    setNoiseSuppression: vi.fn(),
    deviceSelection: vi.fn(),
    mute: vi.fn(),
    publishScreen: f.publish,
    stopScreen: f.stopScreen,
    changeScreenSource: f.changeSource,
    changeScreenQuality: f.changeQuality,
    setScreenSound: f.sound,
  }),
}));
import {
  changeScreenQuality,
  changeScreenSource,
  joinVoice,
  leaveVoice,
  setScreenSound,
  startScreen,
} from '../apps/desktop/src/realtime';
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((ok) => (resolve = ok));
  return { promise, resolve };
}
beforeEach(async () => {
  window.rooms = {} as any;
  await leaveVoice();
  vi.clearAllMocks();
  f.sharing = false;
  f.grant.mockImplementation(async (id: string) => ({
    roomName: `room-${id}`,
    token: 'local-test-token',
    serverUrl: 'wss://media.test',
  }));
  f.leave.mockResolvedValue(undefined);
  f.presenter.mockResolvedValue(undefined);
  f.select.mockResolvedValue(undefined);
  f.clear.mockResolvedValue(undefined);
  f.disconnect.mockResolvedValue(undefined);
  f.connect.mockResolvedValue(undefined);
  f.publish.mockImplementation(async () => {
    f.sharing = true;
  });
  f.stopScreen.mockResolvedValue(undefined);
  f.changeSource.mockResolvedValue(undefined);
  f.changeQuality.mockResolvedValue(undefined);
  f.sound.mockResolvedValue({ audio: true });
  useCommunity.setState({
    serverUrl: 'https://test',
    user: { id: 'owner', username: 'Owner', displayName: 'Owner', avatar: null },
  });
});

it('a late leave of the previous room never ends a share started in the new room', async () => {
  await joinVoice('one', 'One');
  const late = deferred<void>();
  f.leave.mockImplementationOnce(() => late.promise); // the server-side leave of room one drags on
  await joinVoice('two', 'Two');
  await startScreen('window:game', { quality: '1080p60' });
  expect(f.presenter).toHaveBeenCalledWith('two', 'acquire');
  late.resolve(); // it finally arrives
  await Promise.resolve();
  await Promise.resolve();
  expect(f.leave).toHaveBeenCalledTimes(1);
  expect(f.leave).toHaveBeenCalledWith('one');
  expect(f.stopScreen).not.toHaveBeenCalled();
  expect(f.presenter).not.toHaveBeenCalledWith('two', 'release');
  expect(f.clear).not.toHaveBeenCalled();
  expect(f.sharing).toBe(true);
});
it('switching the source selects it, swaps it in place, and never stops or releases', async () => {
  await joinVoice('one', 'One');
  await startScreen('window:game', {});
  f.presenter.mockClear();
  await changeScreenSource('window:docs');
  expect(f.select).toHaveBeenLastCalledWith('window:docs', { audio: false });
  expect(f.changeSource).toHaveBeenCalledOnce();
  expect(f.stopScreen).not.toHaveBeenCalled();
  expect(f.presenter).not.toHaveBeenCalled();
});
it('a failed source switch says the previous share continues and leaves the share alone', async () => {
  await joinVoice('one', 'One');
  await startScreen('window:game', {});
  f.changeSource.mockRejectedValue(new Error('Permission denied'));
  await expect(changeScreenSource('window:docs')).rejects.toThrow(/önceki paylaşım sürüyor/);
  expect(f.clear).toHaveBeenCalled();
  expect(f.stopScreen).not.toHaveBeenCalled();
  expect(f.presenter).not.toHaveBeenCalledWith('one', 'release');
});
it('quality change goes to the provider; failure names the unchanged quality', async () => {
  await joinVoice('one', 'One');
  await startScreen('window:game', {});
  await changeScreenQuality('720p30');
  expect(f.changeQuality).toHaveBeenCalledWith('720p30');
  f.changeQuality.mockRejectedValue(new Error('Overconstrained'));
  await expect(changeScreenQuality('4k30')).rejects.toThrow(/önceki kaliteyle sürüyor/);
  expect(f.stopScreen).not.toHaveBeenCalled();
});
it('sound on re-selects the shared source with audio; a vanished source is refused honestly', async () => {
  await joinVoice('one', 'One');
  await startScreen('window:game', { audio: true });
  f.sources.mockResolvedValue([{ id: 'window:game', name: 'Game', thumbnail: '' }]);
  await expect(setScreenSound(true)).resolves.toEqual({ audio: true });
  expect(f.select).toHaveBeenLastCalledWith('window:game', { audio: true });
  f.sources.mockResolvedValue([{ id: 'window:other', name: 'Other', thumbnail: '' }]);
  f.sound.mockClear();
  await expect(setScreenSound(true)).rejects.toThrow(/artık bulunamıyor/);
  expect(f.sound).not.toHaveBeenCalled();
  await setScreenSound(false); // off needs no capture at all
  expect(f.sound).toHaveBeenLastCalledWith(false);
});
it('every change is refused while nothing is shared', async () => {
  await joinVoice('one', 'One');
  await expect(changeScreenSource('window:docs')).rejects.toThrow(/Paylaşım yok/);
  await expect(changeScreenQuality('720p30')).rejects.toThrow(/Paylaşım yok/);
  await expect(setScreenSound(false)).rejects.toThrow(/Paylaşım yok/);
});
