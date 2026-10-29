// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { ConnectionPane } from '../apps/desktop/src/ConnectionPane';
import { useCommunity } from '../apps/desktop/src/community';
import { useRooms } from '../apps/desktop/src/store';

const token = 'a'.repeat(64);
const inspectInvite = vi.fn(async (_server: string, code: string) => ({
  code,
  space: { id: 'space', name: 'Arkadaşlar' },
  channel: null,
  expiresAt: '2026-10-26T12:00:00.000Z',
}));
beforeEach(() => {
  inspectInvite.mockClear();
  (window as any).rooms = { social: { inspectInvite } };
  useRooms.getState().setPreference('serverUrl', '');
});
afterEach(() => {
  cleanup();
  delete (window as any).rooms;
});
const signedOut = (extra: Record<string, unknown> = {}) =>
  useCommunity.setState({ user: null, busy: false, error: null, ...extra });
const signsIn = () =>
  vi.fn(async () => {
    useCommunity.setState({
      user: { id: 'friend', username: 'Friend', displayName: 'Friend', avatar: null },
      busy: false,
    });
  });
const fillAccount = () => {
  fireEvent.change(screen.getByLabelText('Kullanıcı adı'), { target: { value: 'Friend' } });
  fireEvent.change(screen.getByLabelText('E-posta adresi'), {
    target: { value: 'friend@example.test' },
  });
  fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: 'unique-test-password' } });
};

it('signs up with a pasted invitation link; the link alone chooses the server', async () => {
  const done = vi.fn();
  const register = signsIn();
  signedOut({ register });
  render(
    <MemoryRouter>
      <ConnectionPane referenceMode="register" onAuthenticated={done} />
    </MemoryRouter>,
  );
  expect(screen.queryByLabelText('Sunucu adresi')).toBeNull();
  expect(screen.queryByText(/kod/i)).toBeNull();
  fireEvent.change(screen.getByLabelText('Davet bağlantısı'), {
    target: { value: ` https://community.example.test/davet/${token}?utm_source=chat ` },
  });
  expect(screen.getByText('Sunucu: community.example.test')).toBeTruthy();
  fillAccount();
  fireEvent.click(screen.getByRole('button', { name: /Hesap oluştur ve katıl/ }));
  await waitFor(() => expect(done).toHaveBeenCalledTimes(1));
  expect(register).toHaveBeenCalledWith({
    serverUrl: 'https://community.example.test',
    email: 'friend@example.test',
    password: 'unique-test-password',
    username: 'Friend',
    inviteCode: token,
  });
  expect(useRooms.getState().preferences.serverUrl).toBe('https://community.example.test');
});

it('explains a pasted value that is not an invitation link and keeps signup closed', () => {
  signedOut({ register: vi.fn() });
  render(
    <MemoryRouter>
      <ConnectionPane referenceMode="register" />
    </MemoryRouter>,
  );
  const field = screen.getByLabelText('Davet bağlantısı');
  fireEvent.change(field, { target: { value: 'https://example.test/not-an-invite' } });
  fillAccount();
  expect(screen.getByText(/Bu bir Tayfa davet bağlantısı değil/)).toBeTruthy();
  expect(field.getAttribute('aria-invalid')).toBe('true');
  expect(
    (screen.getByRole('button', { name: /Hesap oluştur ve katıl/ }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('hides the link field when the app was opened from an invitation link', async () => {
  const register = signsIn();
  signedOut({ register });
  render(
    <MemoryRouter
      initialEntries={[`/setup/register?server=https%3A%2F%2Ffriends.example&invite=${token}`]}
    >
      <ConnectionPane referenceMode="register" onAuthenticated={() => {}} />
    </MemoryRouter>,
  );
  expect(screen.queryByLabelText('Davet bağlantısı')).toBeNull();
  expect(await screen.findByRole('heading', { name: 'Arkadaşlar' })).toBeTruthy();
  expect(inspectInvite).toHaveBeenCalledWith('https://friends.example', token);
  fillAccount();
  fireEvent.click(screen.getByRole('button', { name: /Hesap oluştur ve katıl/ }));
  await waitFor(() =>
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ serverUrl: 'https://friends.example', inviteCode: token }),
    ),
  );
});

it('lets someone replace the invitation they arrived with', async () => {
  signedOut({ register: vi.fn() });
  render(
    <MemoryRouter
      initialEntries={[`/setup/register?server=https%3A%2F%2Ffriends.example&invite=${token}`]}
    >
      <ConnectionPane referenceMode="register" />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Arkadaşlar' });
  fireEvent.click(screen.getByRole('button', { name: 'Başka bir davet bağlantısı kullan' }));
  expect(screen.getByLabelText('Davet bağlantısı')).toBeTruthy();
});

it('sends someone who already has an account to Giriş yap with the same invitation', async () => {
  signedOut({ register: vi.fn() });
  const search = `?server=https%3A%2F%2Ffriends.example&invite=${token}`;
  function Where() {
    const location = useLocation();
    return <output data-testid="where">{location.pathname + location.search}</output>;
  }
  render(
    <MemoryRouter initialEntries={[`/setup/register${search}`]}>
      <ConnectionPane referenceMode="register" />
      <Where />
    </MemoryRouter>,
  );
  await screen.findByRole('heading', { name: 'Arkadaşlar' });
  fireEvent.click(screen.getByRole('button', { name: /Zaten hesabın var mı\? Giriş yap/ }));
  await waitFor(() =>
    expect(screen.getByTestId('where').textContent).toBe(`/setup/signin${search}`),
  );
});

it('signs in on the invitation server and then joins the community', async () => {
  const connect = signsIn();
  const acceptInvite = vi.fn(async () => {});
  signedOut({ connect, acceptInvite });
  render(
    <MemoryRouter
      initialEntries={[`/setup/signin?server=https%3A%2F%2Ffriends.example&invite=${token}`]}
    >
      <ConnectionPane referenceMode="signin" onAuthenticated={() => {}} />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText('Giriş yaptıktan sonra Arkadaşlar topluluğuna katılacaksın.'),
  ).toBeTruthy();
  expect(screen.getByText('Sunucu: friends.example')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('E-posta adresi'), {
    target: { value: 'friend@example.test' },
  });
  fireEvent.change(screen.getByLabelText('Şifre'), { target: { value: 'unique-test-password' } });
  fireEvent.click(screen.getByRole('button', { name: /Giriş yap ve katıl/ }));
  await waitFor(() => expect(acceptInvite).toHaveBeenCalledWith(token));
  expect(connect).toHaveBeenCalledWith({
    serverUrl: 'https://friends.example',
    email: 'friend@example.test',
    password: 'unique-test-password',
  });
});

it('points signed-out people to the start tabs instead of a second form', () => {
  signedOut();
  render(
    <MemoryRouter>
      <ConnectionPane />
    </MemoryRouter>,
  );
  expect(screen.getByRole('button', { name: /Giriş yap/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Kayıt ol' })).toBeTruthy();
  expect(screen.queryByRole('textbox')).toBeNull();
});
