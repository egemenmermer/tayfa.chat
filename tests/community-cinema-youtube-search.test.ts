import { describe, expect, it } from 'vitest';
import { setupCommunityCinema } from '../apps/desktop/electron/community-cinema';
import {
  mapYouTubeSearch,
  youtubeSearchFailure,
} from '../packages/community-cinema/src/youtube-search';

describe('YouTube search result mapping', () => {
  it('maps service rows and drops malformed, duplicate or untitled ones', () => {
    expect(
      mapYouTubeSearch([
        { id: 'dQw4w9WgXcQ', title: ' Never \u0007Gonna ', durationSec: 212.4 },
        { id: 'dQw4w9WgXcQ', title: 'duplicate', durationSec: 1 },
        { id: 'short', title: 'bad id', durationSec: 1 },
        { id: 'jNQXAC9IVRw', title: '   ', durationSec: 1 },
        { id: 'jNQXAC9IVRw', title: 'Me at the zoo', durationSec: -5 },
        null,
        'x',
      ]),
    ).toEqual([
      { videoId: 'dQw4w9WgXcQ', title: 'Never Gonna', durationSec: 212 },
      { videoId: 'jNQXAC9IVRw', title: 'Me at the zoo', durationSec: 0 },
    ]);
  });
  it('keeps at most five results and refuses a non-list answer', () => {
    const rows = Array.from({ length: 9 }, (_, i) => ({
      id: `abcdefghij${i}`,
      title: `t${i}`,
      durationSec: 10,
    }));
    expect(mapYouTubeSearch(rows)).toHaveLength(5);
    expect(() => mapYouTubeSearch({ error: 'x' })).toThrow('CINEMA_YOUTUBE_SEARCH_UNAVAILABLE');
  });
  it('classifies failures: rate limit, busy, access, everything else', () => {
    expect(youtubeSearchFailure(429, { message: 'slow down' })).toBe('CINEMA_RATE_LIMITED');
    expect(youtubeSearchFailure(503, { error: 'MUSIC_SEARCH_BUSY' })).toBe('CINEMA_RATE_LIMITED');
    expect(youtubeSearchFailure(401, { error: 'AUTH_REQUIRED' })).toBe('CINEMA_ACCESS_DENIED');
    expect(youtubeSearchFailure(404, null)).toBe('CINEMA_YOUTUBE_SEARCH_UNAVAILABLE');
    expect(youtubeSearchFailure(503, { error: 'MUSIC_SEARCH_UNAVAILABLE' })).toBe(
      'CINEMA_YOUTUBE_SEARCH_UNAVAILABLE',
    );
  });
});

function setup(respond: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const requests: { url: string; init?: RequestInit }[] = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(input), init });
    return respond(String(input), init);
  }) as typeof fetch;
  const account = { client: {} as never, token: 'token-a', origin: 'https://rooms.example' };
  setupCommunityCinema({
    handle: (name, handler) => handlers.set(name, handler),
    account: () => account,
    isCurrent: () => true,
    fetch: fetchMock,
  });
  return {
    search: (...args: unknown[]) => handlers.get('rooms:cinema-youtube-search')!(...args),
    requests,
  };
}

describe('rooms:cinema-youtube-search', () => {
  it('posts the trimmed query to the access service with the member token and maps the answer', async () => {
    const { search, requests } = setup(() =>
      Response.json([{ id: 'dQw4w9WgXcQ', title: 'Song', durationSec: 200 }]),
    );
    await expect(search('hall-1', '  rick roll ')).resolves.toEqual([
      { videoId: 'dQw4w9WgXcQ', title: 'Song', durationSec: 200 },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toBe(
      'https://rooms.example/rooms-access/v1/halls/hall-1/youtube-search',
    );
    expect(requests[0]!.init).toMatchObject({ method: 'POST', redirect: 'error' });
    expect((requests[0]!.init!.headers as Record<string, string>).Authorization).toBe('token-a');
    expect(JSON.parse(String(requests[0]!.init!.body))).toEqual({ query: 'rick roll' });
  });
  it('rejects bad input before any request', async () => {
    const { search, requests } = setup(() => Response.json([]));
    await expect(search('hall-1', 'a')).rejects.toThrow();
    await expect(search('../x', 'abc')).rejects.toThrow();
    expect(requests).toHaveLength(0);
  });
  it('reports a rate limit, an old server without the route and a network failure', async () => {
    await expect(
      setup(() => new Response('{}', { status: 429 })).search('hall-1', 'abc'),
    ).rejects.toThrow('CINEMA_RATE_LIMITED');
    await expect(
      setup(() => new Response('Not found', { status: 404 })).search('hall-1', 'abc'),
    ).rejects.toThrow('CINEMA_YOUTUBE_SEARCH_UNAVAILABLE');
    await expect(
      setup(() => {
        throw new TypeError('offline');
      }).search('hall-1', 'abc'),
    ).rejects.toThrow('CINEMA_YOUTUBE_SEARCH_UNAVAILABLE');
    await expect(
      setup(() => Response.json({ not: 'a list' })).search('hall-1', 'abc'),
    ).rejects.toThrow('CINEMA_YOUTUBE_SEARCH_UNAVAILABLE');
  });
});
