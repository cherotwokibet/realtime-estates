import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const intent = {
  policy: 'staff-invitation-intent-v1',
  operationId: id(200),
  recipientEmail: 'synthetic@example.invalid',
  requestedRole: 'agent',
  branchId: null,
  expiresAfterHours: 72,
};
const saved = {
  policy: 'staff-invitation-request-record-v1',
  operationId: id(200),
  actorId: id(10),
  recipientEmail: intent.recipientEmail,
  requestedRole: 'agent',
  expiresAfterHours: 72,
  branch: null,
  recordedAt: '2026-10-30T06:00:00.000Z',
  expiresAt: '2026-11-02T06:00:00.000Z',
  status: 'recorded',
  delivery: 'not_attempted',
  membershipGranted: false,
};
const command = {
  policy: 'staff-invitation-revocation-command-v1',
  operationId: id(300),
  invitationId: id(200),
  expectedVersion: '1',
  reason: 'Synthetic cancellation.',
};
const revoked = {
  policy: 'staff-invitation-revocation-record-v1',
  operationId: id(300),
  invitationId: id(200),
  actorId: id(10),
  expectedVersion: '1',
  version: '2',
  reason: command.reason,
  outcome: 'revoked',
  recordedAt: '2026-10-30T07:00:00.000Z',
};
const api = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic-invite-v1',
    fetch,
  });
test('invitation SDK snapshots private credentials and uses explicit writes and GET-only originals/state', async () => {
  const calls = [];
  const client = api(async (url, init) => {
    calls.push({ url, init });
    if (url.includes('/revocations/')) return Response.json(revoked);
    if (url.includes('/operations/'))
      return Response.json(saved, { status: init.method === 'POST' ? 202 : 200 });
    const { actorId, ...facts } = saved;
    return Response.json({
      ...facts,
      policy: 'staff-invitation-state-v1',
      state: 'pending',
      version: '1',
    });
  });
  const options = { bearerToken: 'original' };
  const work = client.recordStaffInvitationRequest(intent, options);
  options.bearerToken = 'changed';
  assert.deepEqual(await work, saved);
  assert.deepEqual(await client.getStaffInvitationRequest(id(200), options), saved);
  assert.equal((await client.getStaffInvitationState(id(200), options)).state, 'pending');
  assert.deepEqual(await client.revokeStaffInvitationRequest(command, options), revoked);
  assert.deepEqual(await client.getStaffInvitationRevocation(id(200), id(300), options), revoked);
  assert.deepEqual(
    calls.map((c) => c.init.method),
    ['POST', 'GET', 'GET', 'POST', 'GET'],
  );
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer original');
  for (const c of calls) {
    assert.equal(c.init.credentials, 'omit');
    assert.equal(c.init.redirect, 'error');
    assert.equal(c.init.cache, 'no-store');
    if (c.init.method === 'GET') assert.equal(c.init.body, undefined);
  }
  assert.deepEqual(JSON.parse(calls[3].init.body), command);
});
test('invalid intent/authority/accessor options fail before transport and cannot create a grant', async () => {
  let calls = 0,
    reads = 0;
  const client = api(async () => {
    calls++;
    return Response.json(saved, { status: 202 });
  });
  for (const value of [
    { ...intent, tenantId: id(2) },
    { ...intent, requestedRole: 'owner' },
    { ...intent, expiresAfterHours: 0 },
  ])
    await assert.rejects(
      () => client.recordStaffInvitationRequest(value, { bearerToken: 'actor' }),
      (e) => e.kind === 'VALIDATION',
    );
  const options = {};
  Object.defineProperty(options, 'bearerToken', {
    enumerable: true,
    get() {
      reads++;
      return 'actor';
    },
  });
  await assert.rejects(
    () => client.recordStaffInvitationRequest(intent, options),
    (e) => e.kind === 'VALIDATION',
  );
  await assert.rejects(
    () => client.getStaffInvitationRequest('not-canonical', { bearerToken: 'actor' }),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(calls, 0);
  assert.equal(reads, 0);
});
test('lost, malformed, oversized and wrong-status successful writes stay uncertain without automatic replay', async () => {
  for (const transport of [
    async () => {
      throw Error('Synthetic lost reply');
    },
    async () => Response.json({ ...saved, membershipGranted: true }, { status: 202 }),
    async () => Response.json(saved),
    async () =>
      new Response(JSON.stringify(saved).replace('"policy":', '"\\u0070olicy":"bad","policy":'), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
    async () =>
      new Response(' '.repeat(8193), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
  ]) {
    let calls = 0;
    const client = api(async (...args) => {
      calls++;
      return transport(...args);
    });
    await assert.rejects(
      () => client.recordStaffInvitationRequest(intent, { bearerToken: 'actor' }),
      (e) => e.submissionUncertain === true,
    );
    assert.equal(calls, 1);
  }
  const bad = api(async () => Response.json({ ...revoked, reason: 'Changed' }));
  await assert.rejects(
    () => bad.revokeStaffInvitationRequest(command, { bearerToken: 'actor' }),
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
  );
});
test('foreign originals and duplicate/rounded state projections are rejected as reads without a hidden write', async () => {
  const calls = [];
  const wrong = api(async (url, init) => {
    calls.push(init.method);
    return Response.json({ ...saved, operationId: id(201) });
  });
  await assert.rejects(
    () => wrong.getStaffInvitationRequest(id(200), { bearerToken: 'actor' }),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
  assert.deepEqual(calls, ['GET']);
  const rounded = api(async () => {
    const { actorId, ...facts } = saved;
    return new Response(
      JSON.stringify({
        ...facts,
        policy: 'staff-invitation-state-v1',
        state: 'pending',
        version: '1',
      }).replace('"expiresAfterHours":72', '"expiresAfterHours":7.2e1'),
      { headers: { 'content-type': 'application/json' } },
    );
  });
  await assert.rejects(
    () => rounded.getStaffInvitationState(id(200), { bearerToken: 'actor' }),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
  const foreign = api(async () => Response.json({ ...revoked, invitationId: id(999) }));
  await assert.rejects(
    () => foreign.getStaffInvitationRevocation(id(200), id(300), { bearerToken: 'actor' }),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
});
