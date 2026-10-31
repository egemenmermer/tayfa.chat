/** Protocol fixture tests only: these are not upstream Stoat integration evidence. */
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { StoatClient } from '@rooms/stoat';
let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});
async function fixture(
  handler: (
    path: string,
    method: string,
    body: Record<string, unknown>,
    token: string | undefined,
  ) => unknown,
) {
  server = createServer(async (req, res) => {
    let input = '';
    for await (const chunk of req) input += chunk;
    const value = handler(
      req.url!,
      req.method!,
      input ? JSON.parse(input) : {},
      req.headers['x-session-token'] as string | undefined,
    );
    res.setHeader('Content-Type', 'application/json');
    // `{ status, body }` answers with that HTTP status; anything else is a 200 body.
    if (value && typeof value === 'object' && 'status' in value && 'body' in value) {
      res.statusCode = Number(value.status);
      res.end(JSON.stringify(value.body));
      return;
    }
    res.end(JSON.stringify(value));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  return `http://127.0.0.1:${address.port}`;
}
describe('Stoat official REST protocol fixtures', () => {
  it('uses official session path and x-session-token without exposing session fields in user result', async () => {
    const calls: unknown[] = [];
    const url = await fixture((path, method, body, token) => {
      calls.push({ path, method, body, token });
      if (path === '/api/auth/session/login')
        return { result: 'Success', token: 'private-fixture-token', _id: 'private-session' };
      return {
        _id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        username: 'friend',
        display_name: 'Friend',
        avatar: { _id: 'avatar' },
      };
    });
    const client = new StoatClient(url);
    const user = await client.login('friend@example.test', 'fixture-password');
    expect(user).toEqual({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      username: 'friend',
      displayName: 'Friend',
      avatar: 'avatar',
    });
    expect(JSON.stringify(user)).not.toContain('private');
    expect(calls).toEqual([
      {
        path: '/api/auth/session/login',
        method: 'POST',
        body: {
          email: 'friend@example.test',
          password: 'fixture-password',
          friendly_name: 'ROOMS Desktop',
        },
        token: undefined,
      },
      { path: '/api/users/@me', method: 'GET', body: {}, token: 'private-fixture-token' },
    ]);
  });
  it('uses the owned signup gate without accepting client-supplied official account tickets', async () => {
    const calls: unknown[] = [];
    const url = await fixture((path, method, body) => {
      calls.push({ path, method, body });
      if (path === '/rooms-access/v1/auth/register') return { token: 'private-fixture-token' };
      return { _id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', username: 'friend' };
    });
    const client = new StoatClient(url);
    await client.register({
      email: 'a@example.test',
      password: 'fixture',
      username: 'friend',
      inviteCode: 'rooms-invite',
      accountInviteCode: 'must-not-forward',
    });
    expect(calls[0]).toEqual({
      path: '/rooms-access/v1/auth/register',
      method: 'POST',
      body: {
        email: 'a@example.test',
        password: 'fixture',
        username: 'friend',
        inviteCode: 'rooms-invite',
      },
    });
  });
  it('reports an email that already has an account as a definite refusal', async () => {
    const calls: string[] = [];
    server = createServer((req, res) => {
      calls.push(`${req.method} ${req.url}`);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/api/auth/account/create') {
        // Upstream with SMTP off: it finds the account, cannot mail a reset, creates nothing.
        res.statusCode = 500;
        return res.end(JSON.stringify({ type: 'OperationFailed' }));
      }
      res.end(JSON.stringify({ _id: 'invite', type: 'Server', server_id: 'space' }));
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as { port: number };
    const stages: string[] = [];
    await expect(
      new StoatClient(`http://127.0.0.1:${port}`).registerUpstream(
        {
          email: 'taken@example.test',
          password: 'fixture',
          username: 'friend',
          inviteCode: 'community-invite',
          accountInviteCode: 'account-invite',
        },
        { onStage: (stage) => stages.push(stage) },
      ),
    ).rejects.toMatchObject({ status: 409, code: 'OperationFailed' });
    expect(stages).toEqual(['account-create']);
    expect(calls).not.toContain('POST /api/auth/session/login');
  });
  it('reads the own bio through the profile route by user id', async () => {
    const paths: string[] = [];
    const url = await fixture((path) => {
      paths.push(path);
      if (path.endsWith('/users/01ARZ3NDEKTSV4RRFFQ69G5FAV/profile'))
        return { content: 'Film gecesi' };
      if (path.endsWith('/profile')) return { type: 'NotFound' };
      return {
        _id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        username: 'friend',
        status: { text: 'Dizide', presence: 'Idle' },
      };
    });
    const client = new StoatClient(url, 'fixture-token');
    await expect(client.ownProfile()).resolves.toEqual({
      bio: 'Film gecesi',
      statusText: 'Dizide',
      presence: 'idle',
    });
    expect(paths.some((path) => path.includes('@me/profile'))).toBe(false);
  });
  it('does not send social tokens to an unrelated events host discovered in upstream response', async () => {
    const url = await fixture(() => ({ ws: 'wss://unexpected.example/ws' }));
    const client = new StoatClient(url, 'fixture-token');
    await expect(client.connect()).rejects.toMatchObject({ code: 'UNTRUSTED_GATEWAY' });
    await client.disconnect();
  });
  it('creates scoped tickets through the owned broker instead of sending ignored expiry to upstream', async () => {
    const calls: unknown[] = [];
    const url = await fixture((path, method, body, token) => {
      calls.push({ path, method, body, token });
      return {
        code: 'rooms-ticket',
        space: null,
        channel: null,
        expiresAt: '2026-10-09T00:00:00.000Z',
      };
    });
    const client = new StoatClient(url, 'fixture-token');
    const invite = await client.createInvite('01ARZ3NDEKTSV4RRFFQ69G5FAV');
    expect(invite.code).toBe('rooms-ticket');
    expect(calls[0]).toEqual({
      path: '/rooms-access/v1/invites',
      method: 'POST',
      body: { channelId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
      token: undefined,
    });
  });
});

it('uses authoritative relationships, official friend tag and self-profile edits (protocol fixtures)', async () => {
  const calls: unknown[] = [];
  const url = await fixture((path, method, body) => {
    calls.push({ path, method, body });
    if (path === '/api/users/@me' && method === 'GET')
      return { _id: 'self', username: 'self', relations: [{ _id: 'friend', status: 'Friend' }] };
    if (path === '/api/users/friend' && method === 'GET')
      return {
        _id: 'friend',
        username: 'friend',
        discriminator: '1234',
        online: true,
        status: { presence: 'Idle' },
      };
    return { _id: 'self', username: 'self', display_name: 'Updated' };
  });
  const client = new StoatClient(url, 'fixture-token');
  expect(await client.listFriends()).toMatchObject([
    { user: { id: 'friend', discriminator: '1234' }, relationship: 'friend', status: 'idle' },
  ]);
  await client.addFriend('friend#1234');
  await client.removeFriend('friend');
  await client.updateProfile({ displayName: 'Updated', bio: '', statusText: 'Tonight' });
  expect(calls).toContainEqual({
    path: '/api/users/friend',
    method: 'POST',
    body: { username: 'friend#1234' },
  });
  expect(calls).toContainEqual({ path: '/api/users/friend/friend', method: 'DELETE', body: {} });
  expect(calls).toContainEqual({
    path: '/api/users/@me',
    method: 'PATCH',
    body: { display_name: 'Updated', remove: ['ProfileContent'], status: { text: 'Tonight' } },
  });
});
it('maps attachment metadata and reactions without credentials; reaction edits use official endpoint', async () => {
  const raw = {
    _id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    channel: 'channel',
    author: 'friend',
    user: { _id: 'friend', username: 'friend' },
    content: 'Attachment',
    attachments: [{ _id: 'file', filename: 'safe.pdf', size: 10, content_type: 'application/pdf' }],
    reactions: { '1f44d': ['friend'] },
  };
  const calls: string[] = [];
  const url = await fixture((path, method) => {
    calls.push(method + ' ' + path);
    if (method === 'PUT') return {};
    return raw;
  });
  const client = new StoatClient(url, 'fixture-token');
  let update: unknown;
  client.subscribe((e) => {
    if (e.type === 'MESSAGE_UPDATE') update = e.data;
  });
  await client.react('channel', raw._id, '\u{1f44d}');
  expect(update).toMatchObject({
    attachments: [{ id: 'file', name: 'safe.pdf', size: 10, mime: 'application/pdf' }],
    reactions: { '1f44d': ['friend'] },
  });
  expect(JSON.stringify(update)).not.toContain('fixture-token');
  expect(calls[0]).toBe(
    'PUT /api/channels/channel/messages/01ARZ3NDEKTSV4RRFFQ69G5FAV/reactions/%F0%9F%91%8D',
  );
});
it('sends Unicode and custom emoji reactions URL-encoded and rejects anything else', async () => {
  const calls: string[] = [];
  const url = await fixture((path, method) => {
    calls.push(method + ' ' + path);
    return method === 'GET' ? { _id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', channel: 'channel' } : {};
  });
  const client = new StoatClient(url, 'fixture-token');
  const base = 'channels/channel/messages/01ARZ3NDEKTSV4RRFFQ69G5FAV/reactions';
  await client.react('channel', '01ARZ3NDEKTSV4RRFFQ69G5FAV', '\u2764\ufe0f');
  await client.react('channel', '01ARZ3NDEKTSV4RRFFQ69G5FAV', '\u{1f44d}\u{1f3fd}', true);
  await client.react('channel', '01ARZ3NDEKTSV4RRFFQ69G5FAV', '01ARZ3NDEKTSV4RRFFQ69G5FAW');
  expect(calls.filter((call) => !call.startsWith('GET'))).toEqual([
    `PUT /api/${base}/%E2%9D%A4%EF%B8%8F`,
    `DELETE /api/${base}/%F0%9F%91%8D%F0%9F%8F%BD`,
    `PUT /api/${base}/01ARZ3NDEKTSV4RRFFQ69G5FAW`,
  ]);
  calls.length = 0;
  for (const emoji of [
    '2764',
    '1f44d',
    'thumbsup',
    '1',
    '',
    '../x',
    '\u2764/..',
    '\u2764?x=1',
    '\u2764 ',
    '\u{1f44d}'.repeat(17),
  ])
    await expect(
      client.react('channel', '01ARZ3NDEKTSV4RRFFQ69G5FAV', emoji),
    ).rejects.toMatchObject({ code: 'INVALID_EMOJI' });
  expect(calls).toEqual([]);
});
it('rejects foreign file origins before sending upload credentials', async () => {
  const url = await fixture(() => ({
    features: { autumn: { enabled: true, url: 'https://unexpected.example/autumn' } },
  }));
  const client = new StoatClient(url, 'fixture-token');
  await expect(
    client.uploadAttachment(new Uint8Array([1]), 'fixture.txt', 'text/plain'),
  ).rejects.toMatchObject({ code: 'ATTACHMENTS_UNAVAILABLE' });
});
it('uploads multipart bytes only to the configured Autumn origin and returns no native path (protocol fixture)', async () => {
  let base = '';
  const calls: { path: string; token: unknown; type: unknown; body: string }[] = [];
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({
      path: req.url!,
      token: req.headers['x-session-token'],
      type: req.headers['content-type'],
      body,
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify(
        req.url === '/api'
          ? { features: { autumn: { enabled: true, url: base + '/autumn' } } }
          : { id: 'uploaded_fixture' },
      ),
    );
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = new StoatClient(base, 'fixture-private-token');
  const result = await client.uploadAttachment(
    new TextEncoder().encode('actual fixture bytes'),
    'fixture.txt',
    'text/plain',
  );
  expect(result).toEqual({
    id: 'uploaded_fixture',
    name: 'fixture.txt',
    size: 20,
    mime: 'text/plain',
  });
  expect(calls[1].path).toBe('/autumn/attachments');
  expect(calls[1].token).toBe('fixture-private-token');
  expect(calls[1].type).toMatch(/^multipart\/form-data; boundary=/);
  expect(calls[1].body).toContain('actual fixture bytes');
  expect(calls[1].body).toContain('filename="fixture.txt"');
  expect(JSON.stringify(result)).not.toContain('fixture-private-token');
  await expect(
    client.uploadAttachment(new Uint8Array([]), 'empty.txt', 'text/plain'),
  ).rejects.toMatchObject({ code: 'INVALID_ATTACHMENT' });
  expect(calls).toHaveLength(2);
});
it('saves a community profile: uploads the icon, removes an empty description, reads it back', async () => {
  const calls: { method: string; path: string; body: string }[] = [];
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  let server_: Record<string, unknown> = {
    _id: 'space',
    name: 'Eski',
    description: 'x',
    owner: 'me',
  };
  let base = '';
  server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    calls.push({ method: req.method!, path: req.url!, body });
    if (req.url === '/autumn/icons/icon_1') {
      res.setHeader('Content-Type', 'image/png');
      res.end(png);
      return;
    }
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api')
      res.end(JSON.stringify({ features: { autumn: { enabled: true, url: base + '/autumn' } } }));
    else if (req.url === '/autumn/icons') res.end(JSON.stringify({ id: 'icon_1' }));
    else if (req.url === '/api/servers/space' && req.method === 'PATCH') {
      const change = JSON.parse(body);
      server_ = { ...server_, name: change.name, icon: { _id: change.icon } };
      if (change.remove?.includes('Description')) delete server_.description;
      res.end(JSON.stringify(server_));
    } else res.end(JSON.stringify(server_));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = new StoatClient(base, 'fixture-token');
  const saved = await client.updateSpaceProfile('space', {
    name: '  Dostlar ',
    description: '',
    icon: { bytes: png, name: 'ikon.png', mime: 'image/png' },
  });
  const patch = calls.find((c) => c.method === 'PATCH')!;
  expect(JSON.parse(patch.body)).toEqual({
    name: 'Dostlar',
    icon: 'icon_1',
    remove: ['Description'],
  });
  expect(calls.find((c) => c.path === '/autumn/icons')!.method).toBe('POST');
  expect(saved).toMatchObject({ name: 'Dostlar', description: '', banner: null, ownerId: 'me' });
  expect(saved.icon).toBe(`data:image/png;base64,${png.toString('base64')}`);
  await expect(
    client.updateSpaceProfile('space', {
      icon: { bytes: png, name: 'x.svg', mime: 'image/svg+xml' },
    }),
  ).rejects.toMatchObject({ code: 'INVALID_SERVER_IMAGE' });
});
it('refuses an attachment above the limit the server advertises before uploading it', async () => {
  const paths: string[] = [];
  server = createServer((req, res) => {
    paths.push(req.url!);
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        features: {
          autumn: { enabled: true, url: base + '/autumn' },
          limits: { default: { file_upload_size_limits: { attachments: 8 } } },
        },
      }),
    );
  });
  let base = '';
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const client = new StoatClient(base, 'fixture-token');
  expect(await client.attachmentSizeLimit()).toBe(8);
  await expect(
    client.uploadAttachment(new Uint8Array(9), 'clip.mov', 'video/quicktime'),
  ).rejects.toMatchObject({ status: 413, message: 'This file is larger than the server accepts.' });
  expect(paths).toEqual(['/api']);
});
it('sends official bot replies with a stable delivery key and no reply ping (protocol fixture)', async () => {
  let request: Record<string, unknown> | undefined;
  server = createServer(async (req, res) => {
    let text = '';
    for await (const chunk of req) text += chunk;
    request = {
      path: req.url,
      botToken: req.headers['x-bot-token'],
      sessionToken: req.headers['x-session-token'],
      key: req.headers['idempotency-key'],
      body: JSON.parse(text),
    };
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        _id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        channel: 'channel',
        author: 'bot',
        user: { _id: 'bot', username: 'ROOMS', bot: {} },
        content: 'Done',
      }),
    );
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await new StoatClient(base, 'fixture-bot-token', { botToken: true }).sendReply(
    'channel',
    'source-message',
    'Done',
    'delivery-001',
  );
  expect(request).toEqual({
    path: '/api/channels/channel/messages',
    botToken: 'fixture-bot-token',
    sessionToken: undefined,
    key: 'delivery-001',
    // Stoat rejects a body nonce sent alongside Idempotency-Key, so only the header carries it.
    body: {
      content: 'Done',
      replies: [{ id: 'source-message', mention: false }],
    },
  });
});
it('restores only authoritative own read markers and resyncs after acknowledgement without unread counts', async () => {
  const calls: string[] = [];
  let acknowledged = false;
  const url = await fixture((path, method) => {
    calls.push(method + ' ' + path);
    if (path === '/api/users/@me') return { _id: 'self', username: 'self' };
    if (path === '/api/sync/unreads')
      return [
        {
          _id: { channel: 'channel', user: 'self' },
          last_id: acknowledged ? 'latest' : 'previous',
          mentions: acknowledged ? [] : ['mentioned-message'],
        },
        { _id: { channel: 'private-other', user: 'other' }, last_id: 'other-message' },
      ];
    if (path === '/api/channels/channel/ack/latest') {
      acknowledged = true;
      return {};
    }
    return {};
  });
  const client = new StoatClient(url, 'fixture-token');
  expect(await client.readStates()).toEqual([
    {
      channelId: 'channel',
      lastReadMessageId: 'previous',
      mentionMessageIds: ['mentioned-message'],
    },
  ]);
  let synced: unknown;
  client.subscribe((event) => {
    if (event.type === 'READ_STATE_SYNC') synced = event.data;
  });
  await client.ackRead('channel', 'latest');
  expect(synced).toEqual([
    { channelId: 'channel', lastReadMessageId: 'latest', mentionMessageIds: [] },
  ]);
  expect(calls).toContain('PUT /api/channels/channel/ack/latest');
  expect(JSON.stringify(synced)).not.toContain('count');
});
it('does not invent empty read markers when the sync response is unsupported or invalid', async () => {
  const url = await fixture((path) =>
    path === '/api/users/@me' ? { _id: 'self', username: 'self' } : { type: 'NotFound' },
  );
  await expect(new StoatClient(url, 'fixture-token').readStates()).rejects.toMatchObject({
    code: 'INVALID_READ_STATES',
  });
});
it('fetches one authoritative message and rejects a mismatched reminder source scope (protocol fixture)', async () => {
  let mismatch = false;
  const paths: string[] = [];
  const messageId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
  const url = await fixture((path) => {
    paths.push(path);
    return {
      _id: messageId,
      channel: mismatch ? 'another-channel' : 'channel',
      user: { _id: 'friend', username: 'Friend' },
      author: 'friend',
      content: 'Remind me later',
    };
  });
  const client = new StoatClient(url, 'fixture-token', { botToken: true });
  expect(await client.getMessage('channel', messageId)).toMatchObject({
    id: messageId,
    channelId: 'channel',
    content: 'Remind me later',
  });
  expect(paths).toEqual([`/api/channels/channel/messages/${messageId}`]);
  mismatch = true;
  await expect(client.getMessage('channel', messageId)).rejects.toMatchObject({
    code: 'MESSAGE_SCOPE_MISMATCH',
  });
  await expect(client.getMessage('../channel', messageId)).rejects.toMatchObject({
    code: 'INVALID_ID',
  });
  expect(paths).toHaveLength(2);
});

it('queues same-bucket REST calls until authoritative headers replenish (protocol fixture)', async () => {
  const times: number[] = [];
  server = createServer((_req, res) => {
    times.push(Date.now());
    res.setHeader('Content-Type', 'application/json');
    if (times.length === 1) {
      res.setHeader('X-RateLimit-Remaining', '0');
      res.setHeader('X-RateLimit-Reset-After', '60');
    }
    res.end(JSON.stringify({ _id: 'channel', channel_type: 'TextChannel', name: 'QA' }));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const client = new StoatClient(
    `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    'fixture-token',
  );
  await Promise.all([client.getChannel('channel'), client.getChannel('channel')]);
  expect(times).toHaveLength(2);
  expect(times[1] - times[0]).toBeGreaterThanOrEqual(60);
});
it('retries only definite pre-route 429 and does not retry ambiguous mutation failure (protocol fixture)', async () => {
  let count = 0,
    mutations = 0;
  server = createServer(async (req, res) => {
    for await (const _chunk of req) {
    }
    count++;
    res.setHeader('Content-Type', 'application/json');
    if (count === 1) {
      res.statusCode = 429;
      res.setHeader('X-RateLimit-Reset-After', '1');
      res.end(JSON.stringify({ retry_after: 1 }));
      return;
    }
    if (req.method === 'DELETE') {
      mutations++;
      res.statusCode = 503;
      res.end('{}');
      return;
    }
    res.end(JSON.stringify({ _id: 'channel', channel_type: 'TextChannel' }));
  });
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
  const client = new StoatClient(
    `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    'fixture-token',
  );
  await client.getChannel('channel');
  expect(count).toBe(2);
  await expect(client.deleteMessage('channel', 'message')).rejects.toMatchObject({ status: 503 });
  expect(mutations).toBe(1);
});
it('normalizes authorized community members without exposing upstream secrets or inventing presence', async () => {
  const url = await fixture((path) =>
    path === '/api/servers/community/members'
      ? {
          users: [
            {
              _id: 'known',
              username: 'friend',
              online: true,
              status: { presence: 'Idle', text: 'Tea time' },
              private_token: 'must-not-expose',
            },
            { _id: 'unknown', username: 'quiet' },
          ],
          members: [
            {
              _id: { server: 'community', user: 'known' },
              roles: ['moderator'],
              private_notes: 'must-not-expose',
            },
            { _id: { server: 'community', user: 'unknown' }, roles: [] },
            { _id: { server: 'community', user: 'missing' } },
          ],
        }
      : {},
  );
  const client = new StoatClient(url, 'fixture-token');
  const members = await client.listCommunityMembers('community');
  expect(members).toMatchObject([
    {
      user: { id: 'known', username: 'friend' },
      status: 'idle',
      statusText: 'Tea time',
      roles: ['moderator'],
    },
    { user: { id: 'unknown' }, status: 'unknown', roles: [] },
  ]);
  expect(JSON.stringify(members)).not.toContain('must-not-expose');
});
it('rejects malformed member responses rather than displaying invented empty membership', async () => {
  const url = await fixture(() => ({ users: [], members: null }));
  const client = new StoatClient(url, 'fixture-token');
  await expect(client.listCommunityMembers('community')).rejects.toMatchObject({
    code: 'INVALID_MEMBERS_RESPONSE',
  });
});

describe('community mutation boundaries (isolated protocol fixtures)', () => {
  it('uses official create/edit contracts and returns normalized public metadata only', async () => {
    const calls: unknown[] = [];
    const url = await fixture((path, method, body) => {
      calls.push({ path, method, body });
      const value = {
        _id: 'community',
        name: body.name,
        owner: 'owner',
        channels: ['channel'],
        private_token: 'must-not-expose',
      };
      return path === '/api/servers/create'
        ? {
            server: value,
            channels: [{ _id: 'channel', channel_type: 'TextChannel', name: 'general' }],
          }
        : value;
    });
    const client = new StoatClient(url, 'fixture-token');
    const events: unknown[] = [];
    client.subscribe((e) => events.push(e));
    expect(await client.createSpace(' Friends ')).toMatchObject({
      id: 'community',
      name: 'Friends',
      ownerId: 'owner',
    });
    expect(await client.renameSpace('community', 'Evening')).toMatchObject({
      id: 'community',
      name: 'Evening',
    });
    expect(calls).toEqual([
      { path: '/api/servers/create', method: 'POST', body: { name: 'Friends' } },
      { path: '/api/servers/community', method: 'PATCH', body: { name: 'Evening' } },
    ]);
    expect(JSON.stringify(events)).not.toContain('must-not-expose');
  });
  it('rejects malformed returned identity and mismatched edit identity', async () => {
    const url = await fixture((path) =>
      path === '/api/servers/create'
        ? { server: { name: 'Friends' } }
        : { _id: 'other', name: 'Friends' },
    );
    const client = new StoatClient(url, 'fixture-token');
    await expect(client.createSpace('Friends')).rejects.toMatchObject({
      code: 'INVALID_SERVER_RESPONSE',
    });
    await expect(client.renameSpace('community', 'Friends')).rejects.toMatchObject({
      code: 'INVALID_SERVER_RESPONSE',
    });
    await expect(client.createSpace('x'.repeat(33))).rejects.toMatchObject({
      code: 'INVALID_SERVER_NAME',
    });
    await expect(client.renameSpace('community', 'invalid\nname')).rejects.toMatchObject({
      code: 'INVALID_SERVER_NAME',
    });
  });
  it('normalizes the official ServerCreate event into cached server and channels', async () => {
    const client = new StoatClient('http://localhost', 'fixture-token');
    const internal = client as unknown as {
      servers: Map<string, unknown>;
      channels: Map<string, unknown>;
      processPacket(packet: unknown): Promise<void>;
    };
    await internal.processPacket({
      type: 'ServerCreate',
      _id: 'community',
      name: 'Friends',
      owner: 'owner',
      channels: [{ _id: 'channel', channel_type: 'TextChannel', name: 'general' }],
    });
    expect(internal.servers.get('community')).toMatchObject({ _id: 'community', name: 'Friends' });
    expect(internal.channels.get('channel')).toMatchObject({ _id: 'channel' });
    await internal.processPacket({
      type: 'ServerCreate',
      name: 'Invalid',
      channels: [{ name: 'Invalid' }],
    });
    expect(internal.servers.size).toBe(1);
    expect(internal.channels.size).toBe(1);
  });
});

it('keeps a channel’s messages when one author’s account was removed', async () => {
  const url = await fixture((path) => {
    if (path.startsWith('/api/channels/chan/messages'))
      return {
        messages: [
          { _id: '01M53QA4TKPB72RQVTZ9V071K3', channel: 'chan', author: 'gone', content: 'old' },
          { _id: '01M53QA4TKPB72RQVTZ9V071K4', channel: 'chan', author: 'here', content: 'new' },
        ],
        users: [{ _id: 'here', username: 'here' }],
      };
    if (path === '/api/users/gone') return { status: 404, body: { type: 'NotFound' } };
    return {};
  });
  const client = new StoatClient(url, 'fixture-token');
  const messages = await client.listMessages('chan');
  expect(messages.map((message) => [message.author.id, message.content])).toEqual([
    ['here', 'new'],
    ['gone', 'old'],
  ]);
});
