export { normalizeForSearch, normalizeChannelName, searchTerms } from './normalize';
export { parseQuality, type QualityParse } from './quality';
export {
  parseCategoryFlag,
  flagForCategory,
  flagged,
  flagEmoji,
  stripCountryPrefix,
  type FlagParse,
} from './flags';
export {
  EpgMatcher,
  noEpgMatch,
  type EpgChannelRef,
  type EpgMatchMethod,
  type EpgMatchResult,
} from './epg-matcher';
export { maskUrl, maskServer, maskText } from './mask';
export { compareNames, sortByName } from './collation';
export { cleanVodTitle, cleanEpisodeTitle } from './titles';
export type * from './types';
export {
  mapYouTubeSearch,
  youtubeSearchFailure,
  YOUTUBE_SEARCH_MAX_RESULTS,
  type YouTubeSearchResult,
} from './youtube-search';
export { CINEMA_REF_PATTERN, RMDB_REVIEW_MAX } from './types';
export {
  CINEMA_SCHEME,
  cinemaArtUrl,
  type CinemaBridge,
  type CinemaErrorCode,
  type CinemaItemsQuery,
  type CinemaPage,
  type CinemaExternalSubtitleSource,
  type CinemaExternalSubtitleSources,
  type CinemaSourceInput,
  type CinemaSubtitleSource,
  type CinemaWatchSource,
} from './bridge';
export {
  cueText,
  decodeSubtitle,
  formatVtt,
  parseAss,
  parseSrt,
  parseVtt,
  subtitleCues,
  type SubtitleCue,
} from './webvtt';
