import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branch = (n) => ({
  policy: 'staff-branch-current-v1',
  branchId: id(n),
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
test('directory SDK snapshots exact query and private credentials before I/O; performs GET only', async () => {
  const calls = [],
    q = { limit: 2, after: id(1) },
    o = { ...auth };
  const client = api(async (url, init) => {
    calls.push({ url, init });
    q.limit = 20;
    q.after = null;
    o.bearerToken = 'changed';
    return Response.json({
      policy: 'staff-branch-page-v1',
      items: [branch(2), branch(3)],
      nextAfter: id(3),
    });
  });
  const page = await client.listStaffBranches(q, o);
  assert.equal(page.nextAfter, id(3));
  assert.ok(Object.isFrozen(page.items));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://synthetic.invalid/v2/staff/branches?limit=2&after=' + id(1));
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic-admin');
  const empty = await api(async () =>
    Response.json({ policy: 'staff-invitation-page-v1', items: [], nextAfter: null }),
  ).listStaffInvitationRequests({ limit: 20, after: null }, auth);
  assert.equal(empty.items.length, 0);
});
test('invalid directory query/authority never dispatches; malformed page cannot advance requested cursor', async () => {
  let calls = 0;
  const client = api(async () => {
    calls++;
    return Response.json({ policy: 'staff-branch-page-v1', items: [], nextAfter: null });
  });
  for (const q of [
    { limit: 21, after: null },
    { limit: 1 },
    { limit: 2, after: null, tenantId: id(1) },
  ])
    await assert.rejects(
      () => client.listStaffBranches(q, auth),
      (e) => e.kind === 'VALIDATION',
    );
  assert.equal(calls, 0);
  for (const page of [
    { policy: 'staff-branch-page-v1', items: [branch(1)], nextAfter: null },
    { policy: 'staff-branch-page-v1', items: [branch(3), branch(2)], nextAfter: id(2) },
    { policy: 'staff-branch-page-v1', items: [], nextAfter: id(2) },
  ])
    await assert.rejects(
      () =>
        api(async () => Response.json(page)).listStaffBranches({ limit: 2, after: id(1) }, auth),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
});
test('directory transport requires status200 and strict JSON framing, duplicate refusal and64KiB ceiling', async () => {
  for (const response of [
    Response.json({ policy: 'staff-branch-page-v1', items: [], nextAfter: null }, { status: 202 }),
    new Response('{"policy":"staff-branch-page-v1","items":[],"nextAfter":null,"nextAfter":null}', {
      headers: { 'content-type': 'application/json' },
    }),
    new Response(' '.repeat(65537), { headers: { 'content-type': 'application/json' } }),
    Response.json(
      { policy: 'staff-branch-page-v1', items: [], nextAfter: null },
      { headers: { 'content-encoding': 'gzip' } },
    ),
  ])
    await assert.rejects(
      () => api(async () => response).listStaffBranches({ limit: 2, after: null }, auth),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
  // A valid response can exceed the8KiB single-receipt ceiling while staying within the page ceiling.
  const page = {
    policy: 'staff-branch-page-v1',
    items: Array.from({ length: 20 }, (_, i) => ({
      ...branch(i + 1),
      name: '\u{1f3e0}'.repeat(160),
    })),
    nextAfter: null,
  };
  assert.ok(new TextEncoder().encode(JSON.stringify(page)).length > 8192);
  assert.equal(
    (await api(async () => Response.json(page)).listStaffBranches({ limit: 20, after: null }, auth))
      .items.length,
    20,
  );
});
