// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CommunityEditor } from '../apps/desktop/src/CommunitySettings';
import { useCommunity } from '../apps/desktop/src/community';

vi.mock('../apps/desktop/src/realtime', () => ({
  useRealtime: () => ({ participants: [], status: 'idle' }),
}));

const space = { id: 'new-space', name: 'Tayfa', ownerId: 'me', icon: null } as never;
const createInvite = vi.fn(async (channelId: string) => ({
  code: `code-${channelId}`,
  expiresAt: null,
  maxUses: null,
}));

afterEach(cleanup);
beforeEach(() => {
  vi.clearAllMocks();
  useCommunity.setState({
    serverUrl: 'https://local.example',
    // The community that was open before; its channel must never get the new invite.
    channels: [{ id: 'old-general', spaceId: 'old-space', name: 'genel', type: 0, topic: null }],
    createInvite: createInvite as never,
  });
});

it('shows no unfinished controls when the connection reports no description or visibility', () => {
  render(<CommunityEditor mode="create" onClose={() => {}} onSave={async () => space} />);
  expect(screen.getByRole('heading', { name: 'Topluluk oluştur' })).toBeTruthy();
  expect(screen.queryByText('İkon değiştir')).toBeNull();
  expect(screen.queryByText('Kısa açıklama')).toBeNull();
  expect(screen.queryByText(/Görünürlük|görünürlüğü/)).toBeNull();
  expect(screen.queryByText(/henüz/)).toBeNull();
  expect(document.querySelector('input:disabled')).toBeNull();
});

it('shows a known description as text and a known visibility policy', () => {
  render(
    <CommunityEditor
      mode="create"
      description="Cuma akşamları"
      inviteOnly
      onClose={() => {}}
      onSave={async () => space}
    />,
  );
  expect(screen.getByText('Cuma akşamları')).toBeTruthy();
  expect(screen.getByText('Yalnızca davetle')).toBeTruthy();
});

it('explains why creating is unavailable without a connection', () => {
  render(<CommunityEditor mode="create" onClose={() => {}} />);
  expect(
    screen.getByText('Topluluk oluşturmak ve düzenlemek için önce sunucuna bağlan.'),
  ).toBeTruthy();
  expect(
    (screen.getByRole('button', { name: 'Topluluğu oluştur' }) as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('offers an invite for the new community once its own text channel has loaded', async () => {
  const onSaved = vi.fn();
  render(
    <CommunityEditor
      mode="create"
      onClose={() => {}}
      onSave={async (name) => ({ ...(space as object), name }) as never}
      onSaved={onSaved}
    />,
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Topluluk adı' }), {
    target: { value: 'Tayfa' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Topluluğu oluştur' }));
  await screen.findByRole('heading', { name: 'Topluluğun hazır' });
  expect(onSaved).toHaveBeenCalledOnce();
  expect(screen.getByRole('button', { name: 'Bitti' })).toBeTruthy();
  // The previous community's channels are still loaded: no invite button yet.
  expect(screen.queryByRole('button', { name: 'Davet oluştur' })).toBeNull();

  act(() =>
    useCommunity.setState({
      channels: [
        { id: 'voice', spaceId: 'new-space', name: 'Ses', type: 2, topic: null },
        { id: 'general', spaceId: 'new-space', name: 'genel', type: 0, topic: null },
      ],
    }),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Davet oluştur' }));
  await waitFor(() => expect(createInvite).toHaveBeenCalledWith('general'));
  expect(await screen.findByDisplayValue(/code-general/)).toBeTruthy();
});

it('keeps the finished state when the app opens the new community', async () => {
  const oldSpace = { id: 'old-space', name: 'Dostlar', ownerId: 'me', icon: null } as never;
  const onSave = vi.fn(async () => space);
  const editor = (open: never) => (
    <CommunityEditor mode="create" space={open} onClose={() => {}} onSave={onSave} />
  );
  // The app passes whichever community is open; it switches to the new one after saving.
  const { rerender } = render(editor(oldSpace));
  expect((screen.getByRole('textbox', { name: 'Topluluk adı' }) as HTMLInputElement).value).toBe(
    '',
  );
  fireEvent.change(screen.getByRole('textbox', { name: 'Topluluk adı' }), {
    target: { value: 'Tayfa' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Topluluğu oluştur' }));
  await screen.findByRole('heading', { name: 'Topluluğun hazır' });
  rerender(editor(space));
  expect(screen.getByRole('heading', { name: 'Topluluğun hazır' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Topluluğu oluştur' })).toBeNull();
  expect(onSave).toHaveBeenCalledOnce();
});
