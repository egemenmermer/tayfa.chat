// Public shapes the cinema service sends to members. Nothing here carries a
// provider URL, username or password: items use opaque refs and artwork uses
// opaque ids that the service resolves.

export type CatalogKind = 'live' | 'movie' | 'series';

/** Opaque catalog reference, also used in activity queue items. */
export const CINEMA_REF_PATTERN = /^[a-z]-[A-Za-z0-9_-]{1,120}$/;

export type CinemaCategory = {
  id: string;
  kind: CatalogKind;
  /** Label without the country marker; `flag` holds the emoji when known. */
  label: string;
  flag: string | null;
  count: number;
};

export type CinemaItem = {
  ref: string;
  kind: CatalogKind;
  title: string;
  /** Quality badges parsed from the provider name (`FHD`, `4K`, `H265`…). */
  badges: string[];
  categoryId: string | null;
  number: number | null;
  /** Opaque artwork id for `/art/:id`, or null. */
  art: string | null;
  year: number | null;
  /** 0–10. */
  rating: number | null;
  /** Epoch ms when the provider added it. */
  addedAt: number | null;
  /** Live: whether a guide is matched. */
  hasGuide: boolean;
};

export type CinemaProgramme = {
  start: number;
  stop: number;
  title: string;
  subTitle: string | null;
  description: string | null;
  category: string | null;
};

export type CinemaEpisode = {
  ref: string;
  season: number;
  episode: number;
  title: string;
  plot: string | null;
  durationSec: number | null;
  art: string | null;
  /** Epoch ms of the day it airs (UTC noon), when the provider lists one. */
  airDate?: number | null;
};

export type CinemaDetails = {
  item: CinemaItem;
  plot: string | null;
  genre: string | null;
  cast: string | null;
  director: string | null;
  durationSec: number | null;
  backdrop: string | null;
  seasons: { season: number; episodes: CinemaEpisode[] }[];
  /** The title's TMDB id, when the provider lists it (IMDb and Letterboxd links). */
  tmdbId?: number | null;
  /** The same title listed in other qualities (its own badges are on `item`). */
  versions?: { ref: string; badges: string[] }[];
};

export type CinemaImportStep =
  'connecting' | 'live' | 'movies' | 'series' | 'guide' | 'completed' | 'failed';

export type CinemaImportProgress = {
  step: CinemaImportStep;
  counts: { live: number; movies: number; series: number; programmes: number };
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
};

export type CinemaStatus = {
  communityId: string;
  hallChannelId: string | null;
  isOwner: boolean;
  connected: boolean;
  source: {
    kind: 'xtream' | 'm3u';
    /** Masked server (`https://dom***:8080`). Owner only. */
    label: string | null;
    hasCustomGuide: boolean;
  } | null;
  account: {
    status: string | null;
    expiresAt: number | null;
    maxConnections: number | null;
  } | null;
  catalog: {
    live: number;
    movies: number;
    series: number;
    programmes: number;
    importedAt: number | null;
    guideImportedAt: number | null;
  };
  importing: CinemaImportProgress | null;
  /** Streams the server may relay at once. */
  relaySlots: number;
  /** Whether films can look up subtitles (the owner added a SubDL key). The key never leaves. */
  subtitleSearch: boolean;
  /** Whether the owner added a TMDB key (air dates of next episodes). The key never leaves. */
  tmdb?: boolean;
  /** Films start with a Turkish dub when there is one, or in their own language. */
  audioDefault?: 'turkish' | 'original';
  /** The owner's linked Stremio account; the email is shown to the owner only. */
  stremio?: { linked: boolean; email: string | null; linkedAt: number | null };
};

export type CinemaWatch = {
  /** Relay session id; the desktop maps it to `rooms-cinema://<session>/index.m3u8`. */
  session: string;
  ticket: string;
  expiresAt: number;
  itemRef: string;
  live: boolean;
  /** Seconds; VOD only. */
  durationSec: number | null;
  /** VOD: the position the relay started from. */
  offsetSec: number;
  epoch: number;
  /** Ticket lifetime from issue, so clients renew by their own clock. */
  ttlMs: number;
  /**
   * EXT-X-PROGRAM-DATE-TIME (epoch ms) of relay output time 0, or null while unknown.
   * Work position = offsetSec + (playing date − originPdtMs) / 1000, for live and VOD.
   */
  originPdtMs: number | null;
  /** The source's audio streams (`index` = position among them) and the one relayed. */
  audioTracks: CinemaAudioTrack[];
  audioTrack: number | null;
  /**
   * VOD text subtitles; each viewer picks their own. The desktop maps `index` to
   * `rooms-cinema://stream/<session>/sub<index>.vtt`, timed on the work's timeline.
   */
  subtitleTracks: CinemaSubtitleTrack[];
  /** The source picture (absent from older services). */
  video?: CinemaVideoInfo | null;
};

export type CinemaAudioTrack = { index: number; label: string };

