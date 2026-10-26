import { applyOps, studioOpSchema, type StudioOp, type StudioProject } from '@rooms/studio';
import type { EditorLoop, EditorPort, EditorPresence, EditorSelection } from './port';

/**
 * In-memory EditorPort for tests and development fixtures. `dispatch` validates every op with the
 * contract schema and applies it with the real reducer, so a malformed or skipped op shows up.
 */
export class FakeEditorStore {
  doc: StudioProject;
  readonly batches: StudioOp[][] = [];
  readonly skipped: string[] = [];
  readonly previews: { trackId: string; pitch: number; velocity: number }[] = [];
  selection: EditorSelection = { noteIds: [] };
  presence: EditorPresence[];
  loop: EditorLoop | null;
  playhead = 0;
  canEdit = true;
  private listeners = new Set<() => void>();
  private port: EditorPort | null = null;

  constructor(
    doc: StudioProject,
    options: { presence?: EditorPresence[]; loop?: EditorLoop | null; canEdit?: boolean } = {},
  ) {
    this.doc = doc;
    this.presence = options.presence ?? [];
    this.loop = options.loop ?? null;
    this.canEdit = options.canEdit ?? true;
  }

  dispatch = (ops: StudioOp[]) => {
    if (!ops.length) return;
    const parsed = ops.map((op) => studioOpSchema.parse(op));
    const result = applyOps(this.doc, parsed);
    for (const skip of result.skipped) this.skipped.push(`${skip.op}:${skip.reason}`);
    this.batches.push(ops);
    this.doc = result.doc;
    this.emit();
  };

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** A port object that changes identity on every update (like a store snapshot). */
  getPort = (): EditorPort => {
    if (this.port && this.port.doc === this.doc && this.port.loop === this.loop) return this.port;
    this.port = {
      doc: this.doc,
      canEdit: this.canEdit,
      dispatch: this.dispatch,
      presence: this.presence,
      selfUserId: 'self',
      position: () => this.playhead,
      preview: (trackId, pitch, velocity) => this.previews.push({ trackId, pitch, velocity }),
      setSelection: (selection) => {
        this.selection = selection;
      },
      loop: this.loop,
      setLoop: (loop) => {
        this.loop = loop;
        this.emit();
      },
      seek: (beat) => {
        this.playhead = beat;
      },
    };
    return this.port;
  };

  private emit() {
    this.port = null;
    for (const listener of this.listeners) listener();
  }
}
