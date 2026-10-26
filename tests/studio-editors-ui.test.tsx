// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { useSyncExternalStore } from 'react';
import { applyOps, createProject, defaultTrack } from '@rooms/studio';
import { FakeEditorStore } from '../apps/desktop/src/studio/editors/fake-port';
import { StudioEditors } from '../apps/desktop/src/studio/editors/StudioEditors';

beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
});
afterEach(cleanup);

function setup(options: { canEdit?: boolean; clip?: string } = {}) {
  const doc = applyOps(
    createProject({
      id: 'p',
      roomId: 'r',
      name: 'Demo',
      createdBy: 'u',
      createdAt: 1,
      template: 'drums-bass',
    }),
    [{ op: 'track.create', track: defaultTrack('audio', 'audio') }],
  ).doc;
  const store = new FakeEditorStore(doc, { canEdit: options.canEdit ?? true });
  let next = 0;
  function Harness() {
    const port = useSyncExternalStore(store.subscribe, store.getPort);
    return (
      <>
        <input aria-label="name" />
        <StudioEditors
          port={port}
          newId={() => `id${(next += 1)}`}
          initialClipId={options.clip ?? null}
        />
      </>
    );
  }
  render(<Harness />);
  return store;
}

describe('Studio editors UI with a fake store', () => {
  it('toggles a drum step from the keyboard as one batch and previews the sound', () => {
    const store = setup({ clip: 'tpl-drums-clip' });
    const cell = screen.getByRole('gridcell', { name: 'El çırpma, adım 5' });
    expect(cell.getAttribute('aria-pressed')).toBe('false');
    fireEvent.keyDown(cell, { key: 'Enter' });
    expect(store.batches).toHaveLength(1);
    expect(store.batches[0][0]).toMatchObject({
      op: 'note.create',
      note: { pitch: 39, startBeat: 1 },
    });
    expect(store.previews).toEqual([{ trackId: 'tpl-drums', pitch: 39, velocity: 100 }]);
    expect(
      screen.getByRole('gridcell', { name: 'El çırpma, adım 5' }).getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('paints several steps with one drag and commits once on release', () => {
    const store = setup({ clip: 'tpl-drums-clip' });
    const at = (step: number) => screen.getByRole('gridcell', { name: `Rim, adım ${step}` });
    fireEvent.pointerDown(at(1), { button: 0 });
    fireEvent.pointerEnter(at(2));
    fireEvent.pointerEnter(at(3));
    expect(store.batches).toHaveLength(0);
    act(() => {
      window.dispatchEvent(new Event('pointerup'));
    });
    return Promise.resolve().then(() => {
      expect(store.batches).toHaveLength(1);
      expect(store.batches[0].map((op) => op.op)).toEqual([
        'note.create',
        'note.create',
        'note.create',
      ]);
    });
  });

  it('selects all clips with Cmd/Ctrl+A and deletes them with Delete', () => {
    const store = setup();
    const timeline = screen.getByRole('application', { name: 'Düzenleme zaman çizelgesi' });
    fireEvent.keyDown(timeline, { key: 'a', metaKey: true, ctrlKey: true });
    fireEvent.keyDown(timeline, { key: 'Delete' });
    expect(store.batches).toEqual([
      [
        { op: 'clip.delete', id: 'tpl-drums-clip' },
        { op: 'clip.delete', id: 'tpl-bass-clip' },
      ],
    ]);
  });

  it('never acts on keys typed into an input', () => {
    const store = setup({ clip: 'tpl-bass-clip' });
    const input = screen.getByLabelText('name');
    fireEvent.keyDown(input, { key: 'Backspace' });
    fireEvent.keyDown(input, { key: 'a', metaKey: true, ctrlKey: true });
    expect(store.batches).toHaveLength(0);
  });

  it('nudges and duplicates selected piano-roll notes with the keyboard', () => {
    const store = setup({ clip: 'tpl-bass-clip' });
    const roll = screen.getByRole('application', { name: 'Piyano rulosu' });
    fireEvent.keyDown(roll, { key: 'a', metaKey: true, ctrlKey: true });
    fireEvent.keyDown(roll, { key: 'ArrowUp' });
    expect(store.batches).toHaveLength(1);
    expect(store.batches[0].every((op) => op.op === 'note.set' && op.field === 'pitch')).toBe(true);
    fireEvent.keyDown(roll, { key: 'd', metaKey: true, ctrlKey: true });
    expect(store.batches[1].filter((op) => op.op === 'note.create')).toHaveLength(20);
    expect(store.skipped).toEqual([]);
    expect(store.selection.clipId).toBe('tpl-bass-clip');
  });

  it('is read-only without edit rights and says so', () => {
    const store = setup({ canEdit: false, clip: 'tpl-drums-clip' });
    expect(screen.getByText('Salt okunur')).toBeTruthy();
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Kick, adım 1' }), { key: 'Enter' });
    const timeline = screen.getByRole('application', { name: 'Düzenleme zaman çizelgesi' });
    fireEvent.keyDown(timeline, { key: 'a', metaKey: true, ctrlKey: true });
    fireEvent.keyDown(timeline, { key: 'Delete' });
    expect(store.batches).toHaveLength(0);
  });
});
