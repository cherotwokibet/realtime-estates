import { staffBranchBoundary } from '../dist/tests/lib/staff-branch-server.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '@realtor/api-client';
import { startStaffPreview } from '../../../apps/api/dev/staff-preview.mjs';
import { staffDirectoryBoundary } from '../dist/tests/lib/staff-directory-server.js';
const mode = {
  port: 0,
  seedAcceptedMedia: false,
  staffInvitationMode: 'synthetic-capture-only-v1',
};
const settings = (p) => ({
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1',
  STAFF_PREVIEW_API_ORIGIN: p.origin,
  STAFF_PREVIEW_TOKEN: p.bearerToken,
  STAFF_PREVIEW_INSTANCE: randomUUID(),
});
const request = (env, kind, query = '?limit=2', headers = {}) =>
  new Request('http://localhost:3120/api/staff-directory/' + kind + query, {
    headers: {
      host: '127.0.0.1:3120',
      'x-preview-instance': env.STAFF_PREVIEW_INSTANCE,
      ...headers,
    },
  });
test('current-instance directory boundary uses SDK over signed HTTP/restricted SQL for real branch and invitation pages', async () => {
  const p = await startStaffPreview({ ...mode, actor: 'admin' });
  try {
    const env = settings(p),
      api = new RealtorApiClient({
        baseUrl: p.origin,
        privacyNoticeVersion: 'synthetic-staff-notice-v1',
        allowLoopbackHttp: true,
      }),
      auth = { bearerToken: p.bearerToken };
    const branch = {
      policy: 'staff-branch-command-v1',
      operationId: randomUUID(),
      branchId: randomUUID(),
      expectedVersion: '0',
      name: 'Synthetic BFF branch',
      active: true,
      reason: 'Synthetic BFF integration.',
    };
    await api.saveStaffBranch(branch, auth);
    const commands = Array.from({ length: 3 }, () => ({
      policy: 'staff-invitation-intent-v1',
      operationId: randomUUID(),
      recipientEmail: 'synthetic@example.invalid',
      requestedRole: 'agent',
      branchId: branch.branchId,
      expiresAfterHours: 24,
    })).sort((a, b) => a.operationId.localeCompare(b.operationId));
    for (const command of commands) await api.recordStaffInvitationRequest(command, auth);
    let r = await staffDirectoryBoundary(request(env, 'branches'), 'branches', env);
    assert.equal(r.status, 200);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const branches = (await r.json()).page;
    assert.equal(branches.items[0].branchId, branch.branchId);
    assert.equal(branches.items[0].name, branch.name);
    assert.equal(Object.hasOwn(branches.items[0], 'reason'), false);
    r = await staffDirectoryBoundary(request(env, 'invitations'), 'invitations', env);
    assert.equal(r.status, 200);
    const first = (await r.json()).page;
    assert.deepEqual(
      first.items.map((x) => x.operationId),
      commands.slice(0, 2).map((x) => x.operationId),
    );
    assert.equal(first.nextAfter, commands[1].operationId);
    r = await staffDirectoryBoundary(
      request(env, 'invitations', '?limit=2&after=' + first.nextAfter),
      'invitations',
      env,
    );
    const last = (await r.json()).page;
    assert.deepEqual(
      last.items.map((x) => x.operationId),
      [commands[2].operationId],
    );
    assert.equal(last.nextAfter, null);
    assert.equal(last.items[0].membershipGranted, false);
    assert.equal(last.items[0].branch.name, branch.name);
    assert.equal(Object.hasOwn(last.items[0], 'actorId'), false);
    let calls = 0;
    const transport = async (...args) => {
      calls++;
      return fetch(...args);
    };
    r = await staffDirectoryBoundary(
      request(env, 'branches', '?limit=2', { 'x-preview-instance': randomUUID() }),
      'branches',
      env,
      transport,
    );
    assert.equal(r.status, 403);
    assert.equal(calls, 0);
    r = await staffDirectoryBoundary(
      request(env, 'branches', '?limit=2', { 'x-tenant-id': randomUUID() }),
      'branches',
      env,
      transport,
    );
    assert.equal(r.status, 403);
    assert.equal(calls, 0);
  } finally {
    await p.close();
  }
});
test('signed upstream agent/foreign authority is refused and BFF error stays sanitized', async () => {
  for (const actor of ['agent', 'other-company-admin']) {
    const p = await startStaffPreview({ ...mode, actor });
    try {
      const env = settings(p);
      for (const kind of ['branches', 'invitations']) {
        const r = await staffDirectoryBoundary(request(env, kind), kind, env);
        assert.equal(r.status, 403);
        assert.deepEqual(await r.json(), { error: 'STAFF_DIRECTORY_UNAVAILABLE' });
      }
    } finally {
      await p.close();
    }
  }
});

test('branch BFF uncertain committed write recovers original with GET over signed HTTP without automatic replay', async () => {
  const p = await startStaffPreview({
    ...mode,
    actor: 'admin',
    branchReplyFault: 'invalid-first-branch-result-v1',
  });
  try {
    const env = settings(p),
      command = {
        policy: 'staff-branch-command-v1',
        operationId: randomUUID(),
        branchId: randomUUID(),
        expectedVersion: '0',
        name: 'Synthetic recovery',
        active: true,
        reason: 'Synthetic BFF recovery.',
      };
    const path =
      'http://localhost:3120/api/staff-directory/branches/operations/' + command.operationId;
    const req = (body) =>
      new Request(path, {
        method: body ? 'POST' : 'GET',
        headers: {
          host: '127.0.0.1:3120',
          'x-preview-instance': env.STAFF_PREVIEW_INSTANCE,
          ...(body ? { origin: 'http://127.0.0.1:3120', 'content-type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    const calls = [],
      transport = async (input, init) => {
        calls.push(init?.method ?? 'GET');
        return fetch(input, init);
      };
    let r = await staffBranchBoundary(
      req(command),
      'operation',
      command.operationId,
      env,
      transport,
    );
    assert.ok(r.status >= 400);
    assert.equal((await r.json()).submissionUncertain, true);
    assert.deepEqual(calls, ['POST']);
    r = await staffBranchBoundary(req(), 'operation', command.operationId, env, transport);
    assert.equal(r.status, 200);
    const original = (await r.json()).receipt;
    assert.equal(original.outcome, 'applied');
    assert.equal(original.version, '1');
    assert.deepEqual(calls, ['POST', 'GET']);
    const currentReq = new Request(
      'http://localhost:3120/api/staff-directory/branches/' + command.branchId,
      { headers: { host: '127.0.0.1:3120', 'x-preview-instance': env.STAFF_PREVIEW_INSTANCE } },
    );
    r = await staffBranchBoundary(currentReq, 'current', command.branchId, env, transport);
    assert.equal(r.status, 200);
    assert.equal((await r.json()).branch.name, command.name);
    assert.deepEqual(calls, ['POST', 'GET', 'GET']);
  } finally {
    await p.close();
  }
});
