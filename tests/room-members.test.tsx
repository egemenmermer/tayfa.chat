// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { SocialMember } from '@rooms/social';
import { RoomMembers } from '../apps/desktop/src/RoomMembers';
import { useCommunity } from '../apps/desktop/src/community';
import { queryClient } from '../apps/desktop/src/query-client';
import {
  memberAccount,
  prefetchRoomMembers,
  roomMembersKey,
  ROOM_MEMBERS_STALE_MS,
} from '../apps/desktop/src/room-members';

const original = useCommunity.getState();
const me = { id: 'me', username: 'me', displayName: 'Me', avatar: null };
const member = (id: string, name: string): SocialMember => ({
  user: { id, username: id, displayName: name, avatar: null },
  status: 'online',
  statusText: null,
  roles: [],
});
function install(members: () => Promise<SocialMember[]>) {
  const fn = vi.fn(members);
  window.rooms = {
    social: { members: fn, avatar: vi.fn(async () => null) },
  } as unknown as NonNullable<Window['rooms']>;
  return fn;
}
const panel = () => (
  <MemoryRouter>
    <RoomMembers onClose={() => {}} notify={() => {}} />
  </MemoryRouter>
);
const key = roomMembersKey('https://rooms.example', 'me', 'space');
beforeEach(() => {
  queryClient.clear();
  useCommunity.setState({
    user: me,
    serverUrl: 'https://rooms.example',
    activeSpaceId: 'space',
    status: 'connected',
    presence: {},
  });
});
afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.useRealTimers();
  useCommunity.setState(original, true);
  delete window.rooms;
});

describe('room members panel', () => {
  it('renders cached members at once, without waiting for or repeating the network', () => {
    const members = install(() => new Promise<SocialMember[]>(() => {}));
    queryClient.setQueryData(key, [member('ayse', 'Ayşe'), member('can', 'Can')]);
    render(panel());
    expect(screen.getByText('Ayşe')).toBeTruthy();
    expect(screen.getByText('Can')).toBeTruthy();
    expect(screen.queryByText('Üyeler yükleniyor…')).toBeNull();
    expect(members).not.toHaveBeenCalled();
  });

  it('shows the loading state first, then members, and a second open reuses them', async () => {
    let resolve!: (rows: SocialMember[]) => void;
    const members = install(() => new Promise<SocialMember[]>((r) => (resolve = r)));
    const first = render(panel());
    expect(screen.getByText('Üyeler yükleniyor…')).toBeTruthy();
    await act(async () => resolve([member('ayse', 'Ayşe')]));
    expect(await screen.findByText('Ayşe')).toBeTruthy();
    first.unmount();
    render(panel());
    // The second open paints the known list immediately and does not call the network again.
    expect(screen.getByText('Ayşe')).toBeTruthy();
    expect(screen.queryByText('Üyeler yükleniyor…')).toBeNull();
    expect(members).toHaveBeenCalledTimes(1);
  });

  it('refreshes a stale list in the background while keeping the old rows visible', async () => {
    let call = 0;
    const members = install(async () =>
      ++call === 1 ? [member('ayse', 'Ayşe')] : [member('ayse', 'Ayşe'), member('can', 'Can')],
    );
    const first = render(panel());
    expect(await screen.findByText('Ayşe')).toBeTruthy();
    first.unmount();
    queryClient.setQueryData(key, queryClient.getQueryData(key), {
      updatedAt: Date.now() - ROOM_MEMBERS_STALE_MS - 1000,
    });
    render(panel());
    expect(screen.getByText('Ayşe')).toBeTruthy();
    expect(screen.queryByText('Üyeler yükleniyor…')).toBeNull();
    expect(await screen.findByText('Can')).toBeTruthy();
    expect(members).toHaveBeenCalledTimes(2);
  });

  it('keeps a failed load visible', async () => {
    install(async () => {
      throw new Error('NETWORK_UNAVAILABLE');
    });
    render(panel());
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('Üyeler yükleniyor…')).toBeNull();
  });

  it('prefetch warms the cache once and opening the panel then needs no request', async () => {
    const members = install(async () => [member('ayse', 'Ayşe')]);
    prefetchRoomMembers('https://rooms.example', 'me', 'space');
    prefetchRoomMembers('https://rooms.example', 'me', 'space');
    await waitFor(() => expect(queryClient.getQueryData(key)).toBeTruthy());
    render(panel());
    expect(screen.getByText('Ayşe')).toBeTruthy();
    expect(members).toHaveBeenCalledTimes(1);
  });
});

describe('member account for a voice participant', () => {
  it('finds the username and tag a friend request needs, or nothing', async () => {
    const { QueryClient } = await import('@tanstack/react-query');
    const client = new QueryClient();
    const load = vi.fn(async () => [
      {
        user: {
          id: 'u2',
          username: 'sedrado',
          displayName: 'sedrado',
          avatar: null,
          discriminator: '4821',
        },
        status: 'online',
        statusText: null,
        roles: [],
      } as SocialMember,
    ]);
    expect(await memberAccount('https://s', 'me', 'space', 'u2', client, load)).toMatchObject({
      username: 'sedrado',
      discriminator: '4821',
    });
    // The list is cached: a second profile does not refetch.
    expect(await memberAccount('https://s', 'me', 'space', 'nobody', client, load)).toBeNull();
    expect(load).toHaveBeenCalledTimes(1);
    const failing = vi.fn(async () => {
      throw new Error('offline');
    });
    expect(await memberAccount('https://s', 'me', 'other', 'u2', client, failing)).toBeNull();
    expect(await memberAccount('https://s', null, 'space', 'u2', client, load)).toBeNull();
  });
});
