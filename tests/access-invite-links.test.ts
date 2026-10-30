import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { inviteLocale, renderInvitePage } from '../apps/services/access/invite-page';
// `<id>-token` signs in as `<id>`; `owner` owns `space`, `member` already belongs to it and
// `stranger` does not. Registration outcomes are steered per test through `stoat.register`;
// `defaultPermissions` is the community's @everyone permission set.
const stoat = vi.hoisted(() => ({
  defaultPermissions: '0',
  register: 'ok' as 'ok' | 'invalid-invite' | 'email-taken' | 'timeout' | 'after-create',
  registered: [] as { accountInviteCode: string; inviteCode: string }[],
  accepted: [] as string[],
  deleted: [] as string[],
  communityName: 'Arkadaşlar <b>&</b>',
}));
vi.mock('@rooms/stoat', async () => {
  const real = await vi.importActual<any>('@rooms/stoat');
  return {
    ...real,
    StoatClient: class {
      constructor(
        _url: string,
        private token?: string,
      ) {}
      async getCurrentUser() {
        if (!this.token) throw new real.StoatError(401, 'AUTH_REQUIRED');
        return { id: this.token.replace(/-token$/, ''), displayName: 'Person' };
      }
      async getChannel() {
        return { _id: 'room', channel_type: 'TextChannel', server: 'space' };
      }
      async getServer(spaceId: string) {
        if (spaceId !== 'space') throw new real.StoatError(404, 'NotFound');
        return {
          _id: 'space',
          owner: 'owner',
          default_permissions: stoat.defaultPermissions,
          roles: {},
        };
      }
      async getMember(server: string, user: string) {
        if (user === 'stranger' || user === 'banned') throw new real.StoatError(404, 'NotFound');
        return { _id: { server, user }, roles: [] };
      }
      async createUpstreamInvite() {
        return { code: 'upstream-code', space: null, channel: null, expiresAt: null };
      }
      async inspectUpstreamInvite(code: string) {
        return {
          code,
          space: { id: 'space', name: stoat.communityName },
          channel: null,
          expiresAt: null,
        };
      }
      async acceptInvite(code: string) {
        if (this.token === 'banned-token') throw new real.StoatError(403, 'Banned');
        stoat.accepted.push(code);
        return { code, space: { id: 'space', name: 'x' }, channel: null, expiresAt: null };
      }
      async deleteUpstreamInvite(code: string) {
        stoat.deleted.push(code);
      }
      async registerUpstream(
        input: { accountInviteCode: string; inviteCode: string },
        hooks: { onStage?(stage: string): void } = {},
      ) {
        if (stoat.register === 'invalid-invite') throw new real.StoatError(404, 'NotFound');
        hooks.onStage?.('account-create');
        if (stoat.register === 'email-taken') throw new real.StoatError(409, 'OperationFailed');
        if (stoat.register === 'timeout') throw new real.StoatError(503, 'NETWORK_UNAVAILABLE');
        hooks.onStage?.('account-created');
        if (stoat.register === 'after-create') throw new real.StoatError(409, 'UsernameTaken');
        stoat.registered.push(input);
      }
      getToken() {
        return 'new-session';
      }
    },
  };
});
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { INVITE_LINKS_PER_SPACE } from '@rooms/social';
import { createAccessServer } from '../apps/services/access/server';

let directory: string;
let seeded: string[];
beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'rooms-invite-links-'));
  seeded = [];
  Object.assign(stoat, {
    defaultPermissions: '0',
    register: 'ok',
    registered: [],
    accepted: [],
    deleted: [],
  });
});
afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});
async function access(extra: Record<string, unknown> = {}) {
  return createAccessServer({
    stoatUrl: 'http://127.0.0.1:1',
    livekitUrl: 'http://127.0.0.1:1',
    publicLivekitUrl: 'ws://127.0.0.1:1',
    apiKey: 'test',
    apiSecret: 'test-secret-key-at-least-32-characters',
    registrationInvitesFile: join(directory, 'invites.json'),
    accountInviteSink: { insert: async (code: string) => void seeded.push(code) },
    publicUrl: 'https://friends.example',
    ...extra,
  });
}
const bearer = (user: string) => ({ authorization: `Bearer ${user}-token` });
async function createLink(server: Awaited<ReturnType<typeof access>>) {
  const response = await server.inject({
    method: 'POST',
    url: '/v1/invites',
    headers: bearer('owner'),
    payload: { channelId: 'room' },
  });
  expect(response.statusCode).toBe(200);
  return response.json() as { code: string; maxUses: number; uses: number };
}
const register = (server: Awaited<ReturnType<typeof access>>, code: string, n = 1) =>
  server.inject({
    method: 'POST',
    url: '/v1/auth/register',
    payload: {
      email: `friend${n}@example.com`,
      password: 'correct horse battery',
      username: `friend${n}`,
      inviteCode: code,
    },
  });
