import { TMDB_KEY_PATTERN } from './metadata';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { StoatError } from '@rooms/stoat';
import { SOCIAL_ID_PATTERN } from '@rooms/social';
import { CINEMA_REF_PATTERN, RMDB_REVIEW_MAX } from '../../../packages/community-cinema/src/types';
import type { CinemaAuthority } from './authority';
import type { ConfigStore } from './config-store';
import { CinemaError, safeError } from './importer';
import type { CinemaService } from './service';
import { STREMIO_CATALOG_KEY, STREMIO_ID, STREMIO_TYPE } from './stremio';
import { ingressLimit, TRUSTED_PROXIES } from '../shared/ingress';

const socialId = z.string().regex(SOCIAL_ID_PATTERN);
const ref = z.string().regex(CINEMA_REF_PATTERN);
const kind = z.enum(['live', 'movie', 'series']);

const statusOf: Record<string, number> = {
  CINEMA_OWNER_REQUIRED: 403,
  CINEMA_ACCESS_DENIED: 403,
  CINEMA_HALL_REQUIRED: 409,
  CINEMA_NOT_CONNECTED: 409,
  CINEMA_IMPORT_RUNNING: 409,
  CINEMA_NOTHING_SELECTED: 409,
  CINEMA_SOURCE_INVALID: 400,
  CINEMA_PROVIDER_DENIED: 422,
  CINEMA_ACCOUNT_EXPIRED: 422,
  CINEMA_PROVIDER_UNREACHABLE: 502,
  CINEMA_STREAM_FAILED: 502,
  CINEMA_CODEC_UNSUPPORTED: 415,
  CINEMA_RELAY_BUSY: 503,
  CINEMA_ITEM_NOT_FOUND: 404,
  CINEMA_SESSION_ENDED: 410,
  CINEMA_SUBTITLE_KEY_INVALID: 422,
  CINEMA_SUBTITLE_UNAVAILABLE: 502,
  CINEMA_METADATA_KEY_INVALID: 422,
  CINEMA_METADATA_UNAVAILABLE: 502,
  CINEMA_RMDB_NOT_FOUND: 404,
  CINEMA_RMDB_INVALID: 400,
  CINEMA_STREMIO_NOT_LINKED: 409,
  CINEMA_STREMIO_LOGGED_OUT: 409,
  CINEMA_STREMIO_UNAVAILABLE: 502,
  CINEMA_STREMIO_LINK_EXPIRED: 410,
  CINEMA_STREMIO_STREAM_EXPIRED: 410,
};

const stremioId = z.string().regex(STREMIO_ID);

const review = z
  .object({
    rating: z.number().int().min(1).max(10).nullable(),
    text: z.string().max(RMDB_REVIEW_MAX),
    spoiler: z.boolean(),
    liked: z.boolean(),
  })
  .strict();

/** RMDB input that does not fit is the member's mistake, not a bad cinema source. */
function rmdbInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value ?? {});
  if (!parsed.success) throw new CinemaError('CINEMA_RMDB_INVALID');
  return parsed.data;
}

export type CinemaServerOptions = {
  service: CinemaService;
  configs: ConfigStore;
  authority: CinemaAuthority;
  /** Adds the ticketed relay file routes (`/v1/relay/...`). */
  registerRelay?(server: ReturnType<typeof Fastify>): void;
  log?: (line: string) => void;
};

