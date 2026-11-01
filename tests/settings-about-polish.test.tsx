// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { DesktopBridge } from '@rooms/contracts';

vi.mock('../apps/desktop/src/realtime', async () => {
  const { create } = await import('zustand');
  return {
    useRealtime: create(() => ({
      status: 'idle',
      muted: true,
      noiseProcessing: null,
      roomName: '',
      diagnostics: { bitrate: null, packetLoss: null, rtt: null, video: null },
    })),
    setNoiseSuppression: vi.fn(),
  };
});
vi.mock('../apps/desktop/src/runtime-sources', () => ({ mediaProvider: () => ({}) }));
vi.mock('@rooms/media', () => ({
  createNoiseSuppressionNode: vi.fn(),
  selectedInputLabel: () => null,
}));
vi.mock('../apps/desktop/src/NoiseComparison', () => ({ NoiseComparison: () => null }));
import Settings, { communityTabs } from '../apps/desktop/src/Settings';
import { About, platformName } from '../apps/desktop/src/About';
import { StartupSplash } from '../apps/desktop/src/SystemState';
import { useCommunity } from '../apps/desktop/src/community';
import { queryClient } from '../apps/desktop/src/query-client';

beforeEach(() => {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: false,
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
      }) as unknown as MediaQueryList,
  );
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  delete window.rooms;
});

const deep = (): unknown =>
  new Proxy(() => new Promise(() => {}), {
    get: (_target, key) =>
      key === 'then' ? undefined : key === Symbol.toPrimitive ? () => '' : deep(),
  });
const quiet = <T extends object>(known: T): T =>
  new Proxy(known, {
    get: (target, key) => (key in target ? target[key as keyof T] : deep()),
  });
const member = { id: 'member', username: 'member', displayName: 'Uye', avatar: null };
const none = {
  manageServer: false,
  manageChannels: false,
  manageRoles: false,
  managePermissions: false,
  assignRoles: false,
  kickMembers: false,
  banMembers: false,
  moveMembers: false,
  communityAdmin: false,
};
const adminTabs = [
  'Sunucu profili',
  'Sinema',
  'Üyeler ve roller',
  'Kanal izinleri',
  'Asistan yetkileri',
  'Otomasyon modu',
];

function renderSettings(capabilities: typeof none, tab = 'appearance') {
  const communityCapabilities = vi.fn(async () => capabilities);
  window.rooms = quiet({
    platform: 'darwin',
    social: quiet({
      communityCapabilities,
      ownProfile: async () => ({ bio: '', statusText: '', presence: 'online' }),
    }),
    hostOps: quiet({ hosts: async () => [] }),
  }) as unknown as DesktopBridge;
  useCommunity.setState({
    user: member,
    status: 'connected',
    serverUrl: 'https://one.example',
    activeSpaceId: 'space',
    spaces: [{ id: 'space', name: 'Ekip', ownerId: 'owner' }] as never,
  });
  const view = render(
    <MemoryRouter initialEntries={[`/settings?tab=${tab}`]}>
      <Settings notify={() => {}} onClose={() => {}} />
    </MemoryRouter>,
  );
  const nav = () => within(view.container.querySelector<HTMLElement>('#settings-categories')!);
  return { communityCapabilities, nav };
}

