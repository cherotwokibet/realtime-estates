import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const window = {
  fromAt: '2026-10-27T21:00:00.000Z',
  untilAt: '2026-11-03T21:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
const path =
  '/v2/staff/viewings/calendar?fromAt=' +
  encodeURIComponent(window.fromAt) +
  '&untilAt=' +
  encodeURIComponent(window.untilAt);
function setup(role = 'agent', bad = false) {
  const contexts = [],
    sql = [];
  const handler = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic-calendar-v1',
    verifyAuthorization: async () => ({ actorId: id(11) }),
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
                  calendar: {
                    policy: 'staff-viewing-calendar-v1',
                    asOf: '2026-10-28T09:00:00.000Z',
                    window,
                    scheduled: { items: [], limit: 100, hasMore: false },
                    unscheduled: { items: [], limit: 25, hasMore: false },
                    ...(bad ? { privateNotes: 'must not escape' } : {}),
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
const request = (selected = path, options = {}) =>
  new Request('https://synthetic.invalid' + selected, {
    headers: { authorization: 'Bearer synthetic' },
    ...options,
  });
test('calendar API binds verified actor and configured company to one parameterized bounded read', async () => {
  for (const role of ['admin', 'agent']) {
    const { handler, contexts, sql } = setup(role);
    const response = await handler(request());
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const page = await response.json();
    assert.equal(page.scheduled.limit, 100);
    assert.equal(contexts[0].tenantId, id(1));
    assert.equal(contexts[0].actorId, id(11));
    assert.deepEqual(sql.find((row) => row.statement.includes('read_viewing_calendar(')).values, [
      window.fromAt,
      window.untilAt,
    ]);
    assert.equal(sql.filter((row) => row.statement.includes('read_viewing_calendar(')).length, 1);
  }
});
test('calendar API refuses caller authority, ambiguous windows and writes before calendar SQL', async () => {
  for (const [selected, options, status] of [
    [path + '&role=admin', {}, 400],
    [path + '&fromAt=' + encodeURIComponent(window.fromAt), {}, 400],
    [path.replace('fromAt=', '%66romAt='), {}, 400],
    [path.replace(encodeURIComponent(window.untilAt), '2026-12-01T21%3A00%3A00.000Z'), {}, 400],
    ['/v2/staff/viewings/calendar?', {}, 400],
    [path + '#fragment', {}, 400],
    [path, { headers: { authorization: 'Bearer synthetic', 'x-company-id': id(2) } }, 400],
    [path, { headers: { authorization: 'Bearer synthetic', cookie: 'private=1' } }, 400],
    [path, { method: 'POST', body: '{}' }, 405],
  ]) {
    const { handler, sql, contexts } = setup();
    assert.equal((await handler(request(selected, options))).status, status);
    assert.equal(sql.length, 0);
    assert.equal(contexts.length, 0);
  }
  for (const role of ['customer', null]) {
    const { handler, sql } = setup(role);
    assert.equal((await handler(request())).status, 403);
    assert.equal(sql.length, 1);
  }
});
test('calendar API sanitizes invalid private projections rather than returning extra stored fields', async () => {
  const { handler } = setup('admin', true);
  const response = await handler(request());
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('must not escape'));
});
