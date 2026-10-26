import { Kiraathane } from '../Kiraathane';
import './styles/index.css';
import { t } from '../i18n';
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useActivityRoom } from '../activity';
import { retiredActivity } from '../activity-route';
import { useCurrentRoom } from '../Agent';
import { useCommunity } from '../community';
import { useGameFixtureMetadata } from './shared/fixture';
import { ReferenceGameHistory } from './shared/History';
import { ReferenceGames } from './shared/Lobby';
import { isOfferedGame } from './catalog';
import { gameDefinition, type GameSetupValues } from './registry';
import { tableTitle } from './shared/model';
import { ReferenceOtherGame } from './shared/TableShell';

export default function Games() {
  const roomId = useCurrentRoom(),
    activity = useActivityRoom(roomId);
  const [params] = useSearchParams(),
    navigate = useNavigate(),
    community = useCommunity(),
    fixtureMetadata = useGameFixtureMetadata();
  const [create, setCreate] = useState<string | null>(null),
    [setup, setSetup] = useState<GameSetupValues>({});
  const game =
    activity.room?.primary?.activity === activity.room?.game?.kind
      ? (activity.room?.game ?? null)
      : null;
  useEffect(() => setCreate(null), [roomId, activity.room?.primary?.startedAt]);
  // The app directory opens a game's table setup directly: /games?create=holdem.
  const requested = params.get('create');
  useEffect(() => {
    if (requested && isOfferedGame(requested)) setCreate(requested);
  }, [requested]);
  useEffect(() => {
    if (fixtureMetadata) {
      const ui = fixtureMetadata.ui;
      setCreate(ui.create);
      setSetup({ variant: ui.variant, folding: ui.folding, teams: ui.teams });
    }
  }, [fixtureMetadata]);
  if (params.get('tab') === 'history')
    return <ReferenceGameHistory activity={activity} game={game} />;
  if (params.get('tab') !== 'table' && !create)
    return (
      <Kiraathane
        game={game}
        ready={activity.status === 'connected'}
        error={activity.error}
        busy={activity.busy}
        blocked={
          activity.room?.participants.find((p) => p.userId === community.user?.id)?.canCreate ===
          false
            ? t('Bu odada masa açma yetkin yok.')
            : ''
        }
        otherActivity={
          activity.room?.primary && !game
            ? retiredActivity(activity.room.primary.activity)
              ? t('eski Sinema oturumu')
              : activity.room.primary.activity === 'screen'
                ? t('ekran paylaşımı')
                : (tableTitle(activity.room.primary.title, undefined) ?? t('bir etkinlik'))
            : null
        }
        onCreate={setCreate}
        onOpen={() => navigate('/games?tab=table')}
        onHistory={() => navigate('/games?tab=history')}
        onRetry={() => void activity.refresh()}
      />
    );
  if (game && game.status !== 'waiting' && !gameDefinition(game.kind).tableInLobby)
    return (
      <>
        <button className="coffeehouse-return" onClick={() => navigate('/games')}>
          {t('← Oyunlara dön')}
        </button>
        <ReferenceOtherGame
          key={`${roomId}:${activity.room?.primary?.startedAt}`}
          activity={activity}
          game={game}
        />
      </>
    );
  return (
    <>
      <button
        className="coffeehouse-return"
        onClick={() => {
          setCreate(null);
          navigate('/games');
        }}
      >
        {t('← Oyunlara dön')}
      </button>
      <ReferenceGames
        activity={activity}
        roomId={roomId}
        game={game ?? null}
        onCreate={setCreate}
        create={create}
        setup={setup}
        onSetup={(patch) => setSetup((value) => ({ ...value, ...patch }))}
      />
    </>
  );
}