describe('Settings navigation (UI-44)', () => {
  it('hides every community admin tab from a plain member', async () => {
    const { communityCapabilities, nav } = renderSettings(none);
    await waitFor(() => expect(communityCapabilities).toHaveBeenCalledWith('space'));
    await act(async () => {});
    for (const name of adminTabs) expect(nav().queryByRole('button', { name })).toBeNull();
    // A member without community tabs gets no empty community group header.
    expect(nav().queryByText(/^EK.P$/)).toBeNull();
    // Klavye and Tanılama live in the nav, not behind a title dropdown.
    expect(nav().getByRole('button', { name: 'Klavye' })).toBeTruthy();
    expect(nav().getByRole('button', { name: 'Tanılama' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Diğer ayarlar' })).toBeNull();
  });

  it('lets the keyboard tab rebind the mute and deafen shortcuts (H04)', async () => {
    renderSettings(none, 'shortcuts');
    await act(async () => {});
    const voice = within(screen.getByRole('heading', { name: 'Ses kısayolları' }).parentElement!);
    expect(voice.getByText('Mikrofonu aç / kapat')).toBeTruthy();
    expect(voice.getByText('Sesi kapat')).toBeTruthy();
    expect(voice.getByText('Bas konuş tuşu')).toBeTruthy();
    // Unset system-wide shortcuts offer "Ata"; push-to-talk always has a key.
    expect(voice.getAllByRole('button', { name: 'Ata' })).toHaveLength(2);
    act(() => voice.getAllByRole('button', { name: 'Ata' })[0]!.click());
    expect(voice.getByRole('button', { name: 'Vazgeç' })).toBeTruthy();
    // The built-in app shortcut is still listed below.
    expect(screen.getByRole('heading', { name: 'Uygulama kısayolları' })).toBeTruthy();
    expect(screen.getByText('⌘ / Ctrl Shift M')).toBeTruthy();
  });

  it('shows the admin tabs to a community admin', async () => {
    const { nav } = renderSettings({ ...none, communityAdmin: true });
    for (const name of adminTabs) expect(await nav().findByRole('button', { name })).toBeTruthy();
  });

  it('shows each tab only for the right it needs', () => {
    expect(communityTabs({ ...none, manageServer: true }, false, false)).toEqual([
      'server-profile',
    ]);
    expect(communityTabs({ ...none, kickMembers: true }, false, false)).toEqual([
      'community-management',
    ]);
    expect(communityTabs({ ...none, managePermissions: true }, false, false)).toEqual([
      'channel-permissions',
    ]);
    expect(communityTabs(null, false, true)).toEqual(['hostops']);
    expect(communityTabs(null, false, false)).toEqual([]);
    expect(communityTabs(null, true, false)).toEqual([
      'server-profile',
      'cinema',
      'community-management',
      'channel-permissions',
      'assistant-permissions',
      'automation',
      'hostops',
    ]);
  });
});

describe('controls that could never work are hidden (UI-40, UI-43)', () => {
  it('drops the email field and the privacy section and names the OS', async () => {
    renderSettings(none, 'profile');
    expect(await screen.findByText('Bu cihaz · macOS')).toBeTruthy();
    expect(screen.queryByText('E-posta')).toBeNull();
    expect(screen.queryByText('Gizlilik')).toBeNull();
    expect(screen.queryByText(/henüz uygulanmadı/)).toBeNull();
  });

  it('drops the tray preview and names the OS in the login item', async () => {
    renderSettings(none, 'desktop');
    expect(await screen.findByText('Paketlenmiş macOS uygulamasında kullanılabilir.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Menü seçenekleri' })).toBeNull();
  });

  it('labels the lilac accent and the members panel truthfully (UI-01, UI-42)', async () => {
    renderSettings(none, 'appearance');
    expect(await screen.findByRole('button', { name: 'Lila vurgusu' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'İnci vurgusu' })).toBeNull();
    expect(screen.getByText('Üye paneli')).toBeTruthy();
  });

  it('shows readable connection states in Diagnostics (UI-41)', async () => {
    renderSettings(none, 'diagnostics');
    expect(await screen.findByRole('heading', { name: 'Tanılama' })).toBeTruthy();
    expect(screen.queryByText('connected')).toBeNull();
    expect(screen.queryByText('idle')).toBeNull();
    expect(screen.getByText('macOS')).toBeTruthy();
  });
});

describe('About and splash (UI-33, UI-47, UI-48)', () => {
  const status = {
    state: 'idle',
    version: '9.9.9',
    configured: true,
    enabled: true,
    progress: 0,
    releaseNotes: [],
    reason: null,
  };
  function renderAbout(state: string) {
    window.rooms = quiet({
      platform: 'darwin',
      applicationInfo: async () => ({
        version: '0.1.18',
        platform: 'darwin',
        arch: 'arm64',
        electron: '1',
      }),
      updates: quiet({ status: async () => ({ ...status, state }) }),
    }) as unknown as DesktopBridge;
    render(
      <MemoryRouter>
        <About notify={() => {}} />
      </MemoryRouter>,
    );
  }

  it('does not call a stale offered version new once the check finds nothing', async () => {
    renderAbout('idle');
    expect(await screen.findByText('Kontrol edilebilir')).toBeTruthy();
    expect(screen.queryByText('Yeni sürüm')).toBeNull();
    expect(screen.queryByText('Tayfa 9.9.9')).toBeNull();
  });

  it('calls an offered version new while it is available', async () => {
    renderAbout('available');
    expect(await screen.findByText('Yeni sürüm')).toBeTruthy();
    expect(screen.getByText('Tayfa 9.9.9')).toBeTruthy();
  });

  it('ships the taglines and hides the crash report toggle', async () => {
    renderAbout('idle');
    expect(await screen.findByText('Arkadaşlarınla aynı yerde.')).toBeTruthy();
    expect(screen.getByText(/Özel arkadaş toplulukları için/)).toBeTruthy();
    expect(screen.queryByText('Çökme raporlarını paylaş')).toBeNull();
  });

  it('shows the splash headline in production', () => {
    render(<StartupSplash />);
    expect(screen.getByRole('heading', { name: 'Aynı yere dönmek güzel.' })).toBeTruthy();
  });

  it('names the operating systems', () => {
    expect(platformName('darwin')).toBe('macOS');
    expect(platformName('win32')).toBe('Windows');
    expect(platformName('linux')).toBe('Linux');
    expect(platformName(undefined)).toBe('—');
  });
});
