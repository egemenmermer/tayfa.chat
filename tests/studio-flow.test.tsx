// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { applyOps, createProject, type StudioOp, type StudioProject } from '@rooms/studio';
import type {
  StudioBridge,
  StudioProjectSummary,
  StudioSyncResponse,
} from '../packages/shared-contracts/src/studio';
import { useCommunity } from '../apps/desktop/src/community';
import type { StudioEngine } from '../apps/desktop/src/studio/engine/engine';
import {
  closeStudioProject,
  createStudioProject,
  listStudioProjects,
  removeStudioProject,
  setStudioBridgeForTesting,
} from '../apps/desktop/src/studio/store';
import {
  exportFileStem,
  STUDIO_SHARE_LIMIT_BYTES,
} from '../apps/desktop/src/studio/ui/ExportDialog';
import { panLabel } from '../apps/desktop/src/studio/ui/Mixer';
import { ProjectList } from '../apps/desktop/src/studio/ui/ProjectList';
import { StudioProjectScreen } from '../apps/desktop/src/studio/ui/StudioPage';
import { StudioSurface } from '../apps/desktop/src/studio/ui/StudioSurface';
import { createLiveTransport } from '../apps/desktop/src/studio/ui/transport';
import { barsOf } from '../apps/desktop/src/studio/ui/StudioEditor';
import { studioExportFileName, validateStudioExport } from '../apps/desktop/electron/studio-export';
import type { DesktopBridge } from '../packages/shared-contracts/src';

// One flow through the real store, session, transport and editors, with a fake activities service behind the
// bridge and a mock audio engine (no Tone, no AudioContext).

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

const SELF = 'alice';
const ROOM = 'room1';

/** An in-memory activities service: projects, a sequenced op log, long polls that wake on new batches. */
function fakeService() {
  const projects = new Map<
    string,
    { doc: StudioProject; seq: number; log: { seq: number; batchId: string; ops: StudioOp[] }[] }
  >();
  const waiting: (() => void)[] = [];
  const batches: StudioOp[][] = [];
  let ids = 0;
  const summary = (doc: StudioProject, at: number): StudioProjectSummary => ({
    id: doc.id,
    name: doc.name,
    createdBy: doc.createdBy,
    createdAt: doc.createdAt,
    updatedAt: at,
    tempo: doc.tempo,
    tracks: doc.trackOrder.length,
  });
  const response = (id: string, afterSeq: number): StudioSyncResponse => {
    const project = projects.get(id)!;
    const base = {
      protocolVersion: 1 as const,
      serverTimeMs: Date.now(),
      seq: project.seq,
      presence: [],
      access: { canEdit: true, canDelete: true },
    };
    if (afterSeq === 0 || afterSeq > project.seq) return { ...base, snapshot: project.doc };
    return {
      ...base,
      batches: project.log
        .filter((entry) => entry.seq > afterSeq)
        .map((entry) => ({ ...entry, actorId: SELF })),
    };
  };
  const bridge: StudioBridge = {
    list: async () => ({
      protocolVersion: 1,
      access: { canCreate: true },
      projects: [...projects.values()].map(({ doc }) => summary(doc, doc.createdAt)),
    }),
    create: async (roomId, input) => {
      ids += 1;
      const doc = createProject({
        id: `p${ids}`,
        roomId,
        name: input.name,
        createdBy: SELF,
        createdAt: 1000,
        ...(input.template ? { template: input.template } : {}),
      });
      projects.set(doc.id, { doc, seq: 0, log: [] });
      return { protocolVersion: 1, project: summary(doc, 1000) };
    },
    remove: async (_roomId, projectId) => {
      projects.delete(projectId);
      return { protocolVersion: 1, removed: projectId };
    },
    sync: (_roomId, projectId, afterSeq, waitMs) => {
      const project = projects.get(projectId);
      if (!project) return Promise.reject(new Error('STUDIO_PROJECT_NOT_FOUND'));
      if (afterSeq === project.seq && waitMs > 0)
        return new Promise((resolve) => waiting.push(() => resolve(response(projectId, afterSeq))));
      return Promise.resolve(response(projectId, afterSeq));
    },
    ops: async (_roomId, projectId, batch) => {
      const project = projects.get(projectId)!;
      const result = applyOps(project.doc, batch.ops);
      project.doc = result.doc;
      project.seq += 1;
      project.log.push({ seq: project.seq, batchId: batch.batchId, ops: batch.ops });
      batches.push(batch.ops);
      for (const wake of waiting.splice(0)) wake();
      return { protocolVersion: 1, seq: project.seq, applied: result.applied, skipped: [] };
    },
    presence: async () => ({ protocolVersion: 1, presence: [] }),
    saveExport: vi.fn(async () => true),
  };
  return { bridge, projects, batches };
}

