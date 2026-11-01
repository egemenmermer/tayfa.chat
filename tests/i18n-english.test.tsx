// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

beforeEach(() => {
  vi.resetModules();
  globalThis.__roomsLocale = 'en';
});
afterEach(() => {
  cleanup();
  globalThis.__roomsLocale = 'tr';
});

it('renders the language picker in English when English is chosen', async () => {
  const { LanguageSetting } = await import('../apps/desktop/src/LanguageSetting');
  render(<LanguageSetting />);
  expect(screen.getByRole('heading', { name: 'Language / Dil' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'System language' })).toBeTruthy();
  expect(screen.getByRole('option', { name: 'Türkçe' })).toBeTruthy();
  expect(document.documentElement.lang).toBe('en');
});

it('translates server error codes for English readers', async () => {
  const { uiError, locale, localeLanguage } = await import('../apps/desktop/src/i18n');
  // The Intl tag carries the clock (H12); without a system region English uses 12 hours.
  expect(locale).toBe('en-US-u-hc-h12');
  expect(localeLanguage).toBe('en');
  expect(uiError(new Error('SOME_UNKNOWN_CODE'))).toBe(
    'The action could not be completed. Try again.',
  );
  expect(uiError(new Error('Approved sign-up is not enabled for this community.'))).toBe(
    'Sign-up without an invite isn’t enabled for this community.',
  );
});

it('shows approved sign-up requests in English', async () => {
  const { CommunitySignupRequestsTab } =
    await import('../apps/desktop/src/CommunitySignupRequestsTab');
  const bridge = {
    signupRequests: vi.fn(async () => ({
      enabled: true,
      requests: [
        { id: 'r1', username: 'ada', createdAt: '2026-10-20T10:00:00.000Z', state: 'pending' },
        { id: 'r2', username: 'lin', createdAt: '2026-10-20T11:00:00.000Z', state: 'approved' },
      ],
    })),
    decideSignupRequest: vi.fn(async () => {}),
  } as const;
  render(
    <CommunitySignupRequestsTab
      spaceId="SPACE"
      capability={{ managementSupported: true } as never}
      bridge={bridge as never}
    />,
  );
  expect(await screen.findByText('Pending')).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Sign-up requests' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Approve again' })).toBeTruthy();
  expect(document.body.textContent).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
});

it('keys the stale Stremio source reload on the error code, not on Turkish text', async () => {
  const { cinemaErrorCode, cinemaErrorText } =
    await import('../apps/desktop/src/cinema/cinema-bridge');
  const stale = new Error('Error invoking remote method: CINEMA_STREMIO_STREAM_EXPIRED');
  expect(cinemaErrorText(stale)).toBe('The source list is out of date. Reload the sources.');
  expect(cinemaErrorCode(stale)).toBe('CINEMA_STREMIO_STREAM_EXPIRED');
});
