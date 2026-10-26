import { useEffect, useMemo } from 'react';
import { Navigate, useLocation, useNavigate, useParams } from 'react-router-dom';
import { RiHashtag, RiVolumeUpLine } from '@remixicon/react';
import { Button } from '@boardui/base/button';
import { useCommunity } from '../../community';
import { t } from '../../i18n';
import { useRealtime } from '../../realtime';
import {
  createStudioProject,
  listStudioProjects,
  openStudioProject,
  removeStudioProject,
  studioActions,
  useStudioStore,
} from '../store';
import type { StudioEditorModel, StudioProjectsApi } from './model';
import { ProjectList } from './ProjectList';
import { StudioEditor } from './StudioEditor';
import { StudioSurface } from './StudioSurface';
import { createLiveTransport } from './transport';

const realApi: StudioProjectsApi = {
  list: listStudioProjects,
  create: createStudioProject,
  remove: removeStudioProject,
};

/** `/studio`, `/studio/:roomId` and `/studio/:roomId/:projectId`. */
export default function StudioPage() {
  const { roomId, projectId } = useParams();
  const c = useCommunity();
  const voiceRoom = useRealtime().channelId;
  const rooms = c.channels.filter((channel) => channel.type === 2 || channel.type === 0);
  if (!roomId) {
    const current = rooms.find((room) => room.id === voiceRoom && room.type === 2);
    if (current) return <Navigate to={`/studio/${current.id}`} replace />;
    return (
      <StudioSurface>
        <RoomPicker rooms={rooms} />
      </StudioSurface>
    );
  }
  const room = rooms.find((channel) => channel.id === roomId);
  if (!room)
    return (
      <StudioSurface>
        <div className="flex flex-col items-start gap-3 p-6">
          <h1 className="text-title-3-semibold">{t('Oda bulunamadı')}</h1>
          <p className="text-body-regular text-text-secondary">
            {t('Bu oda silinmiş ya da artık göremiyorsun.')}
          </p>
          <RoomPicker rooms={rooms} />
        </div>
      </StudioSurface>
    );
  return (
    <StudioSurface>
      {projectId ? (
        <OpenProject key={`${roomId}/${projectId}`} roomId={roomId} projectId={projectId} />
      ) : (
        <ProjectListEntry roomId={roomId} roomName={room.name} />
      )}
    </StudioSurface>
  );
}

function RoomPicker({ rooms }: { rooms: { id: string; name: string; type: number }[] }) {
  const navigate = useNavigate();
  const voice = rooms.filter((room) => room.type === 2);
  const text = rooms.filter((room) => room.type === 0);
  return (
    <section className="flex flex-col gap-4 overflow-auto p-6" aria-labelledby="studio-rooms-title">
      <div className="flex flex-col gap-1">
        <h1 id="studio-rooms-title" className="text-title-3-semibold text-text-primary">
          {t('Stüdyo')}
        </h1>
        <p className="max-w-[560px] text-body-regular text-text-secondary">
          {t('Projeler bir odaya aittir. Birlikte müzik yapacağınız odayı seç.')}
        </p>
      </div>
      {!rooms.length && (
        <p className="text-body-regular text-text-tertiary">
          {t('Bu toplulukta görebildiğin bir oda yok.')}
        </p>
      )}
      {[
        [t('Ses odaları'), voice, RiVolumeUpLine],
        [t('Sohbet kanalları'), text, RiHashtag],
      ].map(([label, list, Icon]) =>
        (list as typeof rooms).length ? (
          <div key={label as string} className="flex flex-col gap-2">
            <h2 className="text-caption-1-semibold text-text-tertiary">{label as string}</h2>
            <div className="flex flex-wrap gap-2">
              {(list as typeof rooms).map((room) => (
                <Button
                  key={room.id}
                  variant="secondary"
                  leadingIcon={Icon as typeof RiHashtag}
                  onClick={() => navigate(`/studio/${room.id}`)}
                >
                  {room.name}
                </Button>
              ))}
            </div>
          </div>
        ) : null,
      )}
    </section>
  );
}

function ProjectListEntry({ roomId, roomName }: { roomId: string; roomName: string }) {
  const navigate = useNavigate();
  const selfId = useCommunity((state) => state.user?.id ?? null);
  return (
    <ProjectList
      roomId={roomId}
      roomName={roomName}
      api={realApi}
      selfId={selfId}
      nameOf={() => null}
      onOpen={(projectId, options) =>
        navigate(`/studio/${roomId}/${projectId}${options?.rename ? '?rename=1' : ''}`)
      }
    />
  );
}

function OpenProject({ roomId, projectId }: { roomId: string; projectId: string }) {
  const navigate = useNavigate();
  const location = useLocation();
  const view = useStudioStore((state) =>
    state.roomId === roomId && state.projectId === projectId ? state.view : null,
  );
  // The session outlives this screen on purpose (store.ts); opening is a no-op when it is already open.
  useEffect(() => openStudioProject(roomId, projectId), [roomId, projectId]);
  const transport = useMemo(() => createLiveTransport(), []);
  useEffect(() => () => transport.dispose(), [transport]);
  const model: StudioEditorModel = {
    status: view?.status ?? 'connecting',
    doc: view?.doc ?? null,
    readOnly: view?.readOnly ?? true,
    pending: view?.pending ?? 0,
    canUndo: view?.canUndo ?? false,
    canRedo: view?.canRedo ?? false,
    presence: view?.presence ?? [],
    error: view?.error ?? null,
    dispatch: (ops) => studioActions.dispatch(ops),
    undo: () => studioActions.undo(),
    redo: () => studioActions.redo(),
    clearError: () => studioActions.clearError(),
    retry: () => openStudioProject(roomId, projectId),
  };
  return (
    <StudioEditor
      model={model}
      transport={transport}
      startRenaming={new URLSearchParams(location.search).get('rename') === '1'}
      onBack={() => navigate(`/studio/${roomId}`)}
    />
  );
}
