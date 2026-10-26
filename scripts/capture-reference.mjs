import { chromium } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

// Capture the existing app's development fixture, never the reference prototype.
const [id = 'S10', variant = 'default', widthText = '1440', heightText = '900', route = '/chat'] =
  process.argv.slice(2);
const width = Number(widthText),
  height = Number(heightText);
const referenceRoutes = {
  S04: '/setup/recovery',
  S66: '/settings?tab=appearance',
  S67: '/settings?tab=desktop',
  S12: '/dm',
  S13: '/chat',
  S14: '/files',
  S15: '/chat',
  S16: '/notifications',
  S17: '/chat',
  S18: '/chat',
  S19: '/voice',
  S20: '/voice',
  S21: '/voice',
  S22: '/voice?view=share',
  S23: '/voice',
  S29: '/media?player=1',
  S59: '/settings?tab=agent',
  S60: '/settings?tab=connections',
  S61: '/settings?tab=room-memory',
  S62: '/settings?tab=schedules',
  S63: '/settings?tab=automation',
};
const insetPlayer = id === 'S36' || id === 'S39' || (id === 'S38' && variant === 'playing');
const targetRoute = insetPlayer
  ? '/media?player=1'
  : ['S33', 'S34', 'S35', 'S37', 'S38'].includes(id)
    ? '/media'
    : id === 'S30'
      ? '/chat'
      : (referenceRoutes[id] ?? route);
if (
  !/^S\d{2}$/.test(id) ||
  !/^[a-zA-Z0-9_-]+$/.test(variant) ||
  !Number.isInteger(width) ||
  !Number.isInteger(height)
)
  throw new Error('Invalid capture parameters');
