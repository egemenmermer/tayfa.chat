import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Bot,
  MonitorUp,
  Music2,
  PenTool,
  Popcorn,
  Search,
  type LucideIcon,
} from 'lucide-react';
import { GameArt, gameCatalog, gameNames } from './Kiraathane';
import { openMusicDJ, openRoomActivity } from './MusicDJ';
import { useRealtime } from './realtime';
import { useCommunity } from './community';
import { useActivityRoom } from './activity';
import { activityRoute, openActivity } from './activity-route';
import { useCommunityCinema } from './cinema/cinema-status';
import { locale, t } from './i18n';
import './app-directory.css';

type Section = 'apps' | 'watch' | 'cards' | 'tables' | 'tools';
const sectionLabels: Record<Section, string> = {
  apps: t('Uygulamalar'),
  watch: t('Birlikte izle'),
  cards: t('Kart oyunları'),
  tables: t('Masa oyunları'),
  tools: t('Araçlar'),
};
interface DirectoryItem {
  id: string;
  name: string;
  detail: string;
  section: Section;
  keywords: string;
  /** Lucide icon on a tinted tile, or the drawn game pieces. */
  icon: LucideIcon | 'game';
  tint: string;
  /** Needs a joined voice room; otherwise the reason is shown. */
  voice?: boolean;
  /** An assistant with its own page, not something the room starts; left out of the launcher. */
  bot?: boolean;
  run(open: (path: string) => void): void;
}
const games = gameCatalog.map((game): DirectoryItem => ({
  id: game.kind,
  name: gameNames[game.kind],
  detail: `${game.detail} ${game.players}.`,
  section: game.section,
  keywords: t('oyun masa kart oyunlar {kind}', { kind: game.kind }),
  icon: 'game',
  tint: '#1f4a3b',
  run: (open) => open(`/games?create=${encodeURIComponent(game.kind)}`),
}));
export const directoryItems: DirectoryItem[] = [
  {
    id: 'dj',
    name: 'DJ Recep',
    detail: t('Odaya müzik aç: YouTube, Spotify listeleri ve sıra.'),
    section: 'apps',
    keywords: t('müzik şarkı spotify youtube bot'),
    icon: Music2,
    tint: '#d9467f',
    run: () => openMusicDJ(),
  },
  {
    id: 'agent',
    name: t('Asistan'),
    detail: t('Soru sor, özet çıkar, görev ver.'),
    section: 'apps',
    keywords: t('claude yapay zeka ai bot'),
    icon: Bot,
    tint: '#6b5bd6',
    bot: true,
    run: (open) => open('/agent'),
  },
  {
    id: 'cinema',
    name: t('Sinema salonu'),
    detail: t('Topluluğun salonunda canlı kanal, film, dizi ve YouTube.'),
    section: 'watch',
    keywords: t('sinema film dizi kanal iptv stremio youtube canlı tv'),
    icon: Popcorn,
    tint: '#c2543a',
    run: (open) => open('/cinema'),
  },
  {
    id: 'screen',
    name: t('Ekran paylaş'),
    detail: t('Pencere, oyun ya da tarayıcı; Instagram ve diğer siteler.'),
    section: 'watch',
    keywords: t('yayın pencere instagram reels'),
    icon: MonitorUp,
    tint: '#2f7fb8',
    voice: true,
    run: () => window.dispatchEvent(new Event('rooms:choose-capture')),
  },
  ...games,
  {
    id: 'board',
    name: t('Beyaz tahta'),
    detail: t('Birlikte çiz, yaz; imleçler canlı görünür.'),
    section: 'tools',
    keywords: t('whiteboard çizim tahta'),
    icon: PenTool,
    tint: '#2f8f6b',
    run: (open) => open('/together?tab=board'),
  },
  {
    id: 'poll',
    name: t('Anket'),
    detail: t('Odaya soru sor, oyları canlı gör.'),
    section: 'tools',
    keywords: t('oylama anket soru'),
    icon: BarChart3,
    tint: '#b98a2c',
    run: (open) => open('/together?tab=polls'),
  },
];
// The first four that this community offers; the grid has two columns.
const featured = ['cinema', 'holdem', '101', 'board', 'poll'];
const sections: Section[] = ['apps', 'watch', 'cards', 'tables', 'tools'];
const fold = (value: string) => value.toLocaleLowerCase(locale).normalize('NFD');

function Tile({ item, large = false }: { item: DirectoryItem; large?: boolean }) {
  return (
    <span
      className={`appdir-tile ${large ? 'large' : ''} ${item.icon === 'game' ? 'felt' : ''}`}
      style={{ '--tile': item.tint } as CSSProperties}
      aria-hidden="true"
    >
      {item.icon === 'game' ? <GameArt kind={item.id} /> : <item.icon size={large ? 40 : 20} />}
    </span>
  );
}

