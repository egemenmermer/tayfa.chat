// @vitest-environment jsdom
import { StrictMode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  applyOps,
  createProject,
  defaultTrack,
  type StudioOp,
  type StudioProject,
} from '@rooms/studio';
import type { StudioProjectList } from '../packages/shared-contracts/src/studio';
import {
  formatPosition,
  parseTempo,
  projectBars,
  trackDisplayName,
} from '../apps/desktop/src/studio/ui/music';
import type { StudioEditorModel, StudioProjectsApi } from '../apps/desktop/src/studio/ui/model';
import { ProjectList } from '../apps/desktop/src/studio/ui/ProjectList';
import { StudioEditor } from '../apps/desktop/src/studio/ui/StudioEditor';
import { TrackHeaders } from '../apps/desktop/src/studio/ui/TrackHeaders';
import type { StudioTransport } from '../apps/desktop/src/studio/ui/transport';
import { useOwnedTransport } from '../apps/desktop/src/studio/ui/use-owned-transport';

// jsdom lacks these; React Aria overlays and the BoardUI menus use them.
class NoopResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', NoopResizeObserver);
if (!globalThis.CSS?.escape)
  vi.stubGlobal('CSS', {
    ...globalThis.CSS,
    escape: (value: string) => value.replace(/[^\w-]/g, '\\$&'),
  });

afterEach(() => cleanup());

const NOW = 1_800_000_000_000;

describe('Studio time helpers', () => {
  it('reads bar:beat in time-signature units', () => {
    expect(formatPosition(0, { beats: 4, unit: 4 })).toBe('1:1');
    expect(formatPosition(5, { beats: 4, unit: 4 })).toBe('2:2');
    expect(formatPosition(3.9999999, { beats: 4, unit: 4 })).toBe('2:1');
    // 6/8: a bar is three quarter beats and has six eighth-note units.
    expect(formatPosition(1.5, { beats: 6, unit: 8 })).toBe('1:4');
    expect(formatPosition(3, { beats: 6, unit: 8 })).toBe('2:1');
    expect(projectBars(16, { beats: 4, unit: 4 })).toBe(4);
    expect(projectBars(16, { beats: 6, unit: 8 })).toBe(6);
  });
  it('clamps tempo text and labels unnamed tracks', () => {
    expect(parseTempo('300')).toBe(240);
    expect(parseTempo('12')).toBe(40);
    expect(parseTempo('98,6')).toBe(99);
    expect(parseTempo('abc')).toBeNull();
    expect(trackDisplayName({ name: '', kind: 'drums' }, 2)).toBe('Davul 2');
    expect(trackDisplayName({ name: 'Bas hattı', kind: 'instrument' }, 1)).toBe('Bas hattı');
  });
});

function list(overrides: Partial<StudioProjectList> = {}): StudioProjectList {
  return {
    protocolVersion: 1,
    access: { canCreate: true },
    projects: [
      {
        id: 'old',
        name: 'Eski',
        createdBy: 'me',
        createdAt: 1,
        updatedAt: NOW - 3 * 86_400_000,
        tempo: 90,
        tracks: 1,
      },
      {
        id: 'new',
        name: 'Yeni',
        createdBy: 'u2',
        createdAt: 2,
        updatedAt: NOW - 120_000,
        tempo: 120,
        tracks: 3,
      },
    ],
    ...overrides,
  };
}

function fakeApi(result: StudioProjectList | Error = list()) {
  const api = {
    list: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))),
    create: vi.fn((_room: string, input: { name: string }) =>
      Promise.resolve({
        project: {
          id: 'created',
          name: input.name,
          createdBy: 'me',
          createdAt: NOW,
          updatedAt: NOW,
          tempo: 120,
          tracks: 0,
        },
      }),
    ),
    remove: vi.fn(() => Promise.resolve({ protocolVersion: 1, removed: 'old' })),
  } satisfies StudioProjectsApi;
  return api;
}

const renderList = (api: StudioProjectsApi, onOpen = vi.fn()) =>
  render(
    <ProjectList
      roomId="room1"
      roomName="Salon"
      api={api}
      selfId="me"
      nameOf={(id) => (id === 'u2' ? 'Ece' : null)}
      onOpen={onOpen}
      now={() => NOW}
    />,
  );

