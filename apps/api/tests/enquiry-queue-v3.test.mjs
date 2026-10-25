import test from 'node:test';
import assert from 'node:assert/strict';
import { staffEnquiryQueueQuery } from '../dist/enquiry-queue.js';
import { createApiService } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-25T12:00:00.000Z';
const summary = (n) => ({
  id: id(n),
  listingId: null,
  contactedRevision: null,
  name: 'Synthetic queue prospect',
  origin: 'web',
  status: 'new',
  assignedAgentId: null,
  nextActionAt: null,
  version: '1',
  createdAt: NOW,
  updatedAt: NOW,
});
function fixture({
  role = 'admin',
  snapshot = { anchorVisible: true, asOf: NOW, items: [summary(100), summary(101), summary(102)] },
} = {}) {
  const calls = [],
    contexts = [];
  const service = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic-notice',
    verifyAuthorization: async (request) => {
      if (request.headers.get('authorization') !== 'Bearer synthetic-staff')
        throw Error('Private auth diagnostic');
      return { actorId: id(10) };
    },
    database: {
      async transaction(context, work) {
        contexts.push(context);
        return work({
          async query(sql, args = []) {
            calls.push({ sql, args });
            if (sql.includes('staff_role')) return { rows: [{ role }] };
            if (sql.startsWith('SET LOCAL')) return { rows: [] };
            return { rows: [snapshot] };
          },
        });
      },
    },
  });
  return { service, calls, contexts };
}
const request = (query = '', options = {}) =>
  new Request('https://queue.example.invalid/v3/staff/enquiries' + query, {
    headers: { Authorization: 'Bearer synthetic-staff', ...options.headers },
    ...(options.method ? { method: options.method } : {}),
  });

test('v3 enquiry queue parser defaults and exact supported selections are bounded and immutable', () => {
  assert.deepEqual(staffEnquiryQueueQuery(new URLSearchParams()), {
    limit: 50,
    filter: 'all',
    after: null,
  });
  for (const filter of ['all', 'open', 'overdue', 'today']) {
    const selected = staffEnquiryQueueQuery(
      new URLSearchParams({ limit: '100', filter, after: id(100) }),
    );
    assert.deepEqual(selected, { limit: 100, filter, after: id(100) });
    assert.ok(Object.isFrozen(selected));
  }
});
test('v3 enquiry queue parser refuses duplicates, blanks, costly pages and caller context', () => {
  for (const query of [
    'limit=',
    'limit=0',
    'limit=101',
    'limit=01',
    'limit=1e1',
    'limit=1&limit=1',
    'filter=',
    'filter=Open',
    'filter=%20open',
    'filter=open%20',
    'filter=closed',
    'filter=all&filter=all',
    'after=',
    'after=invalid',
    'after=' + id(100) + '&after=' + id(100),
    'after=00000000-0000-4000-800A-000000000100',
    'tenantId=' + id(2),
    'actorId=' + id(2),
    'offset=50',
    'sort=created_at',
    'filter=' + 'x'.repeat(8200),
  ])
    assert.throws(
      () => staffEnquiryQueueQuery(new URLSearchParams(query)),
      /supported enquiry queue/,
    );
});
test('v3 enquiry queue uses current staff context, one fixed keyset snapshot, and no private summary fields', async () => {
  const f = fixture(),
    res = await f.service(request('?limit=2&filter=all&after=' + id(99)));
  assert.equal(res.status, 200);
  const page = await res.json();
  assert.deepEqual(page, {
    policy: 'staff-enquiry-queue-v3',
    items: [summary(100), summary(101)],
    limit: 2,
    filter: 'all',
    after: id(99),
    hasMore: true,
    nextAfter: id(101),
    asOf: NOW,
    timeZone: 'Africa/Nairobi',
  });
  assert.equal(f.contexts[0].tenantId, id(1));
  assert.equal(f.contexts[0].actorId, id(10));
  const data = f.calls.filter(({ sql }) => sql.includes('WITH clock AS MATERIALIZED'));
  assert.equal(data.length, 1);
  assert.deepEqual(data[0].args, [id(1), id(99), 'all', 3]);
  assert.match(
    data[0].sql,
    /e\.created_at<a\.created_at OR \(e\.created_at=a\.created_at AND e\.id>a\.id\)/,
  );
  assert.match(data[0].sql, /ORDER BY e\.created_at DESC,e\.id ASC/);
  assert.match(data[0].sql, /date_trunc\('milliseconds',statement_timestamp\(\)\)/);
  assert.match(data[0].sql, /Africa\/Nairobi/);
  assert.ok(f.calls.some(({ sql }) => sql === "SET LOCAL statement_timeout = '2s'"));
  assert.equal(Object.hasOwn(page, 'total'), false);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(
    (
      await f.service(
        new Request('https://queue.example.invalid/v3/staff/reference-session', {
          headers: { Authorization: 'Bearer synthetic-staff' },
        }),
      )
    ).status,
    404,
  );
});
test('v3 enquiry queue refuses invalid context before data access and does not widen an invisible cursor', async () => {
  for (const query of [
    '?filter=',
    '?limit=101',
    '?after=bad',
    '?tenantId=' + id(2),
    '?filter=all&filter=all',
  ]) {
    const f = fixture();
    assert.equal((await f.service(request(query))).status, 400);
    assert.equal(f.contexts.length, 0);
  }
  for (const headers of [
    { cookie: 'session=x' },
    { 'x-tenant-id': id(2) },
    { 'if-none-match': '*' },
    { 'content-type': 'application/json' },
  ]) {
    const f = fixture();
    assert.equal((await f.service(request('', { headers }))).status, 400);
    assert.equal(f.contexts.length, 0);
  }
  assert.equal((await fixture().service(request('', { method: 'POST' }))).status, 405);
  assert.equal(
    (await fixture().service(request('', { headers: { Authorization: '' } }))).status,
    401,
  );
  assert.equal((await fixture({ role: 'customer' }).service(request())).status, 403);
  const missing = fixture({ snapshot: { anchorVisible: false, asOf: NOW, items: [] } });
  assert.equal((await missing.service(request('?after=' + id(99)))).status, 404);
  const empty = fixture({ snapshot: { anchorVisible: true, asOf: NOW, items: [] } });
  assert.deepEqual((await (await empty.service(request())).json()).items, []);
});
test('v3 enquiry queue rejects malformed SQL snapshots and repeated or anchor identities', async () => {
  for (const snapshot of [
    { anchorVisible: true, asOf: NOW, items: [summary(100), summary(100)] },
    { anchorVisible: true, asOf: NOW, items: [summary(99)] },
    { anchorVisible: true, asOf: 'bad', items: [] },
    { anchorVisible: 'true', asOf: NOW, items: [] },
    { anchorVisible: true, asOf: NOW, items: 'not rows' },
  ])
    assert.equal(
      (await fixture({ snapshot }).service(request('?limit=1&after=' + id(99)))).status,
      503,
    );
});
