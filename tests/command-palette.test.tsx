// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { CommandPalette } from '../apps/desktop/src/CommandPalette';
import {
  foldSearch,
  friendlyActionError,
  shortcutRoutes,
} from '../apps/desktop/src/shell-commands';

afterEach(cleanup);

function Where() {
  const location = useLocation();
  return <output data-testid="where">{location.pathname + location.search}</output>;
}

function show() {
  const onClose = vi.fn();
  render(
    <MemoryRouter initialEntries={['/home']}>
      <CommandPalette onClose={onClose} />
      <Where />
    </MemoryRouter>,
  );
  return { onClose, input: screen.getByRole('combobox') };
}

const labels = () => screen.getAllByRole('option').map((option) => option.textContent);

it('lists the destinations under the names the sidebar and launcher use', () => {
  show();
  const text = labels().join('|');
  for (const name of [
    'Mesajlar',
    'Arkadaşlar',
    'Bildirimler',
    'Dosyalar',
    'Oyunlar',
    'Beyaz tahta',
    'Anketler',
    'Asistan',
  ])
    expect(text).toContain(name);
  expect(text).not.toContain('Oyun masası');
  expect(text).not.toContain('Ortak tahta ve anketler');
});

it('opens direct messages, not the channel chat, for Mesajlar', () => {
  const { onClose } = show();
  fireEvent.click(screen.getByRole('option', { name: /^Mesajlar/ }));
  expect(screen.getByTestId('where').textContent).toBe('/messages');
  expect(onClose).toHaveBeenCalled();
});

it('moves the active option with the arrow keys and opens it with Enter', () => {
  const { input } = show();
  const options = screen.getAllByRole('option');
  expect(options[0]!.getAttribute('aria-selected')).toBe('true');
  expect(input.getAttribute('aria-activedescendant')).toBe(options[0]!.id);
  fireEvent.keyDown(input, { key: 'ArrowDown' });
  expect(input.getAttribute('aria-activedescendant')).toBe(options[1]!.id);
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  fireEvent.keyDown(input, { key: 'ArrowUp' });
  // Wraps from the first option to the last.
  expect(input.getAttribute('aria-activedescendant')).toBe(options.at(-1)!.id);
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByTestId('where').textContent).toBe('/settings');
});

it('still finds the Games page under its old name', () => {
  const { input } = show();
  for (const old of ['kıraathane', 'kiraathane', 'KIRAATHANE']) {
    fireEvent.change(input, { target: { value: old } });
    expect(labels()).toHaveLength(1);
    expect(labels()[0]).toContain('Oyunlar');
  }
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByTestId('where').textContent).toBe('/games');
});

it('matches Turkish dotted and dotless i in either case', () => {
  const { input } = show();
  fireEvent.change(input, { target: { value: 'KIRAATHANE' } });
  expect(labels()).toHaveLength(1);
  expect(labels()[0]).toContain('Oyunlar');
  fireEvent.change(input, { target: { value: 'bİldİrİm' } });
  expect(labels()[0]).toContain('Bildirimler');
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByTestId('where').textContent).toBe('/notifications');
});

it('says so when nothing matches', () => {
  const { input } = show();
  fireEvent.change(input, { target: { value: 'zzzz' } });
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  expect(screen.getByText('Sonuç bulunamadı')).toBeTruthy();
  expect(input.getAttribute('aria-activedescendant')).toBeNull();
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(screen.getByTestId('where').textContent).toBe('/home');
});

it('maps ⌘2 to direct messages and lists each shortcut by name', () => {
  expect(shortcutRoutes.map((route) => route.path)).toEqual([
    '/home',
    '/messages',
    '/chat',
    '/voice',
    '/cinema',
  ]);
  expect(shortcutRoutes[1]!.label).toBe('Mesajlar');
});

it('folds case and marks for search', () => {
  expect(foldSearch('İçerik')).toBe(foldSearch('icerik'));
  expect(foldSearch('Işık')).toBe('isik');
});

it('never shows raw error text in a toast', () => {
  const fallback = 'Mikrofon değiştirilemedi.';
  expect(
    friendlyActionError(new Error('NotReadableError: Could not start audio source'), fallback),
  ).toBe(fallback);
  expect(
    friendlyActionError(
      new Error("Error invoking remote method 'x': Error: socket hang up"),
      fallback,
    ),
  ).toBe(fallback);
  expect(friendlyActionError(new Error(''), fallback)).toBe(fallback);
  expect(friendlyActionError(new Error('SOME_UNKNOWN_CODE'), fallback)).toBe(fallback);
  // A service code with its own Turkish explanation keeps that explanation.
  expect(friendlyActionError(new Error('INVALID_COMMAND'), fallback)).toContain('etkinlik servisi');
});