describe('Studio project list', () => {
  it('lists projects newest first with who made them and when they changed', async () => {
    renderList(fakeApi());
    const items = await screen.findAllByRole('listitem');
    expect(items.map((item) => within(item).getAllByRole('button')[0]!.textContent)).toEqual([
      expect.stringContaining('Yeni'),
      expect.stringContaining('Eski'),
    ]);
    expect(items[0]!.textContent).toContain('2 dk önce değişti · Oluşturan: Ece');
    expect(items[1]!.textContent).toContain('Oluşturan: Sen');
  });

  it('creates a project from a template and opens it', async () => {
    const api = fakeApi(list({ projects: [] }));
    const onOpen = vi.fn();
    renderList(api, onOpen);
    fireEvent.click(await screen.findByRole('button', { name: 'İlk projeyi oluştur' }));
    const name = screen.getByRole('textbox', { name: 'Proje adı' });
    fireEvent.change(name, { target: { value: 'Gece' } });
    fireEvent.click(screen.getByRole('radio', { name: 'Boş proje' }));
    fireEvent.click(screen.getByRole('button', { name: 'Oluştur' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith('created'));
    expect(api.create).toHaveBeenCalledWith('room1', { name: 'Gece', template: 'empty' });
  });

  it('deletes only after confirming and reloads the list', async () => {
    const api = fakeApi();
    renderList(api);
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: 'Eski için diğer işlemler' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Sil' }));
    expect(api.remove).not.toHaveBeenCalled();
    const confirm = screen.getByRole('group', { name: 'Silmeyi onayla' });
    fireEvent.click(within(confirm).getByRole('button', { name: 'Sil' }));
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith('room1', 'old'));
    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(2));
  });

  it('rename opens the project with its name in edit mode', async () => {
    const onOpen = vi.fn();
    renderList(fakeApi(), onOpen);
    await screen.findAllByRole('listitem');
    fireEvent.click(screen.getByRole('button', { name: 'Yeni için diğer işlemler' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Yeniden adlandır' }));
    expect(onOpen).toHaveBeenCalledWith('new', { rename: true });
  });

  it('explains why a member cannot create, and shows load errors with a retry', async () => {
    const api = fakeApi(list({ access: { canCreate: false } }));
    renderList(api);
    await screen.findAllByRole('listitem');
    const create = screen.getByRole('button', { name: 'Yeni proje' });
    expect(create.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(create);
    expect(screen.queryByRole('form')).toBeNull();
    cleanup();
    const failing = fakeApi(new Error('Sunucuya ulaşılamıyor.'));
    renderList(failing);
    expect((await screen.findByRole('alert')).textContent).toContain('Sunucuya ulaşılamıyor.');
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(failing.list).toHaveBeenCalledTimes(2);
  });
});

function doc(): StudioProject {
  const base = createProject({
    id: 'p1',
    roomId: 'room1',
    name: 'Demo',
    createdBy: 'me',
    createdAt: 1,
    template: 'drums-bass',
  });
  return applyOps(base, [
    {
      op: 'track.create',
      track: defaultTrack('ud', 'instrument', { name: 'Ud', instrument: 'oud@2' }),
    },
  ]).doc;
}

function fakeModel(overrides: Partial<StudioEditorModel> = {}) {
  const dispatch = vi.fn((_ops: StudioOp[]) => true);
  const model: StudioEditorModel = {
    status: 'live',
    doc: doc(),
    readOnly: false,
    pending: 0,
    canUndo: true,
    canRedo: false,
    presence: [{ userId: 'u2', displayName: 'Ece Kaya', lastSeenAt: NOW }],
    error: null,
    dispatch,
    undo: vi.fn(() => true),
    redo: vi.fn(() => true),
    clearError: vi.fn(),
    retry: vi.fn(),
    ...overrides,
  };
  return model;
}

function fakeTransport() {
  return {
    playing: vi.fn(() => false),
    position: vi.fn(() => 0),
    play: vi.fn(() => Promise.resolve()),
    stop: vi.fn(),
    seek: vi.fn(),
    setLoop: vi.fn(),
    setMetronome: vi.fn(),
    onPosition: vi.fn(() => () => {}),
    dispose: vi.fn(),
  } satisfies StudioTransport;
}

describe('Studio transport and editor frame', () => {
  it('plays, edits tempo through an op, loops and toggles the metronome', async () => {
    const model = fakeModel();
    const transport = fakeTransport();
    render(<StudioEditor model={model} transport={transport} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Çal' }));
    expect(transport.play).toHaveBeenCalled();

    const tempo = screen.getByRole('textbox', { name: 'Tempo (BPM)' });
    fireEvent.change(tempo, { target: { value: '300' } });
    fireEvent.keyDown(tempo, { key: 'Enter' });
    expect(model.dispatch).toHaveBeenCalledWith([
      { op: 'project.set', field: 'tempo', value: 240 },
    ]);

    fireEvent.click(screen.getByRole('button', { name: 'Döngü' }));
    await waitFor(() =>
      expect(transport.setLoop).toHaveBeenLastCalledWith({ startBeat: 0, endBeat: 16 }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Metronom' }));
    await waitFor(() => expect(transport.setMetronome).toHaveBeenLastCalledWith(true));
    expect(screen.getByRole('button', { name: 'Metronom' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(screen.getByRole('img', { name: 'Ece Kaya' }).textContent).toBe('EK');
  });

  it('undoes with the buttons and Cmd/Ctrl+Z, but leaves text fields their own undo', () => {
    const model = fakeModel();
    render(<StudioEditor model={model} transport={fakeTransport()} onBack={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: 'Geri al' }));
    expect(model.undo).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(model.undo).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(window, { key: 'Z', ctrlKey: true, shiftKey: true });
    expect(model.redo).toHaveBeenCalledTimes(1);
    const tempo = screen.getByRole('textbox', { name: 'Tempo (BPM)' });
    fireEvent.keyDown(tempo, { key: 'z', metaKey: true });
    expect(model.undo).toHaveBeenCalledTimes(2);
    // Nothing to redo: the button stays focusable but inert and says why.
    const redo = screen.getByRole('button', { name: 'Yinele' });
    expect(redo.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(redo);
    expect(model.redo).toHaveBeenCalledTimes(1);
  });

  it('keeps the export placeholder disabled with a reason until export ships', async () => {
    render(<StudioEditor model={fakeModel()} transport={fakeTransport()} onBack={() => {}} />);
    const exportButton = screen.getByRole('button', { name: 'Dışa aktar' });
    expect(exportButton.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(document.body, { key: 'Tab' });
    act(() => exportButton.focus());
    expect((await screen.findByRole('tooltip')).textContent).toContain(
      'Dışa aktarma henüz hazır değil',
    );
  });

  it('shows read-only, loading and error states', () => {
    const view = render(
      <StudioEditor
        model={fakeModel({ readOnly: true })}
        transport={fakeTransport()}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText(/düzenleme iznin yok. Dinleyebilir/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Parça ekle' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    view.unmount();
    const retry = vi.fn();
    render(
      <StudioEditor
        model={fakeModel({
          doc: null,
          status: 'error',
          error: 'Bu proje silinmiş ya da artık yok.',
          retry,
        })}
        transport={fakeTransport()}
        onBack={() => {}}
      />,
    );
    expect(screen.getByRole('alert').textContent).toContain('Bu proje silinmiş');
    fireEvent.click(screen.getByRole('button', { name: 'Yeniden dene' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('Studio playback wiring', () => {
  it('shows the position the engine reported, even though position() moves on every read', () => {
    let clock = 0;
    let listener: ((beat: number, playing: boolean) => void) | null = null;
    const transport = {
      ...fakeTransport(),
      position: vi.fn(() => (clock += 0.01)),
      onPosition: vi.fn((next: (beat: number, playing: boolean) => void) => {
        listener = next;
        return () => {
          listener = null;
        };
      }),
    };
    render(<StudioEditor model={fakeModel()} transport={transport} onBack={() => {}} />);
    act(() => listener!(5, true));
    expect(screen.getByRole('status', { name: 'Konum (ölçü:vuruş)' }).textContent).toBe('2:2');
    fireEvent.click(screen.getByRole('button', { name: 'Durdur' }));
    expect(transport.stop).toHaveBeenCalled();
    // A handful of reads, not a render loop.
    expect(transport.position.mock.calls.length).toBeLessThan(10);
  });

  it('gives a StrictMode remount a live transport, disposing only the discarded one', () => {
    const created: ReturnType<typeof fakeTransport>[] = [];
    const create = () => {
      const transport = fakeTransport();
      created.push(transport);
      return transport;
    };
    let current: StudioTransport | null = null;
    function Probe() {
      current = useOwnedTransport(create);
      return null;
    }
    const view = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(created).toHaveLength(2);
    expect(created[0]!.dispose).toHaveBeenCalled();
    expect(current).toBe(created[1]);
    expect(created[1]!.dispose).not.toHaveBeenCalled();
    view.unmount();
    expect(created[1]!.dispose).toHaveBeenCalled();
  });

  it('opens with the project name in edit mode once the project has loaded', () => {
    const transport = fakeTransport();
    const view = render(
      <StudioEditor
        model={fakeModel({ doc: null, status: 'connecting' })}
        transport={transport}
        onBack={() => {}}
        startRenaming
      />,
    );
    const loaded = fakeModel();
    view.rerender(
      <StudioEditor model={loaded} transport={transport} onBack={() => {}} startRenaming />,
    );
    const field = screen.getByRole('textbox', { name: 'Proje adı' });
    fireEvent.change(field, { target: { value: 'Yeni ad' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(loaded.dispatch).toHaveBeenCalledWith([
      { op: 'project.set', field: 'name', value: 'Yeni ad' },
    ]);
  });
});

describe('Studio track headers', () => {
  const setup = (readOnly = false) => {
    const dispatch = vi.fn((_ops: StudioOp[]) => true);
    render(
      <TrackHeaders doc={doc()} readOnly={readOnly} dispatch={dispatch} newId={() => 'new1'} />,
    );
    return dispatch;
  };

  it('adds instrument and drum tracks; recording explains it is coming', async () => {
    const dispatch = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Parça ekle' }));
    expect(await screen.findByText(/Kayıt yakında/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Davul' }));
    const op = dispatch.mock.calls[0]![0][0] as Extract<StudioOp, { op: 'track.create' }>;
    expect(op.op).toBe('track.create');
    expect(op.track).toMatchObject({ id: 'new1', kind: 'drums', instrument: 'drum-kit@1' });
    // The first free colour: the template uses 0 and 4, the oud track 0.
    expect(op.track.color).toBe(1);
  });

  it('renames inline, mutes, solos, reorders and deletes after confirming', async () => {
    const dispatch = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Ud adını değiştir' }));
    const field = screen.getByRole('textbox', { name: 'Parça adı' });
    fireEvent.change(field, { target: { value: 'Ud solo' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(dispatch).toHaveBeenLastCalledWith([
      { op: 'track.set', id: 'ud', field: 'name', value: 'Ud solo' },
    ]);

    const drums = screen.getByRole('listitem', { name: 'Davul 1' });
    fireEvent.click(within(drums).getByRole('button', { name: 'Sustur' }));
    expect(dispatch).toHaveBeenLastCalledWith([
      { op: 'track.set', id: 'tpl-drums', field: 'mute', value: true },
    ]);
    fireEvent.click(within(drums).getByRole('button', { name: 'Solo dinle' }));
    expect(dispatch).toHaveBeenLastCalledWith([
      { op: 'track.set', id: 'tpl-drums', field: 'solo', value: true },
    ]);

    fireEvent.click(within(drums).getByRole('button', { name: 'Davul 1 için diğer işlemler' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Aşağı taşı' }));
    expect(dispatch).toHaveBeenLastCalledWith([{ op: 'track.move', id: 'tpl-drums', index: 1 }]);

    fireEvent.click(within(drums).getByRole('button', { name: 'Davul 1 için diğer işlemler' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Parçayı sil' }));
    const calls = dispatch.mock.calls.length;
    fireEvent.click(within(drums).getByRole('button', { name: 'Sil' }));
    expect(dispatch.mock.calls.length).toBe(calls + 1);
    expect(dispatch).toHaveBeenLastCalledWith([{ op: 'track.delete', id: 'tpl-drums' }]);
  });

  it('labels an instrument this build does not know instead of hiding it', () => {
    setup();
    const ud = screen.getByRole('listitem', { name: 'Ud' });
    expect(ud.textContent).toContain('Bilinmeyen enstrüman');
    expect(
      within(ud).getByRole('img', { name: 'Bu enstrüman için Tayfa’yı güncelle' }),
    ).toBeTruthy();
  });

  it('leaves a read-only member nothing to change', () => {
    const dispatch = setup(true);
    expect(screen.getByRole('button', { name: 'Parça ekle' }).getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(screen.queryByRole('button', { name: /diğer işlemler/ })).toBeNull();
    for (const mute of screen.getAllByRole('button', { name: 'Sustur' })) fireEvent.click(mute);
    expect(dispatch).not.toHaveBeenCalled();
  });
});