/**
 * Discord-style catalogue of what can be opened in this room: apps, watch-together, games and
 * tools, searchable. `apps={false}` (the activity launcher) leaves out the assistant, which is a
 * page of its own rather than something the room starts.
 */
export function AppDirectory({
  onClose,
  apps = true,
  header,
}: {
  onClose(): void;
  apps?: boolean;
  header?: ReactNode;
}) {
  const navigate = useNavigate(),
    voice = useRealtime(),
    community = useCommunity();
  const roomId = voice.channelId ?? community.activeChannelId;
  const activity = useActivityRoom(roomId);
  const primary = activity.room?.primary;
  const cinema = useCommunityCinema();
  // Same rule as the sidebar's hall row: a hall exists, or the owner can set one up there.
  const hasCinema =
    cinema.available && !!cinema.status && (!!cinema.hallId || cinema.status.isOwner);
  const [query, setQuery] = useState('');
  const items = useMemo(
    () =>
      directoryItems.filter((item) => (apps || !item.bot) && (hasCinema || item.id !== 'cinema')),
    [apps, hasCinema],
  );
  const highlights = useMemo(
    () =>
      featured
        .map((id) => items.find((item) => item.id === id))
        .filter((item): item is DirectoryItem => !!item)
        .slice(0, 4),
    [items],
  );
  const matches = useMemo(() => {
    const words = fold(query.trim()).split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    return items.filter((item) => {
      const text = fold(
        `${item.name} ${item.detail} ${sectionLabels[item.section]} ${item.keywords}`,
      );
      return words.every((word) => text.includes(word));
    });
  }, [items, query]);
  const open = (path: string) => openRoomActivity(path, navigate);
  const launch = (item: DirectoryItem) => {
    if (item.voice && voice.status !== 'connected') return;
    item.run(open);
    onClose();
  };
  const row = (item: DirectoryItem) => {
    const blocked = item.voice && voice.status !== 'connected';
    return (
      <button
        key={item.id}
        className="appdir-row"
        disabled={blocked}
        title={blocked ? t('Önce bir ses odasına katıl.') : undefined}
        onClick={() => launch(item)}
      >
        <Tile item={item} />
        <span>
          <strong>{item.name}</strong>
          <small>{blocked ? t('Önce bir ses odasına katıl.') : item.detail}</small>
        </span>
      </button>
    );
  };
  return (
    <div className="appdir" role="dialog" aria-label={t('Uygulamalar ve etkinlikler')}>
      {header}
      <label className="appdir-search">
        <Search size={17} aria-hidden="true" />
        <input
          autoFocus
          aria-label={t('Uygulama ve etkinlik ara')}
          placeholder={t('Uygulama ve etkinlik ara')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              onClose();
            }
            if (event.key === 'Enter' && matches?.[0]) launch(matches[0]);
          }}
        />
      </label>
      <div className="appdir-scroll">
        {primary && !matches && (
          <button
            className="appdir-live"
            onClick={() => {
              openActivity(primary.activity, navigate);
              onClose();
            }}
          >
            <i aria-hidden="true" />
            <span>
              <small>{t('Şu an odada')}</small>
              <strong>
                {(gameNames as Record<string, string>)[primary.title] ?? primary.title}
              </strong>
            </span>
            {activityRoute(primary.activity) ? (
              <em>
                {t('Katıl')} <ArrowRight size={14} />
              </em>
            ) : (
              <em>{t('Eski Sinema · ayrıntılar')}</em>
            )}
          </button>
        )}
        {matches ? (
          matches.length ? (
            <div className="appdir-list">{matches.map(row)}</div>
          ) : (
            <p className="appdir-empty">
              {t('“{query}” için bir şey bulunamadı.', { query: query.trim() })}
            </p>
          )
        ) : (
          <>
            <h3>{t('Öne çıkanlar')}</h3>
            <div className="appdir-featured">
              {highlights.map((item) => (
                <button key={item.id} className="appdir-card" onClick={() => launch(item)}>
                  <Tile item={item} large />
                  <span>
                    <strong>{item.name}</strong>
                    <small>{item.detail}</small>
                  </span>
                </button>
              ))}
            </div>
            {sections.map((section) => {
              const list = items.filter((item) => item.section === section);
              return list.length ? (
                <section key={section}>
                  <h3>{sectionLabels[section]}</h3>
                  <div className="appdir-list">{list.map(row)}</div>
                </section>
              ) : null;
            })}
          </>
        )}
      </div>
    </div>
  );
}
