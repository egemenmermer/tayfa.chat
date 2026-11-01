// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { isRoomMuteShortcut } from '../apps/desktop/src/shell-commands';

const key = (overrides: Partial<KeyboardEvent> = {}) =>
  ({
    key: 'M',
    code: 'KeyM',
    ctrlKey: true,
    metaKey: false,
    shiftKey: true,
    altKey: false,
    repeat: false,
    defaultPrevented: false,
    ...overrides,
  }) as KeyboardEvent;

describe('room mute shortcut', () => {
  it('matches Ctrl Shift M on Windows and Cmd Shift M on macOS', () => {
    expect(isRoomMuteShortcut(key())).toBe(true);
    expect(isRoomMuteShortcut(key({ ctrlKey: false, metaKey: true }))).toBe(true);
  });

  it('matches by layout letter or by physical key', () => {
    expect(isRoomMuteShortcut(key({ code: 'Semicolon', key: 'M' }))).toBe(true);
    expect(isRoomMuteShortcut(key({ key: 'Ö' }))).toBe(true);
  });

  it('works while the message composer has focus', () => {
    const composer = document.createElement('textarea');
    document.body.append(composer);
    const event = new KeyboardEvent('keydown', {
      key: 'M',
      code: 'KeyM',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
    });
    let matched = false;
    const listener = (e: KeyboardEvent) => (matched = isRoomMuteShortcut(e));
    window.addEventListener('keydown', listener);
    composer.dispatchEvent(event);
    window.removeEventListener('keydown', listener);
    composer.remove();
    expect(matched).toBe(true);
  });

  it('ignores AltGr, key repeat, missing modifiers and swallowed events', () => {
    expect(isRoomMuteShortcut(key({ altKey: true }))).toBe(false);
    expect(isRoomMuteShortcut(key({ repeat: true }))).toBe(false);
    expect(isRoomMuteShortcut(key({ shiftKey: false }))).toBe(false);
    expect(isRoomMuteShortcut(key({ ctrlKey: false }))).toBe(false);
    expect(isRoomMuteShortcut(key({ defaultPrevented: true }))).toBe(false);
    expect(isRoomMuteShortcut(key({ key: 'K', code: 'KeyK' }))).toBe(false);
  });
});