/** What the relayed picture is, from the server's probe of the source. */
export type CinemaVideoInfo = {
  width: number | null;
  height: number | null;
  /** Frames per second, rounded to two decimals. */
  fps: number | null;
  codec: string | null;
  /** The source's own bit rate (bits/s) when its container says it; players also measure. */
  bitrate: number | null;
};

/** A subtitle found online for a film or episode (SubDL), opaque to clients. */
export type CinemaExternalSubtitle = {
  id: string;
  label: string;
  language: 'tur' | 'eng';
  hearingImpaired: boolean;
};

export type CinemaExternalSubtitles = {
  /** False when the owner has not added a SubDL key. */
  available: boolean;
  subtitles: CinemaExternalSubtitle[];
};

export type CinemaSubtitleTrack = {
  index: number;
  label: string;
  /** ISO 639 code from the stream's tag (`tur`, `tr`, `eng` …), or null. */
  language: string | null;
  /** Signs and foreign-dialogue only. */
  forced: boolean;
};

// RMDB: the community's own record of what the hall watched, with members' ratings and
// reviews. It lives apart from the IPTV account: removing or replacing the account keeps
// every entry, poster, review and diary line.

/** A member as RMDB saw them; the desktop resolves avatars by `userId`. */
export type RmdbPerson = { userId: string; name: string };

/** Half-star steps: 1 = ½★ … 10 = ★★★★★. */
export type RmdbRating = number;

export type RmdbEpisodeRef = { season: number; episode: number; title: string | null };

/** Where the hall stopped. Series: inside `episode`. */
export type RmdbProgress = {
  positionSec: number;
  durationSec: number | null;
  /** The hall reached 90 % of the work (series: of `episode`) or its end. */
  finished: boolean;
  episode: RmdbEpisodeRef | null;
  updatedAt: number;
};

export type RmdbWorkSummary = {
  /** RMDB's own id (`w-…`), not a catalog ref: it outlives the IPTV account. */
  id: string;
  kind: 'movie' | 'series';
  title: string;
  year: number | null;
  genre: string | null;
  /** Poster art id for `cinemaArtUrl`; RMDB keeps its own copy. */
  art: string | null;
  /** Community average on the half-star scale (1–10), or null without ratings. */
  averageRating: number | null;
  ratingCount: number;
  /** Reviews with text; a rating or a heart alone does not count. */
  reviewCount: number;
  likeCount: number;
  /** Null until the hall has played it (added by hand). */
  progress: RmdbProgress | null;
  /** Diary entries, and when the newest one began. */
  watchCount: number;
  lastWatchedAt: number | null;
  addedAt: number;
  /** On the hall's shared İzlenecekler list. */
  onWatchlist: boolean;
  /** This viewer's own rating and heart. */
  mine: { rating: RmdbRating | null; liked: boolean };
};

export type RmdbReview = {
  author: RmdbPerson;
  rating: RmdbRating | null;
  /** May be empty: a rating or a heart alone. */
  text: string;
  spoiler: boolean;
  liked: boolean;
  createdAt: number;
  updatedAt: number;
};

export type RmdbDiaryEntry = {
  id: string;
  /** When the watch began. */
  watchedAt: number;
  /** Hall: members whose player received the stream. Hand log: the member alone. */
  viewers: RmdbPerson[];
  episode: RmdbEpisodeRef | null;
  finished: boolean;
  /** Hall: the last position seen in this watch (of the work or `episode`). Hand logs: null. */
  positionSec: number | null;
  source: 'hall' | 'manual';
  /** Hand logs: who logged it (they and the owner may remove it). */
  loggedBy: RmdbPerson | null;
};

export type RmdbEpisodeProgress = RmdbEpisodeRef & {
  positionSec: number;
  durationSec: number | null;
  finished: boolean;
  watchedAt: number;
};

export type RmdbWorkDetails = RmdbWorkSummary & {
  plot: string | null;
  director: string | null;
  cast: string | null;
  durationSec: number | null;
  backdrop: string | null;
  /** Newest first. */
  reviews: RmdbReview[];
  /** Newest first. */
  diary: RmdbDiaryEntry[];
  /** Series: the episodes the hall played, in season and episode order. */
  episodes: RmdbEpisodeProgress[];
  watchlist: { by: RmdbPerson; at: number } | null;
  /**
   * What the current IPTV catalog can open, or null (no account, or the title left the
   * catalog). Unfinished: where the hall stopped. Finished film: from the start. Finished
   * episode: the next one, from the start (null after the last).
   */
  resume: {
    ref: string;
    title: string;
    positionSec: number;
    art: string | null;
    /** Series: the episode it opens. */
    episode: RmdbEpisodeRef | null;
  } | null;
};

/**
 * A card of the "Devam et" row on Filmler and Diziler: where the hall stopped, the next
 * episode of a series it finished an episode of, or that episode's air date when it is
 * not out yet.
 */
