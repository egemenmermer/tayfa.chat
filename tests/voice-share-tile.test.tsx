// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
const f = vi.hoisted(() => {
  const person = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
    id,
    name,
    local: false,
    muted: false,
    deafened: false,
    speaking: false,
    camera: false,
    screen: false,
    watching: null,
    volume: 1,
    quality: 'excellent',
    ...extra,
  });
  return {
    attach: vi.fn(() => () => {}),
    snapshot: {
      status: 'connected',
      channelId: 'room',
      roomName: 'Salon',
      muted: false,
      camera: false,
      sharing: false,
      deafened: false,
      busy: false,
      error: null,
      // The reported room: four people, Osman sharing his screen.
      participants: [
        person('sems', 'sems', { local: true }),
        person('umut', 'Umut'),
        person('osman', 'OB', { screen: true, speaking: true }),
        person('iphone', 'iphone_37d37c'),
      ],
      tracks: [
        {
          id: 'screen-osman',
          participantId: 'osman',
          source: 'screen_share',
          kind: 'video',
          local: false,
          muted: false,
        },
      ],
    },
  };
});
vi.mock('../apps/desktop/src/realtime', () => ({
  useVoiceRejoin: (select: (state: { rejoin: null }) => unknown) => select({ rejoin: null }),
  useRealtime: () => f.snapshot,
  useVoiceContext: (selector: (state: { channelId: string }) => unknown) =>
    selector({ channelId: 'room' }),
  joinVoice: vi.fn(),
  leaveVoice: vi.fn(),
  toggleMic: vi.fn(),
  toggleDeafen: vi.fn(),
  toggleCamera: vi.fn(),
  startScreen: vi.fn(),
  stopScreen: vi.fn(),
  watchScreen: vi.fn(),
  setScreenVolume: vi.fn(),
  setScreenQuality: vi.fn(),
  setParticipantVolume: vi.fn(),
  startRoomAudio: vi.fn(),
  attachMediaTrack: f.attach,
  playSoundboard: vi.fn(),
  stopSoundboard: vi.fn(),
}));
vi.mock('../apps/desktop/src/screen-handoff', () => ({
  ScreenHandoffControls: () => null,
  cancelScreenHandoff: vi.fn(),
  decideScreenHandoff: vi.fn(),
  useScreenHandoff: (selector: any) => selector({ value: null, error: null }),
}));
import { CommunityVoice } from '../apps/desktop/src/RealSocial';
afterEach(cleanup);

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

it('shows a shared screen as a tile right after its presenter, not as a trailing row', () => {
  render(
    <MemoryRouter initialEntries={['/voice']}>
      <CommunityVoice openLauncher={() => {}} notify={() => {}} />
      <Where />
    </MemoryRouter>,
  );
  const share = screen.getByRole('button', { name: 'OB ekranını izle' });
  expect(share.className).toContain('room-share-preview');
  const presenter = document.querySelector('[data-voice-participant-id="osman"]');
  expect(presenter?.nextElementSibling).toBe(share);
  // Everyone after the presenter still follows the shared screen in the same grid.
  expect(share.nextElementSibling?.getAttribute('data-voice-participant-id')).toBe('iphone');
  // A remote screen is only advertised; nothing is downloaded before the listener asks.
  expect(f.attach).not.toHaveBeenCalled();
  expect(screen.getByText('Yayını izle')).toBeTruthy();
  fireEvent.click(share);
  expect(screen.getByTestId('where').textContent).toBe('/voice?view=share&screen=screen-osman');
});
