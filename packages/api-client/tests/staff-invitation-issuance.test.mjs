import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { RealtorApiClient } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('recipient identity session uses a bounded no-store GET and rejects invented authority or cached facts', async () => {
  const value = {
      policy: 'synthetic-staff-invitation-recipient-session-v1',
      tenantId: id(1),
      actorId: id(2),
      recipientEmail: 'recipient@example.invalid',
      authority: 'identity_only',
    },
    calls = [];
  const result = await client(async (url, init) => {
    calls.push({ url, init });
    return response(value);
  }).getStaffInvitationRecipientSession(auth);
  assert.deepEqual(result, value);
  assert.ok(Object.isFrozen(result));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://synthetic.invalid/v2/staff/invitation-recipient-session');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  for (const make of [
    () => response({ ...value, role: 'admin' }),
    () => Response.json(value),
    () =>
      new Response('{"actorId":1,"actorId":2}', {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
      }),
  ]) {
    let n = 0;
    await assert.rejects(
      () =>
        client(async () => {
          n++;
          return make();
        }).getStaffInvitationRecipientSession(auth),
      (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain !== true,
    );
    assert.equal(n, 1);
  }
});
const issue = () => ({
  policy: 'staff-invitation-issue-command-v1',
  operationId: id(1),
  invitationId: id(2),
});
const redeem = () => ({
  policy: 'staff-invitation-redemption-command-v1',
  operationId: id(4),
  invitationId: id(2),
});
const receipt = () => ({
  policy: 'staff-invitation-issuance-record-v1',
  operationId: id(1),
  invitationId: id(2),
  actorId: id(3),
  recordedAt: '2026-11-02T10:00:00.000Z',
  expiresAt: '2026-11-03T10:00:00.000Z',
  secretRecovery: 'revoke_and_replace',
  delivery: 'not_attempted',
  membershipGranted: false,
});
const accepted = () => ({
  policy: 'staff-invitation-redemption-record-v1',
  operationId: id(4),
  invitationId: id(2),
  memberId: id(5),
  requestedRole: 'agent',
  branchId: null,
  recordedAt: '2026-11-02T10:05:00.000Z',
  membershipGranted: true,
});
const state = () => ({
  policy: 'staff-issued-invitation-state-v1',
  operationId: id(1),
  invitationId: id(2),
  recordedAt: receipt().recordedAt,
  expiresAt: receipt().expiresAt,
  state: 'used',
});
const auth = { bearerToken: 'synthetic-private-bearer' };
const response = (data, init = {}) =>
  Response.json(data, { ...init, headers: { 'Cache-Control': 'no-store', ...init.headers } });
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch,
  });
