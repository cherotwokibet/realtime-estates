import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '../dist/index.js';
import { startStaffPreview } from '../../../apps/api/dev/staff-preview.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const mode = {
  port: 0,
  actor: 'admin',
  seedAcceptedMedia: false,
  staffMembershipMode: 'synthetic-existing-members-v1',
};
const command = (overrides = {}) => ({
  policy: 'staff-membership-command-v1',
  operationId: randomUUID(),
  memberId: id(11),
  expectedVersion: '1',
  requestedRole: 'admin',
  active: true,
  reason: 'Synthetic existing staff administration.',
  ...overrides,
});
const client = (p, transport) =>
  new RealtorApiClient({
    baseUrl: p.origin,
    allowLoopbackHttp: true,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    ...(transport ? { fetch: transport } : {}),
  });
const status = (expected) => (error) => error.status === expected;

test('signed SDK membership lifecycle preserves originals, explicit replay, terminal conflicts, no-ops and existing-member boundaries', async () => {
  const p = await startStaffPreview(mode);
  try {
    const api = client(p),
      auth = { bearerToken: p.bearerToken },
      c = command();
    assert.deepEqual(await api.getStaffMembership(c.memberId, auth), {
      policy: 'staff-membership-current-v1',
      memberId: id(11),
      role: 'agent',
      active: true,
      version: '1',
      revokedAt: null,
    });
    const saved = await api.saveStaffMembership(c, auth);
    assert.equal(saved.outcome, 'applied');
    assert.equal(saved.actorId, id(10));
    assert.equal(saved.memberId, c.memberId);
    assert.equal(saved.expectedVersion, '1');
    assert.equal(saved.version, '2');
    assert.equal(saved.requestedRole, 'admin');
    assert.deepEqual(await api.getStaffMembershipOperation(c.operationId, auth), saved);
    assert.deepEqual(await api.saveStaffMembership(c, auth), saved);
    const stale = command({ expectedVersion: '1', requestedRole: 'agent' }),
      conflict = await api.saveStaffMembership(stale, auth);
    assert.equal(conflict.outcome, 'conflict');
    assert.equal(conflict.version, '2');
    const noop = command({ expectedVersion: '2' });
    assert.equal((await api.saveStaffMembership(noop, auth)).outcome, 'unchanged');
    const revoke = command({ expectedVersion: '2', active: false });
    assert.equal((await api.saveStaffMembership(revoke, auth)).version, '3');
    const inactive = await api.getStaffMembership(c.memberId, auth);
    assert.equal(inactive.active, false);
    assert.equal(inactive.version, '3');
    assert.match(inactive.revokedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    const restore = command({ expectedVersion: '3', requestedRole: 'agent' });
    assert.equal((await api.saveStaffMembership(restore, auth)).version, '4');
    assert.deepEqual(await api.getStaffMembership(c.memberId, auth), {
      policy: 'staff-membership-current-v1',
      memberId: c.memberId,
      role: 'agent',
      active: true,
      version: '4',
      revokedAt: null,
    });
    assert.deepEqual(await api.saveStaffMembership(stale, auth), conflict);
    assert.deepEqual(await api.getStaffMembershipOperation(c.operationId, auth), saved);
    await assert.rejects(
      () => api.saveStaffMembership({ ...c, reason: 'Changed original request.' }, auth),
      status(409),
    );
    for (const memberId of [id(13), id(20), randomUUID()]) {
      await assert.rejects(() => api.saveStaffMembership(command({ memberId }), auth), status(404));
      await assert.rejects(() => api.getStaffMembership(memberId, auth), status(404));
    }
    await assert.rejects(
      () => api.saveStaffMembership(command({ memberId: id(10) }), auth),
      status(403),
    );
    await assert.rejects(
      () => api.getStaffMembership(c.memberId, { bearerToken: p.bearerToken + 'x' }),
      status(401),
    );
    const invalid = command(),
      path = p.origin + '/v2/staff/memberships/operations/' + invalid.operationId;
    for (const header of [
      { 'x-tenant-id': randomUUID() },
      { 'x-actor-id': randomUUID() },
      { cookie: 'session=synthetic' },
      { 'if-match': '1' },
      { 'idempotency-key': randomUUID() },
    ]) {
      const r = await fetch(path, {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + p.bearerToken,
          'Content-Type': 'application/json',
          ...header,
        },
        body: JSON.stringify(invalid),
      });
      assert.equal(r.status, 400);
    }
    assert.equal(
      (
        await fetch(path + '?tenantId=' + randomUUID(), {
          headers: { Authorization: 'Bearer ' + p.bearerToken },
        })
      ).status,
      400,
    );
    await assert.rejects(
      () => api.getStaffMembershipOperation(invalid.operationId, auth),
      status(404),
    );
  } finally {
    await p.close();
  }
});

