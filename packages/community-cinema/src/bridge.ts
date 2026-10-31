// The renderer ↔ Electron main contract for the community cinema. The main
// process holds the Stoat token, calls the cinema service and serves relay
// playlists, segments and artwork on the `rooms-cinema:` scheme, so the
// renderer never sees a ticket, a token or a provider URL.
import type {
  CinemaContinueItem,
  CinemaVideoInfo,
  CinemaTitleLinks,
  CinemaEpisodeMarks,
  CatalogKind,
  CinemaAudioTrack,
  CinemaCategory,
  CinemaDetails,
  CinemaExternalSubtitle,
  CinemaItem,
  CinemaProgramme,
  CinemaStatus,
  CinemaSubtitleTrack,
  RmdbReviewInput,
  RmdbWorkDetails,
  RmdbWorkSummary,
  StremioDetails,
  StremioHome,
  StremioLinkCode,
  StremioPicked,
  StremioStream,
  StremioCatalogPage,
  StremioStreams,
  StremioTitle,
  StremioType,
} from './types';
import type { YouTubeSearchResult } from './youtube-search';

export const CINEMA_SCHEME = 'rooms-cinema';

/** Artwork for an item (`CinemaItem.art`, `CinemaDetails.backdrop`). */
export const cinemaArtUrl = (hallId: string, artId: string) =>
  `${CINEMA_SCHEME}://art/${encodeURIComponent(hallId)}/${encodeURIComponent(artId)}`;

export type CinemaSourceInput =
  | {
      kind: 'xtream';
      server: string;
      username: string;
      password: string;
      /** null = the provider's own guide, '' = no guide, else a custom XMLTV URL. */
      guideUrl: string | null;
    }
  | { kind: 'm3u'; url: string; guideUrl: string | null };

export type CinemaItemsQuery = {
  kind: CatalogKind;
  categoryId?: string | null;
  sort?: 'default' | 'name' | 'added' | 'rating';
  offset?: number;
  limit?: number;
};

export type CinemaPage = { items: CinemaItem[]; total: number };

export type CinemaWatchSource = {
  /** `rooms-cinema://stream/<session>/index.m3u8`, playable with hls.js. */
  src: string;
  itemRef: string;
  live: boolean;
  durationSec: number | null;
  /** VOD: the relay's first segment starts at this position of the work. */
  offsetSec: number;
  /** Changes whenever the relay restarts (seek, new item); reload the player then. */
  epoch: number;
  /**
   * PROGRAM-DATE-TIME (epoch ms) of relay output time 0, or null. Every relay playlist
   * carries EXT-X-PROGRAM-DATE-TIME, so the work position is
   * `offsetSec + (hls.playingDate − originPdtMs) / 1000` — independent of where hls.js
   * starts its own timeline.
   */
  originPdtMs: number | null;
  /** The source's audio streams and the one the hall hears. */
  audioTracks: CinemaAudioTrack[];
  audioTrack: number | null;
  /** VOD text subtitles; `src` is a WebVTT file on the work's timeline, still growing. */
  subtitles: CinemaSubtitleSource[];
  /** The source picture, for the info pills; null when the service did not say. */
  video: CinemaVideoInfo | null;
};

export type CinemaSubtitleSource = CinemaSubtitleTrack & { src: string };

/** A subtitle found online; `src` is a WebVTT file on `rooms-cinema:`. */
export type CinemaExternalSubtitleSource = CinemaExternalSubtitle & { src: string };

export type CinemaExternalSubtitleSources = {
  /** False when the owner has not added a SubDL key. */
  available: boolean;
  subtitles: CinemaExternalSubtitleSource[];
};

