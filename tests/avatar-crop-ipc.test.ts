import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SOCIAL_ROLE_PERMISSION_KEYS } from '@rooms/social';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';

const mock = vi.hoisted(() => ({
  handlers: new Map<string, Function>(),
  instances: [] as { url: string; token?: string }[],
  capabilities: {
    emailEnabled: true,
    captcha: { required: false, siteKey: null as string | null },
  },
  request: vi.fn(),
  changeRole: vi.fn(),
  confirm: vi.fn(),
  clipboard: vi.fn(),
  exists: vi.fn(() => false),
  upload: vi.fn(),
  open: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { isPackaged: true, getPath: () => '/tmp/rooms-local-recovery-ipc-fixture', on: vi.fn() },
  ipcMain: { handle: (name: string, handler: Function) => mock.handlers.set(name, handler) },
  safeStorage: { isEncryptionAvailable: () => false },
  clipboard: { readText: () => mock.clipboard() },
  session: { defaultSession: { setDisplayMediaRequestHandler: vi.fn() } },
  dialog: { showOpenDialog: (...args: unknown[]) => mock.open(...args) },
  desktopCapturer: {},
  systemPreferences: {},
  screen: { on: vi.fn(), removeListener: vi.fn() },
}));
vi.mock('node:fs', async () => ({
  ...(await vi.importActual<object>('node:fs')),
  existsSync: mock.exists,
}));
vi.mock('@rooms/stoat', async () => ({
  ...(await vi.importActual<object>('@rooms/stoat')),
  StoatError: class extends Error {},
  StoatClient: class {
    instanceUrl: string;
    status = 'connected';
    private token: string | undefined;
    constructor(url: string, token?: string) {
      this.instanceUrl = url;
      this.token = token;
      mock.instances.push({ url, token });
    }
    uploadAvatar(...args: unknown[]) {
      return mock.upload(...args);
    }
    changeCommunityRole(input: unknown) {
      return mock.changeRole(input);
    }
    passwordRecoveryCapabilities() {
      return Promise.resolve(mock.capabilities);
    }
    requestPasswordRecovery(input: unknown) {
      return mock.request(input);
    }
    confirmPasswordRecovery(input: unknown) {
      return mock.confirm(input);
    }
    logout() {
      return Promise.resolve();
    }
    login() {
      this.token = 'fixture-private-session';
      return Promise.resolve({
        id: '111111',
        username: 'fixture',
        displayName: 'fixture',
        avatar: null,
      });
    }
    getToken() {
      return this.token;
    }
    subscribe() {
      return () => {};
    }
    connect() {
      return Promise.resolve();
    }
    disconnect() {
      return Promise.resolve();
    }
  },
}));
import { photoType, setupCommunity } from '../apps/desktop/electron/community';

let close: (() => Promise<void>) | undefined;
const event = { trusted: true, sender: { id: 7 } } as unknown as IpcMainInvokeEvent;
const windowFixture = {
  isFocused: () => false,
  webContents: {
    getURL: () => 'file:///rooms/index.html',
    isDestroyed: () => false,
    send: vi.fn(),
  },
} as unknown as BrowserWindow;
const invoke = (name: string, ...args: unknown[]) => mock.handlers.get(name)!(event, ...args);
beforeEach(async () => {
  mock.handlers.clear();
  mock.instances.length = 0;
  mock.capabilities = { emailEnabled: true, captcha: { required: false, siteKey: null } };
  mock.changeRole
    .mockReset()
    .mockResolvedValue({ roleId: 'role', management: { spaceId: 'space' } });
  mock.request.mockReset().mockResolvedValue({ accepted: true });
  mock.confirm.mockReset().mockResolvedValue({ completed: true });
  mock.clipboard
    .mockReset()
    .mockReturnValue('https://selected.example/login/reset/' + 'a'.repeat(32));
  const community = await setupCommunity(
    () => windowFixture,
    (invocation) => {
      if (invocation !== event) throw new Error('Untrusted sender');
    },
    () => true,
  );
  close = community.close;
});
afterEach(async () => {
  await close?.();
  close = undefined;
});
const png = (size = 64) => {
  const bytes = new Uint8Array(size);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  return bytes;
};
const login = () =>
  invoke('rooms:social-login', {
    serverUrl: 'https://current.example',
    email: 'friend@example.com',
    password: 'fixture-password',
  });
describe('avatar crop IPC (fully mocked Stoat/Electron, no remote calls)', () => {
  it('knows PNG, JPEG and WebP by their bytes only', () => {
    expect(photoType(png())).toBe('image/png');
    expect(photoType(new Uint8Array([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe(
      'image/jpeg',
    );
    expect(photoType(new TextEncoder().encode('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp');
    expect(photoType(new TextEncoder().encode('<svg onload=1>'))).toBeNull();
  });
  it('uploads a cropped avatar only when its bytes match the type and size', async () => {
    await login();
    const updated = { id: '111111', username: 'fixture', displayName: 'fixture', avatar: 'new' };
    mock.upload.mockReset().mockResolvedValue(updated);
    await expect(invoke('rooms:social-upload-avatar', png(), 'image/jpeg')).rejects.toThrow();
    await expect(invoke('rooms:social-upload-avatar', 'not bytes', 'image/png')).rejects.toThrow();
    await expect(
      invoke('rooms:social-upload-avatar', png(2_000_001), 'image/png'),
    ).rejects.toThrow();
    expect(mock.upload).not.toHaveBeenCalled();
    expect(await invoke('rooms:social-upload-avatar', png(), 'image/png')).toEqual(updated);
    expect(mock.upload).toHaveBeenCalledWith(expect.any(Buffer), 'avatar.png', 'image/png');
  });
  it('returns the picked photo to crop without uploading it, up to 10 MB', async () => {
    await login();
    mock.upload.mockReset();
    const dir = mkdtempSync(join(tmpdir(), 'rooms-avatar-'));
    const file = join(dir, 'me.jpg');
    writeFileSync(file, new Uint8Array([255, 216, 255, ...new Array(3_000_000).fill(1)]));
    mock.open.mockReset().mockResolvedValue({ canceled: false, filePaths: [file] });
    const picked = await invoke('rooms:social-pick-avatar');
    expect(picked).toMatchObject({ name: 'me.jpg', mime: 'image/jpeg' });
    expect(picked.bytes).toBeInstanceOf(Uint8Array);
    expect(picked.bytes.length).toBe(3_000_003);
    expect(mock.upload).not.toHaveBeenCalled();
    // The old one-step picker keeps its 2 MB limit.
    await expect(invoke('rooms:social-choose-avatar')).rejects.toThrow();
    mock.open.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await invoke('rooms:social-pick-avatar')).toBeNull();
  });
});
