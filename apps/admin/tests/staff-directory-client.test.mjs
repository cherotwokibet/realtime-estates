import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaffDirectoryClient } from '../dist/tests/lib/staff-directory-client.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const command = () => ({
  policy: 'staff-branch-command-v1',
  operationId: id(2),
  branchId: id(3),
  expectedVersion: '0',
  name: 'Synthetic branch',
  active: true,
  reason: 'Synthetic creation.',
});
const saved = () => ({
  ...command(),
  policy: 'staff-branch-record-v1',
  actorId: id(4),
  version: '1',
  outcome: 'applied',
  recordedAt: '2026-10-31T02:00:00.000Z',
});
test('staff browser transport snapshots instance/command and sends only current-instance headers', async () => {
  const scope = { instanceId: id(1) },
    c = command(),
    calls = [];
  const client = createStaffDirectoryClient(scope, async (url, init) => {
    calls.push({ url, init });
    c.name = 'Changed';
    return Response.json({ receipt: saved() });
  });
  scope.instanceId = id(5);
  assert.equal((await client.saveBranch(c)).name, 'Synthetic branch');
  assert.equal(calls[0].init.headers['X-Preview-Instance'], id(1));
  assert.equal(JSON.parse(calls[0].init.body).name, 'Synthetic branch');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  await client.getBranchOperation(id(2));
  assert.deepEqual(
    calls.map((x) => x.init.method),
    ['POST', 'GET'],
  );
});
test('staff browser scope/query authority and accessors never dispatch', () => {
  let calls = 0;
  const transport = async () => {
    calls++;
    throw Error();
  };
  assert.throws(() => createStaffDirectoryClient({ instanceId: id(1), actorId: id(2) }, transport));
  let getters = 0;
  const scope = {};
  Object.defineProperty(scope, 'instanceId', {
    enumerable: true,
    get() {
      getters++;
      return id(1);
    },
  });
  assert.throws(() => createStaffDirectoryClient(scope, transport));
  assert.equal(getters, 0);
  const client = createStaffDirectoryClient({ instanceId: id(1) }, transport);
  assert.throws(() => client.listBranches({ limit: 21, after: null }));
  assert.throws(() => client.saveBranch({ ...command(), tenantId: id(2) }));
  assert.equal(calls, 0);
});
test('staff browser lost/malformed/wrong-status writes remain uncertain with one dispatch', async () => {
  for (const transport of [
    async () => {
      throw Error('Lost');
    },
    async () => Response.json({ receipt: { ...saved(), name: 'Changed' } }),
    async () => Response.json({ receipt: saved() }, { status: 202 }),
    async () =>
      new Response('{"receipt":null,"receipt":null}', {
        headers: { 'content-type': 'application/json' },
      }),
    async () => Response.json({ receipt: saved() }, { headers: { 'content-encoding': 'gzip' } }),
  ]) {
    let calls = 0;
    const client = createStaffDirectoryClient({ instanceId: id(1) }, async (...args) => {
      calls++;
      return transport(...args);
    });
    await assert.rejects(
      () => client.saveBranch(command()),
      (e) => e.submissionUncertain,
    );
    assert.equal(calls, 1);
  }
});
test('staff browser pre-cancel never dispatches; interrupted read is bounded even when transport ignores signal', async () => {
  let calls = 0;
  const c = createStaffDirectoryClient({ instanceId: id(1) }, async () => {
    calls++;
    return new Promise(() => {});
  });
  const cancelled = new AbortController();
  cancelled.abort();
  await assert.rejects(
    () => c.saveBranch(command(), cancelled.signal),
    (e) => e.kind === 'CANCELLED' && !e.submissionUncertain,
  );
  assert.equal(calls, 0);
  const stop = new AbortController(),
    pending = c.listBranches({ limit: 2, after: null }, stop.signal);
  stop.abort();
  await assert.rejects(
    () => pending,
    (e) => e.kind === 'CANCELLED' && !e.submissionUncertain,
  );
  assert.equal(calls, 1);
});
