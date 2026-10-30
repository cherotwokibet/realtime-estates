import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cmd = () => ({
  policy: 'staff-branch-command-v1',
  operationId: id(1),
  branchId: id(2),
  expectedVersion: '0',
  name: 'Synthetic branch',
  active: true,
  reason: 'Synthetic creation.',
});
const saved = () => ({
  ...cmd(),
  policy: 'staff-branch-record-v1',
  actorId: id(3),
  version: '1',
  outcome: 'applied',
  recordedAt: '2026-10-30T06:00:00.000Z',
});
const current = () => ({
  policy: 'staff-branch-current-v1',
  branchId: id(2),
  version: '1',
  name: 'Synthetic branch',
  active: true,
  recordedAt: '2026-10-30T06:00:00.000Z',
});
const api = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch,
  });
const auth = { bearerToken: 'synthetic-admin' };
test('branch SDK snapshots original command/credentials and separates exact save from original/current GET', async () => {
  const calls = [],
    command = cmd(),
    options = { ...auth };
  const client = api(async (url, init) => {
    calls.push({ url, init });
    command.name = 'Changed';
    options.bearerToken = 'changed';
    return Response.json(url.endsWith('/' + id(2)) ? current() : saved());
  });
  const r = await client.saveStaffBranch(command, options);
  assert.equal(r.name, 'Synthetic branch');
  assert.equal(JSON.parse(calls[0].init.body).name, 'Synthetic branch');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic-admin');
  assert.deepEqual(await client.getStaffBranchOperation(id(1), auth), saved());
  assert.deepEqual(await client.getStaffBranch(id(2), auth), current());
  assert.deepEqual(
    calls.map((x) => x.init.method),
    ['POST', 'GET', 'GET'],
  );
});
test('lost/malformed/wrong original branch write stays uncertain with one dispatch and no automatic retry', async () => {
  for (const transport of [
    async () => {
      throw Error('Synthetic lost reply');
    },
    async () => Response.json({ ...saved(), name: 'Wrong' }),
    async () => Response.json(saved(), { status: 202 }),
    async () => new Response(' '.repeat(8193), { headers: { 'content-type': 'application/json' } }),
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        api(async (...args) => {
          calls++;
          return transport(...args);
        }).saveStaffBranch(cmd(), auth),
      (e) => e.submissionUncertain === true,
    );
    assert.equal(calls, 1);
  }
  const client = api(async () => Response.json({ ...saved(), operationId: id(4) }));
  await assert.rejects(
    () => client.getStaffBranchOperation(id(1), auth),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
});
test('invalid branch authority/version never dispatches and current projection refuses private or wrong-target facts', async () => {
  let calls = 0;
  const client = api(async () => {
    calls++;
    return Response.json(current());
  });
  for (const patch of [
    { actorId: id(3) },
    { expectedVersion: '-1' },
    { expectedVersion: '9007199254740991' },
  ])
    await assert.rejects(
      () => client.saveStaffBranch({ ...cmd(), ...patch }, auth),
      (e) => e.kind === 'VALIDATION',
    );
  assert.equal(calls, 0);
  for (const patch of [{ branchId: id(5) }, { actorId: id(3) }, { reason: 'private' }])
    await assert.rejects(
      () => api(async () => Response.json({ ...current(), ...patch })).getStaffBranch(id(2), auth),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
});
