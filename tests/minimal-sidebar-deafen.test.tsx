// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const f = vi.hoisted(() => ({
  snapshot: {
    status: 'connected',
    channelId: 'room',
    roomName: 'Test room',
    muted: false,
    camera: false,
    sharing: false,
    deafened: false,
    participants: [],
    tracks: [],
    busy: false,
    error: null,
  },
}));
vi.mock('../apps/desktop/src/realtime', () => ({
  useRealtime: () => f.snapshot,
  joinVoice: vi.fn(),
  leaveVoice: vi.fn(),
  toggleMic: vi.fn(),
  toggleDeafen: vi.fn(),
  toggleCamera: vi.fn(),
  startRoomAudio: vi.fn(),
  stopScreen: vi.fn(),
}));
vi.mock('../apps/desktop/src/voice-directory', () => ({ useVoiceDirectory: () => ({}) }));
vi.mock('../apps/desktop/src/Soundboard', () => ({ SoundboardButton: () => null }));
import { MinimalSidebar } from '../apps/desktop/src/MinimalSidebar';
import { useCommunity } from '../apps/desktop/src/community';
afterEach(cleanup);
beforeEach(() => {
  f.snapshot.deafened = false;
  useCommunity.setState({
    user: { id: 'me', username: 'me', displayName: 'Me', avatar: null },
    serverUrl: 'https://local.example',
    activeSpaceId: 'server',
    activeChannelId: null,
    channels: [],
    spaces: [{ id: 'server', name: 'Server', ownerId: 'me', icon: null }],
  });
});
const mount = () =>
  render(
    <MemoryRouter initialEntries={['/voice']}>
      <MinimalSidebar
        notify={() => {}}
        invite={() => {}}
        createSpace={() => {}}
        editSpace={() => {}}
        search={() => {}}
        help={() => {}}
      />
    </MemoryRouter>,
  );
it('deafen control reflects the deafened state in its icon, class and pressed state', () => {
  mount();
  const idle = screen.getByRole('button', { name: 'Sağırlaştır · kısayol için sağ tıkla' });
  expect(idle.getAttribute('aria-pressed')).toBe('false');
  expect(idle.className).not.toContain('muted-control');
  expect(idle.querySelector('.lucide-headphones')).not.toBeNull();
  cleanup();
  f.snapshot.deafened = true;
  mount();
  const active = screen.getByRole('button', {
    name: 'Sağırlaştırmayı kapat · kısayol için sağ tıkla',
  });
  expect(active.getAttribute('aria-pressed')).toBe('true');
  expect(active.className).toContain('muted-control');
  expect(active.querySelector('.lucide-headphone-off')).not.toBeNull();
});