/** A StudioEngine stand-in that records calls; export returns a tiny valid WAV. */
function mockEngine() {
  let playing = false;
  let loaded: StudioProject | null = null;
  const listeners = new Set<(beat: number, playing: boolean) => void>();
  const wav = new Uint8Array(64);
  wav.set(
    [...'RIFF'].map((c) => c.charCodeAt(0)),
    0,
  );
  wav.set(
    [...'WAVE'].map((c) => c.charCodeAt(0)),
    8,
  );
  const engine = {
    load: vi.fn(async (project: StudioProject) => {
      loaded = project;
      return null as never;
    }),
    play: vi.fn(async () => {
      playing = true;
      for (const listener of listeners) listener(0, true);
    }),
    pause: vi.fn(),
    stop: vi.fn(() => {
      playing = false;
      for (const listener of listeners) listener(0, false);
    }),
    seek: vi.fn(),
    setLoop: vi.fn(),
    setMetronome: vi.fn(),
    position: () => 0,
    playing: () => playing,
    onPosition: (listener: (beat: number, playing: boolean) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    plan: () => null,
    renderOffline: vi.fn(),
    exportWav: vi.fn(
      async (_project: StudioProject, options: { onProgress?: (n: number) => void }) => {
        options.onProgress?.(0.5);
        options.onProgress?.(1);
        return {
          wav,
          range: { fromBeat: 0, toBeat: 4, musicSeconds: 2, tailSeconds: 1, totalSeconds: 3 },
        };
      },
    ),
    stats: vi.fn(),
    preview: vi.fn(),
    dispose: vi.fn(),
    loaded: () => loaded,
  };
  return engine;
}

let engine = mockEngine();
// Stable factory (the screen creates its transport once per mount).
const createTransport = () => createLiveTransport(async () => engine as unknown as StudioEngine);

beforeEach(() => {
  engine = mockEngine();
});
afterEach(() => {
  cleanup();
  closeStudioProject();
  setStudioBridgeForTesting(null);
});

describe('Studio end to end over a fake bridge', () => {
  it('creates a project, adds drums, toggles steps, plays, exports and shares to the room chat', async () => {
    const service = fakeService();
    setStudioBridgeForTesting(service.bridge);
    const social = {
      dropAttachment: vi.fn(async (_channel: string, name: string, data: Uint8Array) => ({
        id: 'att1',
        name,
        size: data.byteLength,
        mime: 'audio/wav',
      })),
      send: vi.fn(async () => ({})),
      discardAttachment: vi.fn(async () => {}),
    };
    window.rooms = { platform: 'darwin', social } as unknown as DesktopBridge;
    useCommunity.setState({ user: { id: SELF } as never });

    // 1. Create an empty project from the list.
    const opened = vi.fn();
    render(
      <StudioSurface>
        <ProjectList
          roomId={ROOM}
          roomName="Salon"
          api={{
            list: listStudioProjects,
            create: createStudioProject,
            remove: removeStudioProject,
          }}
          selfId={SELF}
          nameOf={() => null}
          onOpen={opened}
        />
      </StudioSurface>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'İlk projeyi oluştur' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Proje adı' }), {
      target: { value: 'Gece/ritmi' },
    });
    fireEvent.click(screen.getByRole('radio', { name: 'Boş proje' }));
    fireEvent.click(screen.getByRole('button', { name: 'Oluştur' }));
    await waitFor(() => expect(opened).toHaveBeenCalled());
    const projectId = opened.mock.calls[0]![0] as string;
    cleanup();

    // 2. Open it: the editors sit in the frame's slot, beside the track headers.
    render(
      <StudioSurface>
        <StudioProjectScreen
          roomId={ROOM}
          projectId={projectId}
          createTransport={createTransport}
          onBack={() => {}}
        />
      </StudioSurface>,
    );
    await screen.findByRole('application', { name: 'Düzenleme zaman çizelgesi' });

    // 3. Add a drum track through the header menu; it reaches the service as one batch.
    fireEvent.click(screen.getByRole('button', { name: 'Parça ekle' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Davul' }));
    await waitFor(() =>
      expect(service.batches.flat().some((op) => op.op === 'track.create')).toBe(true),
    );
    const drumId = service.projects.get(projectId)!.doc.trackOrder[0]!;
    expect(service.projects.get(projectId)!.doc.tracks[drumId]!.kind).toBe('drums');

    // 4. Double-click the drum lane (ruler 40 px, lanes 88 px) to make a clip; it opens the step sequencer.
    const canvas = screen.getByTestId('arrangement-canvas');
    fireEvent.doubleClick(canvas, { clientX: 10, clientY: 40 + 30 });
    const kick = await screen.findByRole('gridcell', { name: 'Kick, adım 1' });
    fireEvent.keyDown(kick, { key: 'Enter' });
    fireEvent.keyDown(screen.getByRole('gridcell', { name: 'Kick, adım 9' }), { key: 'Enter' });
    expect(engine.preview).not.toHaveBeenCalled(); // no engine before the first Play
    await waitFor(() =>
      expect(
        Object.values(service.projects.get(projectId)!.doc.notes).map((note) => note.startBeat),
      ).toEqual([0, 2]),
    );
    expect(
      screen.getByRole('gridcell', { name: 'Kick, adım 1' }).getAttribute('aria-pressed'),
    ).toBe('true');

    // 5. Play: the live transport creates the (mock) engine, feeds it the document and reports playing.
    fireEvent.click(screen.getByRole('button', { name: 'Çal' }));
    await screen.findByRole('button', { name: 'Durdur' });
    expect(engine.play).toHaveBeenCalled();
    await waitFor(() => expect(Object.keys(engine.loaded()?.notes ?? {})).toHaveLength(2));

    // 6. Mixer tab: a reverb change is one track.set op.
    fireEvent.click(screen.getByRole('radio', { name: 'Mikser' }));
    expect(screen.getByRole('group', { name: 'Mikser' })).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Solo' }));
    await waitFor(() =>
      expect(service.projects.get(projectId)!.doc.tracks[drumId]!.solo).toBe(true),
    );

    // 7. Export the whole song, save it through main, then share it to the room's chat.
    fireEvent.click(screen.getByRole('button', { name: 'Dışa aktar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Şarkıyı dışa aktar' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    await within(dialog).findByText('Gece ritmi.wav kaydedildi.');
    expect(engine.exportWav).toHaveBeenCalledTimes(1);
    expect(engine.exportWav.mock.calls[0]![1]).not.toHaveProperty('fromBeat');
    expect(service.bridge.saveExport).toHaveBeenCalledWith(
      'Gece ritmi.wav',
      expect.any(Uint8Array),
    );

    fireEvent.click(within(dialog).getByRole('button', { name: 'Sohbete paylaş' }));
    await within(dialog).findByText('Şarkı odanın sohbetine gönderildi.');
    // The render is reused: the document did not change between save and share.
    expect(engine.exportWav).toHaveBeenCalledTimes(1);
    expect(social.dropAttachment).toHaveBeenCalledWith(
      ROOM,
      'Gece ritmi.wav',
      expect.any(Uint8Array),
    );
    expect(social.send).toHaveBeenCalledWith(ROOM, 'Stüdyo’dan yeni bir parça: Gece/ritmi', [
      'att1',
    ]);
    await act(async () => {});
  });

  it('cancels a render and refuses to share a song over the chat limit', async () => {
    const service = fakeService();
    setStudioBridgeForTesting(service.bridge);
    const created = await service.bridge.create(ROOM, { name: 'Uzun', template: 'drums-bass' });
    useCommunity.setState({ user: { id: SELF } as never });
    const social = { dropAttachment: vi.fn(), send: vi.fn(), discardAttachment: vi.fn() };
    window.rooms = { platform: 'darwin', social } as unknown as DesktopBridge;
    let release: (() => void) | null = null;
    engine.exportWav.mockImplementation(
      (_project, options: { signal?: AbortSignal; onProgress?: (n: number) => void }) =>
        new Promise((resolve, reject) => {
          options.onProgress?.(0.3);
          options.signal?.addEventListener('abort', () =>
            reject(new DOMException('cancelled', 'AbortError')),
          );
          release = () =>
            resolve({
              wav: new Uint8Array(STUDIO_SHARE_LIMIT_BYTES + 1),
              range: { fromBeat: 0, toBeat: 4, musicSeconds: 2, tailSeconds: 1, totalSeconds: 3 },
            });
        }) as never,
    );
    render(
      <StudioSurface>
        <StudioProjectScreen
          roomId={ROOM}
          projectId={created.project.id}
          createTransport={createTransport}
          onBack={() => {}}
        />
      </StudioSurface>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Dışa aktar' }));
    const dialog = await screen.findByRole('dialog', { name: 'Şarkıyı dışa aktar' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Kaydet' }));
    expect(await within(dialog).findByRole('progressbar')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'İptal' }));
    await waitFor(() => expect(within(dialog).queryByRole('progressbar')).toBeNull());
    expect(service.bridge.saveExport).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Sohbete paylaş' }));
    await waitFor(() => expect(release).not.toBeNull());
    await act(async () => release!());
    expect(await within(dialog).findByRole('alert')).toHaveProperty(
      'textContent',
      expect.stringContaining('sohbete en fazla 25 MB'),
    );
    expect(social.dropAttachment).not.toHaveBeenCalled();
  });
});

describe('Studio export helpers', () => {
  it('cleans file names in the renderer and again in main', () => {
    expect(exportFileStem('  a/b:c*?  ')).toBe('a b c');
    expect(exportFileStem('...')).toBe('tayfa-studio');
    expect(studioExportFileName('../../etc/passwd')).toBe('etc passwd.wav');
    expect(studioExportFileName('Song.WAV')).toBe('Song.wav');
    expect(studioExportFileName(42)).toBe('tayfa-studio.wav');
  });

  it('accepts only bounded RIFF/WAVE bytes in main', () => {
    const wav = new Uint8Array(44);
    wav.set(
      [...'RIFF'].map((c) => c.charCodeAt(0)),
      0,
    );
    wav.set(
      [...'WAVE'].map((c) => c.charCodeAt(0)),
      8,
    );
    expect(validateStudioExport(wav)).toBe(wav);
    expect(() => validateStudioExport(new Uint8Array(44))).toThrow(/not a WAV/);
    expect(() => validateStudioExport('RIFF')).toThrow(/not a WAV/);
  });

  it('labels pan and rounds a ruler loop out to whole bars', () => {
    expect(panLabel(0)).toBe('Merkez');
    expect(panLabel(-0.25)).toBe('Sol 25');
    expect(panLabel(1)).toBe('Sağ 100');
    const doc = { timeSignature: { beats: 4, unit: 4 as const } };
    const current = { on: false, startBar: 1, endBar: 5 };
    expect(barsOf({ startBeat: 4, endBeat: 10 }, doc, current)).toEqual({
      on: true,
      startBar: 2,
      endBar: 4,
    });
    expect(barsOf(null, doc, { ...current, on: true })).toEqual(current);
  });
});
