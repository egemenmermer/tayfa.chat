// Sinema's YouTube search: the shape the desktop shows and how the access service's answer maps to it.

/** One result of a YouTube text search. The thumbnail is derived from `videoId` by the UI. */
export interface YouTubeSearchResult {
  videoId: string;
  title: string;
  /** 0 when YouTube did not report a length. */
  durationSec: number;
}

const VIDEO_ID = /^[\w-]{11}$/;
/** Same bound as the DJ search the service reuses. */
export const YOUTUBE_SEARCH_MAX_RESULTS = 5;

/**
 * Maps the service's `[{ id, title, durationSec }]` list to results. Anything that is not a
 * well-formed entry is dropped instead of failing the whole list; a non-array is an error.
 */
export function mapYouTubeSearch(value: unknown): YouTubeSearchResult[] {
  if (!Array.isArray(value)) throw new Error('CINEMA_YOUTUBE_SEARCH_UNAVAILABLE');
  const seen = new Set<string>();
  const results: YouTubeSearchResult[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const { id, title, durationSec } = entry as Record<string, unknown>;
    if (typeof id !== 'string' || !VIDEO_ID.test(id) || seen.has(id)) continue;
    // eslint-disable-next-line no-control-regex
    const clean = typeof title === 'string' ? title.replace(/[\x00-\x1f\x7f]/g, '').trim() : '';
    if (!clean) continue;
    seen.add(id);
    results.push({
      videoId: id,
      title: clean.slice(0, 160),
      durationSec:
        typeof durationSec === 'number' && Number.isFinite(durationSec) && durationSec > 0
          ? Math.min(Math.round(durationSec), 7200)
          : 0,
    });
    if (results.length === YOUTUBE_SEARCH_MAX_RESULTS) break;
  }
  return results;
}

/** The bridge error code for a failed search answer (HTTP status and the service's `error`). */
export function youtubeSearchFailure(
  status: number,
  body: unknown,
): 'CINEMA_RATE_LIMITED' | 'CINEMA_ACCESS_DENIED' | 'CINEMA_YOUTUBE_SEARCH_UNAVAILABLE' {
  const code =
    body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : '';
  if (status === 429 || code === 'MUSIC_SEARCH_BUSY') return 'CINEMA_RATE_LIMITED';
  if (status === 401 || code === 'AUTH_REQUIRED' || code === 'MUSIC_PERMISSION_DENIED')
    return 'CINEMA_ACCESS_DENIED';
  return 'CINEMA_YOUTUBE_SEARCH_UNAVAILABLE';
}
