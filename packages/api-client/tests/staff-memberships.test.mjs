import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const command = () => ({
  policy: 'staff-membership-command-v1',
  operationId: id(1),
  memberId: id(2),
  expectedVersion: '1',
  requestedRole: 'agent',
  active: false,
  reason: 'Synthetic access removal.',
});
const original = () => ({
  ...command(),
  policy: 'staff-membership-record-v1',
  actorId: id(3),
  version: '2',
  outcome: 'applied',
  recordedAt: '2026-11-02T08:00:00.000Z',
});
const current = () => ({
  policy: 'staff-membership-current-v1',
  memberId: id(2),
  role: 'agent',
  active: false,
  version: '2',
  revokedAt: '2026-11-02T08:00:00.000Z',
});
const auth = { bearerToken: 'synthetic-membership-admin' };
const api = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch,
  });

test('membership SDK snapshots exact command and private options before dispatch; originals/current use GET only', async () => {
  const calls = [],
    input = command(),
    options = { ...auth };
  const client = api(async (url, init) => {
    calls.push({ url, init });
    input.requestedRole = 'admin';
    input.active = true;
    input.reason = 'Changed after dispatch.';
    options.bearerToken = 'changed';
    return Response.json(url.endsWith('/' + id(2)) ? current() : original());
  });
  const saved = await client.saveStaffMembership(input, options);
  assert.deepEqual(saved, original());
  assert.equal(Object.isFrozen(saved), true);
  assert.deepEqual(JSON.parse(calls[0].init.body), command());
  assert.equal(
    new Headers(calls[0].init.headers).get('authorization'),
    'Bearer ' + auth.bearerToken,
  );
  assert.deepEqual(await client.getStaffMembershipOperation(id(1), auth), original());
  assert.deepEqual(await client.getStaffMembership(id(2), auth), current());
  assert.deepEqual(
    calls.map(({ url, init }) => [new URL(url).pathname, init.method]),
    [
      ['/v2/staff/memberships/operations/' + id(1), 'POST'],
      ['/v2/staff/memberships/operations/' + id(1), 'GET'],
      ['/v2/staff/memberships/' + id(2), 'GET'],
    ],
  );
  for (const { init } of calls) {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    if (init.method === 'GET') assert.equal(init.body, undefined);
  }
});

test('invalid membership facts and caller authority/accessors fail without invoking transport', async () => {
  let calls = 0,
    reads = 0;
  const client = api(async () => {
    calls++;
    return Response.json(original());
  });
  for (const patch of [
    { tenantId: id(7) },
    { actorId: id(3) },
    { branchId: id(8) },
    { expectedVersion: '0' },
    { expectedVersion: '01' },
    { expectedVersion: '9007199254740991' },
    { requestedRole: 'owner' },
    { active: 'false' },
    { reason: '' },
  ])
    await assert.rejects(
      () => client.saveStaffMembership({ ...command(), ...patch }, auth),
      (error) => error.kind === 'VALIDATION' && !error.submissionUncertain,
    );
  const accessorCommand = command();
  Object.defineProperty(accessorCommand, 'reason', {
    enumerable: true,
    get() {
      reads++;
      return 'Synthetic getter.';
    },
  });
  const accessorOptions = {
    get bearerToken() {
      reads++;
      return auth.bearerToken;
    },
  };
  for (const [input, options] of [
    [accessorCommand, auth],
    [command(), accessorOptions],
    [command(), { ...auth, tenantId: id(9) }],
  ])
    await assert.rejects(
      () => client.saveStaffMembership(input, options),
      (error) => error.kind === 'VALIDATION',
    );
  await assert.rejects(
    () => client.getStaffMembershipOperation('not-a-uuid', auth),
    (error) => error.kind === 'VALIDATION',
  );
  await assert.rejects(
    () => client.getStaffMembership('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', auth),
    (error) => error.kind === 'VALIDATION',
  );
  assert.equal(calls, 0);
  assert.equal(reads, 0);
});