test('committed corrupt signed membership reply recovers exact original by GET only without automatic write replay', async () => {
  const p = await startStaffPreview({
    ...mode,
    membershipReplyFault: 'invalid-first-membership-result-v1',
  });
  try {
    const calls = [],
      api = client(p, async (input, init) => {
        calls.push({ method: init?.method ?? 'GET', path: new URL(String(input)).pathname });
        return fetch(input, init);
      }),
      auth = { bearerToken: p.bearerToken },
      c = command();
    await assert.rejects(
      () => api.saveStaffMembership(c, auth),
      (e) => e.submissionUncertain === true,
    );
    assert.deepEqual(calls, [
      { method: 'POST', path: '/v2/staff/memberships/operations/' + c.operationId },
    ]);
    const original = await api.getStaffMembershipOperation(c.operationId, auth);
    assert.equal(original.outcome, 'applied');
    assert.equal(original.version, '2');
    assert.equal(original.actorId, id(10));
    assert.equal(original.requestedRole, c.requestedRole);
    assert.equal(original.reason, c.reason);
    const current = await api.getStaffMembership(c.memberId, auth);
    assert.equal(current.role, 'admin');
    assert.equal(current.version, '2');
    assert.deepEqual(
      calls.map((r) => r.method),
      ['POST', 'GET', 'GET'],
    );
    assert.equal(calls[1].path, calls[0].path);
    assert.equal(calls[2].path, '/v2/staff/memberships/' + c.memberId);
    // A later replay is deliberate and returns the original version, not another applied change.
    assert.deepEqual(await api.saveStaffMembership(c, auth), original);
    assert.equal((await api.getStaffMembership(c.memberId, auth)).version, '2');
    assert.deepEqual(
      calls.map((r) => r.method),
      ['POST', 'GET', 'GET', 'POST', 'GET'],
    );
  } finally {
    await p.close();
  }
});

test('signed agent/foreign identities and omitted or invalid preview modes cannot administer memberships', async () => {
  await assert.rejects(
    () => startStaffPreview({ port: 0, staffMembershipMode: 'enable' }),
    /Unsupported synthetic staff membership mode/,
  );
  await assert.rejects(
    () =>
      startStaffPreview({ port: 0, membershipReplyFault: 'invalid-first-membership-result-v1' }),
    /Unsupported synthetic membership reply fault/,
  );
  for (const actor of ['agent', 'other-company-admin']) {
    const p = await startStaffPreview({ ...mode, actor });
    try {
      const api = client(p),
        auth = { bearerToken: p.bearerToken },
        c = command();
      await assert.rejects(() => api.saveStaffMembership(c, auth), status(403));
      await assert.rejects(() => api.getStaffMembershipOperation(c.operationId, auth), status(403));
      await assert.rejects(() => api.getStaffMembership(c.memberId, auth), status(403));
    } finally {
      await p.close();
    }
  }
  const p = await startStaffPreview({ port: 0, actor: 'admin', seedAcceptedMedia: false });
  try {
    const api = client(p),
      auth = { bearerToken: p.bearerToken },
      c = command();
    await assert.rejects(() => api.saveStaffMembership(c, auth), status(404));
    await assert.rejects(() => api.getStaffMembershipOperation(c.operationId, auth), status(404));
    await assert.rejects(() => api.getStaffMembership(c.memberId, auth), status(404));
  } finally {
    await p.close();
  }
});