/** Error messages the bridge rejects with; the UI maps them to Turkish copy. */
export type CinemaErrorCode =
  | 'CINEMA_UNAVAILABLE'
  | 'CINEMA_OWNER_REQUIRED'
  | 'CINEMA_HALL_REQUIRED'
  | 'CINEMA_ACCESS_DENIED'
  | 'CINEMA_NOT_CONNECTED'
  | 'CINEMA_SOURCE_INVALID'
  | 'CINEMA_PROVIDER_DENIED'
  | 'CINEMA_PROVIDER_UNREACHABLE'
  | 'CINEMA_ACCOUNT_EXPIRED'
  | 'CINEMA_IMPORT_RUNNING'
  | 'CINEMA_ITEM_NOT_FOUND'
  | 'CINEMA_NOTHING_SELECTED'
  | 'CINEMA_RELAY_BUSY'
  | 'CINEMA_CODEC_UNSUPPORTED'
  | 'CINEMA_STREAM_FAILED'
  /** The relay session ended (the hall moved on or it went idle); call watch() again. */
  | 'CINEMA_SESSION_ENDED'
  | 'CINEMA_RATE_LIMITED'
  | 'CINEMA_SUBTITLE_KEY_INVALID'
  | 'CINEMA_SUBTITLE_UNAVAILABLE'
  | 'CINEMA_METADATA_KEY_INVALID'
  | 'CINEMA_METADATA_UNAVAILABLE'
  /** RMDB has no such work, review or diary entry (removed meanwhile). */
  | 'CINEMA_RMDB_NOT_FOUND'
  /** A rating, review or date RMDB does not accept (e.g. text over `RMDB_REVIEW_MAX`). */
  | 'CINEMA_RMDB_INVALID'
  /** The owner has not linked a Stremio account. */
  | 'CINEMA_STREMIO_NOT_LINKED'
  /** Stremio no longer accepts the linked session; the owner links again. */
  | 'CINEMA_STREMIO_LOGGED_OUT'
  | 'CINEMA_STREMIO_UNAVAILABLE'
  | 'CINEMA_STREMIO_LINK_EXPIRED'
  /** The stream list is old; list the streams again. */
  | 'CINEMA_STREMIO_STREAM_EXPIRED'
  /** The debrid service does not have this stream yet (it started downloading it). */
  | 'CINEMA_STREMIO_NOT_CACHED'
  /** The server could not search YouTube (old server without the route, search down). */
  | 'CINEMA_YOUTUBE_SEARCH_UNAVAILABLE';

