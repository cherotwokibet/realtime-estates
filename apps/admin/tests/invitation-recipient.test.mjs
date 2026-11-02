import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
  invitationRecipientBoundary as boundary,
  loadInvitationRecipientContext,
} from '../dist/tests/lib/invitation-recipient-server.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1',
  STAFF_INVITATION_RECIPIENT_PREVIEW_MODE: 'synthetic-verified-recipient-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'admin.bearer.signature',
  STAFF_INVITATION_RECIPIENT_TOKEN: 'recipient.bearer.signature',
  STAFF_PREVIEW_INSTANCE: id(1),
};
const target = { invitationId: id(4), operationId: id(5) },
  path = '/api/invitation-acceptance/' + target.invitationId + '/operations/' + target.operationId;
const command = () => ({ policy: 'staff-invitation-redemption-command-v1', ...target });
const session = () => ({
  policy: 'synthetic-staff-invitation-recipient-session-v1',
  tenantId: id(2),
  actorId: id(50),
  recipientEmail: 'recipient@example.invalid',
  authority: 'identity_only',
});
const receipt = () => ({
  policy: 'staff-invitation-redemption-record-v1',
  ...target,
  memberId: id(50),
  requestedRole: 'agent',
  branchId: null,
  recordedAt: '2026-11-02T17:00:00.000Z',
  membershipGranted: true,
});
const response = (v) => Response.json(v, { headers: { 'cache-control': 'no-store' } });
const req = (method = 'GET', url = path, body, headers = {}) =>
  new Request('http://localhost:3120' + url, {
    method,
    headers: {
      host: '127.0.0.1:3120',
      'x-preview-instance': id(1),
      ...(method === 'POST'
        ? { origin: 'http://127.0.0.1:3120', 'content-type': 'application/json' }
        : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });

test('recipient BFF refuses missing mode, missing recipient credential and admin-token fallback without upstream calls', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error();
  };
  for (const settings of [
    { ...env, STAFF_INVITATION_RECIPIENT_PREVIEW_MODE: undefined },
    { ...env, STAFF_INVITATION_RECIPIENT_TOKEN: undefined },
    { ...env, STAFF_INVITATION_RECIPIENT_TOKEN: env.STAFF_PREVIEW_TOKEN },
    { ...env, NODE_ENV: 'production' },
  ]) {
    assert.equal((await boundary(req(), target, settings, fetcher)).status, 403);
    await assert.rejects(() => loadInvitationRecipientContext(settings, fetcher));
  }
  assert.equal(calls, 0);
});

test('recipient page context returns signed identity facts only and never serializes either server credential', async () => {
  const calls = [];
  const result = await loadInvitationRecipientContext(env, async (url, init) => {
    calls.push({ url, init });
    return response(session());
  });
  assert.deepEqual(result, { instanceId: id(1), session: session() });
  assert.ok(Object.isFrozen(result));
  assert.ok(!JSON.stringify(result).includes('bearer'));
  assert.equal(
    calls[0].url,
    env.STAFF_PREVIEW_API_ORIGIN + '/v2/staff/invitation-recipient-session',
  );
  assert.equal(
    new Headers(calls[0].init.headers).get('authorization'),
    'Bearer ' + env.STAFF_INVITATION_RECIPIENT_TOKEN,
  );
});

test('recipient request rejects authority, secret URL/query, malformed commands, headers and session writes before upstream', async () => {
  let calls = 0;
  const fetcher = async () => {
      calls++;
      throw Error();
    },
    secret = randomBytes(32).toString('base64url');
  for (const request of [
    req('POST', path, { command: { ...command(), actorId: id(10) }, secret }),
    req('POST', path, { command: command(), secret, tenantId: id(2) }),
    req('POST', path, { command: { ...command(), operationId: id(9) }, secret }),
    req('POST', path, { command: command(), secret: 'bad' }),
    req('GET', path + '?secret=' + secret),
    req('GET', path, undefined, { authorization: 'Bearer supplied' }),
    req('GET', path, undefined, { cookie: 'private=x' }),
    req('GET', path, undefined, { 'x-preview-instance': id(9) }),
  ])
    assert.ok([400, 403].includes((await boundary(request, target, env, fetcher)).status));
  assert.equal(
    (await boundary(req('POST', '/api/invitation-acceptance/session', {}), null, env, fetcher))
      .status,
    405,
  );
  assert.equal(calls, 0);
});

test('recipient acceptance uses a fresh identity GET and body-only secret with no browser-selected bearer or identity', async () => {
  const calls = [],
    secret = randomBytes(32).toString('base64url');
  const result = await boundary(
    req('POST', path, { command: command(), secret }),
    target,
    env,
    async (url, init) => {
      calls.push({ url, init });
      return response(url.endsWith('/invitation-recipient-session') ? session() : receipt());
    },
  );
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await result.json(), { receipt: receipt() });
  assert.deepEqual(
    calls.map((c) => c.init.method),
    ['GET', 'POST'],
  );
  for (const c of calls) {
    assert.ok(!c.url.includes(secret));
    assert.equal(
      new Headers(c.init.headers).get('authorization'),
      'Bearer ' + env.STAFF_INVITATION_RECIPIENT_TOKEN,
    );
    assert.equal(c.init.credentials, 'omit');
    assert.equal(c.init.redirect, 'error');
  }
  assert.deepEqual(JSON.parse(calls[1].init.body), { command: command(), secret });
});

test('mismatched post-write member facts remain uncertain; malformed recipient identity prevents any redemption call', async () => {
  const secret = randomBytes(32).toString('base64url');
  let writes = 0;
  let result = await boundary(
    req('POST', path, { command: command(), secret }),
    target,
    env,
    async (url, init) => {
      if (init.method === 'POST') writes++;
      return response(
        url.endsWith('/invitation-recipient-session')
          ? session()
          : { ...receipt(), memberId: id(99) },
      );
    },
  );
  assert.equal(result.status, 503);
  assert.equal((await result.json()).submissionUncertain, true);
  assert.equal(writes, 1);
  writes = 0;
  result = await boundary(
    req('POST', path, { command: command(), secret }),
    target,
    env,
    async (url, init) => {
      if (init.method === 'POST') writes++;
      return response({ ...session(), role: 'admin' });
    },
  );
  assert.equal(result.status, 502);
  assert.equal((await result.json()).submissionUncertain, false);
  assert.equal(writes, 0);
});

test('lost acceptance response never retries; explicit original recovery performs only identity and original GET reads', async () => {
  const secret = randomBytes(32).toString('base64url'),
    methods = [];
  const fetcher = async (url, init) => {
    methods.push(init.method);
    if (init.method === 'POST') throw Error(secret);
    return response(url.endsWith('/invitation-recipient-session') ? session() : receipt());
  };
  const failed = await boundary(
    req('POST', path, { command: command(), secret }),
    target,
    env,
    fetcher,
  );
  assert.equal(failed.status, 502);
  const data = await failed.json();
  assert.equal(data.submissionUncertain, true);
  assert.ok(!JSON.stringify(data).includes(secret));
  const original = await boundary(req(), target, env, fetcher);
  assert.equal(original.status, 200);
  assert.deepEqual(await original.json(), { receipt: receipt() });
  assert.deepEqual(methods, ['GET', 'POST', 'GET', 'GET']);
});
