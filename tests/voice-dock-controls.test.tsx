// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
const f = vi.hoisted(() => ({
  snapshot: {
    status: 'connected',
    channelId: 'room',
    roomName: 'Test room',
    muted: true,
    camera: false,
    sharing: false,
    deafened: false,
    participants: [],
    tracks: [],
    busy: false,
    error: null,
  },
  capture: vi.fn(),
  status: vi.fn(),
  start: vi.fn(),
  mic: vi.fn(),
  camera: vi.fn(),
  leave: vi.fn(),
}));
vi.mock('../apps/desktop/src/realtime', () => ({
  useVoiceRejoin: (select: (state: { rejoin: null }) => unknown) => select({ rejoin: null }),
  useRealtime: () => f.snapshot,
  joinVoice: vi.fn(),
  leaveVoice: f.leave,
  toggleMic: f.mic,
  toggleDeafen: vi.fn(),
  toggleCamera: f.camera,
  startScreen: f.start,
  stopScreen: vi.fn(),
  setParticipantVolume: vi.fn(),
  startRoomAudio: vi.fn(),
  attachMediaTrack: vi.fn(),
  playSoundboard: vi.fn(),
  stopSoundboard: vi.fn(),
}));
vi.mock('../apps/desktop/src/runtime-sources', () => ({
  mediaBridge: () => ({ captureSources: f.capture, captureStatus: f.status }),
}));
vi.mock('../apps/desktop/src/screen-handoff', () => ({
  ScreenHandoffControls: () => null,
  cancelScreenHandoff: vi.fn(),
  decideScreenHandoff: vi.fn(),
  useScreenHandoff: (selector: any) => selector({ value: null, error: null }),
}));
import { RealVoiceDock } from '../apps/desktop/src/RealSocial';
afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  f.snapshot.status = 'connected';
  f.capture.mockResolvedValue([{ id: 'window:test', name: 'DEMO window', thumbnail: '' }]);
  f.status.mockResolvedValue({ screen: 'granted', systemAudio: false });
  f.mic.mockResolvedValue(undefined);
  f.start.mockResolvedValue({ audio: false });
  localStorage.clear();
});
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/voice']}>
      <RealVoiceDock openLauncher={() => {}} notify={() => {}} />
    </MemoryRouter>,
  );
