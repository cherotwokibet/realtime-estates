import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '@realtor/api-client';
import { startStaffPreview } from '../../../apps/api/dev/staff-preview.mjs';
import { createStaffDirectoryClient } from '../dist/tests/lib/staff-directory-client.js';
import { createStaffWriteController } from '../dist/tests/lib/staff-write-controller.js';
import { loadStaffDirectoryWorkspace } from '../dist/tests/lib/staff-directory-server.js';
import {
  staffMembershipDirectoryBoundary,
  staffMembershipOperationBoundary,
  staffMembershipCurrentBoundary,
} from '../dist/tests/lib/staff-membership-server.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mode = {
  port: 0,
  seedAcceptedMedia: false,
  staffInvitationMode: 'synthetic-capture-only-v1',
  staffMembershipMode: 'synthetic-existing-members-v1',
};
const settings = (preview) => ({
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1',
  STAFF_MEMBERSHIP_PREVIEW_MODE: 'synthetic-existing-members-v1',
  STAFF_PREVIEW_API_ORIGIN: preview.origin,
  STAFF_PREVIEW_TOKEN: preview.bearerToken,
  STAFF_PREVIEW_INSTANCE: randomUUID(),
});
const request = (env, path = '?limit=2', body) =>
  new Request('http://127.0.0.1:3120/api/staff-directory/memberships' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      host: '127.0.0.1:3120',
      'x-preview-instance': env.STAFF_PREVIEW_INSTANCE,
      ...(body === undefined
        ? {}
        : {
            origin: 'http://127.0.0.1:3120',
            'content-type': 'application/json',
          }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
const change = (patch = {}) => ({
  policy: 'staff-membership-command-v1',
  operationId: randomUUID(),
  memberId: id(11),
  expectedVersion: '1',
  requestedRole: 'agent',
  active: false,
  reason: 'Synthetic existing staff access review.',
  ...patch,
});
const api = (preview) =>
  new RealtorApiClient({
    baseUrl: preview.origin,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    allowLoopbackHttp: true,
  });

test('signed staff loader and membership BFF expose bounded current staff only with the separate explicit flag', async () => {
  const preview = await startStaffPreview({ ...mode, actor: 'admin' });
  try {
    const env = settings(preview),
      paths = [];
    const transport = async (input, init) => {
      paths.push(new URL(input).pathname);
      return fetch(input, init);
    };
    const disabled = { ...env };
    delete disabled.STAFF_MEMBERSHIP_PREVIEW_MODE;
    const before = await loadStaffDirectoryWorkspace(disabled, transport);
    assert.equal(before.memberships, null);
    assert.equal(
      paths.some((path) => path.startsWith('/v2/staff/memberships')),
      false,
    );
    paths.length = 0;
    const loaded = await loadStaffDirectoryWorkspace(env, transport);
    assert.deepEqual(loaded.scope, {
      instanceId: env.STAFF_PREVIEW_INSTANCE,
      tenantId: id(1),
      actorId: id(10),
    });
    assert.deepEqual(
      loaded.memberships.items.map((member) => member.memberId),
      [id(10), id(11), id(12), id(14)],
    );
    assert.equal(
      loaded.memberships.items.find((member) => member.memberId === id(14)).active,
      false,
    );
    assert.equal(JSON.stringify(loaded).includes(preview.bearerToken), false);
    assert.ok(paths.includes('/v2/staff/memberships'));
    let response = await staffMembershipDirectoryBoundary(request(env), env);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const first = (await response.json()).page;
    assert.deepEqual(
      first.items.map((member) => member.memberId),
      [id(10), id(11)],
    );
    assert.equal(first.nextAfter, id(11));
    response = await staffMembershipDirectoryBoundary(
      request(env, '?limit=2&after=' + first.nextAfter),
      env,
    );
    const last = (await response.json()).page;
    assert.deepEqual(
      last.items.map((member) => member.memberId),
      [id(12), id(14)],
    );
    assert.equal(last.nextAfter, null);
    let calls = 0;
    const noTransport = async (...args) => {
      calls++;
      return fetch(...args);
    };
    response = await staffMembershipDirectoryBoundary(request(disabled), disabled, noTransport);
    assert.equal(response.status, 403);
    assert.equal(calls, 0);
    await assert.rejects(() =>
      loadStaffDirectoryWorkspace({ ...env, STAFF_MEMBERSHIP_PREVIEW_MODE: 'enabled' }),
    );
  } finally {
    await preview.close();
  }
});

test('signed agent and foreign administrator cannot load or read/change private company memberships', async () => {
  for (const actor of ['agent', 'other-company-admin']) {
    const preview = await startStaffPreview({ ...mode, actor });
    try {
      const env = settings(preview),
        command = change();
      await assert.rejects(() => loadStaffDirectoryWorkspace(env));
      for (const response of [
        await staffMembershipDirectoryBoundary(request(env), env),
        await staffMembershipCurrentBoundary(request(env, '/' + id(11)), id(11), env),
        await staffMembershipOperationBoundary(
          request(env, '/operations/' + command.operationId, command),
          command.operationId,
          env,
        ),
      ]) {
        const body = await response.json();
        assert.equal(response.status, 403, JSON.stringify(body));
        assert.equal(body.error, 'STAFF_MEMBERSHIP_UNAVAILABLE');
        assert.equal(JSON.stringify(body).includes(command.reason), false);
        assert.equal(JSON.stringify(body).includes(preview.bearerToken), false);
      }
    } finally {
      await preview.close();
    }
  }
});

test('browser/controller/BFF signed membership change persists before POST, survives corrupt committed reply and recovers by GET only', async () => {
  const preview = await startStaffPreview({
    ...mode,
    actor: 'admin',
    enquiryPreview: 'synthetic-v1',
    membershipReplyFault: 'invalid-first-membership-result-v1',
  });
  let controller;
  try {
    const env = settings(preview),
      loaded = await loadStaffDirectoryWorkspace(env);
    const command = change(),
      values = new Map(),
      browserCalls = [],
      upstreamCalls = [];
    let writes = 0;
    const store = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        writes++;
        values.set(key, value);
      },
      removeItem: (key) => values.delete(key),
    };
    const upstream = async (input, init) => {
      upstreamCalls.push({ method: init?.method ?? 'GET', path: new URL(input).pathname });
      return fetch(input, init);
    };
    const client = createStaffDirectoryClient(
      { instanceId: env.STAFF_PREVIEW_INSTANCE },
      async (path, init) => {
        browserCalls.push({ method: init.method, path });
        if (init.method === 'POST') {
          assert.ok(writes >= 2);
          const retained = JSON.parse([...values.values()][0]);
          assert.equal(retained.kind, 'membership');
          assert.equal(retained.command.operationId, JSON.parse(init.body).operationId);
          assert.equal(Object.hasOwn(retained, 'receipt'), false);
          assert.equal(JSON.stringify(retained).includes(preview.bearerToken), false);
        }
        const headers = new Headers(init.headers);
        headers.set('host', '127.0.0.1:3120');
        if (init.method === 'POST') headers.set('origin', 'http://127.0.0.1:3120');
        const incoming = new Request('http://127.0.0.1:3120' + path, { ...init, headers });
        if (path.startsWith('/api/staff-directory/memberships?'))
          return staffMembershipDirectoryBoundary(incoming, env, upstream);
        const operation = /^\/api\/staff-directory\/memberships\/operations\/([^/]+)$/.exec(path);
        if (operation)
          return staffMembershipOperationBoundary(incoming, operation[1], env, upstream);
        const member = /^\/api\/staff-directory\/memberships\/([^/?]+)$/.exec(path);
        if (member) return staffMembershipCurrentBoundary(incoming, member[1], env, upstream);
        throw Error('Unexpected synthetic membership route');
      },
    );
    controller = createStaffWriteController({ scope: loaded.scope, store, client });
    controller.prepare('membership', command);
    await assert.rejects(() => controller.submit());
    assert.equal(controller.snapshot().attempt.phase, 'uncertain');
    assert.equal(controller.snapshot().canNavigate, false);
    assert.throws(() => controller.clear());
    assert.throws(() => controller.prepare('membership', change()));
    assert.deepEqual(
      browserCalls.map((call) => call.method),
      ['POST'],
    );
    assert.deepEqual(
      upstreamCalls.map((call) => call.method),
      ['POST'],
    );
    controller.close();
    controller = createStaffWriteController({ scope: loaded.scope, store, client });
    assert.equal(controller.snapshot().attempt.phase, 'uncertain');
    assert.equal(controller.snapshot().attempt.command.operationId, command.operationId);
    const recovered = await controller.recover();
    assert.equal(recovered.receipt.outcome, 'applied');
    assert.equal(recovered.receipt.memberId, id(11));
    assert.equal(recovered.receipt.actorId, id(10));
    assert.equal(recovered.receipt.version, '2');
    assert.deepEqual(
      browserCalls.map((call) => call.method),
      ['POST', 'GET'],
    );
    assert.deepEqual(
      upstreamCalls.map((call) => call.method),
      ['POST', 'GET'],
    );
    const revoked = await client.getMembership(id(11));
    assert.equal(revoked.active, false);
    assert.equal(revoked.role, 'agent');
    assert.ok(revoked.revokedAt);
    assert.equal(
      (await client.listMemberships({ limit: 10, after: null })).items.find(
        (member) => member.memberId === id(11),
      ).active,
      false,
    );
    await assert.rejects(
      () =>
        api(preview).getCurrentStaffSessionV2({
          bearerToken: preview.enquiryStaff.agent.bearerToken,
        }),
      (error) => error.status === 403,
    );
    controller.clear();
    assert.equal(values.size, 0);
    const restored = change({ expectedVersion: '2', requestedRole: 'admin', active: true });
    controller.prepare('membership', restored);
    const applied = await controller.submit();
    assert.equal(applied.receipt.version, '3');
    assert.equal(
      (
        await api(preview).getCurrentStaffSessionV2({
          bearerToken: preview.enquiryStaff.agent.bearerToken,
        })
      ).actorId,
      id(11),
    );
    const promotedRead = await api(preview).listStaffMemberships(
      { limit: 10, after: null },
      { bearerToken: preview.enquiryStaff.agent.bearerToken },
    );
    assert.equal(promotedRead.items.find((entry) => entry.memberId === id(11)).role, 'admin');
    const page = await client.listMemberships({ limit: 10, after: null });
    const active = page.items.find((member) => member.memberId === id(11));
    assert.deepEqual(
      {
        role: active.role,
        active: active.active,
        revokedAt: active.revokedAt,
        version: active.version,
      },
      { role: 'admin', active: true, revokedAt: null, version: '3' },
    );
    assert.equal(browserCalls.filter((call) => call.method === 'POST').length, 2);
    assert.equal(upstreamCalls.filter((call) => call.method === 'POST').length, 2);
  } finally {
    controller?.close();
    await preview.close();
  }
});