export interface CinemaBridge {
  status(communityId: string): Promise<CinemaStatus>;
  /** Owner: choose (or clear) the hall channel. */
  setHall(communityId: string, channelId: string | null): Promise<CinemaStatus>;
  /** Owner: verify and store the server IPTV account, then import its catalog. */
  connect(communityId: string, source: CinemaSourceInput): Promise<CinemaStatus>;
  /** Owner: remove the account; stops every relay and wipes the catalog. */
  disconnect(communityId: string): Promise<CinemaStatus>;
  reload(communityId: string, scope: 'all' | 'guide'): Promise<CinemaStatus>;
  categories(hallId: string, kind: CatalogKind): Promise<CinemaCategory[]>;
  items(hallId: string, query: CinemaItemsQuery): Promise<CinemaPage>;
  search(hallId: string, text: string, kinds?: CatalogKind[]): Promise<CinemaItem[]>;
  /** Searches YouTube by text (up to 5 results) for the hall's "YouTube" tab. */
  youtubeSearch(hallId: string, text: string): Promise<YouTubeSearchResult[]>;
  /** Programmes overlapping [fromMs, toMs) per live item ref. */
  guide(
    hallId: string,
    refs: string[],
    fromMs: number,
    toMs: number,
  ): Promise<Record<string, CinemaProgramme[]>>;
  details(hallId: string, ref: string): Promise<CinemaDetails>;
  /** A playable source for the hall's current queue item (relayed by the server). */
  watch(hallId: string): Promise<CinemaWatchSource>;
  /** Whoever holds the remote: the audio stream of the playing item, for the whole hall. */
  setAudio(hallId: string, ref: string, track: number): Promise<void>;
  /** Owner: the community's own SubDL API key, verified first; null removes it. */
  setSubtitleKey(communityId: string, key: string | null): Promise<CinemaStatus>;
  /** Owner: films start with a Turkish dub when there is one, or in their own language. */
  setAudioDefault(communityId: string, value: 'turkish' | 'original'): Promise<CinemaStatus>;
  /** Owner: the community's own TMDB key (air dates, IMDb ids), verified first; null removes it. */
  setTmdbKey(communityId: string, key: string | null): Promise<CinemaStatus>;
  /** IMDb and TMDB ids of a film or series (an episode answers for its series). */
  titleLinks(hallId: string, ref: string): Promise<CinemaTitleLinks>;
  /** Subtitles found online for a film or episode (Turkish first). */
  subtitles(hallId: string, ref: string): Promise<CinemaExternalSubtitleSources>;
  /** A subtitle file this viewer picks from disk, converted to WebVTT; null if cancelled. */
  chooseSubtitleFile(): Promise<{ name: string; content: string } | null>;
  /** The "Devam et" row of Filmler or Diziler, newest first. */
  continueWatching(hallId: string, kind: 'movie' | 'series'): Promise<CinemaContinueItem[]>;
  /** This member's favourite live channels (refs), oldest first. */
  favorites(hallId: string): Promise<string[]>;
  /** Stars or unstars a live channel for this member; returns the new list. */
  setFavorite(hallId: string, ref: string, on: boolean): Promise<string[]>;
  /** Which episodes of a catalog series the hall watched, and how far. */
  episodeMarks(hallId: string, seriesRef: string): Promise<CinemaEpisodeMarks>;
  /** Any member: marks an episode (`e-…`) watched or not watched for the hall. */
  markEpisode(hallId: string, episodeRef: string, watched: boolean): Promise<CinemaEpisodeMarks>;
  /** RMDB: every work the hall watched or a member added, most recent activity first. */
  rmdb(hallId: string): Promise<RmdbWorkSummary[]>;
  rmdbWork(hallId: string, workId: string): Promise<RmdbWorkDetails>;
  /**
   * Adds a catalog film or series by hand (not a live channel or an episode), optionally
   * onto İzlenecekler. A title RMDB already has returns that entry.
   */
  rmdbAdd(hallId: string, ref: string, watchlist: boolean): Promise<RmdbWorkDetails>;
  /** This member's rating, review and heart; null removes them. */
  rmdbReview(
    hallId: string,
    workId: string,
    review: RmdbReviewInput | null,
  ): Promise<RmdbWorkDetails>;
  /** Owner: removes another member's review. */
  rmdbRemoveReview(hallId: string, workId: string, userId: string): Promise<RmdbWorkDetails>;
  /** İzlenecekler is shared by the hall: any member adds or removes. */
  rmdbWatchlist(hallId: string, workId: string, on: boolean): Promise<RmdbWorkDetails>;
  /** "İzledim": a diary entry for this member, now unless `watchedAt` (epoch ms, not ahead). */
  rmdbLog(hallId: string, workId: string, watchedAt?: number): Promise<RmdbWorkDetails>;
  /** Removes a diary line: a member their own hand logs, the owner any line. */
  rmdbRemoveLog(hallId: string, workId: string, entryId: string): Promise<RmdbWorkDetails>;
  /** Owner: removes a work with its reviews, diary and poster. */
  rmdbRemove(hallId: string, workId: string): Promise<void>;
  /** Owner: a code to approve at link.stremio.com; the browser opens the link. */
  stremioLinkStart(communityId: string): Promise<StremioLinkCode>;
  /** Owner: the status once the code is approved; `linked` stays false until then. */
  stremioLinkPoll(communityId: string): Promise<CinemaStatus>;
  /** Owner: forgets the Stremio session and every stream picked with it. */
  stremioUnlink(communityId: string): Promise<CinemaStatus>;
  stremioHome(hallId: string): Promise<StremioHome>;
  stremioSearch(hallId: string, text: string): Promise<StremioTitle[]>;
  /** One page of a home row's catalog (`StremioRow.key`), optionally one genre. */
  stremioCatalog(
    hallId: string,
    key: string,
    genre: string | null,
    skip: number,
  ): Promise<StremioCatalogPage>;
  stremioDetails(hallId: string, type: StremioType, id: string): Promise<StremioDetails>;
  /** The streams the account's add-ons offer for a film (`videoId` = its id) or an episode. */
  stremioStreams(
    hallId: string,
    type: StremioType,
    id: string,
    videoId: string,
  ): Promise<StremioStreams>;
  /** Makes a listed stream a hall ref to open like a catalog film. */
  stremioPick(hallId: string, streamId: string): Promise<StremioPicked>;
  /**
   * Whoever linked the account: asks the add-ons that refuse the server (`blockedAddons`)
   * from this computer. The links stay in the main process.
   */
  stremioAssist(
    hallId: string,
    type: StremioType,
    id: string,
    videoId: string,
  ): Promise<StremioStream[]>;
  /** Resolves a stream from `stremioAssist` here and hands its final link to the hall. */
  stremioPickLocal(hallId: string, streamId: string): Promise<StremioPicked>;
}
