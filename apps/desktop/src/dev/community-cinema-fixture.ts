import type { DesktopBridge } from '@rooms/contracts';
import type {
  ActivityResponse,
  QueueItem,
  RoomSnapshot,
} from '../../../../packages/activity-protocol/src';
import {
  RMDB_REVIEW_MAX,
  type CatalogKind,
  type CinemaCategory,
  type CinemaContinueItem,
  type CinemaDetails,
  type CinemaEpisode,
  type CinemaItem,
  type CinemaProgramme,
  type CinemaStatus,
  type RmdbDiaryEntry,
  type RmdbEpisodeProgress,
  type RmdbEpisodeRef,
  type RmdbPerson,
  type RmdbProgress,
  type RmdbReview,
  type RmdbWorkDetails,
  type RmdbWorkSummary,
  type StremioStream,
  type StremioTitle,
} from '../../../../packages/community-cinema/src/types';
import type {
  CinemaBridge,
  CinemaItemsQuery,
  CinemaSourceInput,
} from '../../../../packages/community-cinema/src/bridge';
import { formatVtt } from '../../../../packages/community-cinema/src/webvtt';
import { installCinemaFixture } from '../cinema/cinema-bridge';
import { installMediaFixture } from './media-fixture';
import { installDevelopmentRuntime, mediaBridge, mediaProvider } from '../runtime-sources';
import { useCommunity } from '../community';
import { people as crew, sample } from './sample';

/**
 * S80 · DEV-only community cinema. Every channel, film, programme and RMDB rating, review and
 * diary line below is invented sample data with generated artwork; nothing reaches a cinema
 * service, a relay or a provider. `rmdb_empty` shows an RMDB nobody has used yet.
 */
export const COMMUNITY_CINEMA_FIXTURE_VARIANTS = [
  'default',
  'empty',
  'vod',
  'not_connected',
  'member',
  'no_hall',
  'importing',
  'error',
  'remote',
  'rmdb_empty',
  /** No IPTV account; Stremio is linked. */
  'stremio',
] as const;
export type CommunityCinemaFixtureVariant = (typeof COMMUNITY_CINEMA_FIXTURE_VARIANTS)[number];

export const FIXTURE_HALL_ID = 'demo-channel-film-gecesi';
export const FIXTURE_COMMUNITY_ID = 'demo-bizim-oda';
const me = 'demo-deniz';

