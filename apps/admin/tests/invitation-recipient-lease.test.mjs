import test from 'node:test';
import assert from 'node:assert/strict';
import { validateInvitationRecipientLease } from '@realtor/domain';
import { createBoundedPrivateLease } from '../dist/tests/lib/bounded-private-lease.js';
import {
  invitationRecipientLeaseRequest,
  invitationRecipientPageConfiguration,
} from '../dist/tests/lib/invitation-recipient-server.js';
import { readInvitationRecipientLease } from '../dist/tests/lib/invitation-recipient-lease-client.js';
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
const lease = (now = Date.now(), patch = {}) => ({
  policy: 'invitation-recipient-lease-v1',
  tenantId: id(2),
  actorId: id(50),
  recipientEmail: 'recipient@example.invalid',
  authority: 'identity_only',
  checkedAt: new Date(now).toISOString(),
  expiresAt: new Date(now + 30000).toISOString(),
  ...patch,
});
const request = (path = '/api/invitation-acceptance/lease', headers = {}) =>
  new Request('http://localhost:3120' + path, {
    headers: { host: '127.0.0.1:3120', 'x-preview-instance': id(1), ...headers },
  });
test('recipient page configuration exposes no identity facts and lease BFF uses only the separate recipient bearer', async () => {
  assert.deepEqual(invitationRecipientPageConfiguration(env), { instanceId: id(1) });
  let calls = 0;
  const result = await invitationRecipientLeaseRequest(request(), env, async (url, init) => {
    calls++;
    assert.equal(url, env.STAFF_PREVIEW_API_ORIGIN + '/v2/staff/invitation-recipient-lease');
    assert.equal(
      new Headers(init.headers).get('authorization'),
      'Bearer ' + env.STAFF_INVITATION_RECIPIENT_TOKEN,
    );
    assert.equal(init.credentials, 'omit');
    return Response.json(lease(), { headers: { 'cache-control': 'no-store' } });
  });
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store, no-transform');
  assert.equal((await result.json()).authority, 'identity_only');
  assert.equal(calls, 1);
});
test('recipient lease rejects caller authority, framing, wrong instance and admin fallback before upstream', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error();
  };
  for (const req of [
    request('?x=1'),
    request('/api/invitation-acceptance/lease', { cookie: 'private=x' }),
    request('/api/invitation-acceptance/lease', { 'x-preview-instance': id(9) }),
    request('/api/invitation-acceptance/lease', { 'content-type': 'application/json' }),
  ])
    assert.ok((await invitationRecipientLeaseRequest(req, env, fetcher)).status >= 400);
  assert.equal(
    (
      await invitationRecipientLeaseRequest(
        request(),
        { ...env, STAFF_INVITATION_RECIPIENT_TOKEN: env.STAFF_PREVIEW_TOKEN },
        fetcher,
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
});
test('recipient BFF preserves raw401403503 and never returns identity facts on denial', async () => {
  for (const status of [401, 403, 503]) {
    const r = await invitationRecipientLeaseRequest(
      request(),
      env,
      async () => new Response('not-json', { status }),
    );
    assert.equal(r.status, status);
    assert.equal(Object.hasOwn(await r.json(), 'recipientEmail'), false);
  }
});
test('recipient browser transport omits credentials and rejects role-bearing leases', async () => {
  const signal = new AbortController().signal;
  const value = await readInvitationRecipientLease(id(1), signal, async (path, init) => {
    assert.equal(path, '/api/invitation-acceptance/lease');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    return Response.json(lease(), { headers: { 'cache-control': 'no-store' } });
  });
  assert.equal(value.authority, 'identity_only');
  await assert.rejects(() =>
    readInvitationRecipientLease(id(1), signal, async () =>
      Response.json({ ...lease(), role: 'admin' }),
    ),
  );
});
function rig() {
  let time = 0,
    ready = 0,
    seq = 0;
  const base = Date.now(),
    timers = new Map(),
    closed = [],
    state = { patch: {}, hold: null },
    read = async () => lease(base + time, state.patch),
    options = {
      read,
      validate: validateInvitationRecipientLease,
      matches: () => true,
      fingerprint: (v) => JSON.stringify([v.tenantId, v.actorId, v.recipientEmail, v.authority]),
      onReady: () => ready++,
      onClose: (r) => closed.push(r),
      monotonic: () => time,
      wallNow: () => base + time,
      foreground: () => false,
      schedule: (fn, delay) => {
        timers.set(++seq, { fn, at: time + delay });
        return seq;
      },
      cancel: (n) => timers.delete(n),
    };
  const controller = createBoundedPrivateLease(options);
  return {
    controller,
    state,
    options,
    closed,
    ready: () => ready,
    advance: (ms) => {
      time += ms;
      for (const [n, t] of [...timers])
        if (t.at <= time) {
          timers.delete(n);
          t.fn();
        }
    },
    base,
  };
}
test('identity-only lease gates readiness, expires monotonically and cannot reopen after invalidation', async () => {
  const r = rig();
  assert.equal(r.ready(), 0);
  await r.controller.refresh();
  assert.equal(r.ready(), 1);
  assert.equal(r.controller.active, true);
  r.advance(30000);
  assert.deepEqual(r.closed, ['expired']);
  await r.controller.refresh();
  assert.equal(r.controller.active, false);
});
test('changed email, tenant or actor closes a renewable recipient lease without a staff role', async () => {
  for (const patch of [
    { actorId: id(99) },
    { tenantId: id(99) },
    { recipientEmail: 'changed@example.invalid' },
  ]) {
    const r = rig();
    await r.controller.refresh();
    r.advance(1);
    r.state.patch = patch;
    await r.controller.refresh();
    assert.deepEqual(r.closed, ['access-changed']);
    assert.equal(r.controller.active, false);
  }
});
test('uncooperative recipient checks time out and late replies cannot expose identity', async () => {
  const r = rig();
  let resolve, signal;
  r.options.read = (s) => {
    signal = s;
    return new Promise((done) => (resolve = done));
  };
  const c = createBoundedPrivateLease(r.options),
    p = c.refresh();
  await Promise.resolve();
  await Promise.resolve();
  r.advance(5000);
  assert.equal(signal.aborted, true);
  resolve(lease(r.base + 5000));
  await p;
  assert.equal(r.ready(), 0);
  assert.equal(c.active, false);
  assert.deepEqual(r.closed, ['access-unavailable']);
});
