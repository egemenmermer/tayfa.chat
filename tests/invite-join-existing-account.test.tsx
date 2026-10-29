// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { InviteLanding, JoinWithInviteDialog } from '../apps/desktop/src/Invite';
import { defaultStartTab } from '../apps/desktop/src/ReferenceOnboarding';
import { useCommunity } from '../apps/desktop/src/community';
import { useRooms } from '../apps/desktop/src/store';

const token = 'c'.repeat(64);
const server = 'https://friends.example';
const inspectInvite = vi.fn(async (_server: string, code: string) => ({
  code,
  space: { id: 'dostlar', name: 'Dostlar' },
  channel: null,
  expiresAt: '2026-11-05T12:00:00.000Z',
}));
const acceptInvite = vi.fn(async (_code: string) => {
  // The store refreshes after a join; the new community is then in the list.
  useCommunity.setState({
    spaces: [
      { id: 'home', name: 'Ev', ownerId: 'me', icon: null },
      { id: 'dostlar', name: 'Dostlar', ownerId: 'friend', icon: null },
    ],
  });
});
const openSpace = vi.fn(async (_id: string) => {});

beforeEach(() => {
  inspectInvite.mockClear();
  acceptInvite.mockClear();
  openSpace.mockClear();
  (window as { rooms?: unknown }).rooms = { social: { inspectInvite } };
  useCommunity.setState({
    status: 'connected',
    busy: false,
    error: null,
    user: { id: 'me', username: 'me', displayName: 'Ben', avatar: null },
    serverUrl: `${server}/api`,
    spaces: [{ id: 'home', name: 'Ev', ownerId: 'me', icon: null }],
    acceptInvite,
    openSpace,
  });
});
afterEach(() => {
  cleanup();
  delete (window as { rooms?: unknown }).rooms;
  useRooms.getState().setPreference('serverUrl', '');
});

function Where() {
  return <output data-testid="path">{useLocation().pathname}</output>;
}
const landing = (invite: { serverUrl: string; code: string }) => {
  const onClose = vi.fn();
  const notify = vi.fn();
  render(
    <MemoryRouter initialEntries={['/home']}>
      <InviteLanding invite={invite} onClose={onClose} notify={notify} />
      <Where />
    </MemoryRouter>,
  );
  return { onClose, notify };
};

describe('an opened invite for a signed-in account', () => {
  it('joins the community with one click through the access join and opens it', async () => {
    const { onClose, notify } = landing({ serverUrl: server, code: token });
    expect(await screen.findByRole('heading', { name: 'Dostlar' })).toBeTruthy();
    expect(inspectInvite).toHaveBeenCalledWith(server, token);
    const join = screen.getByRole('button', { name: 'Daveti kabul et' });
    expect((join as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(join);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    // Only the code travels; the signed-in session's own server performs every check.
    expect(acceptInvite).toHaveBeenCalledTimes(1);
    expect(acceptInvite).toHaveBeenCalledWith(token);
    expect(notify).toHaveBeenCalledWith('Davet kabul edildi. Topluluğuna hoş geldin.');
    await waitFor(() => expect(openSpace).toHaveBeenCalledWith('dostlar'));
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/chat'));
  });

  it('never joins an invite from another server; it offers signing out instead', async () => {
    landing({ serverUrl: 'https://other.example', code: token });
    expect(await screen.findByRole('heading', { name: 'Dostlar' })).toBeTruthy();
    expect(screen.getByText(/Farklı bir sunucuda oturumun açık/)).toBeTruthy();
    const join = screen.getByRole('button', { name: 'Daveti kabul et' }) as HTMLButtonElement;
    expect(join.disabled).toBe(true);
    fireEvent.click(join);
    expect(acceptInvite).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Çıkış yap ve davetle devam et/ })).toBeTruthy();
  });

  it('shows the community list when the joined community is not known yet', async () => {
    acceptInvite.mockImplementationOnce(async () => {});
    const { onClose } = landing({ serverUrl: server, code: token });
    fireEvent.click(await screen.findByRole('button', { name: 'Daveti kabul et' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(openSpace).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/spaces'));
  });
});

describe('Davet bağlantısıyla katıl', () => {
  const dialog = () => {
    const onInvite = vi.fn();
    const onClose = vi.fn();
    render(<JoinWithInviteDialog onClose={onClose} onInvite={onInvite} />);
    const submit = (value: string) => {
      fireEvent.change(screen.getByLabelText('Davet bağlantısı'), { target: { value } });
      fireEvent.click(screen.getByRole('button', { name: 'Daveti aç' }));
    };
    return { onInvite, onClose, submit };
  };

  it('hands a pasted /davet link to the invite preview', () => {
    const { onInvite, onClose, submit } = dialog();
    submit(` ${server}/davet/${token}?utm_source=chat `);
    expect(onInvite).toHaveBeenCalledWith({ serverUrl: server, code: token });
    expect(onClose).toHaveBeenCalled();
    expect(acceptInvite).not.toHaveBeenCalled();
  });

  it('accepts a bare link token for the signed-in server', () => {
    const { onInvite, submit } = dialog();
    submit(token);
    expect(onInvite).toHaveBeenCalledWith({ serverUrl: `${server}/api`, code: token });
  });

  it('explains text that is not an invite link and keeps the dialog open', () => {
    const { onInvite, onClose, submit } = dialog();
    for (const value of ['merhaba', `http://friends.example/davet/${token}`, 'abc123']) {
      submit(value);
      expect(screen.getByRole('alert').textContent).toContain(
        'Bu bir Tayfa davet bağlantısı değil.',
      );
    }
    expect(onInvite).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('signed-out invite start tab', () => {
  const params = (serverUrl: string) => new URLSearchParams({ server: serverUrl, invite: token });

  it('opens Kayıt ol for a new device and Giriş yap where the invite server was used', () => {
    useCommunity.setState({ user: null });
    expect(defaultStartTab(params(server))).toBe('register');
    useRooms.getState().setPreference('serverUrl', `${server}/api`);
    expect(defaultStartTab(params(server))).toBe('signin');
    expect(defaultStartTab(params('https://other.example'))).toBe('register');
  });
});