function hex(text: string) {
  let a = 0x811c9dc5,
    b = 0x01000193;
  for (const char of text) {
    a = Math.imul(a ^ char.charCodeAt(0), 0x01000193) >>> 0;
    b = Math.imul(b ^ char.charCodeAt(0), 0x5bd1e995) >>> 0;
  }
  return (a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0')).slice(0, 16);
}

type Art = { kind: 'logo' | 'poster' | 'backdrop' | 'still'; label: string; hue: number };
const artwork = new Map<string, Art>();
function art(kind: Art['kind'], label: string, hue: number) {
  const id = hex(`${kind}:${label}`);
  artwork.set(id, { kind, label, hue });
  return id;
}

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Generated vector artwork: logo tiles, poster gradients and dusk scenes. */
export function fixtureArt(artId: string): string | null {
  const value = artwork.get(artId);
  if (!value) return null;
  const { kind, label, hue } = value;
  const h2 = (hue + 38) % 360;
  let svg: string;
  if (kind === 'logo') {
    const short = label
      .replace(/\b(HD|FHD|4K|TV)\b/g, '')
      .trim()
      .split(/\s+/)
      .map((word) => word[0])
      .join('')
      .slice(0, 3)
      .toLocaleUpperCase('tr');
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${hue} 62% 52%)"/><stop offset="1" stop-color="hsl(${h2} 58% 34%)"/></linearGradient></defs><rect width="96" height="96" rx="20" fill="url(#g)"/><text x="48" y="58" font-family="Inter,system-ui,sans-serif" font-size="${short.length > 2 ? 26 : 32}" font-weight="700" fill="#fff" text-anchor="middle">${escape(short)}</text></svg>`;
  } else if (kind === 'poster') {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 300"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 46% 40%)"/><stop offset="0.62" stop-color="hsl(${h2} 44% 20%)"/><stop offset="1" stop-color="hsl(${h2} 40% 9%)"/></linearGradient><radialGradient id="s" cx="0.7" cy="0.28" r="0.32"><stop offset="0" stop-color="hsl(${(hue + 30) % 360} 90% 78%)" stop-opacity=".9"/><stop offset="1" stop-color="hsl(${hue} 90% 70%)" stop-opacity="0"/></radialGradient></defs><rect width="200" height="300" fill="url(#g)"/><circle cx="140" cy="84" r="64" fill="url(#s)"/><path d="M0 214 Q50 176 100 204 T200 190 V300 H0Z" fill="hsl(${h2} 40% 12%)" opacity=".85"/></svg>`;
  } else {
    svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900"><defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="hsl(${hue} 50% 22%)"/><stop offset="0.55" stop-color="hsl(${h2} 62% 46%)"/><stop offset="1" stop-color="hsl(${(h2 + 20) % 360} 72% 66%)"/></linearGradient><radialGradient id="sun" cx="0.66" cy="0.58" r="0.2"><stop offset="0" stop-color="#fff4d8"/><stop offset="0.4" stop-color="hsl(${(h2 + 24) % 360} 90% 72%)" stop-opacity=".8"/><stop offset="1" stop-color="hsl(${h2} 90% 60%)" stop-opacity="0"/></radialGradient></defs><rect width="1600" height="900" fill="url(#sky)"/><circle cx="1056" cy="522" r="300" fill="url(#sun)"/><path d="M0 610 Q260 520 520 600 T1040 580 T1600 560 V900 H0Z" fill="hsl(${hue} 38% 16%)"/><path d="M0 700 Q300 640 640 700 T1280 690 T1600 680 V900 H0Z" fill="hsl(${hue} 40% 10%)"/><path d="M0 790 Q400 750 800 790 T1600 780 V900 H0Z" fill="hsl(${hue} 42% 6%)"/></svg>`;
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

const titles = {
  blueHour: sample('Mavi Saat', 'Blue Hour'),
  edgeOfDusk: sample('Gecenin Kıyısında', 'At the Edge of Dusk'),
  nationOne: sample('TRT 1', 'Nation One'),
};
const homeFlag = sample('🇹🇷', '🇺🇸');
type Channel = { name: string; category: string; badges: string[]; hue: number; shows: string[] };
const liveCategories: { id: string; label: string; flag: string | null }[] = [
  { id: 'ulusal', label: sample('Ulusal', 'National'), flag: homeFlag },
  { id: 'haber', label: sample('Haber', 'News'), flag: homeFlag },
  { id: 'spor', label: sample('Spor', 'Sports'), flag: homeFlag },
  { id: 'belgesel', label: sample('Belgesel', 'Documentary'), flag: homeFlag },
  { id: 'cocuk', label: sample('Çocuk', 'Kids'), flag: homeFlag },
  { id: 'muzik', label: sample('Müzik', 'Music'), flag: homeFlag },
  { id: 'uk', label: 'Entertainment', flag: '🇬🇧' },
];
const showsBy: Record<string, string[]> = {
  ulusal: sample(
    [
      'Ana Haber',
      'Yalı Günleri',
      'Gece Vardiyası',
      'Sabah Kahvesi',
      'Kayıp Şehir',
      'Mahalle',
      'Yarışma Gecesi',
      'Sinema Kuşağı',
    ],
    [
      'Prime News',
      'Harbor Days',
      'Night Shift',
      'Morning Coffee',
      'The Lost City',
      'The Block',
      'Game Night Live',
      'Movie Slot',
    ],
  ),
  haber: sample(
    [
      'Gün Ortası',
      'Ekonomi Masası',
      'Ana Haber',
      'Dünya Gündemi',
      'Gece Bülteni',
      'Tartışma Saati',
    ],
    ['Midday Report', 'Money Desk', 'Prime News', 'World Today', 'Late Bulletin', 'Debate Hour'],
  ),
  spor: sample(
    [
      'Maç Önü',
      'Süper Lig: Canlı',
      'Maç Sonu',
      'Basketbol Gecesi',
      'Spor Bülteni',
      'Tenis: Yarı Final',
    ],
    [
      'Pre-Match',
      'League Live',
      'Post-Match',
      'Basketball Night',
      'Sports Bulletin',
      'Tennis: Semi-Final',
    ],
  ),
  belgesel: sample(
    ['Anadolu’nun Kuşları', 'Derin Mavi', 'Kayıp Uygarlıklar', 'Vahşi Doğa', 'Şehirlerin Hikâyesi'],
    ['Birds of the Highlands', 'Deep Blue', 'Lost Civilisations', 'Wild Nature', 'City Stories'],
  ),
  cocuk: sample(
    ['Minik Kâşifler', 'Uzay Kedisi', 'Masal Saati', 'Renkli Orman', 'Robot Arkadaşım'],
    ['Little Explorers', 'Space Cat', 'Story Time', 'Rainbow Forest', 'My Robot Friend'],
  ),
  muzik: sample(
    ['Pop Listesi', 'Akustik Saat', 'Klip Kuşağı', 'Gece Seansı', 'Nostalji'],
    ['Pop Chart', 'Acoustic Hour', 'Video Block', 'Late Session', 'Throwback'],
  ),
  uk: ['Morning Live', 'Quiz Night', 'The Evening Show', 'Garden Diaries', 'Late News'],
};
const channelList: Channel[] = [
  [titles.nationOne, 'ulusal', ['HD'], 352],
  [sample('Show TV', 'Spotlight TV'), 'ulusal', ['FHD'], 28],
  [sample('Kanal D', 'Channel Delta'), 'ulusal', ['HD'], 210],
  [sample('ATV', 'Atlas TV'), 'ulusal', ['HD'], 6],
  [sample('Star TV', 'Starlight TV'), 'ulusal', ['HD'], 48],
  [sample('NOW', 'Now Network'), 'ulusal', ['FHD'], 190],
  [sample('TV8', 'Eight TV'), 'ulusal', ['HD'], 300],
  [sample('TRT 2', 'Nation Two'), 'ulusal', ['HD'], 160],
  [sample('TRT Haber', 'City News'), 'haber', ['HD'], 220],
  [sample('CNN Türk', 'World News 24'), 'haber', ['HD'], 0],
  [sample('NTV', 'Metro News'), 'haber', ['HD'], 200],
  [sample('Habertürk', 'Daily Headlines'), 'haber', ['FHD'], 14],
  [sample('Halk TV', 'People TV'), 'haber', [], 340],
  [sample('beIN Sports 1', 'Sports One'), 'spor', ['FHD'], 280],
  [sample('beIN Sports 2', 'Sports Two'), 'spor', ['HD'], 284],
  [sample('TRT Spor', 'Arena Sport'), 'spor', ['HD'], 130],
  [sample('S Sport', 'Stadium Sport'), 'spor', ['4K', 'H265'], 0],
  [sample('TRT Belgesel', 'Nature Channel'), 'belgesel', ['HD'], 96],
  [sample('Doğa Belgesel', 'Wild Planet'), 'belgesel', ['FHD'], 120],
  [sample('Tarih TV', 'Heritage TV'), 'belgesel', [], 36],
  [sample('TRT Çocuk', 'Kids Club'), 'cocuk', [], 52],
  [sample('Minika Go', 'Mini Go'), 'cocuk', [], 320],
  [sample('Kral Pop', 'King Pop'), 'muzik', ['HD'], 330],
  [sample('Power Türk', 'Power Hits'), 'muzik', ['FHD'], 270],
  [sample('BBC One', 'Channel Six'), 'uk', ['HD'], 0],
  [sample('Sky News', 'Skyline News'), 'uk', ['HD'], 350],
].map(([name, category, badges, hue]) => ({
  name: name as string,
  category: category as string,
  badges: badges as string[],
  hue: hue as number,
  shows: showsBy[category as string]!,
}));

const films = [
  [sample('Son Vapur', 'The Last Ferry'), 'yerli', 2024, 7.8, 32],
  [sample('Bozkırda Bir Yaz', 'A Summer on the Prairie'), 'yerli', 2023, 7.2, 40],
  [titles.blueHour, 'dram', 2025, 8.1, 220],
  [sample('Uzak Kıyı', 'Distant Shore'), 'dram', 2022, 6.9, 196],
  [sample('Kırmızı Balon', 'The Crimson Kite'), 'komedi', 2024, 6.4, 2],
  [sample('Deniz Feneri', 'Lamplight Point'), 'dram', 2021, 7.6, 205],
  [sample('Sessiz Sokak', 'Quiet Street'), 'gerilim', 2025, 7.0, 250],
  [sample('Gölgeler Arasında', 'Among the Shadows'), 'gerilim', 2023, 6.8, 270],
  [sample('Eski Defter', 'The Old Ledger'), 'yerli', 2020, 7.4, 30],
  [sample('Rüzgârın Kızı', 'Daughter of the Wind'), 'macera', 2024, 7.1, 150],
  [sample('Sonbahar Mektupları', 'Autumn Letters'), 'dram', 2019, 7.9, 24],
  [sample('Yıldız Tozu', 'Starlight Drift'), 'macera', 2025, 7.3, 260],
  [sample('Pazar Yolculuğu', 'Sunday Drive'), 'komedi', 2023, 6.6, 46],
  [sample('Şehir Uyurken', 'City After Midnight'), 'gerilim', 2024, 7.5, 230],
  [titles.edgeOfDusk, 'dram', 2025, 8.0, 280],
  [sample('Ada Masalı', 'Island Tale'), 'yerli', 2022, 6.7, 180],
] as const;
const filmCategories = [
  { id: 'yerli', label: sample('Yerli Filmler', 'Local Films') },
  { id: 'dram', label: sample('Dram', 'Drama') },
  { id: 'gerilim', label: sample('Gerilim', 'Thriller') },
  { id: 'komedi', label: sample('Komedi', 'Comedy') },
  { id: 'macera', label: sample('Macera', 'Adventure') },
];
const shows = [
  [sample('Mahalle', 'The Block'), 'yerli-dizi', 2024, 8.2, 26, 3],
  [sample('Köprüaltı', 'Under the Bridge'), 'yerli-dizi', 2023, 7.7, 200, 2],
  [sample('Kayıp Şehir', 'The Lost City'), 'gizem', 2025, 8.4, 240, 2],
  [sample('Yalı Günleri', 'Harbor Days'), 'yerli-dizi', 2022, 7.1, 190, 3],
  [sample('Gece Vardiyası', 'Night Shift'), 'gizem', 2024, 7.9, 260, 1],
  [sample('İkinci Bahar', 'Second Spring'), 'komedi-dizi', 2021, 7.3, 36, 2],
  [sample('Ayna', 'The Mirror Room'), 'gizem', 2025, 8.0, 300, 1],
  [sample('Dört Mevsim', 'Four Seasons'), 'komedi-dizi', 2023, 6.9, 110, 2],
] as const;
const showCategories = [
  { id: 'yerli-dizi', label: sample('Yerli Diziler', 'Local Series') },
  { id: 'gizem', label: sample('Gizem ve Gerilim', 'Mystery & Thriller') },
  { id: 'komedi-dizi', label: sample('Komedi', 'Comedy') },
];

const day = 86_400_000;
function buildCatalog(now: number) {
  const items: CinemaItem[] = [];
  const programmes = new Map<string, CinemaProgramme[]>();
  const details = new Map<string, CinemaDetails>();
  channelList.forEach((channel, index) => {
    const ref = `l-${1001 + index}`;
    items.push({
      ref,
      kind: 'live',
      title: channel.name,
      badges: channel.badges,
      categoryId: channel.category,
      number: index + 1,
      art: art('logo', channel.name, channel.hue),
      year: null,
      rating: null,
      addedAt: null,
      hasGuide: channel.category !== 'muzik' || index % 2 === 0,
    });
    const list: CinemaProgramme[] = [];
    const lengths = [30, 45, 60, 90, 40, 120, 50];
    let start = Math.floor((now - 3 * 3_600_000) / 900_000) * 900_000 - (index % 4) * 900_000;
    let k = index;
    while (start < now + 26 * 3_600_000) {
      const minutes = lengths[k % lengths.length]!;
      const title = channel.shows[k % channel.shows.length]!;
      list.push({
        start,
        stop: start + minutes * 60_000,
        title,
        subTitle: k % 3 === 0 ? sample(`${(k % 40) + 1}. Bölüm`, `Episode ${(k % 40) + 1}`) : null,
        description:
          k % 2 === 0
            ? sample(
                `${title}, ${channel.name} ekranlarında. Bu akşamın konukları ve sürprizleriyle canlı yayında.`,
                `${title} on ${channel.name}. Live tonight with guests and surprises.`,
              )
            : sample(
                `${channel.name} yayın akışında ${title.toLocaleLowerCase('tr')} saati.`,
                `${title} time on the ${channel.name} schedule.`,
              ),
        category: liveCategories.find((c) => c.id === channel.category)?.label ?? null,
      });
      start += minutes * 60_000;
      k++;
    }
    if (items[items.length - 1]!.hasGuide) programmes.set(ref, list);
  });
  films.forEach(([title, category, year, rating, hue], index) => {
    const ref = `m-${3001 + index}`;
    const item: CinemaItem = {
      ref,
      kind: 'movie',
      title,
      badges: index % 3 === 0 ? ['4K', 'HDR'] : index % 2 ? ['FHD'] : ['HD'],
      categoryId: category,
      number: null,
      art: art('poster', title, hue),
      year,
      rating,
      addedAt: now - index * 1.7 * day,
      hasGuide: false,
    };
    items.push(item);
    details.set(ref, {
      item,
      plot: sample(
        `${title}, birbirini yıllardır görmeyen eski dostların tek bir gecede yeniden karşılaşmasını anlatıyor. Sessiz, sıcak ve sonunda insanı gülümseten bir hikâye.`,
        `${title} follows old friends who have not seen each other in years as they meet again in a single night. A quiet, warm story that leaves you smiling.`,
      ),
      genre: filmCategories.find((c) => c.id === category)?.label ?? null,
      cast: sample('Elif Aras, Mert Kaya, Selin Tan', 'Emily Hart, Daniel Reed, Sophie Lane'),
      director: sample('Deniz Yalçın', 'Alex Morgan'),
      durationSec: (95 + (index % 5) * 9) * 60,
      backdrop: art('backdrop', title, hue),
      seasons: [],
    });
  });
  shows.forEach(([title, category, year, rating, hue, seasonCount], index) => {
    const ref = `s-${5001 + index}`;
    const item: CinemaItem = {
      ref,
      kind: 'series',
      title,
      badges: index % 2 ? ['FHD'] : ['HD'],
      categoryId: category,
      number: null,
      art: art('poster', title, hue),
      year,
      rating,
      addedAt: now - index * 2.3 * day,
      hasGuide: false,
    };
    items.push(item);
    const seasons = Array.from({ length: seasonCount }, (_, s) => ({
      season: s + 1,
      episodes: Array.from({ length: 6 + ((s + index) % 3) }, (_, e): CinemaEpisode => ({
        ref: `e-${5001 + index}${s + 1}${String(e + 1).padStart(2, '0')}`,
        season: s + 1,
        episode: e + 1,
        title: sample(
          ['Başlangıç', 'Eski Ev', 'Kapı', 'Gece Treni', 'Yağmur', 'Mektup', 'Son Gün', 'Dönüş'],
          [
            'Beginning',
            'Old House',
            'The Door',
            'Night Train',
            'Rain',
            'The Letter',
            'Final Day',
            'Return',
          ],
        )[e % 8]!,
        plot: sample(
          'Mahalleye yeni taşınan bir aile, bodrumda eski bir sandık bulur. Sandıktan çıkan defter herkesin hayatını değiştirecektir.',
          'A family that has just moved into the neighborhood finds an old chest in the basement. The notebook inside will change everyone’s life.',
        ),
        durationSec: (42 + ((e * 3) % 12)) * 60,
        art: art('still', `${title} ${s + 1}.${e + 1}`, (hue + e * 9) % 360),
      })),
    }));
    details.set(ref, {
      item,
      plot: sample(
        `${title}, aynı apartmanda yaşayan dört komşunun bir yaz boyunca birbirine karışan hayatlarını anlatıyor.`,
        `${title} follows four neighbors in the same building as their lives tangle together over one summer.`,
      ),
      genre: showCategories.find((c) => c.id === category)?.label ?? null,
      cast: sample(
        'Ayşe Demir, Can Öztürk, Zeynep Arslan',
        'Grace Miller, Ryan Cole, Chloe Parker',
      ),
      director: sample('Ece Kılıç', 'Erin Clarke'),
      durationSec: null,
      backdrop: art('backdrop', title, hue),
      seasons,
    });
  });
  const categories: CinemaCategory[] = [
    ...liveCategories.map((c) => ({
      id: c.id,
      kind: 'live' as const,
      label: c.label,
      flag: c.flag,
      count: items.filter((i) => i.kind === 'live' && i.categoryId === c.id).length,
    })),
    ...filmCategories.map((c) => ({
      id: c.id,
      kind: 'movie' as const,
      label: c.label,
      flag: null,
      count: items.filter((i) => i.kind === 'movie' && i.categoryId === c.id).length,
    })),
    ...showCategories.map((c) => ({
      id: c.id,
      kind: 'series' as const,
      label: c.label,
      flag: null,
      count: items.filter((i) => i.kind === 'series' && i.categoryId === c.id).length,
    })),
  ];
  return { items, programmes, details, categories };
}

const fold = (text: string) =>
  text.toLocaleLowerCase('tr').normalize('NFKD').replace(/\p{M}/gu, '').replace(/ı/g, 'i');

/** A DEMO RMDB entry as the fixture keeps it; `ref` is null once the title left the catalog. */
type DemoWork = {
  id: string;
  ref: string | null;
  kind: 'movie' | 'series';
  title: string;
  year: number | null;
  genre: string | null;
  art: string | null;
  backdrop: string | null;
  plot: string | null;
  director: string | null;
  cast: string | null;
  durationSec: number | null;
  addedAt: number;
  touchedAt: number;
  progress: RmdbProgress | null;
  reviews: RmdbReview[];
  diary: RmdbDiaryEntry[];
  episodes: RmdbEpisodeProgress[];
  watchlist: { by: RmdbPerson; at: number } | null;
};

const demoPeople = {
  deniz: { userId: 'demo-deniz', name: crew.deniz },
  ece: { userId: 'demo-ece', name: crew.ece },
  can: { userId: 'demo-can', name: crew.can },
  zeynep: { userId: 'demo-zeynep', name: crew.zeynep },
  mert: { userId: 'demo-mert', name: crew.mert },
} satisfies Record<string, RmdbPerson>;

/**
 * DEMO RMDB for S80: invented ratings, reviews and diary lines by the fixture's demo members
 * over the fixture catalog, plus one title that is no longer in it. Never real member data.
 */
function demoRmdb(now: number, catalog: ReturnType<typeof buildCatalog>): DemoWork[] {
  const { deniz, ece, can, zeynep, mert } = demoPeople;
  const hour = 3_600_000;
  let line = 0;
  const review = (
    author: RmdbPerson,
    rating: number | null,
    text: string,
    at: number,
    extra: Partial<RmdbReview> = {},
  ): RmdbReview => ({
    author,
    rating,
    text,
    spoiler: false,
    liked: false,
    createdAt: at,
    updatedAt: at,
    ...extra,
  });
  const hallWatch = (
    at: number,
    viewers: RmdbPerson[],
    finished = true,
    episode: RmdbEpisodeRef | null = null,
    positionSec: number | null = null,
  ): RmdbDiaryEntry => ({
    id: `d-demo-${++line}`,
    watchedAt: at,
    viewers,
    episode,
    finished,
    positionSec,
    source: 'hall',
    loggedBy: null,
  });
  const handLog = (at: number, by: RmdbPerson): RmdbDiaryEntry => ({
    id: `d-demo-${++line}`,
    watchedAt: at,
    viewers: [by],
    episode: null,
    finished: true,
    positionSec: null,
    source: 'manual',
    loggedBy: by,
  });
  const base = (ref: string, id: string, addedAt: number) => {
    const entry = catalog.details.get(ref)!;
    return {
      id,
      ref,
      kind: entry.item.kind as 'movie' | 'series',
      title: entry.item.title,
      year: entry.item.year,
      genre: entry.genre,
      art: entry.item.art,
      backdrop: entry.backdrop,
      plot: entry.plot,
      director: entry.director,
      cast: entry.cast,
      durationSec: entry.durationSec,
      addedAt,
      touchedAt: addedAt,
      progress: null,
      reviews: [],
      diary: [],
      episodes: [],
      watchlist: null,
    } satisfies DemoWork;
  };
  const film = (ref: string, at: number, position: number | 'end'): RmdbProgress => {
    const duration = catalog.details.get(ref)!.durationSec ?? 6000;
    return {
      positionSec: position === 'end' ? duration - 40 : position,
      durationSec: duration,
      finished: position === 'end',
      episode: null,
      updatedAt: at,
    };
  };
  const episodeOf = (ref: string, season: number, episode: number) =>
    catalog.details
      .get(ref)!
      .seasons.find((value) => value.season === season)!
      .episodes.find((value) => value.episode === episode)!;
  const episodeRef = (ref: string, season: number, episode: number): RmdbEpisodeRef => ({
    season,
    episode,
    title: episodeOf(ref, season, episode).title,
  });
  /** A run of watched episodes; the last one stops at `lastAt` seconds unless it is null. */
  const binge = (
    ref: string,
    list: [season: number, episode: number][],
    startAt: number,
    viewers: RmdbPerson[],
    lastAt: number | null = null,
  ) => {
    const episodes: RmdbEpisodeProgress[] = [];
    const diary: RmdbDiaryEntry[] = [];
    list.forEach(([season, episode], index) => {
      const last = index === list.length - 1;
      const at = startAt + index * 0.8 * day;
      const duration = episodeOf(ref, season, episode).durationSec ?? 2700;
      const finished = !(last && lastAt !== null);
      episodes.push({
        ...episodeRef(ref, season, episode),
        positionSec: finished ? duration - 30 : lastAt!,
        durationSec: duration,
        finished,
        watchedAt: at,
      });
      diary.push(
        hallWatch(
          at,
          viewers,
          finished,
          episodeRef(ref, season, episode),
          finished ? duration - 30 : lastAt,
        ),
      );
    });
    const last = episodes[episodes.length - 1]!;
    const progress: RmdbProgress = {
      positionSec: last.positionSec,
      durationSec: last.durationSec,
      finished: last.finished,
      episode: { season: last.season, episode: last.episode, title: last.title },
      updatedAt: last.watchedAt + hour,
    };
    return { episodes, diary, progress };
  };
  const range = (season: number, from: number, to: number) =>
    Array.from({ length: to - from + 1 }, (_, i): [number, number] => [season, from + i]);

  const mahalle = binge(
    's-5001',
    [...range(1, 1, 6), ...range(2, 1, 3)],
    now - 9 * day,
    [ece, deniz, mert],
    730,
  );
  const kayip = binge('s-5003', range(1, 1, 8), now - 11 * day, [zeynep, deniz, can]);
  const kopru = binge('s-5002', range(1, 1, 2), now - 13 * day, [can, deniz]);
  const vardiya = binge('s-5005', range(1, 1, 7), now - 45 * day, [ece, zeynep, deniz]);
  return [
    {
      ...base('m-3003', 'w-demo-mavi-saat', now - 19 * day),
      touchedAt: now - 2 * day + 4 * hour,
      progress: film('m-3003', now - 2 * day + 2 * hour, 'end'),
      reviews: [
        review(
          deniz,
          8,
          sample(
            'İkinci izleyişte daha da güzeldi. İskele sahnesi hâlâ aklımda.',
            'Even better the second time. The pier scene is still stuck in my head.',
          ),
          now - 2 * day + 3 * hour,
          { liked: true },
        ),
        review(
          ece,
          9,
          sample(
            'Son sahnede salonda kimse konuşmadı. Müzikleri de ayrıca çok iyi.',
            'Nobody in the room said a word during the last scene. The score is great too.',
          ),
          now - 18 * day,
          { liked: true },
        ),
        review(
          can,
          8,
          sample(
            'Görüntüler harika; ortası biraz uzamış ama değdi.',
            'Gorgeous visuals; the middle drags a bit but it was worth it.',
          ),
          now - 18 * day - hour,
        ),
        review(zeynep, 10, '', now - 17 * day, { liked: true }),
        review(
          mert,
          7,
          sample(
            'Herkes kadar sevmedim ama güzel bir akşamdı.',
            'I did not love it as much as everyone else, but it was a good evening.',
          ),
          now - 2 * day + 4 * hour,
        ),
      ],
      diary: [
        hallWatch(now - 2 * day, [deniz, mert]),
        hallWatch(now - 19 * day, [ece, can, deniz, zeynep]),
        handLog(now - 60 * day, ece),
      ],
    },
    {
      ...base('m-3015', 'w-demo-gecenin-kiyisinda', now - day),
      touchedAt: now - day + 2 * hour,
      progress: film('m-3015', now - day + hour, 2530),
      reviews: [
        review(
          zeynep,
          9,
          sample(
            'Yarısındayız ama şimdiden favorim. Kimse sonunu söylemesin!',
            'Halfway through and already my favorite. Nobody spoil the ending!',
          ),
          now - day + 2 * hour,
        ),
        review(ece, 8, '', now - day + 2 * hour),
      ],
      diary: [hallWatch(now - day, [ece, can, deniz], false, null, 2530)],
    },
    {
      ...base('s-5001', 'w-demo-mahalle', now - 9 * day),
      touchedAt: mahalle.progress.updatedAt,
      ...mahalle,
      reviews: [
        review(
          mert,
          9,
          sample(
            'Apartman toplantısı bölümü efsane.',
            'The residents’ meeting episode is legendary.',
          ),
          now - 5 * day,
          { liked: true },
        ),
        review(ece, 8, '', now - 6 * day),
      ],
    },
    {
      ...base('m-3001', 'w-demo-son-vapur', now - 6 * day),
      touchedAt: now - 6 * day + hour,
      progress: film('m-3001', now - 6 * day, 'end'),
      reviews: [
        review(
          mert,
          7,
          sample(
            'Biraz yavaş ama görüntüler çok güzel.',
            'A bit slow, but the visuals are beautiful.',
          ),
          now - 6 * day + hour,
        ),
      ],
      diary: [hallWatch(now - 6 * day - 2 * hour, [deniz, ece, mert])],
    },
    {
      ...base('m-3006', 'w-demo-deniz-feneri', now - 3 * day),
      watchlist: { by: zeynep, at: now - 3 * day },
    },
    {
      ...base('m-3009', 'w-demo-eski-defter', now - 4 * day),
      touchedAt: now - 4 * day,
      progress: film('m-3009', now - 4 * day, 900),
      diary: [hallWatch(now - 4 * day - hour, [deniz, mert], false, null, 900)],
    },
    {
      ...base('s-5003', 'w-demo-kayip-sehir', now - 11 * day),
      touchedAt: kayip.progress.updatedAt,
      ...kayip,
      reviews: [
        review(
          zeynep,
          10,
          sample(
            'Sezon finali! Sesimiz bütün apartmana gitti.',
            'Season finale! We were so loud the whole building heard us.',
          ),
          now - 5 * day,
          {
            liked: true,
          },
        ),
        review(deniz, 9, '', now - 5 * day + hour),
      ],
    },
    {
      ...base('m-3007', 'w-demo-sessiz-sokak', now - 9 * day),
      touchedAt: now - 9 * day + 2 * hour,
      progress: film('m-3007', now - 9 * day, 'end'),
      reviews: [
        review(
          can,
          8,
          sample(
            'Katil baştan beri karşı komşuymuş; son sahnedeki ayna her şeyi açıklıyor.',
            'The killer was the neighbor across the street all along; the mirror in the last scene explains everything.',
          ),
          now - 9 * day + hour,
          { spoiler: true },
        ),
        review(
          ece,
          6,
          sample(
            'Gerilimi iyi kurulmuş ama sonu biraz aceleye gelmiş.',
            'Nicely built tension, but the ending feels a bit rushed.',
          ),
          now - 9 * day + 2 * hour,
        ),
      ],
      diary: [hallWatch(now - 9 * day - hour, [can, zeynep, deniz, ece])],
    },
    {
      ...base('m-3010', 'w-demo-ruzgarin-kizi', now - day - 5 * hour),
      watchlist: { by: deniz, at: now - day - 5 * hour },
    },
    {
      ...base('s-5002', 'w-demo-koprualti', now - 13 * day),
      touchedAt: kopru.progress.updatedAt,
      ...kopru,
      reviews: [
        review(
          can,
          6,
          sample(
            'Fena değil, ikinci bölümde açıldı.',
            'Not bad, it picked up in the second episode.',
          ),
          now - 12 * day,
        ),
      ],
    },
    {
      ...base('s-5007', 'w-demo-ayna', now - 8 * day),
      watchlist: { by: ece, at: now - 8 * day },
    },
    {
      ...base('s-5005', 'w-demo-gece-vardiyasi', now - 45 * day),
      touchedAt: vardiya.progress.updatedAt,
      ...vardiya,
      reviews: [
        review(
          ece,
          8,
          sample('Final tam yerindeydi.', 'The finale landed perfectly.'),
          now - 38 * day,
          { liked: true },
        ),
        review(zeynep, 7, '', now - 38 * day),
      ],
    },
    {
      id: 'w-demo-kuzey-treni',
      ref: null,
      kind: 'movie',
      title: sample('Kuzey Treni', 'Northbound Train'),
      year: 2019,
      genre: sample('Dram', 'Drama'),
      art: art('poster', sample('Kuzey Treni', 'Northbound Train'), 200),
      backdrop: art('backdrop', sample('Kuzey Treni', 'Northbound Train'), 200),
      plot: sample(
        'Kışın son treniyle kuzeye giden iki kardeş, yolda eski bir aile sırrıyla yüzleşir.',
        'Two siblings riding the last train of winter north come face to face with an old family secret.',
      ),
      director: sample('Selin Aydın', 'Hannah Doyle'),
      cast: sample('Ozan Er, Melis Kaya', 'Owen Ellis, Mia Kerr'),
      durationSec: 6300,
      addedAt: now - 70 * day,
      touchedAt: now - 69 * day,
      progress: {
        positionSec: 6260,
        durationSec: 6300,
        finished: true,
        episode: null,
        updatedAt: now - 70 * day,
      },
      reviews: [
        review(
          ece,
          9,
          sample(
            'Katalogdan kalktı ama kaydı burada duruyor; iyi ki izlemişiz.',
            'It left the catalogue but its record stays here; glad we watched it.',
          ),
          now - 69 * day,
        ),
        review(can, 8, '', now - 69 * day),
      ],
      diary: [hallWatch(now - 70 * day, [ece, can, zeynep, mert, deniz])],
      episodes: [],
      watchlist: null,
    },
  ];
}

export function createCommunityCinemaFixtureBridge(
  variant: CommunityCinemaFixtureVariant,
  now = Date.now(),
): CinemaBridge {
  const catalog = buildCatalog(now);
  let status: CinemaStatus = {
    communityId: FIXTURE_COMMUNITY_ID,
    hallChannelId: variant === 'no_hall' ? null : FIXTURE_HALL_ID,
    isOwner: variant !== 'member' && variant !== 'remote',
    connected: variant !== 'not_connected' && variant !== 'member' && variant !== 'stremio',
    source:
      variant === 'not_connected' || variant === 'member' || variant === 'stremio'
        ? null
        : { kind: 'xtream', label: 'https://ipt***:8080', hasCustomGuide: false },
    account:
      variant === 'not_connected' || variant === 'member' || variant === 'stremio'
        ? null
        : { status: 'Active', expiresAt: now + 140 * day, maxConnections: 2 },
    catalog: {
      live: catalog.items.filter((i) => i.kind === 'live').length,
      movies: catalog.items.filter((i) => i.kind === 'movie').length,
      series: catalog.items.filter((i) => i.kind === 'series').length,
      programmes: [...catalog.programmes.values()].reduce((n, list) => n + list.length, 0),
      importedAt: now - 3 * 3_600_000,
      guideImportedAt: now - 12 * 60_000,
    },
    importing:
      variant === 'importing'
        ? {
            step: 'movies',
            counts: { live: 26, movies: 9, series: 0, programmes: 0 },
            error: null,
            startedAt: now - 40_000,
            finishedAt: null,
          }
        : null,
    relaySlots: 1,
    subtitleSearch: variant === 'vod',
    stremio:
      variant === 'stremio'
        ? { linked: true, email: 'demo@ornek.test', linkedAt: now - 2 * day }
        : { linked: false, email: null, linkedAt: null },
  };
  /** DEV Stremio picks: `x-` ref → what was picked. */
  const stremioPicks = new Map<string, { title: string; imdbId: string }>();
  const demoStreams = [
    {
      id: 'demo-stream-4k',
      addon: 'Torrentio',
      name: '[RD+] Torrentio\n4k',
      title: 'DEMO.2160p.WEB-DL.mkv\n👤 120 💾 14.2 GB ⚙️ Örnek',
      cached: true,
      resolution: '4K',
      size: '14.2 GB',
    },
    {
      id: 'demo-stream-1080',
      addon: 'Torrentio',
      name: '[RD download] Torrentio\n1080p',
      title: 'DEMO.1080p.BluRay.mkv\n👤 48 💾 2.1 GB ⚙️ Örnek',
      cached: false,
      resolution: '1080p',
      size: '2.1 GB',
    },
    {
      id: 'demo-stream-mf',
      addon: 'MediaFusion',
      name: 'MediaFusion 1080p',
      title: 'DEMO.1080p.WEB.mkv\n💾 3.4 GB',
      cached: null,
      resolution: '1080p',
      size: '3.4 GB',
    },
  ] satisfies StremioStream[];
  const demoStremio: StremioTitle[] = [
    { type: 'movie', id: 'tt9000001', name: 'DEMO Stremio Filmi', year: '2024', art: null },
    { type: 'series', id: 'tt9000002', name: 'DEMO Stremio Dizisi', year: '2022–', art: null },
  ];
  const delay = <T>(value: T, ms = 120) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(structuredClone(value)), ms));
  const hall = (hallId: string) => {
    if (hallId !== status.hallChannelId) throw new Error('CINEMA_HALL_REQUIRED');
    if (!status.connected && !status.stremio?.linked) throw new Error('CINEMA_NOT_CONNECTED');
  };

  // DEMO RMDB: lives apart from the IPTV account, like the service's own record.
  const viewer: RmdbPerson = demoPeople.deniz;
  let works = variant === 'rmdb_empty' ? [] : demoRmdb(now, catalog);
  let logs = 0;
  // DEMO favourites: the first two channels.
  let favorites = catalog.items
    .filter((item) => item.kind === 'live')
    .slice(0, 2)
    .map((item) => item.ref);
  const rmdbHall = (hallId: string) => {
    if (hallId !== status.hallChannelId) throw new Error('CINEMA_HALL_REQUIRED');
  };
  const work = (workId: string) => {
    const found = works.find((value) => value.id === workId);
    if (!found) throw new Error('CINEMA_RMDB_NOT_FOUND');
    return found;
  };
  const owner = () => {
    if (!status.isOwner) throw new Error('CINEMA_OWNER_REQUIRED');
  };
  const summaryOf = (value: DemoWork): RmdbWorkSummary => {
    const ratings = value.reviews.map((r) => r.rating).filter((r): r is number => r !== null);
    const mine = value.reviews.find((r) => r.author.userId === viewer.userId);
    return {
      id: value.id,
      kind: value.kind,
      title: value.title,
      year: value.year,
      genre: value.genre,
      art: value.art,
      averageRating: ratings.length
        ? Math.round((ratings.reduce((sum, r) => sum + r, 0) / ratings.length) * 10) / 10
        : null,
      ratingCount: ratings.length,
      reviewCount: value.reviews.filter((r) => r.text).length,
      likeCount: value.reviews.filter((r) => r.liked).length,
      progress: value.progress,
      watchCount: value.diary.length,
      lastWatchedAt: value.diary.length ? Math.max(...value.diary.map((d) => d.watchedAt)) : null,
      addedAt: value.addedAt,
      onWatchlist: !!value.watchlist,
      mine: { rating: mine?.rating ?? null, liked: mine?.liked ?? false },
    };
  };
  /** What the catalog can open now, as the service decides it (5 s of context on resume). */
  const resumeOf = (value: DemoWork): RmdbWorkDetails['resume'] => {
    const entry = status.connected && value.ref ? catalog.details.get(value.ref) : undefined;
    if (!entry) return null;
    const progress = value.progress;
    const at = (seconds: number) => Math.max(0, Math.floor(seconds) - 5);
    if (value.kind === 'movie')
      return {
        ref: entry.item.ref,
        title: entry.item.title,
        positionSec: progress && !progress.finished ? at(progress.positionSec) : 0,
        art: entry.item.art,
        episode: null,
      };
    const episodes = entry.seasons.flatMap((season) => season.episodes);
    const stop = progress?.episode ?? null;
    const index = stop
      ? episodes.findIndex((e) => e.season === stop.season && e.episode === stop.episode)
      : 0;
    if (index < 0) return null;
    const next = !!stop && progress!.finished;
    const target = episodes[next ? index + 1 : index];
    if (!target) return null;
    return {
      ref: target.ref,
      title: sample(
        `${entry.item.title} · ${target.season}. Sezon ${target.episode}. Bölüm`,
        `${entry.item.title} · Season ${target.season}, Episode ${target.episode}`,
      ),
      positionSec: stop && !next ? at(progress!.positionSec) : 0,
      art: target.art ?? entry.item.art,
      episode: { season: target.season, episode: target.episode, title: target.title || null },
    };
  };
  const detailsOf = (value: DemoWork): RmdbWorkDetails => ({
    ...summaryOf(value),
    plot: value.plot,
    director: value.director,
    cast: value.cast,
    durationSec: value.durationSec,
    backdrop: value.backdrop,
    reviews: [...value.reviews].sort((a, b) => b.updatedAt - a.updatedAt),
    diary: [...value.diary].sort((a, b) => b.watchedAt - a.watchedAt),
    episodes: [...value.episodes].sort((a, b) => a.season - b.season || a.episode - b.episode),
    watchlist: value.watchlist,
    resume: resumeOf(value),
  });
  return {
    status: () => delay(status, 60),
    setHall: async (_communityId, channelId) => {
      status = { ...status, hallChannelId: channelId };
      return delay(status);
    },
    connect: async (_communityId, source: CinemaSourceInput) => {
      if (source.kind === 'xtream' && source.password === 'yanlis')
        throw new Error('CINEMA_PROVIDER_DENIED');
      status = {
        ...status,
        connected: true,
        source: {
          kind: source.kind,
          label: 'https://ipt***:8080',
          hasCustomGuide: !!source.guideUrl,
        },
        account: { status: 'Active', expiresAt: now + 140 * day, maxConnections: 2 },
        importing: {
          step: 'completed',
          counts: { live: 26, movies: 16, series: 8, programmes: 1400 },
          error: null,
          startedAt: Date.now() - 4000,
          finishedAt: Date.now(),
        },
      };
      return delay(status, 600);
    },
    disconnect: async () => {
      status = { ...status, connected: false, source: null, account: null, importing: null };
      return delay(status);
    },
    reload: async () => delay(status),
    categories: async (hallId, kind: CatalogKind) => {
      hall(hallId);
      return delay(catalog.categories.filter((c) => c.kind === kind));
    },
    items: async (hallId, query: CinemaItemsQuery) => {
      hall(hallId);
      let list = catalog.items.filter(
        (i) => i.kind === query.kind && (!query.categoryId || i.categoryId === query.categoryId),
      );
      if (query.sort === 'added')
        list = [...list].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0));
      if (query.sort === 'rating')
        list = [...list].sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0));
      if (query.sort === 'name')
        list = [...list].sort((a, b) => a.title.localeCompare(b.title, sample('tr', 'en')));
      const offset = query.offset ?? 0,
        limit = query.limit ?? 60;
      return delay({ items: list.slice(offset, offset + limit), total: list.length });
    },
    search: async (hallId, text, kinds) => {
      hall(hallId);
      const terms = fold(text).split(/\s+/).filter(Boolean);
      if (!terms.length) return [];
      return delay(
        catalog.items
          .filter((i) => !kinds || kinds.includes(i.kind))
          .filter((i) => {
            const words = fold(i.title).split(/\s+/);
            return terms.every((term) => words.some((word) => word.startsWith(term)));
          })
          .slice(0, 30),
        80,
      );
    },
    // Development stand-in: labeled examples, nothing reaches YouTube.
    youtubeSearch: async (hallId, text) => {
      hall(hallId);
      if (text.trim().length < 2) return [];
      return delay(
        [
          { videoId: 'dQw4w9WgXcQ', title: `${text.trim()} (geliştirme örneği)`, durationSec: 213 },
          {
            videoId: 'jNQXAC9IVRw',
            title: `${text.trim()} (geliştirme örneği 2)`,
            durationSec: 19,
          },
        ],
        120,
      );
    },
    guide: async (hallId, refs, fromMs, toMs) => {
      hall(hallId);
      return delay(
        Object.fromEntries(
          refs.map((ref) => [
            ref,
            (catalog.programmes.get(ref) ?? []).filter((p) => p.stop > fromMs && p.start < toMs),
          ]),
        ),
        60,
      );
    },
    details: async (hallId, ref) => {
      hall(hallId);
      const pick = stremioPicks.get(ref);
      if (pick)
        return delay({
          item: {
            ref,
            kind: 'movie',
            title: pick.title,
            badges: [],
            categoryId: null,
            number: null,
            art: null,
            year: 2024,
            rating: null,
            addedAt: null,
            hasGuide: false,
          },
          plot: 'DEMO: Stremio’dan seçilen kaynak.',
          genre: 'Dram',
          cast: null,
          director: null,
          durationSec: null,
          backdrop: null,
          seasons: [],
          tmdbId: null,
        });
      const value = catalog.details.get(ref);
      if (!value) throw new Error('CINEMA_ITEM_NOT_FOUND');
      return delay(value);
    },
    setAudio: async (hallId, _ref, track) => {
      hall(hallId);
      audioChoice = track;
      await delay(null, 150);
    },
    setSubtitleKey: async (_communityId, key) => {
      if (key === 'yanlis-anahtar') throw new Error('CINEMA_SUBTITLE_KEY_INVALID');
      status = { ...status, subtitleSearch: !!key };
      return delay(status, 300);
    },
    subtitles: async (hallId) => {
      hall(hallId);
      if (!status.subtitleSearch) return delay({ available: false, subtitles: [] }, 200);
      return delay(
        {
          available: true,
          subtitles: [
            {
              id: 'demo-tr',
              label: sample('Türkçe · DEMO harici altyazı', 'Turkish · DEMO external subtitle'),
              language: 'tur' as const,
              hearingImpaired: false,
              src: fixtureVtt(sample('SubDL örneği', 'SubDL sample')),
            },
            {
              id: 'demo-en',
              label: sample(
                'İngilizce · DEMO external subtitle',
                'English · DEMO external subtitle',
              ),
              language: 'eng' as const,
              hearingImpaired: false,
              src: fixtureVtt('SubDL sample'),
            },
          ],
        },
        400,
      );
    },
    favorites: async (hallId) => {
      hall(hallId);
      return delay([...favorites], 60);
    },
    setFavorite: async (hallId, ref, on) => {
      hall(hallId);
      favorites = favorites.filter((value) => value !== ref);
      if (on) favorites.push(ref);
      return delay([...favorites], 80);
    },
    episodeMarks: async (hallId, seriesRef) => {
      hall(hallId);
      const found = works.find((value) => value.ref === seriesRef);
      return delay({ workId: found?.id ?? null, episodes: found?.episodes ?? [] }, 80);
    },
    markEpisode: async (hallId, episodeRef, watched) => {
      hall(hallId);
      const series = [...catalog.details.values()].find((entry) =>
        entry.seasons.some((season) => season.episodes.some((e) => e.ref === episodeRef)),
      );
      const episode = series?.seasons
        .flatMap((season) => season.episodes)
        .find((e) => e.ref === episodeRef);
      if (!series || !episode) throw new Error('CINEMA_ITEM_NOT_FOUND');
      const found = works.find((value) => value.ref === series.item.ref);
      if (found) {
        found.episodes = found.episodes.filter(
          (e) => !(e.season === episode.season && e.episode === episode.episode),
        );
        if (watched)
          found.episodes.push({
            season: episode.season,
            episode: episode.episode,
            title: episode.title,
            positionSec: episode.durationSec ?? 0,
            durationSec: episode.durationSec,
            finished: true,
            watchedAt: Date.now(),
          });
        found.episodes.sort((a, b) => a.season - b.season || a.episode - b.episode);
        const last = found.episodes.filter((e) => e.finished).at(-1);
        found.progress = last
          ? {
              positionSec: last.positionSec,
              durationSec: last.durationSec,
              finished: true,
              episode: { season: last.season, episode: last.episode, title: last.title },
              updatedAt: Date.now(),
            }
          : null;
      }
      return delay({ workId: found?.id ?? null, episodes: found?.episodes ?? [] }, 120);
    },
    setAudioDefault: async (_communityId, value) => {
      status = { ...status, audioDefault: value };
      return delay(status, 200);
    },
    setTmdbKey: async (_communityId, key) => {
      if (key === 'yanlis-anahtar-yanlis-anahtar') throw new Error('CINEMA_METADATA_KEY_INVALID');
      status = { ...status, tmdb: !!key };
      return delay(status, 400);
    },
    titleLinks: async (hallId, ref) => {
      hall(hallId);
      const series = ref.startsWith('e-') || ref.startsWith('s-');
      // DEMO: real public ids, so the links open the right pages during review.
      return delay(
        {
          kind: series ? ('series' as const) : ('movie' as const),
          tmdbId: series ? 1396 : 550,
          imdbId: series ? 'tt0903747' : 'tt0137523',
        },
        300,
      );
    },
    continueWatching: async (hallId, kind) => {
      hall(hallId);
      const cards = works
        .filter((value) => value.kind === kind && value.progress)
        .filter((value) => kind === 'series' || !value.progress!.finished)
        .flatMap((value): CinemaContinueItem[] => {
          const progress = value.progress!;
          const resume = resumeOf(value);
          // DEMO: a finished series with nothing left announces its next episode in 49 days.
          const upcomingAt =
            !resume && kind === 'series' && progress.finished && value.ref ? now + 49 * day : null;
          if ((!resume && !upcomingAt) || !value.ref) return [];
          const next = kind === 'series' && progress.finished;
          const episode =
            resume?.episode ??
            (progress.episode && upcomingAt
              ? {
                  season: progress.episode.season,
                  episode: progress.episode.episode + 1,
                  title: null,
                }
              : null);
          return [
            {
              workId: value.id,
              kind,
              ref: value.ref!,
              title: value.title,
              art: resume?.art ?? value.backdrop ?? value.art,
              resume,
              episode: kind === 'series' ? episode : null,
              progress:
                next || !progress.durationSec
                  ? 0
                  : Math.min(1, progress.positionSec / progress.durationSec),
              remainingSec:
                next || !progress.durationSec
                  ? null
                  : Math.round(progress.durationSec - progress.positionSec),
              upcomingAt,
              updatedAt: progress.updatedAt,
            },
          ];
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
      return delay(cards, 160);
    },
    rmdb: async (hallId) => {
      rmdbHall(hallId);
      return delay([...works].sort((a, b) => b.touchedAt - a.touchedAt).map(summaryOf), 120);
    },
    rmdbWork: async (hallId, workId) => {
      rmdbHall(hallId);
      return delay(detailsOf(work(workId)), 100);
    },
    rmdbAdd: async (hallId, ref, watchlist) => {
      rmdbHall(hallId);
      if (!status.connected) throw new Error('CINEMA_NOT_CONNECTED');
      if (!/^[ms]-/.test(ref)) throw new Error('CINEMA_RMDB_INVALID');
      const entry = catalog.details.get(ref);
      if (!entry) throw new Error('CINEMA_ITEM_NOT_FOUND');
      const at = Date.now();
      let found = works.find(
        (value) =>
          value.ref === ref ||
          (value.kind === entry.item.kind &&
            fold(value.title) === fold(entry.item.title) &&
            (value.year === null || entry.item.year === null || value.year === entry.item.year)),
      );
      if (!found) {
        found = {
          id: `w-demo-${hex(ref)}`,
          ref,
          kind: entry.item.kind as 'movie' | 'series',
          title: entry.item.title,
          year: entry.item.year,
          genre: entry.genre,
          art: entry.item.art,
          backdrop: entry.backdrop,
          plot: entry.plot,
          director: entry.director,
          cast: entry.cast,
          durationSec: entry.durationSec,
          addedAt: at,
          touchedAt: at,
          progress: null,
          reviews: [],
          diary: [],
          episodes: [],
          watchlist: null,
        };
        works.push(found);
      }
      if (watchlist && !found.watchlist) found.watchlist = { by: viewer, at };
      found.touchedAt = at;
      return delay(detailsOf(found), 160);
    },
    rmdbReview: async (hallId, workId, input) => {
      rmdbHall(hallId);
      const value = work(workId);
      if (
        input &&
        ((input.rating !== null &&
          !(Number.isInteger(input.rating) && input.rating >= 1 && input.rating <= 10)) ||
          input.text.length > RMDB_REVIEW_MAX)
      )
        throw new Error('CINEMA_RMDB_INVALID');
      const at = Date.now();
      const previous = value.reviews.find((r) => r.author.userId === viewer.userId);
      value.reviews = value.reviews.filter((r) => r.author.userId !== viewer.userId);
      const text = input?.text.trim() ?? '';
      if (input && (input.rating !== null || text || input.liked))
        value.reviews.push({
          author: viewer,
          rating: input.rating,
          text,
          spoiler: !!text && input.spoiler,
          liked: input.liked,
          createdAt: previous?.createdAt ?? at,
          updatedAt: at,
        });
      value.touchedAt = at;
      return delay(detailsOf(value), 140);
    },
    rmdbRemoveReview: async (hallId, workId, userId) => {
      rmdbHall(hallId);
      owner();
      const value = work(workId);
      if (!value.reviews.some((r) => r.author.userId === userId))
        throw new Error('CINEMA_RMDB_NOT_FOUND');
      value.reviews = value.reviews.filter((r) => r.author.userId !== userId);
      return delay(detailsOf(value), 120);
    },
    rmdbWatchlist: async (hallId, workId, on) => {
      rmdbHall(hallId);
      const value = work(workId);
      value.watchlist = on ? (value.watchlist ?? { by: viewer, at: Date.now() }) : null;
      value.touchedAt = Date.now();
      return delay(detailsOf(value), 100);
    },
    rmdbLog: async (hallId, workId, watchedAt) => {
      rmdbHall(hallId);
      const value = work(workId);
      const at = watchedAt ?? Date.now();
      if (!Number.isFinite(at) || at > Date.now() + 60_000 || at < Date.UTC(1900, 0))
        throw new Error('CINEMA_RMDB_INVALID');
      value.diary.push({
        id: `d-demo-log-${++logs}`,
        watchedAt: at,
        viewers: [viewer],
        episode: null,
        finished: true,
        positionSec: null,
        source: 'manual',
        loggedBy: viewer,
      });
      value.touchedAt = Date.now();
      return delay(detailsOf(value), 140);
    },
    rmdbRemoveLog: async (hallId, workId, entryId) => {
      rmdbHall(hallId);
      const value = work(workId);
      const entry = value.diary.find((d) => d.id === entryId);
      if (!entry) throw new Error('CINEMA_RMDB_NOT_FOUND');
      if (
        !status.isOwner &&
        !(entry.source === 'manual' && entry.loggedBy?.userId === viewer.userId)
      )
        throw new Error('CINEMA_ACCESS_DENIED');
      value.diary = value.diary.filter((d) => d.id !== entryId);
      return delay(detailsOf(value), 120);
    },
    rmdbRemove: async (hallId, workId) => {
      rmdbHall(hallId);
      owner();
      work(workId);
      works = works.filter((value) => value.id !== workId);
      await delay(null, 140);
    },
    // DEV fixture Stremio: labelled sample titles; a picked stream plays the demo film.
    stremioLinkStart: async () => {
      owner();
      return delay({ code: 'DEMO', link: 'https://link.stremio.com/DEMO' }, 200);
    },
    stremioLinkPoll: async () => {
      owner();
      status = {
        ...status,
        stremio: { linked: true, email: 'demo@ornek.test', linkedAt: Date.now() },
      };
      return delay(status, 300);
    },
    stremioUnlink: async () => {
      owner();
      status = { ...status, stremio: { linked: false, email: null, linkedAt: null } };
      return delay(status);
    },
    stremioHome: async () => {
      if (!status.stremio?.linked) throw new Error('CINEMA_STREMIO_NOT_LINKED');
      return delay(
        {
          continue: [
            {
              ...demoStremio[1]!,
              videoId: 'tt9000002:1:3',
              season: 1,
              episode: 3,
              progress: 0.4,
              watchedAt: Date.now() - 86_400_000,
            },
          ],
          library: demoStremio,
          popular: { movie: demoStremio.filter((t) => t.type === 'movie'), series: [] },
        },
        240,
      );
    },
    stremioSearch: async (_hallId, text) =>
      delay(
        demoStremio.filter((title) =>
          title.name.toLocaleLowerCase('tr').includes(text.toLocaleLowerCase('tr')),
        ),
        200,
      ),
    stremioDetails: async (_hallId, type, id) => {
      const title = demoStremio.find((t) => t.id === id && t.type === type);
      if (!title) throw new Error('CINEMA_ITEM_NOT_FOUND');
      return delay(
        {
          ...title,
          plot: 'DEMO: Stremio örneği. Gerçek hesapta Cinemeta açıklaması görünür.',
          genres: ['Dram'],
          runtime: '1h 52min',
          rating: '7.4',
          backdrop: null,
          cast: ['Örnek Oyuncu'],
          director: ['Örnek Yönetmen'],
          videos:
            type === 'series'
              ? Array.from({ length: 6 }, (_, i) => ({
                  id: `${id}:${i < 3 ? 1 : 2}:${(i % 3) + 1}`,
                  season: i < 3 ? 1 : 2,
                  episode: (i % 3) + 1,
                  title: `DEMO bölüm ${(i % 3) + 1}`,
                  plot: null,
                  released: Date.now() - (6 - i) * 7 * 86_400_000,
                  art: null,
                }))
              : [],
        },
        200,
      );
    },
    // In the Stremio-only variant Torrentio refuses the "server" (as Cloudflare does for
    // data-centre IPs) and the linker's computer lists it instead.
    stremioStreams: async () => {
      owner();
      const blocked = variant === 'stremio';
      return delay(
        {
          streams: blocked ? [demoStreams[2]!] : demoStreams.slice(0, 2),
          skippedTorrents: blocked ? 0 : 3,
          failedAddons: [],
          blockedAddons: blocked ? ['Torrentio'] : [],
          assist: blocked,
        },
        500,
      );
    },
    stremioAssist: async () => {
      owner();
      return delay(
        demoStreams.slice(0, 2).map((stream) => ({ ...stream, id: `local-${stream.id}` })),
        600,
      );
    },
    stremioPickLocal: async (_hallId, streamId) => {
      const ref = `x-DEMOlocal${streamId
        .replace(/[^A-Za-z0-9]/g, '')
        .padEnd(11, '0')
        .slice(0, 11)}`;
      stremioPicks.set(ref, { title: 'DEMO Stremio Filmi', imdbId: 'tt9000001' });
      return delay({ ref, title: 'DEMO Stremio Filmi', art: null }, 400);
    },
    stremioPick: async (_hallId, streamId) => {
      const ref = `x-DEMO${streamId
        .replace(/[^A-Za-z0-9]/g, '')
        .padEnd(18, '0')
        .slice(0, 18)}`;
      stremioPicks.set(ref, { title: 'DEMO Stremio Filmi', imdbId: 'tt9000001' });
      return delay({ ref, title: 'DEMO Stremio Filmi', art: null }, 150);
    },
    chooseSubtitleFile: async () =>
      delay(
        {
          name: sample('demo-yerel.srt', 'demo-local.srt'),
          content: decodeURIComponent(
            fixtureVtt(sample('yerel dosya', 'local file')).split(',')[1]!,
          ),
        },
        200,
      ),
    watch: async (hallId) => {
      hall(hallId);
      if (variant === 'error') {
        await delay(null, 500);
        throw new Error('CINEMA_CODEC_UNSUPPORTED');
      }
      const current = room?.queue.find((item) => item.id === room?.timeline.itemId);
      if (current?.media.kind !== 'community-media') throw new Error('CINEMA_NOTHING_SELECTED');
      const detail = catalog.details.get(current.media.ref);
      return delay(
        {
          src: `rooms-fixture://hall/${current.media.ref}`,
          itemRef: current.media.ref,
          live: current.media.live,
          durationSec: current.media.live ? null : (detail?.durationSec ?? 2700),
          offsetSec: 0,
          epoch: room?.timeline.epoch ?? 1,
          originPdtMs: null,
          audioTracks: current.media.live
            ? []
            : [
                { index: 0, label: sample('Almanca', 'German') },
                { index: 1, label: sample('Türkçe · Dublaj', 'English · Dubbed') },
                { index: 2, label: sample('İngilizce', 'Spanish') },
              ],
          audioTrack: current.media.live ? null : (audioChoice ?? 1),
          // DEMO picture facts for the info pills.
          video: current.media.live
            ? { width: 1920, height: 1080, fps: 25, codec: 'h264', bitrate: null }
            : { width: 3840, height: 1608, fps: 23.98, codec: 'hevc', bitrate: 14_200_000 },
          subtitles: current.media.live
            ? []
            : [
                {
                  index: 0,
                  label: sample('Türkçe', 'Turkish'),
                  language: 'tur',
                  forced: false,
                  src: fixtureVtt(sample('Türkçe', 'Turkish')),
                },
                {
                  index: 1,
                  label: sample('İngilizce', 'English'),
                  language: 'eng',
                  forced: false,
                  src: fixtureVtt('English'),
                },
              ],
        },
        variant === 'default' ? 300 : 200,
      );
    },
  };
}

