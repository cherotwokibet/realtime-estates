import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  A = id(2),
  L = id(3),
  O = id(4),
  path = `/v2/staff/listings/${L}/revision-operations/${O}`;
const body = () => ({
  expectedListingVersion: '3',
  predecessor: { revision: 2, version: '4', state: 'rejected' },
  content: normalizeStaffDraftContentV2({
    title: 'Synthetic successor',
    pricing: { declaration: 'not_declared', charges: [] },
    location: { county: null, town: null, area: null },
  }),
});
const original = () => ({
  listingId: L,
  operationId: O,
  actorId: A,
  kind: 'start_revision',
  request: body(),
  decision: {
    outcome: 'applied',
    reason: null,
    result: { listingVersion: '4', revision: 3, revisionVersion: '2' },
  },
  completedAt: '2026-10-16T01:00:00.000Z',
});
function fixture({ role = 'agent', receipt = original(), error } = {}) {
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
        const result = await work({
          async query(sql, args) {
            calls.push({ sql, args });
            if (sql.includes('staff_role')) return { rows: [{ role }] };
            if (error) throw error;
            return { rows: [{ receipt }] };
          },
        });
        commits++;
        return result;
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
const req = ({ method = 'GET', value, raw, suffix = '', headers = {}, auth = true } = {}) =>
  new Request('https://synthetic.invalid' + path + suffix, {
    method,
    headers: {
      ...(auth ? { authorization: 'Bearer synthetic' } : {}),
      ...(value !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(value !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(value) } : {}),
  });
test('successor POST binds seven SQL arguments and validates original inside verified actor transaction', async () => {
  const f = fixture(),
    response = await f.service(req({ method: 'POST', value: body() }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), original());
  assert.deepEqual(f.calls.at(-1).args, [
    L,
    O,
    '3',
    2,
    '4',
    'rejected',
    JSON.stringify(body().content),
  ]);
  assert.equal(f.contexts[0].actorId, A);
  assert.equal(f.contexts[0].tenantId, T);
  assert.equal(f.commits, 1);
  assert.equal(response.headers.get('cache-control'), 'no-store');
});
test('successor original GET is route-bound read only with current verified requester', async () => {
  const f = fixture();
  assert.deepEqual(await (await f.service(req())).json(), original());
  assert.ok(f.calls.at(-1).sql.includes('read_listing_successor'));
  assert.deepEqual(f.calls.at(-1).args, [L, O]);
  assert.equal(
    f.calls.some((x) => x.sql.includes('start_listing_revision')),
    false,
  );
});
test('successor rejects caller authority, lossy or duplicate JSON and ambiguous request headers before storage', async () => {
  const f = fixture();
  for (const value of [
    { ...body(), actorId: A },
    { ...body(), expectedListingVersion: '01' },
    { ...body(), predecessor: { ...body().predecessor, state: 'draft' } },
    { ...body(), content: { ...body().content, assignedAgentId: A } },
  ])
    assert.equal((await f.service(req({ method: 'POST', value }))).status, 400);
  for (const raw of [
    JSON.stringify(body()).replace('"revision":2', '"revision":2.00000000000000001'),
    JSON.stringify(body()).replace(
      '"expectedListingVersion":',
      '"expectedListingVersion":"9","expectedListingVersion":',
    ),
    JSON.stringify(body()).replace('"amountMinor":null', '"amountMinor":1.00000000000000001'),
  ])
    assert.equal((await f.service(req({ method: 'POST', raw }))).status, 400);
  for (const suffix of ['?', '?tenantId=' + T, '#x'])
    assert.equal((await f.service(req({ suffix }))).status, 400);
  for (const headers of [
    { cookie: 'x=1' },
    { 'if-match': '3' },
    { 'idempotency-key': O },
    { 'x-actor-id': A },
    { 'content-length': '01' },
    { 'content-encoding': 'gzip' },
  ])
    assert.equal((await f.service(req({ method: 'POST', value: body(), headers }))).status, 400);
  assert.equal(f.calls.length, 0);
});
test('wrong actor, route and original allocation adapters cannot commit writes or pass GET validation', async () => {
  for (const mutate of [
    (r) => (r.actorId = id(99)),
    (r) => (r.operationId = id(99)),
    (r) => (r.request.predecessor.version = '9'),
    (r) => (r.decision.result.revisionVersion = '3'),
    (r) => (r.decision.result.revision = 4),
  ]) {
    const receipt = original();
    mutate(receipt);
    const f = fixture({ receipt });
    assert.equal((await f.service(req({ method: 'POST', value: body() }))).status, 503);
    assert.equal(f.commits, 0);
  }
  const f = fixture({ receipt: { ...original(), actorId: id(99) } });
  assert.equal((await f.service(req())).status, 503);
  assert.equal(f.commits, 0);
});
test('successor requires current staff and preserves generic SQL denial and operation conflict responses', async () => {
  assert.equal((await fixture().service(req({ auth: false }))).status, 401);
  const customer = fixture({ role: 'customer' });
  assert.equal((await customer.service(req())).status, 403);
  assert.equal(customer.calls.length, 1);
  for (const [code, status] of [
    ['P0002', 404],
    ['40001', 409],
  ]) {
    const response = await fixture({ error: Object.assign(Error('PRIVATE'), { code }) }).service(
      req({ method: 'POST', value: body() }),
    );
    assert.equal(response.status, status);
    assert.ok(!(await response.text()).includes('PRIVATE'));
  }
});
