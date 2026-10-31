import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActivityCommand, ActivityResponse } from '../packages/activity-protocol/src/index';
import { applyCommand, emptyRoom } from '../apps/services/activities/engine';
import { ConfigStore } from '../apps/services/cinema/config-store';
import { Importer } from '../apps/services/cinema/importer';
import { SecureFiles } from '../apps/services/cinema/secure-file';
import { createCinemaServer } from '../apps/services/cinema/server';
import { CatalogStore, CinemaService, type RelayPort } from '../apps/services/cinema/service';
import type { CinemaAuthority } from '../apps/services/cinema/authority';
import {
  CINEMETA,
  STREMIO_API,
  STREMIO_LINK_API,
  StremioBlockedError,
  streamFacts,
  supports,
  type StremioFetch,
} from '../apps/services/cinema/stremio';

const COMMUNITY = 'community1';
const HALL = 'hallchannel';
const AUTH_KEY = 'secret-stremio-auth-key';
const DEBRID = 'https://addon.example/resolve/realdebrid/SECRETDEBRIDKEY/abc/1/film.mkv';
const users: Record<string, { userId: string; isOwner: boolean }> = {
  'owner-token': { userId: 'owner', isOwner: true },
  'member-token': { userId: 'member', isOwner: false },
};

const authority: CinemaAuthority = {
  async community(token) {
    const user = users[token] ?? fail();
    return { userId: user.userId, displayName: user.userId, isOwner: user.isOwner };
  },
  async channel(token, channelId) {
    const user = users[token] ?? fail();
    if (channelId !== HALL) fail();
    return {
      userId: user.userId,
      displayName: user.userId,
      communityId: COMMUNITY,
      isOwner: user.isOwner,
    };
  },
  async close() {},
};
function fail(): never {
  throw new Error('denied');
}