let room: RoomSnapshot | null = null;
let audioChoice: number | null = null;

const hallPeople = [
  { userId: 'demo-deniz', displayName: crew.deniz },
  { userId: 'demo-ece', displayName: crew.ece },
  { userId: 'demo-can', displayName: crew.can },
  { userId: 'demo-zeynep', displayName: crew.zeynep },
  { userId: 'demo-mert', displayName: crew.mert },
];

export function communityCinemaFixtureRoom(
  variant: CommunityCinemaFixtureVariant,
  now = Date.now(),
): RoomSnapshot {
  const playing = ['default', 'vod', 'error', 'remote'].includes(variant);
  const participants = (playing ? hallPeople.slice(1, 5) : []).map((p) => ({
    ...p,
    canControl: true,
    canCreate: true,
    joinedAt: now - 3_600_000,
    lastSeenAt: now,
  }));
  const queue: QueueItem[] = !playing
    ? []
    : variant === 'vod'
      ? [
          {
            id: 'demo-hall-1',
            addedBy: 'demo-ece',
            media: { kind: 'community-media', ref: 'm-3003', title: titles.blueHour, live: false },
          },
          {
            id: 'demo-hall-2',
            addedBy: 'demo-can',
            media: {
              kind: 'community-media',
              ref: 'm-3015',
              title: titles.edgeOfDusk,
              live: false,
            },
          },
        ]
      : [
          {
            id: 'demo-hall-1',
            addedBy: 'demo-ece',
            media: { kind: 'community-media', ref: 'l-1001', title: titles.nationOne, live: true },
          },
          {
            id: 'demo-hall-2',
            addedBy: 'demo-can',
            media: { kind: 'community-media', ref: 'm-3003', title: titles.blueHour, live: false },
          },
          {
            id: 'demo-hall-3',
            addedBy: 'demo-zeynep',
            media: { kind: 'youtube', videoId: 'aqz-KE-bpKQ', title: 'Big Buck Bunny 60fps 4K' },
          },
        ];
  return {
    roomId: FIXTURE_HALL_ID,
    revision: 1,
    participants,
    primary: playing
      ? {
          activity: 'hall',
          title: sample('Sinema salonu', 'Cinema hall'),
          hostUserId: 'demo-ece',
          startedAt: now - 3_600_000,
          state: 'live',
          ...(variant === 'remote' ? { controlMode: 'host' as const, controllers: [] } : {}),
        }
      : null,
    timeline: {
      itemId: queue[0]?.id ?? null,
      epoch: 3,
      positionSec: variant === 'vod' ? 1260 : 0,
      playing: playing,
      rate: 1,
      effectiveServerTimeMs: now,
    },
    queue,
    polls: [],
    whiteboard: [],
  };
}

