// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import type { DesktopBridge } from '@rooms/contracts';
import { useCommunity } from '../apps/desktop/src/community';
const voice = vi.hoisted(() => ({ channelId: 'new', status: 'connected' }));
vi.mock('../apps/desktop/src/realtime', () => ({ useRealtime: () => voice }));
import { useVoiceDirectory } from '../apps/desktop/src/voice-directory';
afterEach(() => {
  cleanup();
  delete window.rooms;
});
it('observes another room without requesting media access and rejects an old-account response', async () => {
  let complete!: (value: any) => void;
  const directory = vi.fn(
    () =>
      new Promise<any>((resolve) => {
        complete = resolve;
      }),
  );
  const grant = vi.fn();
  window.rooms = { media: { directory, grant } } as unknown as DesktopBridge;
  useCommunity.setState({
    serverUrl: 'https://example.test',
    user: { id: 'owner', username: 'Owner', displayName: 'Owner', avatar: null },
  });
  const hook = renderHook(() => useVoiceDirectory(['room']));
  await waitFor(() => expect(directory).toHaveBeenCalledTimes(1));
  act(() => {
    useCommunity.setState({ user: null });
  });
  await act(async () =>
    complete({
      rooms: [
        { channelId: 'room', participants: [{ id: 'friend', name: 'Private', muted: false }] },
      ],
    }),
  );
  expect(hook.result.current.rooms).toEqual([]);
  expect(grant).not.toHaveBeenCalled();
});
it('purges a revoked room immediately and fences the pending directory response', async () => {
  let complete!: (value: any) => void;
  window.rooms = {
    media: {
      directory: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    },
  } as unknown as DesktopBridge;
  useCommunity.setState({
    serverUrl: 'https://example.test',
    user: { id: 'owner', username: 'Owner', displayName: 'Owner', avatar: null },
  });
  const hook = renderHook(() => useVoiceDirectory(['room']));
  act(() =>
    window.dispatchEvent(
      new CustomEvent('rooms:channel-access-invalidated', { detail: { channelIds: ['room'] } }),
    ),
  );
  await act(async () =>
    complete({
      rooms: [
        { channelId: 'room', participants: [{ id: 'friend', name: 'Private', muted: false }] },
      ],
    }),
  );
  expect(hook.result.current.rooms).toEqual([]);
});

it('removes stale own presence from the previous room while preserving friends', async () => {
  window.rooms = {
    media: {
      directory: async () => ({
        rooms: [
          {
            channelId: 'old',
            participants: [
              { id: 'owner', name: 'Owner', muted: true },
              { id: 'friend', name: 'Friend', muted: false },
            ],
          },
          { channelId: 'new', participants: [{ id: 'owner', name: 'Owner', muted: true }] },
        ],
      }),
    },
  } as unknown as DesktopBridge;
  useCommunity.setState({
    serverUrl: 'https://example.test',
    user: { id: 'owner', username: 'Owner', displayName: 'Owner', avatar: null },
  });
  voice.channelId = 'new';
  voice.status = 'connected';
  const hook = renderHook(() => useVoiceDirectory(['old', 'new']));
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  expect(hook.result.current.rooms[0].participants.map((p) => p.id)).toEqual(['friend']);
  expect(hook.result.current.rooms[1].participants.map((p) => p.id)).toEqual(['owner']);
  voice.status = 'connecting';
  hook.rerender();
  expect(hook.result.current.rooms[1].participants).toEqual([]);
});

it('polls hidden voice directories less often and refreshes on returning to the app', async () => {
  vi.useFakeTimers();
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  try {
    const directory = vi.fn(async () => ({ rooms: [] }));
    window.rooms = { media: { directory } } as unknown as DesktopBridge;
    useCommunity.setState({
      serverUrl: 'https://background.test',
      user: {
        id: 'owner',
        username: 'Owner',
        displayName: 'Owner',
        avatar: null,
      },
    });
    renderHook(() => useVoiceDirectory(['room']));
    await act(async () => {});
    await act(async () => vi.advanceTimersByTimeAsync(29_000));
    expect(directory).toHaveBeenCalledTimes(1);
    await act(async () => vi.advanceTimersByTimeAsync(1000));
    expect(directory).toHaveBeenCalledTimes(2);
    hidden.mockReturnValue(false);
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(directory).toHaveBeenCalledTimes(3);
    await act(async () => vi.advanceTimersByTimeAsync(5000));
    expect(directory).toHaveBeenCalledTimes(4);
  } finally {
    cleanup();
    hidden.mockRestore();
    vi.useRealTimers();
  }
});
