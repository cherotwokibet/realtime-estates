import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ApiClientError } from '@realtor/api-client';
import { staffInvitationIssueBoundary as boundary } from '../dist/tests/lib/staff-invitation-issue-server.js';
import { createStaffDirectoryClient } from '../dist/tests/lib/staff-directory-client.js';
import { createStaffWriteController } from '../dist/tests/lib/staff-write-controller.js';
import { serializeStaffWrite, restoreStaffWrite } from '../dist/tests/lib/staff-write-attempt.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const scope = { instanceId: id(1), tenantId: id(2), actorId: id(3) };

test('known rolled-back issuance refusal can be acknowledged without inventing an original or locking future work', async () => {
  let posts = 0;
  const c = createStaffWriteController({
    scope,
    store: store(),
    client: {
      issueInvitation: async () => {
        posts++;
        throw new ApiClientError('HTTP', 'Refused', { status: 409, submissionUncertain: false });
      },
    },
  });
  c.prepare('issuance', command());
  await assert.rejects(() => c.submit());
  assert.equal(c.snapshot().attempt.phase, 'refused');
  assert.equal(c.snapshot().canNavigate, true);
  assert.equal(c.snapshot().secretAvailable, false);
  await assert.rejects(() => c.replay(true));
  assert.equal(posts, 1);
  c.clear();
  assert.equal(c.snapshot().attempt, null);
});
const command = () => ({
  policy: 'staff-invitation-issue-command-v1',
  invitationId: id(4),
  operationId: id(5),
});
const receipt = () => ({
  policy: 'staff-invitation-issuance-record-v1',
  invitationId: id(4),
  operationId: id(5),
  actorId: id(3),
  recordedAt: '2026-11-02T10:00:00.000Z',
  expiresAt: '2026-11-03T10:00:00.000Z',
  secretRecovery: 'revoke_and_replace',
  delivery: 'not_attempted',
  membershipGranted: false,
});
const disclosure = (secret) => ({
  policy: 'staff-invitation-issue-response-v1',
  record: receipt(),
  secret,
});
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_DIRECTORY_PREVIEW_MODE: 'synthetic-v1',
  STAFF_INVITATION_ISSUE_PREVIEW_MODE: 'synthetic-single-use-invitations-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'synthetic.bearer.signature',
  STAFF_PREVIEW_INSTANCE: id(1),
};
const path = '/api/staff-directory/invitation-issues/' + id(4) + '/operations/' + id(5);
const req = (body = command(), target = path, headers = {}) =>
  new Request('http://localhost:3120' + target, {
    method: body === undefined ? 'GET' : 'POST',
    headers: {
      host: '127.0.0.1:3120',
      'x-preview-instance': id(1),
      ...(body === undefined
        ? {}
        : { origin: 'http://127.0.0.1:3120', 'content-type': 'application/json' }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
const read = () =>
  new Request('http://localhost:3120' + path, {
    headers: { host: '127.0.0.1:3120', 'x-preview-instance': id(1) },
  });
const response = (v) => Response.json(v, { headers: { 'cache-control': 'no-store' } });
function store() {
  const values = new Map();
  let writes = 0;
  return {
    values,
    get writes() {
      return writes;
    },
    failAt: 0,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      writes++;
      if (this.failAt === writes) throw Error('Storage unavailable');
      values.set(key, value);
    },
    removeItem: (key) => values.delete(key),
  };
}

test('issuance BFF is default-off, blocks browser authority and rejects malformed exact requests before upstream', async () => {
  let calls = 0;
  const fetcher = async () => {
    calls++;
    throw Error();
  };
  for (const settings of [
    { ...env, STAFF_INVITATION_ISSUE_PREVIEW_MODE: undefined },
    { ...env, NODE_ENV: 'production' },
  ])
    assert.equal((await boundary(req(), id(4), id(5), false, settings, fetcher)).status, 403);
  for (const request of [
    req({ ...command(), actorId: id(3) }),
    req({ ...command(), invitationId: id(9) }),
    req(' '.repeat(8193)),
    req(JSON.stringify(command()).replace('"policy":', '"operationId":"' + id(5) + '","policy":')),
    req(command(), path + '?company=' + id(2)),
    req(command(), path, { authorization: 'Bearer private' }),
    req(command(), path, { cookie: 'private=x' }),
    req(command(), path, { 'x-preview-instance': id(9) }),
  ])
    assert.ok(
      [400, 403].includes((await boundary(request, id(4), id(5), false, env, fetcher)).status),
    );
  for (const state of [false, true]) {
    for (const method of state ? ['POST', 'PUT', 'PATCH', 'DELETE'] : ['PUT', 'PATCH', 'DELETE']) {
      const request = new Request('http://localhost:3120' + path + (state ? '/state' : ''), {
        method,
        headers: {
          host: '127.0.0.1:3120',
          origin: 'http://127.0.0.1:3120',
          'content-type': 'application/json',
          'x-preview-instance': id(1),
        },
      });
      assert.equal((await boundary(request, id(4), id(5), state, env, fetcher)).status, 405);
    }
  }
  assert.equal(calls, 0);
});

test('issuance BFF uses fixed server credentials and ephemeral disclosure; GET only returns validated original metadata', async () => {
  const secret = randomBytes(32).toString('base64url'),
    calls = [];
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    return response(init.method === 'POST' ? disclosure(secret) : receipt());
  };
  const result = await boundary(req(), id(4), id(5), false, env, fetcher);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal((await result.json()).disclosure.secret, secret);
  const original = await boundary(read(), id(4), id(5), false, env, fetcher);
  assert.deepEqual(await original.json(), { receipt: receipt() });
  assert.deepEqual(
    calls.map((c) => c.init.method),
    ['POST', 'GET'],
  );
  for (const c of calls) {
    assert.ok(c.url.startsWith(env.STAFF_PREVIEW_API_ORIGIN + '/v2/staff/invitation-issues/'));
    assert.ok(!c.url.includes(secret));
    assert.equal(c.init.credentials, 'omit');
    assert.equal(
      new Headers(c.init.headers).get('authorization'),
      'Bearer ' + env.STAFF_PREVIEW_TOKEN,
    );
  }
});

test('invalid successful BFF disclosure stays uncertain and cached browser transport is refused after one POST', async () => {
  const broken = await boundary(req(), id(4), id(5), false, env, async () =>
    response({ ...disclosure(null), extra: 'private' }),
  );
  assert.equal(broken.status, 502);
  assert.equal((await broken.json()).submissionUncertain, true);
  let calls = 0;
  const client = createStaffDirectoryClient({ instanceId: id(1) }, async () => {
    calls++;
    return Response.json({ disclosure: disclosure(randomBytes(32).toString('base64url')) });
  });
  await assert.rejects(
    () => client.issueInvitation(command()),
    (e) => e.submissionUncertain === true,
  );
  assert.equal(calls, 1);
});

test('retained issuance persists metadata only, reveals once and blocks clearing until explicit secret disposal', async () => {
  const secret = randomBytes(32).toString('base64url'),
    storage = store(),
    client = { issueInvitation: async () => disclosure(secret) };
  const c = createStaffWriteController({ scope, store: storage, client });
  c.prepare('issuance', command());
  const resolved = await c.submit();
  assert.equal(resolved.phase, 'resolved');
  assert.equal(c.snapshot().secretAvailable, true);
  assert.equal(c.snapshot().canNavigate, false);
  assert.throws(() => c.clear());
  for (const text of [
    ...storage.values.values(),
    JSON.stringify(c.snapshot()),
    serializeStaffWrite(resolved),
  ]) {
    assert.ok(!text.includes(secret));
    assert.ok(!text.includes('"secret":'));
  }
  assert.equal(c.takeSecretOnce(), secret);
  assert.throws(() => c.takeSecretOnce());
  assert.equal(c.snapshot().secretAvailable, false);
  const restored = restoreStaffWrite(serializeStaffWrite(resolved), scope);
  assert.equal(restored.phase, 'uncertain');
  assert.equal(restored.receipt, null);
  c.clear();
  assert.equal(storage.values.size, 0);
  const d = createStaffWriteController({ scope, store: store(), client });
  d.prepare('issuance', command());
  await d.submit();
  d.discardSecret();
  assert.throws(() => d.takeSecretOnce());
  d.clear();
});

test('lost disclosure survives reload as the same uncertain operation and recovery never invokes another write', async () => {
  const storage = store(),
    methods = [];
  const client = {
    issueInvitation: async () => {
      methods.push('POST');
      throw Error('lost');
    },
    getInvitationIssue: async () => {
      methods.push('GET');
      return receipt();
    },
  };
  const first = createStaffWriteController({ scope, store: storage, client });
  first.prepare('issuance', command());
  await assert.rejects(() => first.submit());
  assert.equal(first.snapshot().attempt.phase, 'uncertain');
  assert.throws(() => first.clear());
  first.close();
  const resumed = createStaffWriteController({ scope, store: storage, client });
  assert.equal(resumed.snapshot().attempt.command.operationId, id(5));
  await resumed.recover();
  assert.deepEqual(methods, ['POST', 'GET']);
  assert.equal(resumed.snapshot().attempt.phase, 'resolved');
  assert.equal(resumed.snapshot().secretAvailable, false);
  assert.throws(() => resumed.takeSecretOnce());
  assert.throws(() =>
    restoreStaffWrite([...storage.values.values()][0], { ...scope, actorId: id(9) }),
  );
});

test('storage failure after committed disclosure and access loss while pending never expose or persist raw material', async () => {
  const secret = randomBytes(32).toString('base64url'),
    storage = store();
  storage.failAt = 3;
  const c = createStaffWriteController({
    scope,
    store: storage,
    client: { issueInvitation: async () => disclosure(secret) },
  });
  c.prepare('issuance', command());
  await assert.rejects(() => c.submit());
  assert.equal(c.snapshot().blocked, true);
  assert.equal(c.snapshot().secretAvailable, false);
  assert.ok(![...storage.values.values()].join('').includes(secret));
  assert.throws(() => c.takeSecretOnce());
  let finish;
  const late = new Promise((resolve) => (finish = resolve)),
    d = createStaffWriteController({
      scope,
      store: store(),
      client: { issueInvitation: () => late },
    });
  d.prepare('issuance', command());
  const pending = d.submit();
  await Promise.resolve();
  d.close();
  finish(disclosure(secret));
  await assert.rejects(() => pending);
  assert.equal(d.snapshot().secretAvailable, false);
  assert.throws(() => d.takeSecretOnce());
});

test('mismatched successful actor facts cannot resolve an issuance or reveal its secret', async () => {
  const secret = randomBytes(32).toString('base64url'),
    c = createStaffWriteController({
      scope,
      store: store(),
      client: {
        issueInvitation: async () => ({
          ...disclosure(secret),
          record: { ...receipt(), actorId: id(9) },
        }),
      },
    });
  c.prepare('issuance', command());
  await assert.rejects(() => c.submit());
  assert.equal(c.snapshot().attempt.phase, 'uncertain');
  assert.equal(c.snapshot().secretAvailable, false);
  assert.throws(() => c.takeSecretOnce());
});