export async function createCinemaServer(options: CinemaServerOptions) {
  const { service, configs, authority } = options;
  const server = Fastify({ logger: false, trustProxy: TRUSTED_PROXIES, bodyLimit: 16384 });
  // Relay files are budgeted per ticket; a full hall must not exhaust one address's budget.
  ingressLimit(server, {
    perMinute: 1200,
    error: 'CINEMA_RATE_LIMITED',
    skip: (url) => url.startsWith('/v1/relay/'),
  });
  await server.register(rateLimit, {
    max: 1200,
    timeWindow: '1 minute',
    // Every request arrives through the reverse proxy, so the peer address is the proxy's.
    // Budget per member (token) instead; relay files are budgeted per ticket.
    keyGenerator: (request) => {
      const relay = /^\/v1\/relay\/([^/]{1,1024})\//.exec(request.url);
      const key = relay?.[1] ?? request.headers.authorization ?? request.ip;
      return createHash('sha256').update(key).digest('base64url').slice(0, 22);
    },
  });

  const token = (request: FastifyRequest) => {
    const value = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if (!value || value.length > 4096) throw new CinemaError('CINEMA_ACCESS_DENIED');
    return value;
  };

  const member = async (request: FastifyRequest, communityId: string) => {
    try {
      return await authority.community(token(request), socialId.parse(communityId));
    } catch (error) {
      throw error instanceof CinemaError ? error : new CinemaError('CINEMA_ACCESS_DENIED');
    }
  };

  const owner = async (request: FastifyRequest, communityId: string) => {
    const identity = await member(request, communityId);
    if (!identity.isOwner) throw new CinemaError('CINEMA_OWNER_REQUIRED');
    return identity;
  };

  /** A member who can see the community's hall channel. */
  const viewer = async (request: FastifyRequest, hallId: string) => {
    const channelId = socialId.parse(hallId);
    let identity;
    try {
      identity = await authority.channel(token(request), channelId);
    } catch (error) {
      throw error instanceof CinemaError ? error : new CinemaError('CINEMA_ACCESS_DENIED');
    }
    if (configs.get(identity.communityId).hallChannelId !== channelId)
      throw new CinemaError('CINEMA_HALL_REQUIRED');
    return identity;
  };

  server.setErrorHandler((error, _request, reply: FastifyReply) => {
    // The relay throws plain errors carrying the same codes.
    if (error instanceof Error && Object.hasOwn(statusOf, error.message))
      return reply.code(statusOf[error.message]).send({ error: error.message });
    if (error instanceof z.ZodError)
      return reply.code(400).send({ error: 'CINEMA_SOURCE_INVALID' });
    if (error instanceof StoatError) return reply.code(403).send({ error: 'CINEMA_ACCESS_DENIED' });
    const status = (error as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ error: 'CINEMA_RATE_LIMITED' });
    // Fastify's own request errors (bad JSON, unsupported media type, body too large…).
    if (status && status >= 400 && status < 500)
      return reply.code(status).send({ error: 'CINEMA_SOURCE_INVALID' });
    options.log?.(`cinema request failed: ${safeError(error)}`);
    return reply.code(500).send({ error: 'CINEMA_UNAVAILABLE' });
  });

  server.get('/health', async () => ({ service: 'cinema', status: 'ok' }));

  type Community = { Params: { communityId: string } };
  type Hall = { Params: { hallId: string } };

  server.get<Community>('/v1/communities/:communityId', async (request) => {
    const identity = await member(request, request.params.communityId);
    return service.status(request.params.communityId, identity.isOwner);
  });

  server.put<Community>('/v1/communities/:communityId/hall', async (request) => {
    const { communityId } = request.params;
    await owner(request, communityId);
    const { channelId } = z.object({ channelId: socialId.nullable() }).strict().parse(request.body);
    if (channelId) {
      const channel = await authority.channel(token(request), channelId).catch(() => null);
      if (channel?.communityId !== communityId) throw new CinemaError('CINEMA_HALL_REQUIRED');
    }
    service.setHall(communityId, channelId);
    return service.status(communityId, true);
  });

  server.put<Community>('/v1/communities/:communityId/source', async (request) => {
    const { communityId } = request.params;
    const identity = await owner(request, communityId);
    await service.connect(communityId, identity.userId, request.body);
    return service.status(communityId, true);
  });

  server.delete<Community>('/v1/communities/:communityId/source', async (request) => {
    const { communityId } = request.params;
    await owner(request, communityId);
    await service.disconnect(communityId);
    return service.status(communityId, true);
  });

  /** Owner: the community's own SubDL API key (null removes it). It is never returned. */
  server.put<Community>('/v1/communities/:communityId/subtitles', async (request) => {
    const { communityId } = request.params;
    await owner(request, communityId);
    const { key } = z
      .object({
        key: z
          .string()
          .regex(/^[A-Za-z0-9_-]{8,128}$/)
          .nullable(),
      })
      .strict()
      .parse(request.body);
    await service.setSubtitleKey(communityId, key);
    return service.status(communityId, true);
  });

  server.put<Community>('/v1/communities/:communityId/audio', async (request) => {
    const { communityId } = request.params;
    await owner(request, communityId);
    const { value } = z
      .object({ value: z.enum(['turkish', 'original']) })
      .strict()
      .parse(request.body);
    service.setAudioDefault(communityId, value);
    return service.status(communityId, true);
  });

  /** Owner: the community's own TMDB key (null removes it). It is never returned. */
  server.put<Community>('/v1/communities/:communityId/tmdb', async (request) => {
    const { communityId } = request.params;
    await owner(request, communityId);
    const { key } = z
      .object({ key: z.string().regex(TMDB_KEY_PATTERN).nullable() })
      .strict()
      .parse(request.body);
    await service.setTmdbKey(communityId, key);
    return service.status(communityId, true);
  });

  server.post<Community>('/v1/communities/:communityId/reload', async (request) => {
    const { communityId } = request.params;
    await owner(request, communityId);
    const { scope } = z
      .object({ scope: z.enum(['all', 'guide']) })
      .strict()
      .parse(request.body);
    service.reload(communityId, scope);
    return service.status(communityId, true);
  });

  /** Owner: a Stremio link code; the owner approves it at link.stremio.com. */
  server.post<Community>('/v1/communities/:communityId/stremio/link', async (request) => {
    const { communityId } = request.params;
    await owner(request, communityId);
    return service.stremio.linkStart(communityId);
  });

  /** Owner: checks the code; the status says whether the account is linked now. */
  server.post<Community>('/v1/communities/:communityId/stremio/poll', async (request) => {
    const { communityId } = request.params;
    const identity = await owner(request, communityId);
    await service.stremio.linkPoll(communityId, identity.userId);
    return service.status(communityId, true);
  });

  server.delete<Community>('/v1/communities/:communityId/stremio', async (request) => {
    const { communityId } = request.params;
    await owner(request, communityId);
    await service.stremioUnlink(communityId);
    return service.status(communityId, true);
  });

  server.get<Hall>('/v1/halls/:hallId/stremio/home', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    return service.stremio.home(identity.communityId, identity.userId);
  });

  /** Streams run through the owner's add-ons and debrid account: owner and admins pick. */
  const picker = async (request: FastifyRequest, hallId: string) => {
    const identity = await viewer(request, hallId);
    if (!identity.isOwner) throw new CinemaError('CINEMA_OWNER_REQUIRED');
    return identity;
  };

  server.get<Hall>('/v1/halls/:hallId/stremio/search', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const { q } = z.object({ q: z.string().max(200) }).parse(request.query);
    return service.stremio.search(identity.communityId, q);
  });

  /** One page of a home row's catalog ("Tümü"), optionally one genre. */
  server.get<Hall>('/v1/halls/:hallId/stremio/catalog', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const query = z
      .object({
        key: z.string().regex(STREMIO_CATALOG_KEY),
        genre: z.string().min(1).max(60).optional(),
        skip: z.coerce.number().int().min(0).max(5000).default(0),
      })
      .parse(request.query);
    return service.stremio.catalogPage(
      identity.communityId,
      query.key,
      query.genre ?? null,
      query.skip,
    );
  });

  server.get<Hall>('/v1/halls/:hallId/stremio/details', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const query = z.object({ type: STREMIO_TYPE, id: stremioId }).parse(request.query);
    return service.stremio.details(identity.communityId, query.type, query.id);
  });

  server.get<Hall>('/v1/halls/:hallId/stremio/streams', async (request) => {
    const identity = await picker(request, request.params.hallId);
    const query = z
      .object({ type: STREMIO_TYPE, id: stremioId, videoId: stremioId })
      .parse(request.query);
    return service.stremio.streams(
      identity.communityId,
      query.type,
      query.id,
      query.videoId,
      identity.userId,
    );
  });

  server.post<Hall>('/v1/halls/:hallId/stremio/pick', async (request) => {
    const identity = await picker(request, request.params.hallId);
    const { streamId } = z
      .object({ streamId: z.string().regex(/^[A-Za-z0-9_-]{8,40}$/) })
      .strict()
      .parse(request.body);
    return service.stremio.pick(identity.communityId, streamId);
  });

  /** Whoever linked the account: add-ons that refuse the server, for their desktop to ask. */
  server.get<Hall>('/v1/halls/:hallId/stremio/assist', async (request) => {
    const identity = await picker(request, request.params.hallId);
    const query = z.object({ type: STREMIO_TYPE, videoId: stremioId }).parse(request.query);
    return service.stremio.assistTargets(
      identity.communityId,
      identity.userId,
      query.type,
      query.videoId,
    );
  });

  /** Whoever linked the account: the final link their desktop resolved. */
  server.post<Hall>('/v1/halls/:hallId/stremio/pick-direct', async (request) => {
    const identity = await picker(request, request.params.hallId);
    const body = z
      .object({
        url: z.string().max(4096),
        type: STREMIO_TYPE,
        metaId: stremioId,
        videoId: stremioId,
      })
      .strict()
      .parse(request.body);
    return service.stremio.pickDirect(identity.communityId, identity.userId, body);
  });

  server.get<Hall>('/v1/halls/:hallId/categories', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const query = z.object({ kind }).parse(request.query);
    return service.catalog(identity.communityId).categories(query.kind);
  });

  server.get<Hall>('/v1/halls/:hallId/items', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const query = z
      .object({
        kind,
        categoryId: z
          .string()
          .regex(/^[a-z][A-Za-z0-9_-]{1,100}$/)
          .optional(),
        sort: z.enum(['default', 'name', 'added', 'rating']).optional(),
        offset: z.coerce.number().int().min(0).max(1_000_000).optional(),
        limit: z.coerce.number().int().min(1).max(1000).optional(),
      })
      .parse(request.query);
    return service.catalog(identity.communityId).list(query);
  });

  server.get<Hall>('/v1/halls/:hallId/search', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const query = z
      .object({ q: z.string().max(200), kinds: z.string().max(40).optional() })
      .parse(request.query);
    const kinds = query.kinds ? z.array(kind).parse(query.kinds.split(',')) : undefined;
    return service.catalog(identity.communityId).search(query.q, kinds);
  });

  server.post<Hall>('/v1/halls/:hallId/guide', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const body = z
      .object({
        refs: z.array(ref).max(200),
        from: z.number().int().nonnegative(),
        to: z.number().int().nonnegative(),
      })
      .strict()
      .refine((value) => value.to > value.from && value.to - value.from <= 3 * 86_400_000)
      .parse(request.body);
    return service.catalog(identity.communityId).guide(body.refs, body.from, body.to);
  });

  server.get<{ Params: { hallId: string; ref: string } }>(
    '/v1/halls/:hallId/details/:ref',
    async (request) => {
      const identity = await viewer(request, request.params.hallId);
      return service.details(identity.communityId, ref.parse(request.params.ref));
    },
  );

  server.get<{ Params: { hallId: string; artId: string } }>(
    '/v1/halls/:hallId/art/:artId',
    async (request, reply) => {
      const identity = await viewer(request, request.params.hallId);
      const id = z
        .string()
        .regex(/^[a-f0-9]{16,64}$/)
        .parse(request.params.artId);
      const image = await service.image(identity.communityId, id);
      return reply
        .header('content-type', image.type)
        .header('cache-control', 'private, max-age=86400')
        .header('x-content-type-options', 'nosniff')
        .send(image.body);
    },
  );

  server.get<{ Params: { hallId: string; ref: string } }>(
    '/v1/halls/:hallId/subtitles/:ref',
    async (request) => {
      const identity = await viewer(request, request.params.hallId);
      return service.externalSubtitles(identity.communityId, ref.parse(request.params.ref));
    },
  );

  server.get<{ Params: { hallId: string; ref: string; id: string } }>(
    '/v1/halls/:hallId/subtitles/:ref/:id',
    async (request, reply) => {
      const identity = await viewer(request, request.params.hallId);
      const id = z
        .string()
        .regex(/^[A-Za-z0-9_-]{1,64}$/)
        .parse(request.params.id);
      const text = await service.subtitleFile(
        identity.communityId,
        ref.parse(request.params.ref),
        id,
      );
      return reply
        .header('content-type', 'text/vtt; charset=utf-8')
        .header('cache-control', 'private, max-age=86400')
        .header('x-content-type-options', 'nosniff')
        .send(text);
    },
  );

  server.post<Hall>('/v1/halls/:hallId/watch', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    return service.watch(
      token(request),
      request.params.hallId,
      identity.communityId,
      identity.userId,
      identity.displayName,
    );
  });

  /** The hall's audio stream for the playing item; only whoever holds the remote. */
  server.post<Hall>('/v1/halls/:hallId/audio', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const body = z
      .object({ ref, track: z.number().int().min(0).max(31) })
      .strict()
      .parse(request.body);
    return service.setAudio(
      token(request),
      request.params.hallId,
      identity.communityId,
      identity.userId,
      body.ref,
      body.track,
    );
  });

  /** Renews the ticket of a running relay session; never starts or restarts a relay. */
  server.post<{ Params: { hallId: string; session: string } }>(
    '/v1/halls/:hallId/sessions/:session/ticket',
    async (request) => {
      const identity = await viewer(request, request.params.hallId);
      const session = z
        .string()
        .regex(/^[a-f0-9]{32}$/)
        .parse(request.params.session);
      return service.renew(
        token(request),
        request.params.hallId,
        identity.communityId,
        identity.userId,
        session,
        identity.displayName,
      );
    },
  );

  // RMDB: the community's record of what the hall watched. It works without an IPTV
  // account; only adding a title from the catalog needs one.
  type Work = { Params: { hallId: string; workId: string } };
  const person = (identity: { userId: string; displayName: string }) => ({
    userId: identity.userId,
    name: identity.displayName,
  });
  const writes = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };

  server.get<Hall>('/v1/halls/:hallId/rmdb', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    return service.rmdbList(identity.communityId, identity.userId);
  });

  // Filmler and Diziler open with what the hall left unfinished.
  server.get<Hall>('/v1/halls/:hallId/continue', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const { kind } = rmdbInput(
      z.object({ kind: z.enum(['movie', 'series']) }).strict(),
      request.query,
    );
    return service.rmdbContinue(identity.communityId, kind);
  });

  server.get<{ Params: { hallId: string; ref: string } }>(
    '/v1/halls/:hallId/links/:ref',
    async (request) => {
      const identity = await viewer(request, request.params.hallId);
      return service.titleLinks(identity.communityId, rmdbInput(ref, request.params.ref));
    },
  );

  // Each member's own favourite channels.
  server.get<Hall>('/v1/halls/:hallId/favorites', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    return service.favorites(identity.communityId, identity.userId);
  });
  server.put<Hall>('/v1/halls/:hallId/favorites', writes, async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const body = rmdbInput(z.object({ ref, on: z.boolean() }).strict(), request.body);
    return service.setFavorite(identity.communityId, identity.userId, body.ref, body.on);
  });

  // Episode marks of a series' details page; any member may change them.
  type Series = { Params: { hallId: string; ref: string } };
  server.get<Series>('/v1/halls/:hallId/episodes/:ref', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    return service.rmdbEpisodes(identity.communityId, rmdbInput(ref, request.params.ref));
  });
  server.put<Series>('/v1/halls/:hallId/episodes/:ref', writes, async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const { watched } = rmdbInput(z.object({ watched: z.boolean() }).strict(), request.body);
    return service.rmdbMarkEpisode(
      identity.communityId,
      rmdbInput(ref, request.params.ref),
      watched,
      person(identity),
    );
  });

  server.post<Hall>('/v1/halls/:hallId/rmdb', writes, async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const body = rmdbInput(
      z.object({ ref, watchlist: z.boolean().optional() }).strict(),
      request.body,
    );
    return service.rmdbAdd(identity.communityId, body.ref, person(identity), !!body.watchlist);
  });

  server.get<Work>('/v1/halls/:hallId/rmdb/:workId', async (request) => {
    const identity = await viewer(request, request.params.hallId);
    return service.rmdbWork(identity.communityId, request.params.workId, identity.userId);
  });

  server.delete<Work>('/v1/halls/:hallId/rmdb/:workId', writes, async (request) => {
    const identity = await viewer(request, request.params.hallId);
    if (!identity.isOwner) throw new CinemaError('CINEMA_OWNER_REQUIRED');
    service.rmdbRemove(identity.communityId, request.params.workId);
    return { removed: true };
  });

  server.put<Work>('/v1/halls/:hallId/rmdb/:workId/review', writes, async (request) => {
    const identity = await viewer(request, request.params.hallId);
    return service.rmdbReview(
      identity.communityId,
      request.params.workId,
      person(identity),
      rmdbInput(review, request.body),
    );
  });

  server.delete<Work>('/v1/halls/:hallId/rmdb/:workId/review', writes, async (request) => {
    const identity = await viewer(request, request.params.hallId);
    return service.rmdbReview(identity.communityId, request.params.workId, person(identity), null);
  });

  /** Owner: removes another member's review. */
  server.delete<{ Params: { hallId: string; workId: string; userId: string } }>(
    '/v1/halls/:hallId/rmdb/:workId/reviews/:userId',
    writes,
    async (request) => {
      const identity = await viewer(request, request.params.hallId);
      if (!identity.isOwner) throw new CinemaError('CINEMA_OWNER_REQUIRED');
      return service.rmdbRemoveReview(
        identity.communityId,
        request.params.workId,
        rmdbInput(socialId, request.params.userId),
        identity.userId,
      );
    },
  );

  server.put<Work>('/v1/halls/:hallId/rmdb/:workId/watchlist', writes, async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const { on } = rmdbInput(z.object({ on: z.boolean() }).strict(), request.body);
    return service.rmdbWatchlist(identity.communityId, request.params.workId, person(identity), on);
  });

  server.post<Work>('/v1/halls/:hallId/rmdb/:workId/diary', writes, async (request) => {
    const identity = await viewer(request, request.params.hallId);
    const { watchedAt } = rmdbInput(
      z.object({ watchedAt: z.number().int().optional() }).strict(),
      request.body,
    );
    return service.rmdbLog(
      identity.communityId,
      request.params.workId,
      person(identity),
      watchedAt,
    );
  });

  server.delete<{ Params: { hallId: string; workId: string; entryId: string } }>(
    '/v1/halls/:hallId/rmdb/:workId/diary/:entryId',
    writes,
    async (request) => {
      const identity = await viewer(request, request.params.hallId);
      return service.rmdbRemoveLog(
        identity.communityId,
        request.params.workId,
        request.params.entryId,
        person(identity),
        identity.isOwner,
      );
    },
  );

  options.registerRelay?.(server);
  return server;
}