const progress = JSON.parse(await readFile('docs/rooms-implementation/PROGRESS.json', 'utf8'));
const record = progress.records.find((r) => r.id === id && r.variant === variant);
if (!record) throw new Error('Capture must match an inventoried reference');
const directory = path.resolve('.local/design-review/evidence', `${id}-${variant}`);
await mkdir(directory, { recursive: true });
// In-process GPU: see the note in scripts/fixture-shots.mjs and docs/QA.md (macOS GPU child hang).
const browser = await chromium.launch({ headless: true, args: ['--in-process-gpu'] });
try {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 2,
    colorScheme: 'dark',
    locale: 'tr-TR',
    timezoneId: 'Europe/Amsterdam',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const fixtureId =
    [
      'S01',
      'S02',
      'S03',
      'S04',
      'S05',
      'S06',
      'S07',
      'S08',
      'S09',
      'S10',
      'S19',
      'S20',
      'S21',
      'S22',
      'S23',
      'S29',
      'S30',
      'S56',
      'S57',
      'S58',
      'S59',
      'S60',
      'S61',
      'S62',
      'S63',
      'S66',
      'S67',
      'S68',
      'S70',
      'S71',
      'S72',
    ].includes(id) ||
    /^S1[2-8]$/.test(id) ||
    /^S(4[0-9]|5[0-4]|7[3-5])$/.test(id)
      ? id
      : null;
  const personalFixture =
    ['S33', 'S34', 'S35', 'S37'].includes(id) || (id === 'S38' && variant !== 'playing');
  const exactFixtureId = personalFixture || insetPlayer ? id : fixtureId;
  if (!exactFixtureId)
    throw new Error(`Exact ${id}/${variant} fixture is not integrated; capture refused.`);
  const fixtureVariant = /^\d+x\d+$/.test(variant) || exactFixtureId !== id ? 'default' : variant;
  const url = `http://127.0.0.1:5173/?fixture=${exactFixtureId}&variant=${fixtureVariant}#${targetRoute}`;
  await page.goto(url);
  await page.locator('.app').waitFor();
  if (id === 'S67') {
    await page.getByRole('switch', { name: 'Bildirim sesleri', exact: true }).waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('[aria-label="Bu kanalı sessize al"]')?.getAttribute('disabled') ===
        null,
    );
    if (variant === 'tray')
      await page.getByRole('dialog', { name: 'Menü çubuğu', exact: true }).waitFor();
    await page.evaluate(() => document.activeElement?.blur());
  }
  if (id === 'S66') {
    await page.getByRole('slider', { name: 'Sohbet metni boyutu', exact: true }).waitFor();
    if (variant === 'compact')
      await page.getByRole('button', { name: 'Kompakt', exact: true }).click();
    if (variant === 'reduced') {
      await page.getByRole('switch', { name: 'Hareketi azalt', exact: true }).click();
      await page.getByRole('switch', { name: 'Şeffaflığı azalt', exact: true }).click();
    }
    if (variant === 'focus')
      await page.getByRole('button', { name: 'Odaklı düğme', exact: true }).focus();
  }
  if (id === 'S04') {
    if (variant === 'reset') {
      await page
        .getByRole('button', { name: 'Panodan kurtarma bağlantısını aktar', exact: true })
        .click();
      await page.getByLabel('Yeni şifre', { exact: true }).waitFor();
    }
    if (variant === 'sent') {
      await page.getByLabel('E-posta adresi', { exact: true }).fill('demo@example.test');
      await page.getByRole('button', { name: 'Kurtarma isteği gönder', exact: true }).click();
      await page.getByRole('status').filter({ hasText: 'İstek kabul edildi.' }).waitFor();
    }
    if (variant === 'expired')
      await page.getByRole('heading', { name: 'Yeniden giriş yap', exact: true }).waitFor();
  }
  if (insetPlayer) {
    await page.locator('.personal-playback-runtime.inset.foreground').waitFor();
    if (id === 'S36') await page.locator('.personal-programme-grid').waitFor();
    if (id === 'S39') await page.getByRole('dialog').waitFor();
  }
  if (personalFixture) {
    await page.locator('.ref-personal-media').waitFor();
    await page.waitForFunction(
      () =>
        !document.querySelector('.ref-personal-media')?.getAttribute('aria-busy')?.includes('true'),
    );
    if (id === 'S34' || id === 'S37') await page.getByRole('dialog').waitFor();
    if (id === 'S34' && variant === 'edit')
      await page.getByRole('dialog', { name: 'IPTV bağlantısını düzenle', exact: true }).waitFor();
    if (id === 'S34' && variant === 'remove')
      await page.getByRole('dialog', { name: /bağlantısını kaldır/ }).waitFor();
    if (id === 'S34' && ['checking', 'error'].includes(variant)) {
      await page.getByLabel('Bağlantı adı', { exact: true }).fill('DEV fixture · local demo');
      await page
        .getByLabel('Liste bağlantısı', { exact: true })
        .fill('https://provider.example.test/demo.m3u');
      await page.getByRole('button', { name: 'Doğrula ve ekle', exact: true }).click();
      if (variant === 'checking')
        await page
          .getByRole('status')
          .filter({ hasText: 'Kaynak ve kanal listesi doğrulanıyor' })
          .waitFor();
      else await page.getByRole('alert').filter({ hasText: 'DEV fixture' }).waitFor();
    }
    if (id === 'S37' && ['waiting', 'expired', 'cancelled', 'error'].includes(variant)) {
      await page.getByRole('button', { name: 'Bağlantıyı başlat', exact: true }).click();
      if (variant === 'error')
        await page.getByRole('alert').filter({ hasText: 'DEV fixture' }).waitFor();
      else if (variant === 'expired')
        await page.getByText('Yetkilendirme kodunun süresi doldu.', { exact: false }).waitFor();
      else {
        await page.locator('.ref-media-code').waitFor();
        if (variant === 'cancelled') {
          await page.getByRole('button', { name: 'Onay kontrolünü durdur', exact: true }).click();
          await page.getByText('Onay kontrolü durduruldu.', { exact: false }).waitFor();
        }
      }
    }
    if (id === 'S35') {
      await page.locator('.ref-media-browse').waitFor();
      if (variant === 'no_guide')
        await page.getByText('Bu bağlantıda program rehberi yok.', { exact: true }).waitFor();
      else if (variant === 'empty') {
        await page.getByLabel('Kanal ara', { exact: true }).fill('eşleşmeyen arama');
        await page.getByRole('heading', { name: 'Kanal bulunamadı', exact: true }).waitFor();
      } else await page.locator('.ref-media-current-program').first().waitFor();
    }
    if (id === 'S33')
      await page
        .getByText('Kayıtlı konumlar yükleniyor…', { exact: true })
        .waitFor({ state: 'hidden' });
    if (id === 'S38') {
      await page.locator('.ref-media-library,.ref-media-empty').waitFor();
      if (variant === 'details') {
        await page.getByRole('button', { name: 'Aç', exact: true }).first().click();
        await page.locator('.ref-media-detail').waitFor();
      }
    }
  }
  if (/^S(4[0-9]|5[0-2]|7[3-5])$/.test(id)) await page.locator('.rg-page').waitFor();
  if (id === 'S53' || id === 'S54') await page.locator('.rt-page').waitFor();
  if (id === 'S53' && variant === 'create')
    await page.getByRole('dialog', { name: 'Odaya bir soru sor' }).waitFor();
  if (id === 'S54' && variant === 'export')
    await page.getByRole('dialog', { name: 'Board’u PNG olarak indir' }).waitFor();
  if (/^S5[678]$/.test(id)) {
    await page.locator('.rat-layout').waitFor();
    if (id === 'S58' && ['default', 'unauthorized', 'uncertain'].includes(variant))
      await page.locator('.rat-modal').waitFor();
    if (id === 'S57' && variant !== 'empty' && variant !== 'sources')
      await page.waitForFunction(() => !document.querySelector('.rat-document [role="status"]'));
  }
  if (id === 'S29')
    await page.locator('.personal-playback-runtime.foreground .ref-personal-player').waitFor();
  if (id === 'S30') {
    await page
      .locator('.personal-playback-runtime.s30-mini-active .mini-playback-chrome')
      .waitFor();
    if (variant === 'live')
      await page
        .locator(
          '.personal-playback-runtime.s30-mini-active .mini-playback-chrome[aria-label="Canlı yayın küçük oynatıcı"]',
        )
        .waitFor();
  }
  if (id === 'S59') await page.locator('.reference-personal-models').waitFor();
  if (id === 'S60') await page.locator('.reference-app-connections').waitFor();
  if (id === 'S61') await page.locator('.reference-room-memory').waitFor();
  if (id === 'S62') await page.locator('.reference-agent.reference-schedules').waitFor();
  if (id === 'S63') {
    await page.locator('.reference-agent-automation .s63-status').waitFor();
    if (variant === 'confirm') await page.locator('.s63-modal').waitFor();
  }
  if (id === 'S68') {
    await page.locator('.rcm-page,.rcm-state:not([aria-busy="true"])').waitFor();
    if (['role', 'remove'].includes(variant)) await page.locator('.rcm-modal').waitFor();
  }
  if (id === 'S13') {
    await page.locator('.ss-search').waitFor();
    await page.keyboard.press('Shift+Tab');
  }
  if (id === 'S14' && variant === 'preview') await page.locator('.ss-preview').waitFor();
  if (id === 'S15') await page.locator('.ss-profile').waitFor();
  if (id === 'S17' || id === 'S18') await page.locator('.rcs-modal').waitFor();
  if (id === 'S70') {
    await page.locator('.reference-agent-management').waitFor();
    await page.getByRole('tab', { name: 'Yetkiler', exact: true }).waitFor();
    await page.waitForFunction(
      () => !document.querySelector('.reference-agent-management [role="status"]'),
    );
  }
  if (id === 'S71') {
    await page.locator('.reference-about').waitFor();
    await page.waitForFunction(() =>
      document.querySelector('.about-hero small')?.textContent?.includes('0.8.3'),
    );
  }
  if (id === 'S21') {
    await page.locator('.real-voice-dock').waitFor();
    await page.evaluate(() => window.dispatchEvent(new Event('rooms:choose-capture')));
    await page.locator('.reference-capture-modal').waitFor();
    if (variant === 'system_audio_unavailable')
      await page.locator('.reference-capture-grid>button').first().click();
  }
  if (id === 'S19' && variant === 'empty')
    await page.locator('.reference-voice-empty-stage').waitFor();
  if (id === 'S19' && variant === 'ptt') await page.getByText(/^Bas konuş açık · /).waitFor();
  if (id === 'S20' && variant === 'focus')
    await page.locator('.reference-participant-grid.focus-grid').waitFor();
  if (id === 'S22') {
    await page.locator('.reference-share-content').waitFor();
    if (variant === 'request' || variant === 'request_sent')
      await page.locator('.reference-share-intent-modal').waitFor();
  }
  if (id === 'S29') {
    if (variant === 'captions') await page.locator('.personal-reference-caption').waitFor();
    if (!(await page.evaluate(() => !!document.fullscreenElement))) {
      await page.getByRole('button', { name: 'Tam ekran', exact: true }).click();
      await page.waitForFunction(() => !!document.fullscreenElement);
    }
    await page.waitForFunction(
      () => document.documentElement.dataset.roomPlayerFullscreen === 'true',
    );
    if (variant === 'controls_hidden') {
      await page.waitForFunction(() =>
        document.querySelector('.ref-personal-player')?.classList.contains('idle'),
      );
    } else {
      await page.mouse.move(24, 24);
      await page.waitForFunction(
        () => !document.querySelector('.ref-personal-player')?.classList.contains('idle'),
      );
    }
    await page.waitForTimeout(120);
  }
  if (id === 'S59' && ['choose'].includes(variant))
    await page.locator('.s59-task-choice').waitFor();
  if (id === 'S61' && variant === 'source') await page.locator('.s61-modal').waitFor();
  if (id === 'S61' && variant === 'save') await page.locator('.s61-modal').waitFor();
  if (id === 'S61' && variant === 'delete') await page.locator('.s61-delete-modal').waitFor();
  if (id === 'S62' && variant === 'create')
    await page.locator('.s62-modal:not(.s62-cancel-modal)').waitFor();
  if (id === 'S62' && variant === 'cancel') await page.locator('.s62-cancel-modal').waitFor();
  if (id === 'S23') {
    await page
      .locator('.real-voice-dock')
      .getByRole('button', { name: 'Etkinlikler', exact: true })
      .click();
    await page.locator('.appdir-modal, .reference-launcher-modal').first().waitFor();
  }
  if ((id === 'S22' && ['request', 'request_sent'].includes(variant)) || id === 'S23') {
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
  }
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => Array.from(document.images).every((image) => image.complete));
  await page.screenshot({ path: path.join(directory, 'application.png'), animations: 'disabled' });
  const metrics = await page.evaluate(() => ({
    font: getComputedStyle(document.body).fontFamily,
    loadedInter: document.fonts.check('14px Inter'),
    fixture: document.documentElement.dataset.referenceFixture,
    roomPlayerFullscreen: document.documentElement.dataset.roomPlayerFullscreen === 'true',
    overflow: document.documentElement.scrollWidth > innerWidth,
    panels: Object.fromEntries(
      [
        'window-chrome',
        'space-rail',
        'voice-channel-sidebar',
        'friends-panel',
        'room-members-panel',
        'chat-heading',
      ].map((name) => {
        const el = document.querySelector(`.${name}`);
        const bounds = el?.getBoundingClientRect();
        return [
          name,
          bounds ? { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } : null,
        ];
      }),
    ),
  }));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const sourceFiles = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter(
      (file) =>
        /^(apps|packages|scripts)\//.test(file) ||
        /^(package.json|pnpm-lock.yaml|vite.config.ts)$/.test(file),
    )
    .sort();
  const sourceHashes = Object.fromEntries(
    await Promise.all(
      sourceFiles.map(async (file) => [
        file,
        createHash('sha256')
          .update(await readFile(file))
          .digest('hex'),
      ]),
    ),
  );
  const sourceManifestHash = createHash('sha256')
    .update(JSON.stringify(sourceHashes))
    .digest('hex');
  await writeFile(
    path.join(directory, 'source-manifest.json'),
    JSON.stringify(sourceHashes, null, 2) + '\n',
  );
  const diff = execFileSync('git', ['diff', '--binary'], { maxBuffer: 16 * 1024 * 1024 });
  const receipt = {
    id,
    variant,
    reference_path: record.reference_path,
    reference_hash: record.reference_hash,
    fixture: `${exactFixtureId}/${fixtureVariant}`,
    integration_status: 'LOCAL_FIXTURE',
    application_url: url,
    viewport: { width, height, device_scale_factor: 2 },
    revision,
    working_tree_diff_sha256: createHash('sha256').update(diff).digest('hex'),
    source_manifest_sha256: sourceManifestHash,
    timestamp: new Date().toISOString(),
    metrics,
    runtime_errors: errors,
    status: 'CAPTURED_NOT_VISUALLY_ACCEPTED',
  };
  await writeFile(path.join(directory, 'capture.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ directory, metrics, errors }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
}
