// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const media = vi.hoisted(() => ({
  status: 'connected',
  toggleMic: vi.fn(),
  toggleDeafen: vi.fn(),
}));
vi.mock('../apps/desktop/src/realtime', () => ({
  useRealtime: () => ({ status: media.status }),
  toggleMic: media.toggleMic,
  toggleDeafen: media.toggleDeafen,
}));
import { GlobalShortcuts, useShortcutStatus } from '../apps/desktop/src/GlobalShortcuts';
import { ShortcutKeyField } from '../apps/desktop/src/ShortcutKeyField';
import { useRooms } from '../apps/desktop/src/store';

let trigger: (action: 'mute' | 'deafen') => void = () => {};
const set = vi.fn();
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  media.status = 'connected';
  media.toggleMic.mockResolvedValue(undefined);
  media.toggleDeafen.mockResolvedValue(undefined);
  set.mockResolvedValue({ mute: { state: 'active' }, deafen: { state: 'none' } });
  (window as unknown as { rooms: unknown }).rooms = {
    globalShortcuts: {
      set,
      onTrigger: (listener: typeof trigger) => {
        trigger = listener;
        return () => {};
      },
    },
  };
  useRooms.setState({
    preferences: { ...useRooms.getState().preferences, muteKey: 'Ctrl+Alt+KeyM', deafenKey: '' },
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
  delete (window as unknown as { rooms?: unknown }).rooms;
  useShortcutStatus.setState({ status: null });
});
const flush = () => act(async () => {});

it('sends the saved shortcuts to the main process and keeps its answer', async () => {
  render(<GlobalShortcuts notify={vi.fn()} />);
  await flush();
  expect(set).toHaveBeenCalledWith({ mute: 'Ctrl+Alt+KeyM', deafen: '' });
  expect(useShortcutStatus.getState().status?.mute).toEqual({ state: 'active' });
  await act(async () =>
    useRooms.getState().setPreferences({ ...useRooms.getState().preferences, deafenKey: 'F9' }),
  );
  expect(set).toHaveBeenLastCalledWith({ mute: 'Ctrl+Alt+KeyM', deafen: 'F9' });
});

it('toggles the microphone and deafen exactly like the on-screen buttons', async () => {
  render(<GlobalShortcuts notify={vi.fn()} />);
  await flush();
  act(() => trigger('mute'));
  expect(media.toggleMic).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 1000);
  act(() => trigger('deafen'));
  expect(media.toggleDeafen).toHaveBeenCalledTimes(1);
});

it('ignores a double delivery and a press while not in a call', async () => {
  const { rerender } = render(<GlobalShortcuts notify={vi.fn()} />);
  await flush();
  act(() => trigger('mute'));
  act(() => trigger('mute'));
  expect(media.toggleMic).toHaveBeenCalledTimes(1);
  vi.setSystemTime(Date.now() + 1000);
  media.status = 'idle';
  rerender(<GlobalShortcuts notify={vi.fn()} />);
  act(() => trigger('mute'));
  expect(media.toggleMic).toHaveBeenCalledTimes(1);
});

it('shows a failed toggle as a message', async () => {
  const notify = vi.fn();
  media.toggleMic.mockRejectedValue(new Error('no device'));
  render(<GlobalShortcuts notify={notify} />);
  await flush();
  await act(async () => trigger('mute'));
  expect(notify).toHaveBeenCalledWith(expect.stringContaining('Mikrofon'));
});

it('records a shortcut, refuses conflicts and clears', () => {
  const onChange = vi.fn();
  render(<ShortcutKeyField label="Mikrofon" value="" onChange={onChange} others={['Alt+KeyD']} />);
  expect(screen.getByText('Atanmadı')).toBeTruthy();
  const record = (init: KeyboardEventInit) => {
    fireEvent.click(screen.getByRole('button', { name: /Ata|Değiştir/ }));
    fireEvent.keyDown(window, init);
  };
  record({ code: 'KeyM' });
  expect(screen.getByRole('alert').textContent).toContain('Ctrl, Alt');
  record({ code: 'KeyM', ctrlKey: true, shiftKey: true });
  expect(screen.getByRole('alert').textContent).toContain('kullanılıyor');
  record({ code: 'KeyD', altKey: true });
  expect(screen.getByRole('alert').textContent).toContain('aynı');
  expect(onChange).not.toHaveBeenCalled();
  record({ code: 'KeyM', altKey: true });
  expect(onChange).toHaveBeenCalledWith('Alt+KeyM');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('explains a shortcut the system refused and offers clear', () => {
  const onChange = vi.fn();
  render(
    <ShortcutKeyField
      label="Mikrofon"
      value="Ctrl+Alt+KeyM"
      onChange={onChange}
      others={[]}
      status={{ state: 'failed', problem: 'taken' }}
    />,
  );
  expect(screen.getByRole('alert').textContent).toContain('Başka bir uygulama');
  fireEvent.click(screen.getByRole('button', { name: 'Temizle' }));
  expect(onChange).toHaveBeenCalledWith('');
});
