import { create } from 'zustand';
import type { StudioOp, StudioProject } from '@rooms/studio';
import type {
  StudioBridge,
  StudioCreateInput,
  StudioPresenceState,
} from '../../../../packages/shared-contracts/src/studio';
import { useCommunity } from '../community';
import { t } from '../i18n';
import type { StudioEngine } from './engine/engine';
import { connectStudioEngine } from './engine-adapter';
import { studioErrorMessage } from './errors';
import { createStudioSession, type StudioSession, type StudioSyncView } from './sync';

// The open Studio project lives here, outside page components, like activity.ts: leaving the Studio screen and
// coming back keeps the document, the pending edits and the long poll of the same project.

interface StudioStoreState {
  roomId: string | null;
  projectId: string | null;
  /** Null when no project is open. */
  view: StudioSyncView | null;
}

export const useStudioStore = create<StudioStoreState>(() => ({
  roomId: null,
  projectId: null,
  view: null,
}));

let session: StudioSession | null = null;
let detach: (() => void) | null = null;
let bridgeOverride: StudioBridge | null = null;

/** Development/test seam: a fake bridge instead of `window.rooms.studio`. */
export function setStudioBridgeForTesting(bridge: StudioBridge | null) {
  bridgeOverride = bridge;
}

export function studioBridge(): StudioBridge {
  if (bridgeOverride) return bridgeOverride;
  const bridge = typeof window === 'undefined' ? undefined : window.rooms?.studio;
  if (!bridge) throw new Error(t('Stüdyo masaüstü uygulaması ve yapılandırılmış sunucu gerektirir.'));
  return bridge;
}

const accountScope = () => {
  const state = useCommunity.getState();
  return JSON.stringify([state.serverUrl, state.user?.id ?? null]);
};

/** Opens (or keeps) the project's live session. Opening another project closes the previous one. */
export function openStudioProject(roomId: string, projectId: string) {
  const current = useStudioStore.getState();
  if (
    session &&
    current.roomId === roomId &&
    current.projectId === projectId &&
    current.view?.status !== 'error'
  )
    return;
  closeStudioProject();
  const actorId = useCommunity.getState().user?.id;
  let bridge: StudioBridge;
  try {
    if (!actorId) throw new Error(t('Önce giriş yap.'));
    bridge = studioBridge();
  } catch (error) {
    useStudioStore.setState({
      roomId,
      projectId,
      view: {
        status: 'error',
        doc: null,
        seq: 0,
        readOnly: true,
        canDelete: false,
        pending: 0,
        canUndo: false,
        canRedo: false,
        presence: [],
        serverOffsetMs: 0,
        error: studioErrorMessage(error),
      },
    });
    return;
  }
  const opened = createStudioSession({ bridge, roomId, projectId, actorId });
  session = opened;
  detach = opened.subscribe(() => {
    if (session === opened) useStudioStore.setState({ view: opened.view() });
  });
  useStudioStore.setState({ roomId, projectId, view: opened.view() });
}

export function closeStudioProject() {
  detach?.();
  detach = null;
  session?.close();
  session = null;
  useStudioStore.setState({ roomId: null, projectId: null, view: null });
}

/** The optimistic document of the open project (for non-React readers such as the engine adapter). */
export function currentStudioDoc(): StudioProject | null {
  return useStudioStore.getState().view?.doc ?? null;
}

/** Editing commands for the open project; each is a no-op returning false when none is open. */
export const studioActions = {
  dispatch: (ops: readonly StudioOp[]) => session?.dispatch(ops) ?? false,
  undo: () => session?.undo() ?? false,
  redo: () => session?.redo() ?? false,
  setPresence: (state: Partial<StudioPresenceState>) => session?.setPresence(state),
  clearError: () => session?.clearError(),
};

/** Bridge calls with the failure turned into interface text. */
async function readable<T>(task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    throw new Error(studioErrorMessage(error), { cause: error });
  }
}
export const listStudioProjects = (roomId: string) => readable(() => studioBridge().list(roomId));
export const createStudioProject = (roomId: string, input: StudioCreateInput) =>
  readable(() => studioBridge().create(roomId, input));
export const removeStudioProject = (roomId: string, projectId: string) =>
  readable(async () => {
    const result = await studioBridge().remove(roomId, projectId);
    const open = useStudioStore.getState();
    if (open.roomId === roomId && open.projectId === projectId) closeStudioProject();
    return result;
  });

// Another account or server: nothing of the previous session may stay on screen.
let scope = accountScope();
useCommunity.subscribe(() => {
  const next = accountScope();
  if (next === scope) return;
  scope = next;
  closeStudioProject();
});
// Membership changed for these channels: start over so the server decides access again.
if (typeof window !== 'undefined')
  window.addEventListener('rooms:channel-access-invalidated', (event) => {
    const ids = new Set((event as CustomEvent<{ channelIds: string[] }>).detail?.channelIds ?? []);
    const { roomId, projectId } = useStudioStore.getState();
    if (roomId && projectId && ids.has(roomId)) {
      closeStudioProject();
      openStudioProject(roomId, projectId);
    }
  });

/** Feeds `engine` with every new document of the open project until the returned function is called. */
export function feedStudioEngine(
  engine: Pick<StudioEngine, 'load'>,
  onError?: (error: unknown) => void,
) {
  return connectStudioEngine(
    engine,
    { current: currentStudioDoc, subscribe: (listener) => useStudioStore.subscribe(listener) },
    onError,
  );
}