const torrentio = {
  transportUrl: 'https://addon.example/SECRETDEBRIDKEY/manifest.json',
  manifest: {
    id: 'com.stremio.torrentio.addon',
    name: 'Torrentio',
    resources: [{ name: 'stream', types: ['movie', 'series'], idPrefixes: ['tt'] }],
    types: ['movie', 'series'],
  },
};
const subtitlesAddon = {
  transportUrl: 'https://subs.example/manifest.json',
  manifest: {
    id: 'org.subs',
    name: 'Subs',
    resources: ['subtitles'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
  },
};

const animeAddon = {
  transportUrl: 'https://anime.example/manifest.json',
  manifest: {
    id: 'org.anime',
    name: 'Anime',
    resources: ['catalog', 'meta'],
    types: ['series'],
    idPrefixes: ['kitsu:'],
    catalogs: [
      {
        type: 'series',
        id: 'top',
        name: 'Popular anime',
        extra: [{ name: 'genre', options: ['Action', 'Romance'] }, { name: 'skip' }],
      },
      // Needs a search text: never a home row.
      { type: 'series', id: 'search', extra: [{ name: 'search', isRequired: true }] },
      { type: 'channel', id: 'tv' },
    ],
  },
};

/** A Cinemeta-shaped meta; the URLs stay on the server, clients get opaque art ids. */
const meta = (id: string, name: string) => ({
  id,
  name,
  releaseInfo: '2021',
  poster: `https://images.example/${id}.jpg`,
  background: `https://images.example/${id}-bg.jpg`,
  logo: `https://images.example/${id}-logo.png`,
  description: `${name} plot.`,
  imdbRating: '8.0',
  genres: ['Sci-Fi', 'Drama'],
});

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'rooms-stremio-'));
  const files = new SecureFiles(randomBytes(32));
  const configs = new ConfigStore(dir, files);
  const room = emptyRoom(HALL, Date.now());
  const send = (userId: string, command: ActivityCommand) =>
    applyCommand(
      room,
      { userId, displayName: userId, canCreate: true, canControl: true },
      {
        protocolVersion: 1,
        commandId: randomUUID(),
        expectedRevision: room.snapshot.revision,
        command,
      },
      Date.now(),
    );
  const calls: { url: string; body?: unknown }[] = [];
  const state = { approved: false, sessionValid: true, blocked: false, addonsBroken: false };
  const fetch: StremioFetch = async (url, init) => {
    calls.push({ url, body: init?.body });
    if (url === `${STREMIO_LINK_API}create?type=Create`)
      return {
        result: { success: true, code: 'AB12', link: 'https://link.stremio.com/AB12', qrcode: '' },
      };
    if (url.startsWith(`${STREMIO_LINK_API}read`))
      return state.approved
        ? { result: { authKey: AUTH_KEY } }
        : { error: { code: 101, message: 'Invalid or expired token' } };
    if (url.startsWith(STREMIO_API)) {
      if (!state.sessionValid) return { error: { code: 1, message: 'Session does not exist' } };
      const method = url.slice(STREMIO_API.length);
      if (method === 'getUser') return { result: { email: 'owner@example.com' } };
      if (method === 'addonCollectionGet') {
        if (state.addonsBroken) return { error: { code: 9, message: 'Internal error' } };
        return {
          result: {
            addons: [torrentio, subtitlesAddon, animeAddon, { transportUrl: 'not a url' }],
          },
        };
      }
      if (method === 'datastoreGet')
        return {
          result: [
            {
              _id: 'tt0903747',
              name: 'Breaking Bad',
              type: 'series',
              poster: 'https://images.example/bb.jpg',
              removed: false,
              temp: false,
              _mtime: '2026-10-20T10:00:00.000Z',
              state: {
                timeOffset: 600_000,
                duration: 2_400_000,
                video_id: 'tt0903747:1:2',
                lastWatched: '2026-10-21T20:00:00.000Z',
              },
            },
            { _id: 'tt1', name: 'Removed', type: 'movie', removed: true, temp: false, state: {} },
          ],
        };
    }
    if (url === `${CINEMETA}/meta/movie/tt1160419.json`)
      return {
        meta: {
          id: 'tt1160419',
          name: 'Dune',
          releaseInfo: '2021',
          poster: 'https://images.example/dune.jpg',
          description: 'Spice.',
          genres: ['Sci-Fi'],
          director: ['Denis Villeneuve'],
        },
      };
    if (url === 'https://addon.example/SECRETDEBRIDKEY/stream/movie/tt1160419.json') {
      if (state.blocked) throw new StremioBlockedError('blocked');
      return {
        streams: [
          { name: '[RD+] Torrentio\n4k', title: 'Dune.2021.2160p.mkv\n💾 40.1 GB', url: DEBRID },
          { name: 'Torrentio\n1080p', title: 'Dune.1080p', infoHash: 'abcdef' },
          { name: 'Bad', url: 'magnet:?xt=urn:btih:abc' },
        ],
      };
    }
    if (url === `${CINEMETA}/manifest.json`)
      return {
        catalogs: [
          { type: 'movie', id: 'top', extra: [{ name: 'genre', options: ['Action', 'Comedy'] }] },
          { type: 'series', id: 'top', extra: [{ name: 'genre', options: ['Drama'] }] },
        ],
      };
    if (url.startsWith(`${CINEMETA}/catalog/`)) {
      const [, type, path] = /catalog\/(movie|series)\/(.+)\.json$/.exec(url)!;
      const prefix = type === 'movie' ? 'tt1' : 'tt2';
      return {
        metas: [
          meta(`${prefix}000001`, `${type} ${path} one`),
          meta(`${prefix}000002`, `${type} ${path} two`),
          { id: 'bad id with spaces', name: 'Dropped' },
        ],
      };
    }
    if (url.startsWith('https://anime.example/catalog/series/top'))
      return {
        metas: [{ id: 'kitsu:1', name: 'Cowboy Bebop', poster: 'https://images.example/cb.jpg' }],
      };
    if (url === 'https://subs.example/subtitles/movie/tt1160419.json')
      return {
        subtitles: [
          { id: '1', url: 'https://subs.example/1.srt', lang: 'tur' },
          { id: '2', url: 'https://subs.example/2.srt', lang: 'fre' },
        ],
      };
    throw new Error(`unexpected ${url}`);
  };
  const acquired: Parameters<RelayPort['acquire']>[0][] = [];
  const stopped: string[] = [];
  const running: Awaited<ReturnType<RelayPort['acquire']>>[] = [];
  const relays: RelayPort = {
    async acquire(input) {
      acquired.push(input);
      const info = {
        session: `s${acquired.length}`,
        live: false,
        offsetSec: input.startSec ?? 0,
        epoch: acquired.length,
        durationSec: 9000,
        producedSec: 30,
        windowStartSec: 0,
      };
      running.splice(0, running.length, info);
      return info;
    },
    sessionsOf: () => [...running],
    async stop(session) {
      stopped.push(session);
      running.splice(0, running.length);
    },
    async stopCommunity() {},
  };
  const service = new CinemaService({
    configs,
    catalogs: new CatalogStore(dir, files),
    importer: new Importer({ userAgent: 'test', allowPrivateNetwork: true }),
    relays,
    tickets: (claims) => ({ ticket: `ticket-${claims.session}`, expiresAt: Date.now() + 60_000 }),
    activity: async (): Promise<ActivityResponse> => ({
      protocolVersion: 1,
      serverTimeMs: Date.now(),
      room: room.snapshot,
      events: [],
      replayRequired: false,
    }),
    image: async () => ({ body: Buffer.from('png'), type: 'image/png' }),
    stremio: fetch,
    maxRelays: 1,
  });
  const server = await createCinemaServer({ service, configs, authority });
  const call = async (
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    url: string,
    token: string,
    payload?: unknown,
  ) => {
    const response = await server.inject({
      method,
      url,
      headers: { authorization: `Bearer ${token}` },
      payload: payload as object,
    });
    return { status: response.statusCode, body: response.json(), raw: response.body };
  };
  await call('PUT', `/v1/communities/${COMMUNITY}/hall`, 'owner-token', { channelId: HALL });
  const link = async () => {
    await call('POST', `/v1/communities/${COMMUNITY}/stremio/link`, 'owner-token', {});
    state.approved = true;
    return call('POST', `/v1/communities/${COMMUNITY}/stremio/poll`, 'owner-token', {});
  };
  return { dir, server, call, link, send, state, calls, acquired, stopped, service };
}

