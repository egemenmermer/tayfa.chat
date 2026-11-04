// @vitest-environment jsdom
import React, { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Avatar, IconButton, Modal } from '../packages/design-system/src/index';
afterEach(cleanup);

describe('dialog focus ownership', () => {
  it('keeps the current field focused when the parent recreates its close callback', () => {
    function Form() {
      const [value, setValue] = useState('');
      return (
        <Modal title="Form" onClose={() => {}}>
          <input aria-label="First" />
          <input aria-label="Second" value={value} onChange={(e) => setValue(e.target.value)} />
        </Modal>
      );
    }
    render(<Form />);
    const second = screen.getByLabelText('Second');
    second.focus();
    fireEvent.change(second, { target: { value: 'A' } });
    expect(document.activeElement).toBe(second);
  });
  it('skips disabled fields and includes links in the focus cycle', () => {
    render(
      <Modal title="Form" onClose={() => {}}>
        <input disabled aria-label="Disabled" />
        <a href="#help">Help</a>
        <button>Save</button>
      </Modal>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pencereyi kapat' }));
    screen.getByRole('button', { name: 'Save' }).focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Pencereyi kapat' }));
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Save' }));
  });
  it('uses the newest callback and restores the connected trigger on dismissal', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    const oldClose = vi.fn(),
      newClose = vi.fn();
    const view = render(
      <Modal title="Dialog" onClose={oldClose}>
        <button>Action</button>
      </Modal>,
    );
    view.rerender(
      <Modal title="Dialog" onClose={newClose}>
        <button>Action</button>
      </Modal>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(newClose).toHaveBeenCalledOnce();
    expect(oldClose).not.toHaveBeenCalled();
    view.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });
  it('lets only the topmost dialog dismiss on Escape even after the parent rerenders', () => {
    const outer = vi.fn(),
      inner = vi.fn();
    const tree = (close: () => void) => (
      <Modal title="Outer" onClose={close}>
        <Modal title="Inner" onClose={inner}>
          <button>Inner action</button>
        </Modal>
      </Modal>
    );
    const view = render(tree(outer));
    view.rerender(tree(() => outer()));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledOnce();
    expect(outer).not.toHaveBeenCalled();
  });
});

describe('avatar fallback', () => {
  it.each([
    ['  Sam   Lee ', 'SL'],
    ['👩🏽‍💻 Priya', '👩🏽‍💻P'],
    ['🦊 Fox', '🦊F'],
    ['', '?'],
    ['王秀英', '王'],
    ['dana', 'D'],
  ])('renders complete initials for %s', (name, initials) => {
    const { container } = render(<Avatar name={name} />);
    expect(container.querySelector('.avatar > span')?.textContent).toBe(initials);
    expect(container.querySelector('.avatar')?.className).not.toContain('undefined');
  });
  it('tolerates a missing name from a partial snapshot', () => {
    const { container } = render(<Avatar name={undefined} />);
    expect(container.querySelector('.avatar > span')?.textContent).toBe('?');
    expect(container.querySelector('.avatar')?.getAttribute('aria-label')).toBe('Kullanıcı');
  });
});

describe('IconButton shortcut hint', () => {
  it('keeps the plain native tooltip without a shortcut', () => {
    render(<IconButton label="Mikrofonu kapat" />);
    const button = screen.getByRole('button', { name: 'Mikrofonu kapat' });
    expect(button.getAttribute('title')).toBe('Mikrofonu kapat');
    expect(button.hasAttribute('data-shortcut')).toBe(false);
    expect(button.hasAttribute('aria-keyshortcuts')).toBe(false);
  });
  it('shows the key combination through the in-page tooltip and keeps the accessible name', () => {
    render(<IconButton label="Mikrofonu kapat" shortcut="⌘ Shift M" />);
    const button = screen.getByRole('button', { name: 'Mikrofonu kapat' });
    expect(button.hasAttribute('title')).toBe(false);
    expect(button.getAttribute('data-tip')).toBe('Mikrofonu kapat');
    expect(button.getAttribute('data-shortcut')).toBe('⌘ Shift M');
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Meta+Shift+M');
  });
});