export type CinemaContinueItem = {
  workId: string;
  kind: 'movie' | 'series';
  /** The film or series in the current catalog, for its details page. */
  ref: string;
  /** The film or series name alone, without platform or quality decorations. */
  title: string;
  /** Wide artwork: the episode still, else the backdrop, else the poster. */
  art: string | null;
  /** What opens, or null while the episode has not aired. */
  resume: RmdbWorkDetails['resume'];
  /** Series: the episode the card is about; its title is the episode's own name or null. */
  episode: RmdbEpisodeRef | null;
  /** 0–1: how much of the film (series: of the episode) the hall watched; 0 for a next one. */
  progress: number;
  /** Seconds left of an unfinished film or episode, when its length is known. */
  remainingSec: number | null;
  /** Series: epoch ms the next episode airs, when it is not out yet. */
  upcomingAt: number | null;
  /** When the hall last watched it; the row is newest first. */
  updatedAt: number;
};

/** Outside pages of a film or series; null where nobody knows the id. */
export type CinemaTitleLinks = {
  kind: 'movie' | 'series';
  tmdbId: number | null;
  imdbId: string | null;
};

/** The hall's watched episodes of a series, for its details page. */
export type CinemaEpisodeMarks = {
  /** The series' Tayfa (RMDB) entry, or null before the hall watched or marked any. */
  workId: string | null;
  episodes: RmdbEpisodeProgress[];
};

export type RmdbReviewInput = {
  rating: RmdbRating | null;
  text: string;
  spoiler: boolean;
  liked: boolean;
};

/** Longest review text the service keeps, in characters. */
export const RMDB_REVIEW_MAX = 4000;

// Stremio in the hall: titles come from Cinemeta and the linked account's add-ons; streams
// are listed by opaque ids, and a picked stream becomes an `x-` ref the relay plays.

export type StremioType = 'movie' | 'series';

export type StremioLinkCode = { code: string; link: string };

export type StremioTitle = {
  type: StremioType;
  /** Stremio id (`tt0903747`, `kitsu:1`…). */
  id: string;
  name: string;
  year: string | null;
  /** Opaque artwork id for `/art/:id`, or null. */
  art: string | null;
  /** IMDb rating when the catalog has one (`7.4`); older services leave it out. */
  rating?: string | null;
};

/** One home row: a catalog of Cinemeta or of an add-on the linked account installed. */
export type StremioRow = {
  /** Opaque key for `stremioCatalog` (`cinemeta:movie:top`, `addon:<id>:<type>:<catalog>`). */
  key: string;
  type: StremioType;
  /** The catalog's own name (`Popular`); the desktop names Cinemeta rows itself. */
  name: string;
  /** The add-on's name; null for Cinemeta. */
  addon: string | null;
  items: StremioTitle[];
  /** Genres the catalog filters by (`genre=`); empty when it has none. */
  genres: string[];
  /** The catalog pages with `skip=`. */
  paged: boolean;
};

/** A title for the home's hero: Cinemeta's backdrop, logo and plot. */
export type StremioFeatured = StremioTitle & {
  backdrop: string | null;
  logo: string | null;
  plot: string | null;
  genres: string[];
};

export type StremioCatalogPage = { items: StremioTitle[]; more: boolean };

export type StremioContinueItem = StremioTitle & {
  /** The episode or film being watched (`tt0903747:1:2`), when Stremio knows it. */
  videoId: string | null;
  season: number | null;
  episode: number | null;
  /** 0–1. */
  progress: number | null;
  watchedAt: number | null;
};

export type StremioHome = {
  continue: StremioContinueItem[];
  library: StremioTitle[];
  /** Cinemeta's popular films and series; kept for desktops older than `rows`. */
  popular: { movie: StremioTitle[]; series: StremioTitle[] };
  /** Catalog rows (Cinemeta, then the account's add-ons); older services leave it out. */
  rows?: StremioRow[];
  featured?: StremioFeatured[];
};

export type StremioVideo = {
  id: string;
  season: number;
  episode: number;
  title: string;
  plot: string | null;
  released: number | null;
  art: string | null;
};

export type StremioDetails = StremioTitle & {
  plot: string | null;
  genres: string[];
  runtime: string | null;
  rating: string | null;
  backdrop: string | null;
  cast: string[];
  director: string[];
  videos: StremioVideo[];
};

export type StremioStream = {
  /** Opaque, valid for about two hours. */
  id: string;
  addon: string;
  name: string;
  title: string;
  /** Debrid cache (`[RD+]`): true plays at once, false must download first, null unknown. */
  cached: boolean | null;
  resolution: string | null;
  size: string | null;
};

export type StremioStreams = {
  streams: StremioStream[];
  /** Torrent-only streams the server does not play (no debrid link). */
  skippedTorrents: number;
  /** Other streams the hall cannot play (external pages, YouTube ids, Usenet). */
  skippedOther?: number;
  failedAddons: string[];
  /** Add-ons Cloudflare refuses the server for (Torrentio blocks data-centre addresses). */
  blockedAddons: string[];
  /** This viewer linked the account: their desktop can ask the refused add-ons itself. */
  assist: boolean;
};

export type StremioPicked = { ref: string; title: string; art: string | null };
