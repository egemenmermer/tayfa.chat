import { useMemo } from 'react';
import { t } from '../../i18n';
import { StudioEditors, type EditorPort, type EditorSelection } from '../editors';
import type { LoopRegion } from '../engine/schedule';
import { studioBridge } from '../store';
import { StudioExportControl, type StudioExportApi } from './ExportDialog';
import { StudioMixer } from './Mixer';
import type { StudioEditorModel } from './model';
import { presenceColorIndex } from './music';
import { StudioEditor } from './StudioEditor';
import type { StudioTransport } from './transport';

/**
 * Adapts the Studio model + transport to the editors' EditorPort. The session (sync.ts) splits a dispatch into
 * ≤ MAX_BATCH_OPS batches with `chunkOps` while keeping it one undo step, so a large gesture is one call here.
 */
export function useEditorPort(
  model: StudioEditorModel,
  transport: StudioTransport,
  selfUserId: string,
  loop: { region: LoopRegion | null; set(region: LoopRegion | null): void } | null,
): EditorPort | null {
  const { doc, readOnly, presence } = model;
  const dispatch = model.dispatch;
  const setSelection = model.setSelection;
  const region = loop?.region ?? null;
  const setLoop = loop?.set;
  return useMemo(() => {
    if (!doc) return null;
    return {
      doc,
      canEdit: !readOnly,
      dispatch: (ops) => {
        dispatch(ops);
      },
      presence: presence.map((member) => ({
        userId: member.userId,
        name: member.displayName,
        colorIndex: presenceColorIndex(member.userId),
        ...(member.playheadBeat !== undefined ? { playheadBeat: member.playheadBeat } : {}),
        ...(member.selection ? { selection: member.selection } : {}),
      })),
      selfUserId,
      position: () => transport.position(),
      preview: (trackId, pitch, velocity) => transport.preview?.(trackId, pitch, velocity),
      setSelection: (selection: EditorSelection) => setSelection?.(selection),
      loop: region ? { ...region, enabled: true } : null,
      ...(setLoop
        ? {
            setLoop: (next: { startBeat: number; endBeat: number; enabled: boolean } | null) =>
              setLoop(next && next.enabled ? next : null),
          }
        : {}),
      seek: (beat: number) => transport.seek(beat),
    } satisfies EditorPort;
  }, [doc, readOnly, presence, dispatch, setSelection, selfUserId, transport, region, setLoop]);
}

/** Save through main's dialog and share through the chat attachment path of the project's room. */
export const desktopExportApi: StudioExportApi = {
  async save(fileName, wav) {
    const bridge = studioBridge();
    if (!bridge.saveExport) throw new Error(t('Bu sürümde dosya kaydedilemiyor.'));
    return bridge.saveExport(fileName, wav);
  },
  async share(roomId, fileName, wav, message) {
    const social = typeof window === 'undefined' ? undefined : window.rooms?.social;
    if (!social) throw new Error(t('Sohbet bu görünümde kullanılamıyor.'));
    const item = await social.dropAttachment(roomId, fileName, wav);
    try {
      await social.send(roomId, message, [item.id]);
    } catch (error) {
      await social.discardAttachment(item.id).catch(() => {});
      throw error;
    }
  },
};

export interface StudioWorkspaceProps {
  model: StudioEditorModel;
  transport: StudioTransport;
  roomId: string;
  selfUserId: string;
  exportApi?: StudioExportApi;
  onBack(): void;
  startRenaming?: boolean;
}

/** The open project: frame (transport, headers) + editors + mixer + export, all on one model and transport. */
export function StudioWorkspace({
  model,
  transport,
  roomId,
  selfUserId,
  exportApi = desktopExportApi,
  onBack,
  startRenaming,
}: StudioWorkspaceProps) {
  return (
    <StudioEditor
      model={model}
      transport={transport}
      onBack={onBack}
      startRenaming={startRenaming}
      exportSlot={({ doc, loop }) => (
        <StudioExportControl
          doc={doc}
          roomId={roomId}
          loop={loop}
          exporter={transport.exportWav}
          api={exportApi}
        />
      )}
      arrangement={(slot) => (
        <WiredEditors
          model={model}
          transport={transport}
          selfUserId={selfUserId}
          slot={slot}
        />
      )}
    />
  );
}

function WiredEditors({
  model,
  transport,
  selfUserId,
  slot,
}: {
  model: StudioEditorModel;
  transport: StudioTransport;
  selfUserId: string;
  slot: Parameters<NonNullable<Parameters<typeof StudioEditor>[0]['arrangement']>>[0];
}) {
  const port = useEditorPort(model, transport, selfUserId, {
    region: slot.loop,
    set: slot.setLoop,
  });
  if (!port) return null;
  return (
    <StudioEditors
      port={port}
      laneHeaders={slot.trackHeaders}
      laneHeight={slot.rowHeight}
      rulerHeight={slot.headerHeight}
      mixer={<StudioMixer doc={slot.doc} readOnly={slot.readOnly} dispatch={model.dispatch} />}
    />
  );
}
