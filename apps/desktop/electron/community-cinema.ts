import { z } from 'zod';
import type { StoatClient } from '@rooms/stoat';
import { SOCIAL_ID_PATTERN } from '@rooms/social';
import { randomBytes } from 'node:crypto';
import { isIP } from 'node:net';
import { t } from '@rooms/i18n';
import { CINEMA_REF_PATTERN, RMDB_REVIEW_MAX } from '../../../packages/community-cinema/src/types';
import { STREMIO_ID, streamFacts } from '../../../packages/community-cinema/src/stremio';
import {
  mapYouTubeSearch,
  youtubeSearchFailure,
} from '../../../packages/community-cinema/src/youtube-search';

/** The account the cinema request was made with; a request finishing in another account fails. */
export type CinemaAccount = { client: StoatClient; token: string; origin: string };

export class CinemaRequestError extends Error {}

const socialId = z.string().regex(SOCIAL_ID_PATTERN);
const ref = z.string().regex(CINEMA_REF_PATTERN);
const kind = z.enum(['live', 'movie', 'series']);
const relayFile = /^[A-Za-z0-9_.-]{1,80}$/;
const sessionId = /^[A-Za-z0-9_-]{1,80}$/;
const rmdbWork = z.string().regex(/^w-[A-Za-z0-9_-]{8,40}$/);
const rmdbEntry = z.string().regex(/^d-[A-Za-z0-9_-]{8,40}$/);
const stremioType = z.enum(['movie', 'series']);
const stremioId = z.string().regex(STREMIO_ID);
const assistTargets = z
  .array(z.object({ addon: z.string().max(200), url: z.string().max(4096) }))
  .max(20);

/** An https link to a public host: add-on answers never steer this computer into its LAN. */
function publicHttps(value: unknown) {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.localhost')) return null;
    if (isIP(host)) return null;
    return url.href;
  } catch {
    return null;
  }
}
const textOf = (value: unknown, max: number) =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null;
const stremioStream = z.string().regex(/^[A-Za-z0-9_-]{8,40}$/);
const stremioLink = z
  .object({
    code: z.string().regex(/^[A-Za-z0-9]{3,16}$/),
    link: z.string().regex(/^https:\/\/link\.stremio\.com\/[A-Za-z0-9]{3,16}$/),
  })
  .strict();
const rmdbReview = z
  .object({
    rating: z.number().int().min(1).max(10).nullable(),
    text: z.string().max(RMDB_REVIEW_MAX),
    spoiler: z.boolean(),
    liked: z.boolean(),
  })
  .strict();

const sourceInput = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('xtream'),
      server: z.string().max(2048),
      username: z.string().max(200),
      password: z.string().max(200),
      guideUrl: z.string().max(2048).nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal('m3u'),
      url: z.string().max(2048),
      guideUrl: z.string().max(2048).nullable(),
    })
    .strict(),
]);