test('lost, malformed, duplicate, oversized, framed and wrong-status membership writes remain uncertain without retry', async () => {
  const json = (value, options) => Response.json(value, options);
  for (const transport of [
    async () => {
      throw Error('Synthetic lost response.');
    },
    async () => json({ ...original(), requestedRole: 'admin' }),
    async () => json({ ...original(), memberId: id(9) }),
    async () => json({ ...original(), expectedVersion: '2', version: '3' }),
    async () => json({ ...original(), version: '3' }),
    async () => json(original(), { status: 202 }),
    async () =>
      new Response(
        JSON.stringify(original()).replace('"policy":', '"\\u0070olicy":"bad","policy":'),
        {
          headers: { 'content-type': 'application/json' },
        },
      ),
    async () => new Response(' '.repeat(8193), { headers: { 'content-type': 'application/json' } }),
    async () => json(original(), { headers: { 'content-encoding': 'gzip' } }),
    async () => json(original(), { headers: { 'content-range': 'bytes 0-1/2' } }),
    async () => json(original(), { headers: { 'content-length': '1' } }),
    async () =>
      new Response('Synthetic redirect', { status: 302, headers: { location: '/elsewhere' } }),
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        api(async (...args) => {
          calls++;
          return transport(...args);
        }).saveStaffMembership(command(), auth),
      (error) => error.submissionUncertain === true,
    );
    assert.equal(calls, 1);
  }
});

test('membership original/current binding rejects wrong identity, unsupported role and inconsistent private projection', async () => {
  for (const patch of [
    { operationId: id(9) },
    { requestedRole: 'owner' },
    { actorId: id(2) },
    { outcome: 'unchanged' },
  ]) {
    const calls = [];
    const client = api(async (_url, init) => {
      calls.push(init.method);
      return Response.json({ ...original(), ...patch });
    });
    await assert.rejects(
      () => client.getStaffMembershipOperation(id(1), auth),
      (error) => error.kind === 'INVALID_RESPONSE' && !error.submissionUncertain,
    );
    assert.deepEqual(calls, ['GET']);
  }
  for (const patch of [
    { memberId: id(9) },
    { role: 'owner' },
    { version: '0' },
    { active: true },
    { revokedAt: null },
    { actorId: id(3) },
    { reason: 'Private original.' },
  ]) {
    const calls = [];
    await assert.rejects(
      () =>
        api(async (_url, init) => {
          calls.push(init.method);
          return Response.json({ ...current(), ...patch });
        }).getStaffMembership(id(2), auth),
      (error) => error.kind === 'INVALID_RESPONSE' && !error.submissionUncertain,
    );
    assert.deepEqual(calls, ['GET']);
  }
});

test('membership terminal no-op/conflict receipts and active projection preserve exact safe versions', async () => {
  for (const value of [
    { ...original(), outcome: 'unchanged', version: '1' },
    { ...original(), outcome: 'conflict', version: '5' },
  ])
    assert.deepEqual(
      await api(async () => Response.json(value)).saveStaffMembership(command(), auth),
      value,
    );
  const active = { ...current(), active: true, revokedAt: null };
  assert.deepEqual(
    await api(async () => Response.json(active)).getStaffMembership(id(2), auth),
    active,
  );
});

test('membership errors retain proven rejection versus uncertain failure and pre-aborted requests never dispatch', async () => {
  const requestId = id(44);
  for (const [status, code, uncertain] of [
    [403, 'FORBIDDEN', false],
    [409, 'CONFLICT', false],
    [503, 'SERVICE_UNAVAILABLE', true],
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        api(async () => {
          calls++;
          return Response.json(
            { error: { code, message: 'Synthetic membership rejection.' }, requestId },
            { status, headers: { 'x-request-id': requestId } },
          );
        }).saveStaffMembership(command(), auth),
      (error) =>
        error.kind === 'HTTP' &&
        error.status === status &&
        !!error.submissionUncertain === uncertain,
    );
    assert.equal(calls, 1);
  }
  const aborted = new AbortController();
  aborted.abort();
  let calls = 0;
  await assert.rejects(
    () =>
      api(async () => {
        calls++;
        return Response.json(original());
      }).saveStaffMembership(command(), { ...auth, signal: aborted.signal }),
    (error) => error.kind === 'CANCELLED' && !error.submissionUncertain,
  );
  assert.equal(calls, 0);
});
