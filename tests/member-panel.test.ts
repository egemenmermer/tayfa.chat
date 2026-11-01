import { describe, expect, it } from 'vitest';
import { docksMembers, memberPanel } from '../apps/desktop/src/member-panel';

const wide = { narrow: false, channel: true, settings: false, docked: true, drawerOpen: false };

describe('members panel placement', () => {
  it('stays docked beside a channel on a wide window until it is closed', () => {
    expect(memberPanel(wide)).toEqual({ docked: true, visible: true, toggles: 'docked' });
    // Closed: remembered off; the button opens it again in place.
    expect(memberPanel({ ...wide, docked: false })).toEqual({
      docked: false,
      visible: false,
      toggles: 'docked',
    });
  });

  it('uses the drawer on narrow windows and on pages without a channel', () => {
    expect(memberPanel({ ...wide, narrow: true })).toMatchObject({
      docked: false,
      visible: false,
      toggles: 'drawer',
    });
    expect(memberPanel({ ...wide, narrow: true, drawerOpen: true })).toMatchObject({
      visible: true,
    });
    // Sinema, games, home: never docked over them, the button still opens the drawer.
    expect(memberPanel({ ...wide, channel: false })).toMatchObject({
      docked: false,
      visible: false,
      toggles: 'drawer',
    });
    expect(memberPanel({ ...wide, channel: false, drawerOpen: true })).toMatchObject({
      visible: true,
    });
  });

  it('hides the docked panel behind Settings', () => {
    expect(memberPanel({ ...wide, settings: true })).toMatchObject({
      docked: false,
      visible: false,
    });
  });

  it('docks only beside text channels; voice rooms and streams keep their width (H11)', () => {
    expect(docksMembers('/chat', false)).toBe(true);
    expect(docksMembers('/chat', true)).toBe(false);
    expect(docksMembers('/voice', false)).toBe(false);
    expect(docksMembers('/cinema', false)).toBe(false);
  });
});