/** Local hall Activity adapter: enough of the protocol to drive the real UI controls. */
export function createCommunityCinemaFixtureActivity(
  initial: RoomSnapshot,
): DesktopBridge['activity'] {
  room = initial;
  const response = (): ActivityResponse => ({
    protocolVersion: 1,
    serverTimeMs: Date.now(),
    room: structuredClone(room!),
    events: [],
    replayRequired: false,
  });
  const fail = (code: string): never => {
    throw new Error(code);
  };
  return {
    snapshot: async () => response(),
    command: async (_id, envelope) => {
      const state = room!;
      if (envelope.expectedRevision !== state.revision) fail('REVISION_CONFLICT');
      const command = envelope.command;
      const self = state.participants.find((p) => p.userId === me);
      const directs = () => {
        const p = state.primary;
        if (p?.controlMode === 'host' && p.hostUserId !== me && !(p.controllers ?? []).includes(me))
          fail('SESSION_HOST_CONTROL');
      };
      const select = (itemId: string, play: boolean) => {
        const item = state.queue.find((i) => i.id === itemId);
        if (!item) fail('QUEUE_ITEM_NOT_FOUND');
        state.timeline = {
          itemId,
          epoch: state.timeline.epoch + 1,
          positionSec: 0,
          rate: 1,
          playing: play,
          effectiveServerTimeMs: Date.now(),
        };
      };
      switch (command.type) {
        case 'join':
          if (!self)
            state.participants.push({
              userId: me,
              displayName: crew.deniz,
              canControl: true,
              canCreate: true,
              joinedAt: Date.now(),
              lastSeenAt: Date.now(),
            });
          break;
        case 'leave':
          state.participants = state.participants.filter((p) => p.userId !== me);
          break;
        case 'start':
          if (state.primary) fail('PRIMARY_ACTIVITY_ACTIVE');
          state.primary = {
            activity: command.activity,
            title: command.title,
            hostUserId: me,
            startedAt: Date.now(),
            state: 'live',
          };
          break;
        case 'queue.add':
          if (command.start) directs();
          state.queue.push({ id: command.itemId, media: command.media, addedBy: me });
          if (command.start) select(command.itemId, true);
          break;
        case 'queue.select':
          directs();
          select(command.itemId, command.play ?? false);
          break;
        case 'queue.remove':
          if (command.itemId === state.timeline.itemId) fail('QUEUE_ACTIVE_ITEM_FIXED');
          state.queue = state.queue.filter((i) => i.id !== command.itemId);
          break;
        case 'queue.clear':
          directs();
          state.queue = state.queue.filter((i) => i.id === state.timeline.itemId);
          break;
        case 'queue.reorder':
          directs();
          state.queue = command.itemIds.map((id) => state.queue.find((i) => i.id === id)!);
          break;
        case 'queue.next': {
          if (state.timeline.itemId !== command.fromItemId) break;
          const index = state.queue.findIndex((i) => i.id === command.fromItemId);
          const next = state.queue[index + 1];
          if (next) select(next.id, true);
          break;
        }
        case 'playback': {
          directs();
          const current = state.queue.find((i) => i.id === state.timeline.itemId)?.media;
          if (current?.kind === 'community-media' && current.live) fail('LIVE_PLAYBACK_FIXED');
          state.timeline = {
            ...state.timeline,
            playing: command.playing,
            positionSec: command.positionSec,
            rate: command.rate,
            effectiveServerTimeMs: Date.now(),
          };
          break;
        }
        case 'session.control':
          if (state.primary) state.primary.controlMode = command.mode;
          break;
        case 'session.permit':
          if (state.primary)
            state.primary.controllers = command.allowed
              ? [...new Set([...(state.primary.controllers ?? []), command.userId])]
              : (state.primary.controllers ?? []).filter((id) => id !== command.userId);
          break;
        case 'session.host':
          if (state.primary) state.primary.hostUserId = command.userId;
          break;
        default:
          fail(`Unsupported hall fixture command: ${command.type}`);
      }
      state.revision++;
      return response();
    },
    exportBoard: async () => fail('No board in the cinema fixture.'),
    youtubePlaylist: async () => fail('Playlist import is unavailable in the cinema fixture.'),
    youtubePlayer: async () => fail('No YouTube playback in the local cinema fixture.'),
  };
}