const itemsQuery = z
  .object({
    kind,
    categoryId: z.string().max(120).nullable().optional(),
    sort: z.enum(['default', 'name', 'added', 'rating']).optional(),
    offset: z.number().int().min(0).max(1_000_000).optional(),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

const watchResponse = z
  .object({
    session: z.string().regex(sessionId),
    ticket: z
      .string()
      .min(16)
      .max(1024)
      .regex(/^[A-Za-z0-9_.-]+$/),
    expiresAt: z.number(),
    live: z.boolean(),
    durationSec: z.number().nullable(),
    offsetSec: z.number().min(0),
    epoch: z.number().int(),
    itemRef: z.string().regex(CINEMA_REF_PATTERN),
    ttlMs: z.number().int().min(0).max(3_600_000).optional(),
    originPdtMs: z.number().nullable().optional(),
    audioTracks: z
      .array(z.object({ index: z.number().int().min(0).max(31), label: z.string().max(80) }))
      .max(32)
      .optional(),
    audioTrack: z.number().int().min(0).max(31).nullable().optional(),
    video: z
      .object({
        width: z.number().int().min(1).max(16384).nullable(),
        height: z.number().int().min(1).max(16384).nullable(),
        fps: z.number().min(1).max(1000).nullable(),
        codec: z.string().max(40).nullable(),
        bitrate: z.number().int().min(1).max(1e10).nullable(),
      })
      .nullable()
      .optional(),
    subtitleTracks: z
      .array(
        z.object({
          index: z.number().int().min(0).max(31),
          label: z.string().max(80),
          language: z
            .string()
            .regex(/^[a-z]{2,3}$/)
            .nullable(),
          forced: z.boolean(),
        }),
      )
      .max(16)
      .optional(),
  })
  .passthrough();

const externalSubtitles = z.object({
  available: z.boolean(),
  subtitles: z
    .array(
      z
        .object({
          id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
          label: z.string().max(80),
          language: z.enum(['tur', 'eng']),
          hearingImpaired: z.boolean(),
        })
        .strict(),
    )
    .max(20),
});

type Ticket = {
  ticket: string;
  hallId: string;
  account: CinemaAccount;
  /** Local clock: the server's ttl counted from when we received it. */
  expiresAt: number;
  renewal?: Promise<Ticket | null>;
};

const renewalResponse = z
  .object({
    ticket: z
      .string()
      .min(16)
      .max(1024)
      .regex(/^[A-Za-z0-9_.-]+$/),
    ttlMs: z.number().int().min(0).max(3_600_000),
  })
  .passthrough();

/**
 * Community cinema IPC and the `rooms-cinema:` scheme. The Stoat token and
 * relay tickets stay here; the renderer gets `rooms-cinema://stream/<session>/…`
 * for playback and `rooms-cinema://art/<hall>/<id>` for artwork.
 */
export function setupCommunityCinema(options: {
  handle(name: string, handler: (...args: unknown[]) => unknown): void;
  /** The signed-in account, or a thrown sign-in error. */
  account(): CinemaAccount;
  /** Whether `account` is still the signed-in one. */
  isCurrent(account: CinemaAccount): boolean;
  /** Opens Stremio's link page in the browser. */
  openExternal?(url: string): Promise<void>;
  fetch?: typeof fetch;
}) {
  const request = options.fetch ?? fetch;
  const tickets = new Map<string, Ticket>();
  /** Latest watch request per hall; an older answer must not drop a newer session. */
  const watches = new Map<string, number>();

  async function call(
    account: CinemaAccount,
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs = 15_000,
  ) {
    let response: Response;
    try {
      response = await request(`${account.origin}/rooms-cinema${path}`, {
        method,
        headers: {
          Authorization: account.token,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new CinemaRequestError('CINEMA_UNAVAILABLE');
    }
    const value = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (!options.isCurrent(account)) throw new CinemaRequestError(t('Oturum değişti.'));
    if (!response.ok)
      throw new CinemaRequestError(
        typeof value?.error === 'string' && /^CINEMA_[A-Z_]{2,40}$/.test(value.error)
          ? value.error
          : 'CINEMA_UNAVAILABLE',
      );
    return value;
  }

  const api = (
    method: 'GET' | 'PUT' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
    timeoutMs?: number,
  ) => call(options.account(), method, path, body, timeoutMs);
  const community = (communityId: unknown) =>
    `/v1/communities/${encodeURIComponent(socialId.parse(communityId))}`;
  const hall = (hallId: unknown) => `/v1/halls/${encodeURIComponent(socialId.parse(hallId))}`;

  options.handle('rooms:cinema-status', (communityId) => api('GET', community(communityId)));
  options.handle('rooms:cinema-set-hall', (communityId, channelId) =>
    api('PUT', `${community(communityId)}/hall`, {
      channelId: socialId.nullable().parse(channelId),
    }),
  );
  // Verifying an account downloads its playlist or account info; large M3U files take a while.
  options.handle('rooms:cinema-connect', (communityId, source) =>
    api('PUT', `${community(communityId)}/source`, sourceInput.parse(source), 180_000),
  );
  options.handle('rooms:cinema-disconnect', async (communityId) => {
    const result = await api('DELETE', `${community(communityId)}/source`);
    tickets.clear();
    return result;
  });
  options.handle('rooms:cinema-reload', (communityId, scope) =>
    api('POST', `${community(communityId)}/reload`, {
      scope: z.enum(['all', 'guide']).parse(scope),
    }),
  );
  options.handle('rooms:cinema-categories', (hallId, value) =>
    api('GET', `${hall(hallId)}/categories?kind=${kind.parse(value)}`),
  );
  options.handle('rooms:cinema-items', (hallId, value) => {
    const query = itemsQuery.parse(value);
    const params = new URLSearchParams({ kind: query.kind });
    if (query.categoryId) params.set('categoryId', query.categoryId);
    if (query.sort) params.set('sort', query.sort);
    if (query.offset !== undefined) params.set('offset', String(query.offset));
    if (query.limit !== undefined) params.set('limit', String(query.limit));
    return api('GET', `${hall(hallId)}/items?${params}`);
  });
  options.handle('rooms:cinema-search', (hallId, text, kinds) => {
    const params = new URLSearchParams({ q: z.string().max(200).parse(text) });
    if (kinds !== undefined) params.set('kinds', z.array(kind).max(3).parse(kinds).join(','));
    return api('GET', `${hall(hallId)}/search?${params}`);
  });
  // YouTube text search goes through the community's access service (it holds the yt-dlp
  // search the DJ uses); the Stoat token never leaves this process.
  options.handle('rooms:cinema-youtube-search', async (hallId, text) => {
    const id = socialId.parse(hallId);
    const account = options.account();
    const query = z.string().trim().min(2).max(200).parse(text);
    let response: Response;
    try {
      response = await request(
        `${account.origin}/rooms-access/v1/halls/${encodeURIComponent(id)}/youtube-search`,
        {
          method: 'POST',
          headers: { Authorization: account.token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          redirect: 'error',
          signal: AbortSignal.timeout(55_000),
        },
      );
    } catch {
      throw new CinemaRequestError('CINEMA_YOUTUBE_SEARCH_UNAVAILABLE');
    }
    const value = await response.json().catch(() => null);
    if (!options.isCurrent(account)) throw new CinemaRequestError(t('Oturum değişti.'));
    if (!response.ok) throw new CinemaRequestError(youtubeSearchFailure(response.status, value));
    try {
      return mapYouTubeSearch(value);
    } catch {
      throw new CinemaRequestError('CINEMA_YOUTUBE_SEARCH_UNAVAILABLE');
    }
  });
  options.handle('rooms:cinema-guide', (hallId, refs, from, to) =>
    api('POST', `${hall(hallId)}/guide`, {
      refs: z.array(ref).max(200).parse(refs),
      from: z.number().int().nonnegative().parse(from),
      to: z.number().int().nonnegative().parse(to),
    }),
  );
  options.handle('rooms:cinema-details', (hallId, value) =>
    api('GET', `${hall(hallId)}/details/${encodeURIComponent(ref.parse(value))}`),
  );
  options.handle('rooms:cinema-watch', async (hallId) => {
    const id = socialId.parse(hallId);
    const account = options.account();
    const sequence = (watches.get(id) ?? 0) + 1;
    watches.set(id, sequence);
    // Starting a relay can take the provider up to ~20 s plus probing.
    const watch = watchResponse.parse(
      await call(account, 'POST', `${hall(id)}/watch`, undefined, 45_000),
    );
    if (watches.get(id) === sequence)
      for (const [session, ticket] of tickets)
        if (ticket.hallId === id && session !== watch.session) tickets.delete(session);
    tickets.set(watch.session, {
      ticket: watch.ticket,
      hallId: id,
      account,
      expiresAt: Date.now() + (watch.ttlMs ?? Math.max(0, watch.expiresAt - Date.now())),
    });
    return {
      src: `rooms-cinema://stream/${watch.session}/index.m3u8`,
      itemRef: watch.itemRef,
      live: watch.live,
      durationSec: watch.durationSec,
      offsetSec: watch.offsetSec,
      epoch: watch.epoch,
      originPdtMs: watch.originPdtMs ?? null,
      audioTracks: watch.audioTracks ?? [],
      audioTrack: watch.audioTrack ?? null,
      video: watch.video ?? null,
      subtitles: (watch.subtitleTracks ?? []).map((track) => ({
        index: track.index,
        label: track.label,
        language: track.language,
        forced: track.forced,
        src: `rooms-cinema://stream/${watch.session}/sub${track.index}.vtt`,
      })),
    };
  });
  options.handle('rooms:cinema-audio-default', (communityId, value) =>
    api('PUT', `${community(communityId)}/audio`, {
      value: z.enum(['turkish', 'original']).parse(value),
    }),
  );
  options.handle('rooms:cinema-tmdb-key', (communityId, key) =>
    api('PUT', `${community(communityId)}/tmdb`, {
      key: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9._-]{20,1024}$/)
        .nullable()
        .parse(key),
    }),
  );
  options.handle('rooms:cinema-links', (hallId, value) =>
    api('GET', `${hall(hallId)}/links/${encodeURIComponent(ref.parse(value))}`, undefined, 20_000),
  );
  options.handle('rooms:cinema-subtitle-key', (communityId, key) =>
    api('PUT', `${community(communityId)}/subtitles`, {
      key: z
        .string()
        .trim()
        .regex(/^[A-Za-z0-9_-]{8,128}$/)
        .nullable()
        .parse(key),
    }),
  );
  options.handle('rooms:cinema-subtitles', async (hallId, value) => {
    const id = socialId.parse(hallId);
    const item = ref.parse(value);
    const result = externalSubtitles.parse(
      await api('GET', `${hall(id)}/subtitles/${encodeURIComponent(item)}`, undefined, 30_000),
    );
    return {
      available: result.available,
      subtitles: result.subtitles.map((subtitle) => ({
        ...subtitle,
        src: `rooms-cinema://subtitle/${id}/${item}/${subtitle.id}`,
      })),
    };
  });
  options.handle('rooms:cinema-audio', async (hallId, value, track) => {
    await api('POST', `${hall(hallId)}/audio`, {
      ref: ref.parse(value),
      track: z.number().int().min(0).max(31).parse(track),
    });
  });

  // RMDB: the hall's own record of what it watched, with members' ratings and reviews.
  const work = (hallId: unknown, workId: unknown) =>
    `${hall(hallId)}/rmdb/${encodeURIComponent(rmdbWork.parse(workId))}`;
  options.handle('rooms:cinema-rmdb', (hallId) => api('GET', `${hall(hallId)}/rmdb`));
  options.handle('rooms:cinema-favorites', (hallId) => api('GET', `${hall(hallId)}/favorites`));
  options.handle('rooms:cinema-favorite', (hallId, value, on) =>
    api('PUT', `${hall(hallId)}/favorites`, { ref: ref.parse(value), on: z.boolean().parse(on) }),
  );
  options.handle('rooms:cinema-episode-marks', (hallId, value) =>
    api('GET', `${hall(hallId)}/episodes/${encodeURIComponent(ref.parse(value))}`),
  );
  options.handle('rooms:cinema-mark-episode', (hallId, value, watched) =>
    api(
      'PUT',
      `${hall(hallId)}/episodes/${encodeURIComponent(ref.parse(value))}`,
      { watched: z.boolean().parse(watched) },
      30_000,
    ),
  );
  // Series may fetch their episodes from the provider first.
  options.handle('rooms:cinema-continue', (hallId, kind) =>
    api(
      'GET',
      `${hall(hallId)}/continue?kind=${z.enum(['movie', 'series']).parse(kind)}`,
      undefined,
      30_000,
    ),
  );
  options.handle('rooms:cinema-rmdb-work', (hallId, workId) =>
    api('GET', work(hallId, workId), undefined, 30_000),
  );
  // Adding fetches the title's details from the provider first.
  options.handle('rooms:cinema-rmdb-add', (hallId, value, watchlist) =>
    api(
      'POST',
      `${hall(hallId)}/rmdb`,
      { ref: ref.parse(value), watchlist: z.boolean().parse(watchlist) },
      30_000,
    ),
  );
  options.handle('rooms:cinema-rmdb-review', (hallId, workId, value) =>
    value === null
      ? api('DELETE', `${work(hallId, workId)}/review`)
      : api('PUT', `${work(hallId, workId)}/review`, rmdbReview.parse(value)),
  );
  options.handle('rooms:cinema-rmdb-remove-review', (hallId, workId, userId) =>
    api('DELETE', `${work(hallId, workId)}/reviews/${encodeURIComponent(socialId.parse(userId))}`),
  );
  options.handle('rooms:cinema-rmdb-watchlist', (hallId, workId, on) =>
    api('PUT', `${work(hallId, workId)}/watchlist`, { on: z.boolean().parse(on) }),
  );
  options.handle('rooms:cinema-rmdb-log', (hallId, workId, watchedAt) =>
    api('POST', `${work(hallId, workId)}/diary`, {
      watchedAt: z.number().int().nonnegative().optional().parse(watchedAt),
    }),
  );
  options.handle('rooms:cinema-rmdb-remove-log', (hallId, workId, entryId) =>
    api('DELETE', `${work(hallId, workId)}/diary/${encodeURIComponent(rmdbEntry.parse(entryId))}`),
  );
  options.handle('rooms:cinema-rmdb-remove', async (hallId, workId) => {
    await api('DELETE', work(hallId, workId));
  });
  // Stremio: the main process opens only Stremio's own link page, whatever the service says.
  options.handle('rooms:cinema-stremio-link', async (communityId) => {
    const code = stremioLink.parse(await api('POST', `${community(communityId)}/stremio/link`, {}));
    await options.openExternal?.(code.link);
    return code;
  });
  options.handle('rooms:cinema-stremio-poll', (communityId) =>
    api('POST', `${community(communityId)}/stremio/poll`, {}, 20_000),
  );
  options.handle('rooms:cinema-stremio-unlink', (communityId) =>
    api('DELETE', `${community(communityId)}/stremio`),
  );
  options.handle('rooms:cinema-stremio-home', (hallId) =>
    api('GET', `${hall(hallId)}/stremio/home`, undefined, 30_000),
  );
  options.handle('rooms:cinema-stremio-search', (hallId, text) =>
    api(
      'GET',
      `${hall(hallId)}/stremio/search?${new URLSearchParams({ q: z.string().max(200).parse(text) })}`,
      undefined,
      30_000,
    ),
  );
  options.handle('rooms:cinema-stremio-details', (hallId, type, id) =>
    api(
      'GET',
      `${hall(hallId)}/stremio/details?${new URLSearchParams({
        type: stremioType.parse(type),
        id: stremioId.parse(id),
      })}`,
      undefined,
      30_000,
    ),
  );
  // Add-ons answer slowly (debrid lookups); the service waits up to 20 s for each.
  options.handle('rooms:cinema-stremio-streams', (hallId, type, id, videoId) =>
    api(
      'GET',
      `${hall(hallId)}/stremio/streams?${new URLSearchParams({
        type: stremioType.parse(type),
        id: stremioId.parse(id),
        videoId: stremioId.parse(videoId),
      })}`,
      undefined,
      60_000,
    ),
  );
  /**
   * Torrentio refuses data-centre addresses. For whoever linked the account, this computer
   * asks those add-ons itself; the links (they carry the debrid key) stay in this process.
   */
  const assisted = new Map<
    string,
    {
      hallId: string;
      url: string;
      type: 'movie' | 'series';
      metaId: string;
      videoId: string;
      at: number;
    }
  >();
  options.handle('rooms:cinema-stremio-assist', async (hallId, type, id, videoId) => {
    const kind = stremioType.parse(type);
    const metaId = stremioId.parse(id);
    const video = stremioId.parse(videoId);
    const hallKey = socialId.parse(hallId);
    const targets = assistTargets.parse(
      await api(
        'GET',
        `${hall(hallKey)}/stremio/assist?${new URLSearchParams({ type: kind, videoId: video })}`,
      ),
    );
    const found: unknown[] = [];
    await Promise.all(
      targets.map(async (target) => {
        const url = publicHttps(target.url);
        if (!url) return;
        let body: { streams?: unknown } | null = null;
        try {
          const response = await request(url, {
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(20_000),
          });
          if (response.ok) body = (await response.json()) as { streams?: unknown };
        } catch {
          return;
        }
        const streams = Array.isArray(body?.streams) ? body.streams.slice(0, 200) : [];
        for (const entry of streams as Record<string, unknown>[]) {
          const link = publicHttps(entry?.url);
          if (!link) continue;
          const name = textOf(entry.name, 200) ?? target.addon;
          const title = textOf(entry.title, 600) ?? textOf(entry.description, 600) ?? '';
          const localId = randomBytes(12).toString('base64url');
          assisted.set(localId, {
            hallId: hallKey,
            url: link,
            type: kind,
            metaId,
            videoId: video,
            at: Date.now(),
          });
          found.push({
            id: localId,
            addon: target.addon,
            name,
            title,
            ...streamFacts(name, title),
          });
        }
      }),
    );
    for (const [key, entry] of assisted)
      if (Date.now() - entry.at > 2 * 3600_000 || assisted.size > 2000) assisted.delete(key);
    return found;
  });
  options.handle('rooms:cinema-stremio-pick-local', async (hallId, streamId) => {
    const entry = assisted.get(stremioStream.parse(streamId));
    if (!entry || entry.hallId !== socialId.parse(hallId))
      throw new CinemaRequestError('CINEMA_STREMIO_STREAM_EXPIRED');
    // Follow the add-on's redirects (Torrentio → the debrid download) from this computer.
    const origin = new URL(entry.url).hostname;
    let current = entry.url;
    for (let hop = 0; hop < 6; hop++) {
      let response: Response;
      try {
        response = await request(current, {
          redirect: 'manual',
          signal: AbortSignal.timeout(30_000),
        });
      } catch {
        throw new CinemaRequestError('CINEMA_STREMIO_UNAVAILABLE');
      }
      const location = response.headers.get('location');
      await response.body?.cancel().catch(() => {});
      if (response.status >= 300 && response.status < 400 && location) {
        current = publicHttps(new URL(location, current).href) ?? '';
        if (!current) throw new CinemaRequestError('CINEMA_STREMIO_UNAVAILABLE');
        continue;
      }
      if (!response.ok) throw new CinemaRequestError('CINEMA_STREMIO_UNAVAILABLE');
      break;
    }
    // Still on the add-on: Torrentio answers an uncached stream with its own "downloading" clip.
    if (new URL(current).hostname === origin)
      throw new CinemaRequestError('CINEMA_STREMIO_NOT_CACHED');
    return api('POST', `${hall(hallId)}/stremio/pick-direct`, {
      url: current,
      type: entry.type,
      metaId: entry.metaId,
      videoId: entry.videoId,
    });
  });
  options.handle('rooms:cinema-stremio-pick', (hallId, streamId) =>
    api('POST', `${hall(hallId)}/stremio/pick`, { streamId: stremioStream.parse(streamId) }),
  );

  /**
   * The session's ticket, renewed when it is close to expiry (or `force`d after a 401).
   * Renewal never starts or restarts a relay; an ended session returns null (→ 410).
   */
  async function ticketFor(session: string, force = false): Promise<Ticket | null> {
    const ticket = tickets.get(session);
    if (!ticket || !options.isCurrent(ticket.account)) return null;
    if (!force && ticket.expiresAt - Date.now() > 30_000) return ticket;
    ticket.renewal ??= (async () => {
      try {
        const next = renewalResponse.parse(
          await call(
            ticket.account,
            'POST',
            `${hall(ticket.hallId)}/sessions/${session}/ticket`,
            undefined,
            15_000,
          ),
        );
        const renewed: Ticket = {
          ticket: next.ticket,
          hallId: ticket.hallId,
          account: ticket.account,
          expiresAt: Date.now() + next.ttlMs,
        };
        if (tickets.get(session) === ticket) tickets.set(session, renewed);
        return renewed;
      } catch (error) {
        if (error instanceof CinemaRequestError && error.message === 'CINEMA_SESSION_ENDED') {
          tickets.delete(session);
          return null;
        }
        return ticket.expiresAt > Date.now() ? ticket : null;
      } finally {
        ticket.renewal = undefined;
      }
    })();
    return ticket.renewal;
  }

  const cors = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' };

  const serve = async (incoming: Request) => {
    try {
      const url = new URL(incoming.url);
      const [first, second] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
      if (url.hostname === 'stream') {
        if (!first || !second || !sessionId.test(first) || !relayFile.test(second))
          return new Response('Not found', { status: 404, headers: cors });
        let ticket = await ticketFor(first);
        if (!ticket) return new Response('Expired', { status: 410, headers: cors });
        const fetchFile = (value: Ticket) =>
          request(
            `${value.account.origin}/rooms-cinema/v1/relay/${encodeURIComponent(value.ticket)}/${encodeURIComponent(second)}`,
            { redirect: 'error', signal: incoming.signal },
          );
        let response = await fetchFile(ticket);
        if (response.status === 401) {
          // Clock skew or a lost renewal: renew once and retry.
          await response.body?.cancel();
          ticket = await ticketFor(first, true);
          if (!ticket) return new Response('Expired', { status: 410, headers: cors });
          response = await fetchFile(ticket);
        }
        if (!options.isCurrent(ticket.account)) {
          await response.body?.cancel();
          return new Response('Expired', { status: 410, headers: cors });
        }
        return new Response(response.ok ? response.body : null, {
          status: response.status,
          headers: {
            ...cors,
            'Content-Type': response.headers.get('content-type') ?? 'application/octet-stream',
          },
        });
      }
      if (url.hostname === 'art') {
        if (
          !first ||
          !second ||
          !SOCIAL_ID_PATTERN.test(first) ||
          !/^[a-f0-9]{16,64}$/.test(second)
        )
          return new Response('Not found', { status: 404 });
        const account = options.account();
        const response = await request(
          `${account.origin}/rooms-cinema${hall(first)}/art/${second}`,
          {
            headers: { Authorization: account.token },
            redirect: 'error',
            signal: incoming.signal,
          },
        );
        const type = response.headers.get('content-type') ?? '';
        if (!response.ok || !type.startsWith('image/') || !options.isCurrent(account)) {
          await response.body?.cancel();
          return new Response('Not found', { status: 404 });
        }
        return new Response(response.body, {
          headers: { 'Content-Type': type, 'Cache-Control': 'private, max-age=86400' },
        });
      }
      if (url.hostname === 'subtitle') {
        const [, , third] = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
        if (
          !first ||
          !second ||
          !third ||
          !socialId.safeParse(first).success ||
          !ref.safeParse(second).success ||
          !/^[A-Za-z0-9_-]{1,64}$/.test(third)
        )
          return new Response('Not found', { status: 404, headers: cors });
        const account = options.account();
        const response = await request(
          `${account.origin}/rooms-cinema${hall(first)}/subtitles/${encodeURIComponent(second)}/${third}`,
          { headers: { Authorization: account.token }, redirect: 'error', signal: incoming.signal },
        );
        const type = response.headers.get('content-type') ?? '';
        if (!response.ok || !type.startsWith('text/vtt') || !options.isCurrent(account)) {
          await response.body?.cancel();
          return new Response('Not found', {
            status: response.ok ? 404 : response.status,
            headers: cors,
          });
        }
        return new Response(response.body, {
          headers: { ...cors, 'Content-Type': 'text/vtt; charset=utf-8' },
        });
      }
      return new Response('Not found', { status: 404 });
    } catch {
      return new Response('Unavailable', { status: 502, headers: cors });
    }
  };

  return {
    /** Handler for the `rooms-cinema:` scheme; main registers it. */
    serve,
    /** Forget every relay ticket (sign-out, account switch). */
    clear() {
      tickets.clear();
    },
  };
}