it('navigation alone never publishes; source selection requires explicit final confirmation', async () => {
  mount();
  expect(f.mic).not.toHaveBeenCalled();
  expect(f.camera).not.toHaveBeenCalled();
  expect(f.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Ekran paylaş' }));
  await screen.findByRole('button', { name: /DEMO window/ });
  expect(f.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /DEMO window/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Seçili kaynağı paylaş' }));
  await waitFor(() =>
    expect(f.start).toHaveBeenCalledWith('window:test', expect.objectContaining({ audio: false })),
  );
});
it('visible microphone toggle invokes the real command and disconnected capture remains disabled', async () => {
  mount();
  fireEvent.click(screen.getByRole('button', { name: 'Mikrofonu aç' }));
  expect(f.mic).toHaveBeenCalledOnce();
  cleanup();
  f.snapshot.status = 'reconnecting';
  mount();
  expect((screen.getByRole('button', { name: 'Ekran paylaş' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  expect(f.capture).not.toHaveBeenCalled();
});

const pickAndShare = async (notify: (message: string) => void = () => {}) => {
  render(
    <MemoryRouter initialEntries={['/voice']}>
      <RealVoiceDock openLauncher={() => {}} notify={notify} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ekran paylaş' }));
  fireEvent.click(await screen.findByRole('button', { name: /DEMO window/ }));
};
const soundSwitch = () => screen.getByRole('switch', { name: 'Sesi de paylaş' });
it('shares sound by default on Windows 11 and macOS 14.2+ and says voices stay out', async () => {
  f.status.mockResolvedValue({
    screen: 'granted',
    systemAudio: true,
    systemAudioOwnExcluded: true,
  });
  f.start.mockResolvedValue({ audio: true });
  const notify = vi.fn();
  await pickAndShare(notify);
  await waitFor(() => expect(soundSwitch().getAttribute('aria-checked')).toBe('true'));
  expect(screen.getByText(/Tayfa’daki konuşmalar yayına karışmaz/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Seçili kaynağı paylaş' }));
  await waitFor(() =>
    expect(f.start).toHaveBeenCalledWith('window:test', expect.objectContaining({ audio: true })),
  );
  expect(notify).not.toHaveBeenCalled();
});
it('warns on Windows 10 that room voices reach the stream, and still defaults to sound', async () => {
  f.status.mockResolvedValue({
    screen: 'unknown',
    systemAudio: true,
    systemAudioOwnExcluded: false,
  });
  await pickAndShare();
  await waitFor(() => expect(soundSwitch().getAttribute('aria-checked')).toBe('true'));
  expect(screen.getByText(/Windows 10’da Tayfa’daki konuşmalar da yayına karışır/)).toBeTruthy();
});
it('explains on an older Mac why sound cannot be shared and shares the picture only', async () => {
  f.status.mockResolvedValue({
    screen: 'granted',
    systemAudio: false,
    systemAudioReason: 'macos-version',
  });
  await pickAndShare();
  await screen.findByText(/macOS 14.2 veya üstü gerekir/);
  expect((soundSwitch() as HTMLButtonElement).disabled).toBe(true);
  expect(soundSwitch().getAttribute('aria-checked')).toBe('false');
  fireEvent.click(screen.getByRole('button', { name: 'Seçili kaynağı paylaş' }));
  await waitFor(() =>
    expect(f.start).toHaveBeenCalledWith('window:test', expect.objectContaining({ audio: false })),
  );
});
it('remembers turning sound off and tells the sharer when sound could not be captured', async () => {
  f.status.mockResolvedValue({
    screen: 'granted',
    systemAudio: true,
    systemAudioOwnExcluded: true,
  });
  await pickAndShare();
  await waitFor(() => expect(soundSwitch().getAttribute('aria-checked')).toBe('true'));
  fireEvent.click(soundSwitch());
  expect(soundSwitch().getAttribute('aria-checked')).toBe('false');
  cleanup();
  // The next picker keeps the choice.
  await pickAndShare();
  await waitFor(() => expect(f.status).toHaveBeenCalledTimes(2));
  await waitFor(() => expect((soundSwitch() as HTMLButtonElement).disabled).toBe(false));
  expect(soundSwitch().getAttribute('aria-checked')).toBe('false');
  fireEvent.click(soundSwitch());
  cleanup();
  // Sound asked for but no loopback track: the picture still goes out and the sharer is told.
  const notify = vi.fn();
  f.start.mockResolvedValue({ audio: false });
  await pickAndShare(notify);
  await waitFor(() => expect(soundSwitch().getAttribute('aria-checked')).toBe('true'));
  fireEvent.click(screen.getByRole('button', { name: 'Seçili kaynağı paylaş' }));
  await waitFor(() =>
    expect(notify).toHaveBeenCalledWith(expect.stringMatching(/Ses paylaşılamadı/)),
  );
});
it('shows the sharer whether the share is sending sound', () => {
  Object.assign(f.snapshot, { sharing: true, sharingAudio: true });
  try {
    mount();
    expect(screen.getByRole('status', { name: 'Yayın sesi paylaşılıyor' })).toBeTruthy();
    cleanup();
    Object.assign(f.snapshot, { sharingAudio: false });
    mount();
    expect(screen.getByRole('status', { name: 'Yayında ses yok' })).toBeTruthy();
  } finally {
    Object.assign(f.snapshot, { sharing: false, sharingAudio: false });
  }
});

function CurrentRoute() {
  const route = useLocation();
  return (
    <output data-testid="capture-route">
      {route.pathname}
      {route.search}
    </output>
  );
}
// The personal player stays visible; anywhere else the shared screen opens in the voice room.
it.each([
  ['/media', '/media'],
  ['/chat', '/voice?view=share'],
])('after explicit capture from %s shows %s', async (path, expected) => {
  render(
    <MemoryRouter initialEntries={[path]}>
      <RealVoiceDock openLauncher={() => {}} notify={() => {}} />
      <CurrentRoute />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Ekran paylaş' }));
  fireEvent.click(await screen.findByRole('button', { name: /DEMO window/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Seçili kaynağı paylaş' }));
  await waitFor(() =>
    expect(screen.queryByRole('button', { name: 'Seçili kaynağı paylaş' })).toBeNull(),
  );
  expect(f.start).toHaveBeenCalledOnce();
  await waitFor(() => expect(screen.getByTestId('capture-route').textContent).toBe(expected));
});
