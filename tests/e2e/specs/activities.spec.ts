import { test, expect } from '../support/fixtures';
import type { RoomsClient } from '../support/client';
import { VoiceView } from '../support/pages/voice';
import { createChannel, uniqueText } from '../support/seed';

// First loads are immediate; this only absorbs Electron and upstream jitter.
const firstLoad = { timeout: 10000 };

async function openPolls(client: RoomsClient, room: string) {
  await new VoiceView(client).join(room);
  await client.goto('/together');
  await expect(client.page.getByRole('heading', { name: 'Anketler' })).toBeVisible();
}

test.describe('shared room activities', () => {
  test('a poll is created, voted on and counted for both members', async ({
    owner,
    guest,
    run,
  }) => {
    test.setTimeout(180000);
    const room = await createChannel(
      run.owner,
      run.space.id,
      uniqueText('anket').replace(' ', '-'),
      true,
    );
    await expect(owner.nav.getByRole('button', { name: room.name, exact: true })).toBeVisible();
    await openPolls(owner, room.name);
    await openPolls(guest, room.name);

    const question = `Akşam ne yapalım ${run.runId}?`;
    await owner.page.getByRole('button', { name: 'Yeni anket' }).first().click(firstLoad);
    const form = owner.page.getByRole('dialog');
    await form.getByLabel('Soru').fill(question);
    await form.getByLabel('Seçenek 1').fill('Film');
    await form.getByLabel('Seçenek 2').fill('Oyun');
    await form.getByRole('button', { name: 'Anketi başlat' }).click();
    await expect(owner.page.getByRole('heading', { name: question })).toBeVisible();

    await expect(guest.page.getByRole('heading', { name: question })).toBeVisible(firstLoad);
    await guest.page.getByRole('button', { name: /Oyun/ }).filter({ hasText: 'oy' }).click();
    await expect(owner.page.getByText('1 kişi oy verdi')).toBeVisible();
    await expect(
      owner.page.getByRole('button', { name: /Oyun/ }).filter({ hasText: '1 oy' }),
    ).toBeVisible();
  });

  test('the activity view of a new room loads promptly', async ({ owner, run }) => {
    // Regression: the first observe() call used to long-poll with afterRevision=0, so a
    // never-used room (revision 0) showed "Oda getiriliyor…" for the full 20 s window.
    const room = await createChannel(
      run.owner,
      run.space.id,
      uniqueText('bos-oda').replace(' ', '-'),
      true,
    );
    await expect(owner.nav.getByRole('button', { name: room.name, exact: true })).toBeVisible();
    await openPolls(owner, room.name);
    await expect(owner.page.getByText('Oda getiriliyor…')).toHaveCount(0, { timeout: 5000 });
  });

  test('a member can start a poll in a fresh voice room', async ({ owner, run }) => {
    // Regression: "Yeni anket" used to require an existing activity participant record, but the
    // client joins only inside send() and the service prunes participants idle for 30 s, so
    // nobody (not even the owner) could open the poll form in a fresh or idle room.
    const room = await createChannel(
      run.owner,
      run.space.id,
      uniqueText('anketsiz').replace(' ', '-'),
      true,
    );
    await expect(owner.nav.getByRole('button', { name: room.name, exact: true })).toBeVisible();
    await openPolls(owner, room.name);
    await expect(owner.page.getByRole('button', { name: 'Yeni anket' }).first()).toBeEnabled(
      firstLoad,
    );
  });

  test('the game hall offers every table game in a voice room', async ({ owner, run }) => {
    await new VoiceView(owner).join(run.channels.voice.name);
    await owner.goto('/games');
    const hall = owner.page.getByRole('region', { name: 'Oyunlar' });
    await expect(hall).toBeVisible();
    for (const game of ['Texas Hold’em', 'Blackjack', 'Batak', '101 Okey']) {
      const card = hall
        .getByRole('article')
        .filter({ has: owner.page.getByRole('heading', { name: game }) });
      await expect(card.getByRole('button', { name: 'Masa aç' })).toBeEnabled(firstLoad);
    }
  });
});