describe('Stremio in the community cinema', () => {
  let s: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => {
    s = await setup();
  });
  afterEach(async () => {
    await s.server.close();
    rmSync(s.dir, { recursive: true, force: true });
  });

  it('links with a Stremio code and keeps the session to the owner and the service', async () => {
    const member = await s.call(
      'POST',
      `/v1/communities/${COMMUNITY}/stremio/link`,
      'member-token',
      {},
    );
    expect(member.body).toEqual({ error: 'CINEMA_OWNER_REQUIRED' });
    const code = await s.call(
      'POST',
      `/v1/communities/${COMMUNITY}/stremio/link`,
      'owner-token',
      {},
    );
    expect(code.body).toEqual({ code: 'AB12', link: 'https://link.stremio.com/AB12' });
    const waiting = await s.call(
      'POST',
      `/v1/communities/${COMMUNITY}/stremio/poll`,
      'owner-token',
      {},
    );
    expect(waiting.body.stremio).toEqual({ linked: false, email: null, linkedAt: null });
    s.state.approved = true;
    const linked = await s.call(
      'POST',
      `/v1/communities/${COMMUNITY}/stremio/poll`,
      'owner-token',
      {},
    );
    expect(linked.body.stremio).toMatchObject({ linked: true, email: 'owner@example.com' });
    const seen = await s.call('GET', `/v1/communities/${COMMUNITY}`, 'member-token');
    expect(seen.body.stremio).toMatchObject({ linked: true, email: null });
    expect(seen.raw).not.toContain(AUTH_KEY);
    // The auth key is stored encrypted.
    const stored = readdirSync(join(s.dir, 'communities')).map((name) =>
      readFileSync(join(s.dir, 'communities', name), 'latin1'),
    );
    expect(stored.join('')).not.toContain(AUTH_KEY);
  });

  it('lists continue watching from the account library', async () => {
    expect((await s.call('GET', `/v1/halls/${HALL}/stremio/home`, 'member-token')).body).toEqual({
      error: 'CINEMA_STREMIO_NOT_LINKED',
    });
    await s.link();
    const theirs = await s.call('GET', `/v1/halls/${HALL}/stremio/home`, 'member-token');
    expect(theirs.body).toMatchObject({ continue: [], library: [] });
    s.calls.length = 0;
    const home = await s.call('GET', `/v1/halls/${HALL}/stremio/home`, 'owner-token');
    expect(home.body.continue).toEqual([
      expect.objectContaining({
        id: 'tt0903747',
        name: 'Breaking Bad',
        videoId: 'tt0903747:1:2',
        season: 1,
        episode: 2,
        progress: 0.25,
      }),
    ]);
    expect(home.body.library.map((title: { id: string }) => title.id)).toEqual(['tt0903747']);
    expect(home.raw).not.toContain('images.example');
    const library = s.calls.find((call) => call.url.endsWith('datastoreGet'));
    expect(library?.body).toEqual({
      authKey: AUTH_KEY,
      collection: 'libraryItem',
      ids: [],
      all: true,
    });
  });

  it('builds the home from Cinemeta’s catalogs and the account’s add-on catalogs', async () => {
    await s.link();
    s.calls.length = 0;
    const home = await s.call('GET', `/v1/halls/${HALL}/stremio/home`, 'member-token');
    expect(home.status).toBe(200);
    const year = new Date().getUTCFullYear();
    expect(home.body.rows.map((row: { key: string }) => row.key)).toEqual([
      'cinemeta:movie:top',
      'cinemeta:series:top',
      'cinemeta:movie:year',
      'cinemeta:series:year',
      'cinemeta:movie:imdbRating',
      'cinemeta:series:imdbRating',
      `addon:${Buffer.from('org.anime').toString('base64url')}:series:${Buffer.from('top').toString('base64url')}`,
    ]);
    const [movies, , newMovies] = home.body.rows;
    expect(movies).toMatchObject({
      type: 'movie',
      addon: null,
      genres: ['Action', 'Comedy'],
      paged: true,
    });
    expect(movies.items).toEqual([
      expect.objectContaining({ id: 'tt1000001', rating: '8.0', art: expect.any(String) }),
      expect.objectContaining({ id: 'tt1000002' }),
    ]);
    // "New" is Cinemeta's year catalog: no genre chips, this year asked.
    expect(newMovies.genres).toEqual([]);
    expect(s.calls.map((call) => call.url)).toContain(
      `${CINEMETA}/catalog/movie/year/genre=${year}.json`,
    );
    expect(home.body.rows[6]).toMatchObject({
      name: 'Popular anime',
      addon: 'Anime',
      genres: ['Action', 'Romance'],
      paged: true,
      items: [expect.objectContaining({ id: 'kitsu:1', name: 'Cowboy Bebop' })],
    });
    // Older desktops still read `popular`.
    expect(home.body.popular.movie.map((title: { id: string }) => title.id)).toEqual([
      'tt1000001',
      'tt1000002',
    ]);
    // Films and series take turns in the hero; every one has a backdrop.
    expect(home.body.featured.map((title: { id: string }) => title.id)).toEqual([
      'tt1000001',
      'tt2000001',
      'tt1000002',
      'tt2000002',
    ]);
    expect(home.body.featured[0]).toMatchObject({
      backdrop: expect.any(String),
      logo: expect.any(String),
      plot: 'movie top one plot.',
      genres: ['Sci-Fi', 'Drama'],
    });
    expect(home.raw).not.toContain('images.example');
    expect(home.raw).not.toContain('anime.example');
  });

  it('pages a row’s catalog by genre for Cinemeta and installed add-ons only', async () => {
    await s.link();
    s.calls.length = 0;
    const page = await s.call(
      'GET',
      `/v1/halls/${HALL}/stremio/catalog?key=cinemeta:movie:top&genre=Action&skip=50`,
      'member-token',
    );
    expect(page.body).toMatchObject({
      more: true,
      items: [{ id: 'tt1000001' }, { id: 'tt1000002' }],
    });
    expect(s.calls.map((call) => call.url)).toEqual([
      `${CINEMETA}/catalog/movie/top/genre=Action&skip=50.json`,
    ]);
    const anime = `addon:${Buffer.from('org.anime').toString('base64url')}:series:${Buffer.from('top').toString('base64url')}`;
    const own = await s.call(
      'GET',
      `/v1/halls/${HALL}/stremio/catalog?key=${anime}&genre=Romance&skip=20`,
      'member-token',
    );
    expect(own.body.items).toEqual([expect.objectContaining({ id: 'kitsu:1' })]);
    expect(s.calls.at(-1)?.url).toBe(
      'https://anime.example/catalog/series/top/genre=Romance&skip=20.json',
    );
    // A genre the add-on does not list, a catalog it does not have, an add-on not installed.
    const refused = [
      `key=${anime}&genre=Horror`,
      `key=addon:${Buffer.from('org.anime').toString('base64url')}:series:${Buffer.from('search').toString('base64url')}`,
      `key=addon:${Buffer.from('evil.addon').toString('base64url')}:movie:${Buffer.from('top').toString('base64url')}`,
    ];
    for (const query of refused) {
      const response = await s.call(
        'GET',
        `/v1/halls/${HALL}/stremio/catalog?${query}`,
        'member-token',
      );
      expect(response.body).toEqual({ error: 'CINEMA_ITEM_NOT_FOUND' });
    }
    for (const query of [
      'key=cinemeta:movie:other',
      'key=https://evil.example/x',
      'key=cinemeta:movie:top&skip=-1',
    ])
      expect(
        (await s.call('GET', `/v1/halls/${HALL}/stremio/catalog?${query}`, 'member-token')).status,
      ).toBe(400);
    expect(s.calls.some((call) => call.url.includes('evil'))).toBe(false);
  });

  it('opens a film’s details from Cinemeta when the add-on list cannot be read', async () => {
    await s.link();
    s.state.addonsBroken = true;
    const details = await s.call(
      'GET',
      `/v1/halls/${HALL}/stremio/details?type=movie&id=tt1160419`,
      'member-token',
    );
    expect(details.body).toMatchObject({ id: 'tt1160419', name: 'Dune', plot: 'Spice.' });
    // The home still shows Cinemeta's rows.
    const home = await s.call('GET', `/v1/halls/${HALL}/stremio/home`, 'member-token');
    expect(home.body.rows.length).toBe(6);
  });

  it('plays a picked debrid stream without an IPTV account and never exposes its link', async () => {
    await s.link();
    const url = `/v1/halls/${HALL}/stremio/streams?type=movie&id=tt1160419&videoId=tt1160419`;
    expect((await s.call('GET', url, 'member-token')).body).toEqual({
      error: 'CINEMA_OWNER_REQUIRED',
    });
    const streams = await s.call('GET', url, 'owner-token');
    expect(streams.status).toBe(200);
    expect(streams.raw).not.toContain('SECRETDEBRIDKEY');
    expect(streams.body.skippedTorrents).toBe(1);
    // The magnet link is neither a direct link nor a torrent hash: counted as "other".
    expect(streams.body.skippedOther).toBe(1);
    expect(streams.body.streams).toEqual([
      expect.objectContaining({
        addon: 'Torrentio',
        cached: true,
        resolution: '4K',
        size: '40.1 GB',
      }),
    ]);
    expect(
      (
        await s.call('POST', `/v1/halls/${HALL}/stremio/pick`, 'member-token', {
          streamId: streams.body.streams[0].id,
        })
      ).body,
    ).toEqual({ error: 'CINEMA_OWNER_REQUIRED' });
    const picked = await s.call('POST', `/v1/halls/${HALL}/stremio/pick`, 'owner-token', {
      streamId: streams.body.streams[0].id,
    });
    expect(picked.body).toMatchObject({
      title: 'Dune',
      ref: expect.stringMatching(/^x-[A-Za-z0-9_-]{22}$/),
    });
    const again = await s.call('POST', `/v1/halls/${HALL}/stremio/pick`, 'owner-token', {
      streamId: streams.body.streams[0].id,
    });
    expect(again.body.ref).toBe(picked.body.ref);

    s.send('member', { type: 'join' });
    s.send('member', { type: 'start', activity: 'hall', title: 'Sinema' });
    s.send('member', {
      type: 'queue.add',
      itemId: 'a',
      media: { kind: 'community-media', ref: picked.body.ref, title: 'Dune', live: false },
      start: true,
    });
    const watch = await s.call('POST', `/v1/halls/${HALL}/watch`, 'member-token');
    expect(watch.status).toBe(200);
    expect(watch.raw).not.toContain('SECRETDEBRIDKEY');
    expect(s.acquired[0]?.source).toEqual({ url: DEBRID, headers: {}, live: false });

    const details = await s.call(
      'GET',
      `/v1/halls/${HALL}/details/${picked.body.ref}`,
      'member-token',
    );
    expect(details.body).toMatchObject({
      item: { title: 'Dune', year: 2021 },
      director: 'Denis Villeneuve',
    });
    const links = await s.call('GET', `/v1/halls/${HALL}/links/${picked.body.ref}`, 'member-token');
    expect(links.body).toEqual({ kind: 'movie', tmdbId: null, imdbId: 'tt1160419' });
    const subtitles = await s.call(
      'GET',
      `/v1/halls/${HALL}/subtitles/${picked.body.ref}`,
      'member-token',
    );
    expect(subtitles.body).toMatchObject({
      available: true,
      subtitles: [expect.objectContaining({ language: 'tur' })],
    });
    expect(subtitles.raw).not.toContain('subs.example');

    // Unlinking stops the relay and forgets every pick.
    await s.call('DELETE', `/v1/communities/${COMMUNITY}/stremio`, 'owner-token');
    expect(s.stopped).toContain('s1');
    expect((await s.call('POST', `/v1/halls/${HALL}/watch`, 'member-token')).body).toEqual({
      error: 'CINEMA_NOT_CONNECTED',
    });
  });

  it('lets the linker’s desktop ask add-ons that refuse the server', async () => {
    await s.link();
    s.state.blocked = true;
    const url = `/v1/halls/${HALL}/stremio/streams?type=movie&id=tt1160419&videoId=tt1160419`;
    const streams = await s.call('GET', url, 'owner-token');
    expect(streams.body).toMatchObject({ streams: [], blockedAddons: ['Torrentio'], assist: true });
    const targets = await s.call(
      'GET',
      `/v1/halls/${HALL}/stremio/assist?type=movie&videoId=tt1160419`,
      'owner-token',
    );
    expect(targets.body).toEqual([
      {
        addon: 'Torrentio',
        url: 'https://addon.example/SECRETDEBRIDKEY/stream/movie/tt1160419.json',
      },
    ]);
    // The member never gets the add-on's link (it carries the debrid key).
    const member = await s.call(
      'GET',
      `/v1/halls/${HALL}/stremio/assist?type=movie&videoId=tt1160419`,
      'member-token',
    );
    expect(member.raw).not.toContain('SECRETDEBRIDKEY');
    const direct = await s.call('POST', `/v1/halls/${HALL}/stremio/pick-direct`, 'owner-token', {
      url: 'https://cdn.debrid.example/d/ABC/Dune.mkv',
      type: 'movie',
      metaId: 'tt1160419',
      videoId: 'tt1160419',
    });
    expect(direct.body).toMatchObject({ title: 'Dune', ref: expect.stringMatching(/^x-/) });
    expect(s.service.stremio.relaySource(COMMUNITY, direct.body.ref)).toEqual({
      url: 'https://cdn.debrid.example/d/ABC/Dune.mkv',
      headers: {},
      live: false,
    });
    const bad = await s.call('POST', `/v1/halls/${HALL}/stremio/pick-direct`, 'owner-token', {
      url: 'file:///etc/passwd',
      type: 'movie',
      metaId: 'tt1160419',
      videoId: 'tt1160419',
    });
    expect(bad.body).toEqual({ error: 'CINEMA_SOURCE_INVALID' });
  });

  it('asks the owner to link again when Stremio drops the session', async () => {
    await s.link();
    s.state.sessionValid = false;
    const home = await s.call('GET', `/v1/halls/${HALL}/stremio/home`, 'owner-token');
    expect(home.body).toEqual({ error: 'CINEMA_STREMIO_LOGGED_OUT' });
  });

  it('matches add-on resources the way Stremio does', () => {
    const addon = { transportUrl: 'https://a.example/manifest.json', manifest: torrentio.manifest };
    expect(supports(addon, 'stream', 'movie', 'tt1')).toBe(true);
    expect(supports(addon, 'stream', 'movie', 'kitsu:1')).toBe(false);
    expect(supports(addon, 'meta', 'movie', 'tt1')).toBe(false);
    expect(streamFacts('[RD download] Torrentio\n1080p', 'x\n💾 2.1 GB')).toEqual({
      cached: false,
      resolution: '1080p',
      size: '2.1 GB',
    });
  });
});

it('drops picks older than 30 days when a new one is kept', async () => {
  const { StremioCinema } = await import('../apps/services/cinema/stremio');
  let now = Date.UTC(2026, 9, 22);
  let saved: { ref: string; url: string; at: number }[] = [
    { ref: 'x-old', url: 'https://cdn.example/old.mkv', at: now - 31 * 86_400_000 },
    { ref: 'x-recent', url: 'https://cdn.example/recent.mkv', at: now - 86_400_000 },
  ];
  const cinema = new StremioCinema({
    fetch: async () => ({}),
    account: () => ({ authKey: 'k', email: null, linkedBy: 'owner', linkedAt: now }),
    picks: () => saved as never,
    savePicks: (_id, picks) => {
      saved = picks as never;
    },
    saveAccount: () => {},
    now: () => now,
  });
  now += 1000;
  (cinema as unknown as { keep(id: string, pick: unknown): unknown }).keep('community1', {
    url: 'https://cdn.example/new.mkv',
    headers: {},
    title: 'New',
    type: 'movie',
    metaId: 'tt1',
    videoId: 'tt1',
  });
  expect(saved.map((pick) => pick.url)).toEqual([
    'https://cdn.example/new.mkv',
    'https://cdn.example/recent.mkv',
  ]);
});
