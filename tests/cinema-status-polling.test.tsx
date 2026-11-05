// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { DesktopBridge } from '@rooms/contracts';
import type { CinemaStatus } from '../packages/community-cinema/src/types';
import { useCommunity } from '../apps/desktop/src/community';
import { refreshCinemaStatus, useCommunityCinema } from '../apps/desktop/src/cinema/cinema-status';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete window.rooms;
});

function setup(importing = false) {
  vi.useFakeTimers();
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  const communityId = `cinema-${Math.random()}`;
  const status = vi.fn(
    async () =>
      ({
        communityId,
        hallChannelId: 'hall',
        isOwner: false,
        importing: importing ? { finishedAt: null } : null,
      }) as CinemaStatus,
  );
  window.rooms = { cinema: { status } } as unknown as DesktopBridge;
  useCommunity.setState({
    activeSpaceId: communityId,
    serverUrl: 'https://example.test',
    user: {
      id: 'first',
      username: 'First',
      displayName: 'First',
      avatar: null,
    },
  });
  return { communityId, status };
}

it('shares a fresh result across staggered shell mounts while preserving explicit refresh', async () => {
  const { communityId, status } = setup();
  renderHook(() => useCommunityCinema());
  await act(async () => {});
  await act(async () => vi.advanceTimersByTimeAsync(5000));
  renderHook(() => useCommunityCinema());
  await act(async () => {});
  expect(status).toHaveBeenCalledTimes(1);
  await act(async () => vi.advanceTimersByTimeAsync(55000));
  expect(status).toHaveBeenCalledTimes(2);
  await act(async () => refreshCinemaStatus(communityId));
  expect(status).toHaveBeenCalledTimes(3);
});

it('slows import polling while hidden and resumes promptly in the foreground', async () => {
  const { status } = setup(true);
  renderHook(() => useCommunityCinema());
  await act(async () => {});
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  await act(async () => vi.advanceTimersByTimeAsync(10000));
  expect(status).toHaveBeenCalledTimes(1);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  expect(status).toHaveBeenCalledTimes(2);
});

it('does not reuse cached cinema permissions for a different account', async () => {
  const { status } = setup();
  const hook = renderHook(() => useCommunityCinema());
  await act(async () => {});
  expect(hook.result.current.status).toBeTruthy();
  act(() =>
    useCommunity.setState({
      user: {
        id: 'second',
        username: 'Second',
        displayName: 'Second',
        avatar: null,
      },
    }),
  );
  await act(async () => {});
  expect(status).toHaveBeenCalledTimes(2);
});

it('keeps the normal refresh cadence when status requests have latency', async () => {
  const { communityId, status } = setup();
  status.mockImplementation(async () => {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { communityId, hallChannelId: 'hall', isOwner: false, importing: null } as CinemaStatus;
  });
  renderHook(() => useCommunityCinema());
  await act(async () => vi.advanceTimersByTimeAsync(60_000));
  expect(status).toHaveBeenCalledTimes(2);
});