const invalid = (error) => error.kind === 'INVALID_RESPONSE';
test('explicit issue/metadata/state/redeem methods use fixed private paths and never put the secret in a URL', async () => {
  const raw = randomBytes(32).toString('base64url'),
    calls = [],
    cmd = issue(),
    options = { ...auth };
  const api = client(async (url, init) => {
    calls.push({ url, init });
    if (calls.length === 1) {
      cmd.invitationId = id(9);
      options.bearerToken = 'changed';
    }
    if (url.endsWith('/state')) return response(state());
    if (url.includes('invitation-redemptions')) return response(accepted());
    return response(
      init.method === 'POST'
        ? { policy: 'staff-invitation-issue-response-v1', record: receipt(), secret: raw }
        : receipt(),
    );
  });
  const fresh = await api.issueStaffInvitation(cmd, options);
  assert.equal(fresh.secret, raw);
  assert.ok(Object.isFrozen(fresh.record));
  assert.deepEqual(await api.getStaffInvitationIssue(issue(), auth), receipt());
  assert.deepEqual(await api.getIssuedStaffInvitationState(issue(), auth), state());
  assert.deepEqual(await api.redeemStaffInvitation(redeem(), raw, auth), accepted());
  assert.deepEqual(await api.getStaffInvitationRedemption(redeem(), auth), accepted());
  assert.equal(calls.length, 5);
  assert.deepEqual(JSON.parse(calls[0].init.body), issue());
  assert.deepEqual(JSON.parse(calls[3].init.body), { command: redeem(), secret: raw });
  for (const c of calls) {
    assert.ok(!c.url.includes(raw));
    assert.equal(c.init.credentials, 'omit');
    assert.equal(c.init.redirect, 'error');
    assert.equal(c.init.cache, 'no-store');
    assert.equal(new Headers(c.init.headers).get('authorization'), 'Bearer ' + auth.bearerToken);
    if (c.init.method === 'GET') assert.equal(c.init.body, undefined);
  }
});
test('caller authority, secret-bearing retained commands, invalid secrets and ambiguous IDs fail before I/O', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    throw Error();
  });
  for (const patch of [
    { tenantId: id(9) },
    { secret: 'private' },
    { actorId: id(3) },
    { operationId: id(1).toUpperCase().replace('00000000', 'A0000000') },
    { policy: 'other' },
  ])
    await assert.rejects(
      () => api.issueStaffInvitation({ ...issue(), ...patch }, auth),
      (e) => e.kind === 'VALIDATION',
    );
  for (const raw of ['', 'x'.repeat(42), '0'.repeat(64), {}, null])
    await assert.rejects(
      () => api.redeemStaffInvitation(redeem(), raw, auth),
      (e) => e.kind === 'VALIDATION',
    );
  assert.equal(calls, 0);
});
test('cached, mismatched, duplicate, oversized and wrong-status issue responses remain uncertain after one POST', async () => {
  const raw = randomBytes(32).toString('base64url');
  const variants = [
    () =>
      Response.json({
        policy: 'staff-invitation-issue-response-v1',
        record: receipt(),
        secret: raw,
      }),
    () =>
      response({
        policy: 'staff-invitation-issue-response-v1',
        record: { ...receipt(), invitationId: id(9) },
        secret: raw,
      }),
    () =>
      response(
        { policy: 'staff-invitation-issue-response-v1', record: receipt(), secret: raw },
        { status: 201 },
      ),
    () =>
      new Response('{"record":{},"record":{}}', {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
    () =>
      new Response(' '.repeat(8193), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      }),
  ];
  for (const reply of variants) {
    let calls = 0;
    await assert.rejects(
      () =>
        client(async () => {
          calls++;
          return reply();
        }).issueStaffInvitation(issue(), auth),
      (e) => invalid(e) && e.submissionUncertain === true,
    );
    assert.equal(calls, 1);
  }
});
test('GET metadata cannot disclose a secret or change operation identity, and reads never replay writes', async () => {
  for (const malformed of [
    { ...receipt(), secret: 'private' },
    { ...receipt(), operationId: id(9) },
  ]) {
    const methods = [];
    await assert.rejects(
      () =>
        client(async (url, init) => {
          methods.push(init.method);
          return response(malformed);
        }).getStaffInvitationIssue(issue(), auth),
      invalid,
    );
    assert.deepEqual(methods, ['GET']);
  }
  const recovered = await client(async () =>
    response({ policy: 'staff-invitation-issue-response-v1', record: receipt(), secret: null }),
  ).issueStaffInvitation(issue(), auth);
  assert.equal(recovered.secret, null);
});
test('network loss and timeouts retain write uncertainty without automatic retries or raw-secret errors', async () => {
  const raw = randomBytes(32).toString('base64url');
  let calls = 0;
  await assert.rejects(
    () =>
      client(async () => {
        calls++;
        throw Error(raw);
      }).redeemStaffInvitation(redeem(), raw, auth),
    (e) => e.kind === 'NETWORK' && e.submissionUncertain && !e.message.includes(raw),
  );
  assert.equal(calls, 1);
  let timeouts = 0;
  const api = client(async () => {
    timeouts++;
    return new Promise(() => {});
  });
  await assert.rejects(
    () => api.issueStaffInvitation(issue(), { ...auth, timeoutMs: 15 }),
    (e) => e.kind === 'TIMEOUT' && e.submissionUncertain === true,
  );
  assert.equal(timeouts, 1);
});
test('bounded server error envelopes stay generic and preserve a known original after a write failure', async () => {
  const raw = randomBytes(32).toString('base64url');
  const requestId = id(8);
  let calls = 0;
  const api = client(async (url, init) => {
    calls++;
    return init.method === 'POST'
      ? response(
          { error: { code: 'SERVICE_UNAVAILABLE', message: raw }, requestId },
          { status: 503, headers: { 'X-Request-Id': requestId } },
        )
      : response(receipt());
  });
  await assert.rejects(
    () => api.issueStaffInvitation(issue(), auth),
    (e) => e.kind === 'HTTP' && e.submissionUncertain === true && !e.message.includes(raw),
  );
  assert.deepEqual(await api.getStaffInvitationIssue(issue(), auth), receipt());
  assert.equal(calls, 2);
});
