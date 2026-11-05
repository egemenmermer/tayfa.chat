import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { AgentRepository } from '../apps/services/agent/repository';
import { createAgentServer, type AgentPrincipal } from '../apps/services/agent/server';
import {
  agentAuthoritySnapshotSchema,
  agentAuditSnapshotSchema,
} from '../packages/agent-contracts/src/index';
async function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'rooms-agent-authority-')),
    repository = new AgentRepository(directory, randomBytes(32));
  const grants: Record<string, AgentPrincipal> = {
    manager: { userId: 'manager', roomIds: ['room'], canManage: true },
    member: { userId: 'member', roomIds: ['room'], canManage: false },
    peer: { userId: 'peer', roomIds: ['room'], canManage: false },
    outsider: { userId: 'outsider', roomIds: ['other'], canManage: true },
  };
  const modelId = randomUUID();
  repository.data.models.push({
    id: modelId,
    ownerId: 'member',
    provider: 'openrouter',
    label: 'Private model label',
    model: 'private-model',
    status: 'connected',
    secret: 'do-not-expose-token',
  });
  let policyWait: Promise<void> | undefined;
  let policyEntered: (() => void) | undefined;
  const app = await createAgentServer({
    repository,
    authorize: async (token) => {
      if (!grants[token]) throw Object.assign(new Error('AUTH_DENIED'), { statusCode: 403 });
      return structuredClone(grants[token]);
    },
    reauthorize: async (user) => grants[user],
    executor: async () => ({ result: 'Local fixture executor', artifacts: [] }),
    authority: async () => {
      policyEntered?.();
      if (policyWait) await policyWait;
      return {
        principals: Object.values(grants),
        scopes: [
          {
            kind: 'github',
            read: true,
            write: true,
            resources: ['team/repo', '/private/path', 'https://user:secret@host/repo?token=secret'],
          },
          { kind: 'workspace', read: true, write: true, resources: ['/private/host/workspace'] },
        ],
        discord: {
          configured: true,
          mappings: [
            { userId: 'member', roomId: 'room', channelId: '12345', modelConnectionId: modelId },
            {
              userId: 'outsider',
              roomId: 'other',
              channelId: '67890',
              modelConnectionId: randomUUID(),
            },
          ],
        },
      };
    },
  });
  await app.server.listen({ host: '127.0.0.1', port: 0 });
  const request = (path: string, token = 'manager', method = 'GET', body?: unknown) =>
    fetch(app.server.listeningOrigin + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    repository,
    grants,
    request,
    modelId,
    hold: () => {
      let release!: () => void;
      policyWait = new Promise<void>((resolve) => {
        release = resolve;
      });
      const entered = new Promise<void>((resolve) => {
        policyEntered = resolve;
      });
      return { release, entered };
    },
    close: async () => {
      await app.server.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
it('projects real room grants and safe scope resources without another user personal model metadata', async () => {
  const f = await fixture();
  try {
    const response = await f.request('/v1/authority?roomId=room');
    expect(response.status).toBe(200);
    const value = agentAuthoritySnapshotSchema.parse(await response.json());
    expect(value).toMatchObject({
      canManage: true,
      permissionsMutable: false,
      configurationSource: 'server-admin',
      discord: {
        state: 'configured',
        mentionOnly: true,
        mappings: [{ userId: 'member', personalModel: 'private' }],
      },
    });
    expect(value.principals.map((p) => p.userId)).toEqual(['manager', 'member', 'peer']);
    expect(value.scopes).toEqual([
      { kind: 'github', read: true, write: true, resources: ['team/repo'] },
      { kind: 'workspace', read: true, write: true, resources: [] },
    ]);
    expect(JSON.stringify(value)).not.toMatch(
      /do-not-expose|Private model|private-model|private\/|outsider|67890|https/,
    );
    const self = agentAuthoritySnapshotSchema.parse(
      await (await f.request('/v1/authority?roomId=room', 'member')).json(),
    );
    expect(self.principals).toEqual([{ userId: 'member', canManage: false, canStart: true }]);
    expect(self.scopes.every((scope) => !scope.resources.length)).toBe(true);
    expect(self.discord.mappings[0].personalModel).toBe('selected');
    expect(((await (await f.request('/v1/status', 'member')).json()) as any).canManage).toBe(false);
  } finally {
    await f.close();
  }
});
it('blocks outsiders, room audit by nonmanagers, and mutation of read-only permission projection', async () => {
  const f = await fixture();
  try {
    expect((await f.request('/v1/authority?roomId=room', 'outsider')).status).toBe(403);
    expect((await f.request('/v1/audit?roomId=room', 'member')).status).toBe(403);
    expect(
      (await f.request('/v1/authority?roomId=room', 'manager', 'POST', { canManage: true })).status,
    ).toBe(404);
    expect((await f.request('/v1/yolo', 'member', 'POST', { value: true })).status).toBe(403);
  } finally {
    await f.close();
  }
});
it('filters room and own audit histories, including deleted memory scope, without raw targets or task text', async () => {
  const f = await fixture();
  try {
    const id = randomUUID();
    f.repository.data.tasks.push({
      id,
      roomId: 'room',
      ownerId: 'member',
      prompt: 'Private prompt',
      modelConnectionId: f.modelId,
      state: 'completed',
      progress: [],
      result: 'Private result',
      artifacts: [],
      createdAt: new Date().toISOString(),
      runAt: null,
      error: null,
    });
    f.repository.audit('member', 'task-created', id);
    f.repository.audit('member', 'memory-deleted', 'private-memory-id', 'room');
    f.repository.audit('outsider', 'task-created', 'secret-task', 'other');
    f.repository.audit('member', 'model-connected', f.modelId);
    f.repository.audit('manager', 'yolo-enabled', 'global');
    f.repository.audit('member', 'unknown-private-command', '/private/secret');
    const room = agentAuditSnapshotSchema.parse(
      await (await f.request('/v1/audit?roomId=room')).json(),
    );
    expect(room.entries.map((e) => e.action)).toEqual(['memory-deleted', 'task-created']);
    expect(room.entries.every((e) => e.roomId === 'room')).toBe(true);
    const own = agentAuditSnapshotSchema.parse(
      await (await f.request('/v1/audit', 'member')).json(),
    );
    expect(own.entries.map((e) => e.action)).toEqual([
      'model-connected',
      'memory-deleted',
      'task-created',
    ]);
    expect(JSON.stringify(own)).not.toMatch(/Private|private-memory|secret|global|unknown/);
    f.grants.member.roomIds = [];
    const revoked = agentAuditSnapshotSchema.parse(
      await (await f.request('/v1/audit', 'member')).json(),
    );
    expect(revoked.entries.map((e) => e.action)).toEqual(['model-connected']);
  } finally {
    await f.close();
  }
});
it('reauthorizes after asynchronous policy read and rejects a management downgrade', async () => {
  const f = await fixture();
  try {
    const held = f.hold();
    const pending = f.request('/v1/authority?roomId=room');
    await held.entered;
    f.grants.manager.canManage = false;
    held.release();
    expect((await pending).status).toBe(403);
  } finally {
    await f.close();
  }
});
it('bounds audit projection without exposing hidden history counts', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 105; i++)
      f.repository.data.audit.push({
        at: new Date().toISOString(),
        userId: 'manager',
        action: 'yolo-enabled',
        target: 'global',
      });
    const audit = agentAuditSnapshotSchema.parse(await (await f.request('/v1/audit')).json());
    expect(audit.entries).toHaveLength(100);
    expect(audit.limited).toBe(true);
  } finally {
    await f.close();
  }
});
it('records actual completed execution in sanitized audit while preserving initiating model ownership', async () => {
  const f = await fixture();
  try {
    const created = (await (
      await f.request('/v1/tasks', 'member', 'POST', {
        roomId: 'room',
        prompt: 'Sensitive fixture task text',
        modelConnectionId: f.modelId,
      })
    ).json()) as any;
    expect(created.ownerId).toBe('member');
    expect((await f.request(`/v1/tasks/${created.id}/approve`, 'manager', 'POST', {})).status).toBe(
      200,
    );
    for (let i = 0; i < 20 && f.repository.data.tasks[0].state !== 'completed'; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    const audit = agentAuditSnapshotSchema.parse(
      await (await f.request('/v1/audit', 'member')).json(),
    );
    expect(
      audit.entries.some((e) => e.action === 'task-completed' && e.taskId === created.id),
    ).toBe(true);
    expect(JSON.stringify(audit)).not.toContain('Sensitive fixture');
    expect(f.repository.data.tasks[0].modelConnectionId).toBe(f.modelId);
  } finally {
    await f.close();
  }
});

it('lets only the owner or a manager approve, cancel or reconcile a task', async () => {
  const f = await fixture();
  try {
    const created = (await (
      await f.request('/v1/tasks', 'member', 'POST', {
        roomId: 'room',
        prompt: 'Owner task',
        modelConnectionId: f.modelId,
      })
    ).json()) as any;
    for (const action of ['approve', 'cancel', 'resolve-operation']) {
      const response = await f.request(`/v1/tasks/${created.id}/${action}`, 'peer', 'POST', {
        operationId: 'a'.repeat(64),
        resolution: 'confirm-not-applied',
      });
      expect(response.status).toBe(403);
      expect(((await response.json()) as any).error).toBe('TASK_ACTION_DENIED');
    }
    expect((await f.request(`/v1/tasks/${created.id}/cancel`, 'member', 'POST', {})).status).toBe(
      200,
    );
  } finally {
    await f.close();
  }
});