const listLinks = async (server: Awaited<ReturnType<typeof access>>) =>
  (await server.inject({ url: '/v1/spaces/space/invites', headers: bearer('owner') })).json()
    .invites as { id: string; uses: number; maxUses: number }[];

describe('invitation links in the access service', () => {
  it('lets anyone with the invite permission create a 10-person, 7-day link', async () => {
    const server = await access();
    const create = (user: string) =>
      server.inject({
        method: 'POST',
        url: '/v1/invites',
        headers: bearer(user),
        payload: { channelId: 'room' },
      });
    try {
      const link = await createLink(server);
      expect(link.code).toMatch(/^[a-f0-9]{64}$/);
      expect(link).toMatchObject({ maxUses: 10, uses: 0 });
      // Without Stoat's InviteOthers permission a member gets a clear refusal.
      const denied = await create('member');
      expect(denied.statusCode).toBe(403);
      expect(denied.json().error).toBe('INVITE_PERMISSION_REQUIRED');
      // The community grants invites to everyone (Stoat's default): any member may create one.
      stoat.defaultPermissions = String((1n << 25n) | (1n << 20n));
      const byMember = await create('member');
      expect(byMember.statusCode).toBe(200);
      expect(byMember.json()).toMatchObject({ maxUses: 10, uses: 0 });
      expect((await create('stranger')).statusCode).not.toBe(200);
      const links = await listLinks(server);
      expect(links.map((item) => (item as { createdBy?: string }).createdBy).sort()).toEqual([
        'member',
        'owner',
      ]);
      expect(seeded).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('serves a read-only landing page with a strict policy and escaped names', async () => {
    const server = await access();
    try {
      const { code } = await createLink(server);
      const before = await readFile(join(directory, 'invites.json'), 'utf8');
      for (let i = 0; i < 10; i++) {
        expect((await server.inject(`/davet/${code}`)).statusCode).toBe(200);
        expect((await server.inject({ method: 'HEAD', url: `/davet/${code}/` })).statusCode).toBe(
          200,
        );
      }
      expect(await readFile(join(directory, 'invites.json'), 'utf8')).toBe(before);
      const page = await server.inject(`/davet/${code}`);
      expect(page.headers['content-security-policy']).toContain("default-src 'none'");
      expect(page.headers['content-security-policy']).not.toContain('script-src');
      expect(page.headers['cache-control']).toBe('no-store');
      expect(page.headers['referrer-policy']).toBe('no-referrer');
      expect(page.headers['x-robots-tag']).toContain('noindex');
      expect(page.body).toContain('Arkadaşlar &lt;b&gt;&amp;&lt;/b&gt; topluluğuna davet edildin');
      expect(page.body).toContain(
        `rooms://invite?server=https%3A%2F%2Ffriends.example&amp;code=${code}`,
      );
      expect(page.body).not.toContain('<script');
    } finally {
      await server.close();
    }
  });

  it('falls back to the Host header and shows a 404 page for unusable links', async () => {
    const server = await access({ publicUrl: undefined });
    try {
      const { code } = await createLink(server);
      const page = await server.inject({ url: `/davet/${code}`, headers: { host: 'rooms.test' } });
      expect(page.body).toContain('server=https%3A%2F%2Frooms.test');
      for (const url of ['/davet/not-a-token', `/davet/${'0'.repeat(64)}`]) {
        const missing = await server.inject(url);
        expect(missing.statusCode).toBe(404);
        expect(missing.body).toContain('artık geçerli değil');
      }
    } finally {
      await server.close();
    }
  });

  it('seeds one account invitation per signup and accepts several people per link', async () => {
    const server = await access();
    try {
      const { code } = await createLink(server);
      for (let n = 1; n <= 3; n++) {
        const response = await register(server, code, n);
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({ token: 'new-session' });
      }
      expect(seeded).toHaveLength(3);
      expect(new Set(seeded).size).toBe(3);
      expect(stoat.registered.map((r) => r.accountInviteCode)).toEqual(seeded);
      expect(stoat.registered.every((r) => r.inviteCode === 'upstream-code')).toBe(true);
      expect((await listLinks(server))[0]).toMatchObject({ uses: 3, maxUses: 10 });
    } finally {
      await server.close();
    }
  });

  it('returns a use only when the account was definitely not created', async () => {
    const server = await access();
    try {
      const { code } = await createLink(server);
      stoat.register = 'invalid-invite';
      expect((await register(server, code, 1)).statusCode).toBe(404);
      stoat.register = 'email-taken';
      const taken = await register(server, code, 2);
      expect(taken.statusCode).toBe(409);
      expect(taken.json().error).toBe('OperationFailed');
      expect((await listLinks(server))[0].uses).toBe(0);
      stoat.register = 'timeout';
      expect((await register(server, code, 3)).statusCode).toBe(503);
      stoat.register = 'after-create';
      expect((await register(server, code, 4)).statusCode).toBe(409);
      expect((await listLinks(server))[0].uses).toBe(2);
    } finally {
      await server.close();
    }
  });

  it('does not spend a use when an existing member opens the link again', async () => {
    const server = await access();
    try {
      const { code } = await createLink(server);
      const join = (user: string) =>
        server.inject({
          method: 'POST',
          url: `/v1/auth/invites/${code}/join`,
          headers: bearer(user),
        });
      expect((await join('member')).statusCode).toBe(200);
      expect(stoat.accepted).toEqual([]);
      expect((await join('stranger')).statusCode).toBe(200);
      expect(stoat.accepted).toEqual(['upstream-code']);
      expect((await listLinks(server))[0].uses).toBe(1);
    } finally {
      await server.close();
    }
  });

  it('returns the use when an existing account is definitely refused', async () => {
    const server = await access();
    try {
      const { code } = await createLink(server);
      const join = await server.inject({
        method: 'POST',
        url: `/v1/auth/invites/${code}/join`,
        headers: bearer('banned'),
      });
      expect(join.statusCode).toBe(403);
      expect((await listLinks(server))[0]).toMatchObject({ uses: 0 });
    } finally {
      await server.close();
    }
  });

  it('lets a member reopen a cancelled link without an error or a use', async () => {
    const server = await access();
    try {
      const { code } = await createLink(server);
      const [link] = await listLinks(server);
      await server.inject({
        method: 'DELETE',
        url: `/v1/spaces/space/invites/${link!.id}`,
        headers: bearer('owner'),
      });
      const join = await server.inject({
        method: 'POST',
        url: `/v1/auth/invites/${code}/join`,
        headers: bearer('member'),
      });
      expect(join.statusCode).toBe(200);
      expect(join.json()).toMatchObject({ code, space: { id: 'space' } });
      expect(stoat.accepted).toEqual([]);
      const stranger = await server.inject({
        method: 'POST',
        url: `/v1/auth/invites/${code}/join`,
        headers: bearer('stranger'),
      });
      expect(stranger.statusCode).toBe(404);
    } finally {
      await server.close();
    }
  });

  it('deletes the upstream invitation when the link limit refuses a new link', async () => {
    const server = await access();
    try {
      for (let i = 0; i < INVITE_LINKS_PER_SPACE; i++) await createLink(server);
      expect(stoat.deleted).toEqual([]);
      const refused = await server.inject({
        method: 'POST',
        url: '/v1/invites',
        headers: bearer('owner'),
        payload: { channelId: 'room' },
      });
      expect(refused.statusCode).toBe(409);
      expect(stoat.deleted).toEqual(['upstream-code']);
    } finally {
      await server.close();
    }
  });

  it('lists and revokes links for the owner only', async () => {
    const server = await access();
    try {
      const { code } = await createLink(server);
      const [link] = await listLinks(server);
      expect((await server.inject('/v1/spaces/space/invites')).statusCode).toBe(401);
      expect(
        (await server.inject({ url: '/v1/spaces/space/invites', headers: bearer('member') }))
          .statusCode,
      ).toBe(403);
      const revoke = (user: string, space = 'space', id = link.id) =>
        server.inject({
          method: 'DELETE',
          url: `/v1/spaces/${space}/invites/${id}`,
          headers: bearer(user),
        });
      expect((await revoke('member')).statusCode).toBe(403);
      expect((await revoke('owner', 'space', 'f'.repeat(16))).statusCode).toBe(404);
      expect((await revoke('owner')).statusCode).toBe(200);
      expect(stoat.deleted).toEqual(['upstream-code']);
      expect((await server.inject(`/v1/auth/invites/${code}`)).statusCode).toBe(404);
      expect((await register(server, code)).statusCode).toBe(404);
      expect(await listLinks(server)).toEqual([]);
    } finally {
      await server.close();
    }
  });

  it('refuses links when account invitations cannot be provisioned', async () => {
    const server = await access({ accountInviteSink: undefined });
    try {
      const response = await server.inject({
        method: 'POST',
        url: '/v1/invites',
        headers: bearer('owner'),
        payload: { channelId: 'room' },
      });
      expect(response.statusCode).toBe(501);
    } finally {
      await server.close();
    }
  });
});

describe('invite landing page language', () => {
  const valid = {
    kind: 'valid',
    communityName: 'Friends <b>',
    expiresAt: '2026-10-20T12:00:00Z',
    appLink: 'rooms://invite?server=https%3A%2F%2Ffriends.example&code=abc',
    downloadUrl: 'https://friends.example/download',
  } as const;

  it('follows the first preferred language and defaults to Turkish', () => {
    expect(inviteLocale(undefined)).toBe('tr');
    expect(inviteLocale('')).toBe('tr');
    expect(inviteLocale('tr-TR,tr;q=0.9,en;q=0.8')).toBe('tr');
    expect(inviteLocale('en-US,en;q=0.9,tr;q=0.8')).toBe('en');
    expect(inviteLocale('de-DE')).toBe('en');
    expect(inviteLocale('en;q=0.5, tr;q=0.9')).toBe('tr');
    expect(inviteLocale('*')).toBe('tr');
  });

  it('renders Turkish without a language preference and English for other languages', () => {
    const turkish = renderInvitePage(valid);
    expect(turkish.html).toContain('<html lang="tr">');
    expect(turkish.html).toContain('Friends &lt;b&gt; topluluğuna davet edildin');
    expect(renderInvitePage(valid, 'tr').html).toBe(turkish.html);

    const english = renderInvitePage(valid, 'en-US,en;q=0.9');
    expect(english.status).toBe(200);
    expect(english.html).toContain('<html lang="en">');
    expect(english.html).toContain('You’ve been invited to join Friends &lt;b&gt;');
    expect(english.html).toContain('Valid until: October 20, 2026');
    expect(english.html).toContain('Download the app');
    expect(english.html).toContain('<b>Sign up</b>');
    expect(english.html).toContain(
      'href="rooms://invite?server=https%3A%2F%2Ffriends.example&amp;code=abc"',
    );
    expect(english.html).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);

    const invalid = renderInvitePage({ kind: 'invalid' }, 'en');
    expect(invalid.status).toBe(404);
    expect(invalid.html).toContain('This invite link is no longer valid');
    expect(invalid.html).not.toMatch(/[çğıöşüÇĞİÖŞÜ]/);
  });
});

describe('invite landing page for existing accounts and new users', () => {
  const valid = {
    kind: 'valid',
    communityName: 'Dostlar',
    expiresAt: '2026-10-20T12:00:00Z',
    appLink: 'rooms://invite?server=https%3A%2F%2Ffriends.example&code=abc',
    downloadUrl: 'https://friends.example/download',
  } as const;
  const openHref = 'href="rooms://invite?server=https%3A%2F%2Ffriends.example&amp;code=abc"';

  it('leads with the primary app link and tells account holders it joins the community', () => {
    for (const [lang, existing, signUp, download] of [
      [
        'tr',
        "Zaten hesabın varsa: <b>Tayfa'da aç</b> → topluluğa katıl.",
        'Henüz hesabın yok mu?',
        'Uygulamayı indir',
      ],
      [
        'en',
        'Already have an account? <b>Open in Tayfa</b> → join the community.',
        'New to Tayfa?',
        'Download the app',
      ],
    ] as const) {
      const html = renderInvitePage(valid, lang).html;
      expect(html).toContain(`<a class="button" ${openHref}>`);
      expect(html).toContain(existing);
      // Account holders never read "Kayıt ol" before the open link and their own instructions.
      const order = [openHref, existing, signUp, download, lang === 'tr' ? 'Kayıt ol' : 'Sign up'];
      const positions = order.map((part) => html.indexOf(part));
      expect(positions.every((index) => index >= 0)).toBe(true);
      expect([...positions].sort((a, b) => a - b)).toEqual(positions);
      // The fallback names the join entry that rc.34 already has, too.
      expect(html).toContain(lang === 'tr' ? '<b>Davetle katıl</b>' : '<b>Join with an invite</b>');
      expect(html.match(/class="button"/g)).toHaveLength(1);
    }
  });

  it('keeps paste instructions for both cases when the app link is unknown', () => {
    const html = renderInvitePage({ ...valid, appLink: null }).html;
    expect(html).not.toContain('rooms://');
    expect(html).toContain('Zaten hesabın varsa: Tayfa');
    expect(html).toContain('<b>Davet bağlantısıyla katıl</b>');
    expect(html).toContain("Tayfa'da <b>Kayıt ol</b> sekmesine bu sayfanın adresini yapıştır.");
    expect(html).not.toContain('yeniden bas');
  });
});
