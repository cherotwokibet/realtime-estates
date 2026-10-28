import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
function setup(role = 'admin', bad = false) {
  const contexts = [],
    sql = [];
  const handler = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic-overview-v1',
    verifyAuthorization: async () => ({ actorId: id(10) }),
    database: {
      transaction: async (context, run) => {
        contexts.push(context);
        return run({
          query: async (statement, values) => {
            sql.push({ statement, values });
            if (statement.includes('staff_role()')) return { rows: [{ role }] };
            if (statement.startsWith('SET LOCAL')) return { rows: [] };
            return {
              rows: [
                {
                  overview: {
                    policy: 'staff-operations-overview-v1',
                    limit: 10,
                    freshnessDays: 30,
                    asOf: '2026-10-28T08:00:00.000Z',
                    staleStock: { items: [], hasMore: false },
                    pendingReviews: { items: [], hasMore: false },
                    overdueEnquiries: { items: [], hasMore: false },
                    viewingOutcomes: { items: [], hasMore: false },
                    ...(bad
                      ? {
                          overdueEnquiries: {
                            hasMore: false,
                            items: [
                              {
                                enquiryId: id(3),
                                name: 'Synthetic',
                                nextActionAt: '2026-10-29T00:00:00.000Z',
                              },
                            ],
                          },
                        }
                      : {}),
                  },
                },
              ],
            };
          },
        });
      },
    },
  });
  return { handler, contexts, sql };
}
const request = (suffix = '', options = {}) =>
  new Request('https://synthetic.invalid/v2/staff/operations/overview' + suffix, {
    headers: { authorization: 'Bearer synthetic' },
    ...options,
  });
test('overview binds configured tenant and current admin, returns no private fields and uses one bounded SQL snapshot', async () => {
  const { handler, contexts, sql } = setup();
  const response = await handler(request());
  assert.equal(response.status, 200);
  const value = await response.json();
  assert.equal(value.policy, 'staff-operations-overview-v1');
  assert.equal(value.limit, 10);
  assert.deepEqual(value.overdueEnquiries, { items: [], hasMore: false });
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.equal(contexts[0].tenantId, id(1));
  assert.equal(contexts[0].actorId, id(10));
  const query = sql.find((x) => x.statement.includes('read_operations_overview()'));
  assert.equal(query.values, undefined);
  assert.equal(sql.filter((x) => x.statement.includes('read_operations_overview()')).length, 1);
});
test('overview rejects agents/customers/revoked memberships before summary SQL and denies caller authority/query/write forms', async () => {
  for (const role of ['agent', 'customer', null]) {
    const { handler, sql } = setup(role);
    assert.equal((await handler(request())).status, 403);
    assert.equal(sql.length, 1);
  }
  for (const [suffix, options, status] of [
    ['?limit=10', {}, 400],
    ['?tenantId=' + id(2), {}, 400],
    ['#fragment', {}, 400],
    ['', { headers: { authorization: 'Bearer synthetic', 'x-company-id': id(2) } }, 400],
    ['', { headers: { authorization: 'Bearer synthetic', cookie: 'private=1' } }, 400],
    ['', { method: 'POST', body: '{}' }, 405],
  ]) {
    const { handler, contexts } = setup();
    assert.equal((await handler(request(suffix, options))).status, status);
    assert.equal(contexts.length, 0);
  }
});
test('malformed or impossible summary data fails closed with a sanitized response', async () => {
  const { handler } = setup('admin', true);
  const response = await handler(request());
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.ok(!text.includes('2026-10-29'));
  assert.ok(!text.includes('nextActionAt'));
});
