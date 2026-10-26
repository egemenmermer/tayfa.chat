import { StrictMode, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  applyOps,
  createProject,
  defaultTrack,
  type StudioOp,
  type StudioProject,
} from '@rooms/studio';
import type {
  StudioPresence,
  StudioProjectList,
} from '../../../../packages/shared-contracts/src/studio';
import type { StudioEditorModel, StudioProjectsApi } from '../studio/ui/model';
import { ProjectList } from '../studio/ui/ProjectList';
import { StudioEditor } from '../studio/ui/StudioEditor';
import { StudioSurface } from '../studio/ui/StudioSurface';
import type { StudioTransport } from '../studio/ui/transport';
import { STUDIO_FIXTURE_VARIANTS, type StudioFixtureVariant } from './studio-fixture';
import { people, places, sample } from './sample';

// Fixed clock so screenshots stay identical between runs.
const NOW = Date.UTC(2026, 9, 26, 12, 0, 0);
const SELF = 'fixture-self';

function projectList(empty: boolean): StudioProjectList {
  return {
    protocolVersion: 1,
    access: { canCreate: true },
    projects: empty
      ? []
      : [
          {
            id: 'p1',
            name: sample('Cuma gecesi jam', 'Friday night jam'),
            createdBy: SELF,
            createdAt: NOW - 86_400_000 * 3,
            updatedAt: NOW - 5 * 60_000,
            tempo: 96,
            tracks: 4,
          },
          {
            id: 'p2',
            name: sample('Salon için intro müziği', 'Intro music for the lounge'),
            createdBy: 'fixture-ece',
            createdAt: NOW - 86_400_000 * 6,
            updatedAt: NOW - 3 * 3_600_000,
            tempo: 120,
            tracks: 2,
          },
          {
            id: 'p3',
            name: sample(
              'Deneme: 6/8 türkü düzenlemesi, ikinci versiyon ve uzun bir ad',
              'Draft: 6/8 folk arrangement, second version with a long name',
            ),
            createdBy: 'fixture-can',
            createdAt: NOW - 86_400_000 * 12,
            updatedAt: NOW - 86_400_000 * 2,
            tempo: 72,
            tracks: 6,
          },
        ],
  };
}

const names: Record<string, string> = { 'fixture-ece': people.ece, 'fixture-can': people.can };

function fixtureApi(variant: StudioFixtureVariant): StudioProjectsApi {
  return {
    list: (): Promise<StudioProjectList> =>
      variant === 'loading'
        ? new Promise(() => {})
        : Promise.resolve(projectList(variant === 'empty')),
    create: () =>
      Promise.reject(
        new Error(sample('Örnekte proje oluşturulmaz.', 'The sample does not create projects.')),
      ),
    remove: () =>
      Promise.reject(
        new Error(sample('Örnekte proje silinmez.', 'The sample does not delete projects.')),
      ),
  };
}

function fixtureDoc(): StudioProject {
  const base = createProject({
    id: 'p1',
    roomId: 'fixture-room',
    name: sample('Cuma gecesi jam', 'Friday night jam'),
    createdBy: SELF,
    createdAt: NOW,
    tempo: 96,
    template: 'drums-bass',
  });
  const tracks: StudioOp[] = [
    { op: 'track.set', id: 'tpl-drums', field: 'name', value: sample('Davul', 'Drums') },
    { op: 'track.set', id: 'tpl-bass', field: 'volume', value: 0.8 },
    {
      op: 'track.create',
      track: defaultTrack('piano', 'instrument', {
        name: sample('Akorlar', 'Chords'),
        color: 3,
        mute: true,
      }),
    },
    {
      op: 'track.create',
      track: defaultTrack('oud', 'instrument', {
        name: sample('Ud (yeni sürüm)', 'Oud (newer version)'),
        instrument: 'oud@2',
        color: 5,
        solo: false,
      }),
    },
  ];
  return applyOps(base, tracks).doc;
}

const presence: StudioPresence[] = [
  { userId: 'fixture-ece', displayName: people.ece, lastSeenAt: NOW, playheadBeat: 4 },
  { userId: 'fixture-can', displayName: people.can, lastSeenAt: NOW },
];

const silentTransport: StudioTransport = {
  playing: () => false,
  position: () => 9,
  play: () => Promise.resolve(),
  stop: () => {},
  seek: () => {},
  setLoop: () => {},
  setMetronome: () => {},
  onPosition: () => () => {},
  dispose: () => {},
};

function FixtureEditor({ readOnly }: { readOnly: boolean }) {
  const [doc, setDoc] = useState(fixtureDoc);
  const [history, setHistory] = useState<StudioProject[]>([]);
  const model: StudioEditorModel = useMemo(
    () => ({
      status: 'live',
      doc,
      readOnly,
      pending: 0,
      canUndo: history.length > 0,
      canRedo: false,
      presence,
      error: null,
      dispatch: (ops) => {
        const result = applyOps(doc, ops);
        if (!result.applied.length) return false;
        setHistory((list) => [...list, doc]);
        setDoc(result.doc);
        return true;
      },
      undo: () => {
        const previous = history.at(-1);
        if (!previous) return false;
        setHistory((list) => list.slice(0, -1));
        setDoc(previous);
        return true;
      },
      redo: () => false,
      clearError: () => {},
      retry: () => {},
    }),
    [doc, history, readOnly],
  );
  return <StudioEditor model={model} transport={silentTransport} onBack={() => {}} />;
}

export function StudioFixture({ variant }: { variant: StudioFixtureVariant }) {
  const api = useMemo(() => fixtureApi(variant), [variant]);
  return (
    <div
      className="studio-fixture"
      style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
    >
      <StudioSurface>
        <div className="flex items-center gap-2 border-b border-separator-border px-4 py-1">
          <span className="rounded-full border border-border-button-default px-2 py-0.5 text-caption-2-semibold tracking-[0.08em] text-text-secondary">
            {sample('GELİŞTİRME ÖRNEĞİ', 'DEVELOPMENT SAMPLE')}
          </span>
          <span className="text-caption-1-regular text-text-tertiary">
            {sample(
              'Yerel örnek veri; sunucu bağlantısı yok.',
              'Local sample data; no server connection.',
            )}
          </span>
        </div>
        {variant === 'editor' || variant === 'readonly' ? (
          <FixtureEditor readOnly={variant === 'readonly'} />
        ) : (
          <ProjectList
            roomId="fixture-room"
            roomName={places.lounge}
            api={api}
            selfId={SELF}
            nameOf={(id) => names[id] ?? null}
            onOpen={() => {}}
            now={() => NOW}
          />
        )}
      </StudioSurface>
    </div>
  );
}

/** Mounts the Studio fixture in place of the app shell (main.tsx, development only). */
export function renderStudioFixture(container: HTMLElement, variant: string) {
  const variants: readonly string[] = STUDIO_FIXTURE_VARIANTS.S91;
  const chosen = (variants.includes(variant) ? variant : 'default') as StudioFixtureVariant;
  document.documentElement.dataset.referenceFixture = `S91/${chosen}`;
  createRoot(container).render(
    <StrictMode>
      <StudioFixture variant={chosen} />
    </StrictMode>,
  );
}
