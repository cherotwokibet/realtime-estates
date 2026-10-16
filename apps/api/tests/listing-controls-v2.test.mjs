import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  A = id(2),
  L = id(3),
  O = id(4);
const body = (publication = false) => ({
  expectedListingVersion: '3',
  ...(publication ? { publicationStatus: 'archived' } : { availability: 'sold' }),
});
const original = (publication = false) => ({
  listingId: L,
  operationId: O,
  actorId: A,
  kind: publication ? 'set_publication' : 'confirm_availability',
  request: body(publication),
  decision: { outcome: 'applied', reason: null, result: { listingVersion: '4' } },
  completedAt: '2026-10-16T17:00:00.123456Z',
});
function fixture({
  publication = false,
  receipt = original(publication),
  role = 'agent',
  error,
} = {}) {
  const calls = [],
    contexts = [];
  let commits = 0;
  const service = createApiService({
    tenantId: T,
    privacyNoticeVersion: 'synthetic-v1',
    verifyAuthorization: async (r) => {
      if (r.headers.get('authorization') !== 'Bearer synthetic') throw Error('PRIVATE');
      return { actorId: A };
    },
    database: {
      async transaction(context, work) {
        contexts.push(context);
        const r = await work({
          async query(sql, args) {
            calls.push({ sql, args });
            if (sql.includes('staff_role')) return { rows: [{ role }] };
            if (error) throw error;
            return { rows: [{ receipt }] };
          },
        });
        commits++;
        return r;
      },
    },
  });
  return {
    service,
    calls,
    contexts,
    get commits() {
      return commits;
    },
  };
}
function req({
  publication = false,
  method = 'GET',
  value,
  raw,
  suffix = '',
  headers = {},
  auth = true,
} = {}) {
  return new Request(
    `https://synthetic.invalid/v2/staff/listings/${L}/${publication ? 'publication' : 'availability'}-operations/${O}${suffix}`,
    {
      method,
      headers: {
        ...(auth ? { authorization: 'Bearer synthetic' } : {}),
        ...(value !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(value !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(value) } : {}),
    },
  );
}
test('both controls bind fixed kind and exact typed SQL to verified context; original GET performs no write', async () => {
  for (const publication of [false, true]) {
    const f = fixture({ publication });
    const r = await f.service(req({ publication, method: 'POST', value: body(publication) }));
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), original(publication));
    assert.deepEqual(f.calls.at(-1).args, [
      L,
      O,
      publication ? 'set_publication' : 'confirm_availability',
      '3',
      publication ? 'archived' : 'sold',
    ]);
    assert.equal(f.contexts[0].tenantId, T);
    assert.equal(f.contexts[0].actorId, A);
    assert.equal(f.commits, 1);
    assert.equal(r.headers.get('cache-control'), 'no-store');
    const g = fixture({ publication });
    assert.equal((await g.service(req({ publication }))).status, 200);
    assert.ok(g.calls.at(-1).sql.includes('read_listing_control'));
    assert.equal(
      g.calls.some((c) => c.sql.includes('app_api.control_listing(')),
      false,
    );
  }
});
test('control routes reject caller context, extra kind/clock, duplicate JSON, malformed versions and headers before storage', async () => {
  const f = fixture();
  for (const value of [
    { ...body(), kind: 'set_publication' },
    { ...body(), actorId: A },
    { ...body(), tenantId: T },
    { ...body(), completedAt: '2026-10-16T17:00:00.000Z' },
    { ...body(), expectedListingVersion: '01' },
    { ...body(), availability: 'invalid' },
  ])
    assert.equal((await f.service(req({ method: 'POST', value }))).status, 400);
  assert.equal(
    (
      await f.service(
        req({
          method: 'POST',
          raw: '{"expectedListingVersion":"3","availability":"sold","availability":"available"}',
        }),
      )
    ).status,
    400,
  );
  for (const suffix of ['?', '?tenantId=' + T, '#x'])
    assert.equal((await f.service(req({ suffix }))).status, 400);
  for (const headers of [
    { 'x-role': 'admin' },
    { cookie: 'x=1' },
    { 'if-match': '3' },
    { 'content-length': '01' },
    { 'idempotency-key': O },
  ])
    assert.equal((await f.service(req({ method: 'POST', value: body(), headers }))).status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.service(req({ method: 'DELETE' }))).status, 405);
});
test('altered original kind actor operation target and next version fail inside transaction for writes and reads', async () => {
  for (const mutate of [
    (r) => (r.actorId = id(9)),
    (r) => (r.operationId = id(9)),
    (r) => (r.kind = 'set_publication'),
    (r) => (r.decision.result.listingVersion = '5'),
    (r) => (r.request.expectedListingVersion = '2'),
  ]) {
    const receipt = original();
    mutate(receipt);
    const f = fixture({ receipt });
    assert.equal((await f.service(req({ method: 'POST', value: body() }))).status, 503);
    assert.equal(f.commits, 0);
  }
  const f = fixture({ receipt: original(true) });
  assert.equal((await f.service(req())).status, 503);
  assert.equal(f.commits, 0);
});
test('controls require verified staff; SQL current-access denial and operation conflict remain generic', async () => {
  assert.equal((await fixture().service(req({ auth: false }))).status, 401);
  assert.equal((await fixture({ role: 'customer' }).service(req())).status, 403);
  for (const [code, status] of [
    ['P0002', 404],
    ['42501', 403],
    ['40001', 409],
  ]) {
    const f = fixture({ error: Object.assign(Error('PRIVATE'), { code }) });
    const r = await f.service(req({ method: 'POST', value: body() }));
    assert.equal(r.status, status);
    assert.ok(!(await r.text()).includes('PRIVATE'));
    assert.equal(f.commits, 0);
  }
});