/** DEV-only install for `?fixture=S80&variant=…`. */
export function installCommunityCinemaFixture(value: string): () => void {
  if (!import.meta.env.DEV) throw new Error('Cinema fixtures are unavailable in production.');
  const variant = (COMMUNITY_CINEMA_FIXTURE_VARIANTS as readonly string[]).includes(value)
    ? (value as CommunityCinemaFixtureVariant)
    : (() => {
        throw new Error(`Unsupported community cinema fixture variant: ${value}`);
      })();
  const restoreMedia = installMediaFixture('S19', 'default');
  const restoreRuntime = installDevelopmentRuntime({
    mediaProvider: mediaProvider(),
    mediaBridge: mediaBridge(),
    activityBridge: createCommunityCinemaFixtureActivity(communityCinemaFixtureRoom(variant)),
  });
  const restoreBridge = installCinemaFixture({
    bridge: createCommunityCinemaFixtureBridge(variant),
    art: fixtureArt,
  });
  if (variant === 'member' || variant === 'remote') {
    const state = useCommunity.getState();
    useCommunity.setState({
      spaces: state.spaces.map((space) =>
        space.id === FIXTURE_COMMUNITY_ID ? { ...space, ownerId: 'demo-ece' } : space,
      ),
    });
  }
  return () => {
    restoreBridge();
    restoreRuntime();
    restoreMedia();
  };
}

/** DEV fixture subtitles: a labelled cue every 6 s for three hours, as a data URL. */
function fixtureVtt(language: string) {
  const cues = Array.from({ length: 1800 }, (_, i) => ({
    start: i * 6,
    end: i * 6 + 4,
    text: sample(
      `DEMO altyazı (${language})\nÖrnek satır ${i + 1}`,
      `DEMO subtitle (${language})\nSample line ${i + 1}`,
    ),
  }));
  return `data:text/vtt;charset=utf-8,${encodeURIComponent(formatVtt(cues))}`;
}
