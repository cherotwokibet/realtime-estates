import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const window = {
  fromAt: '2026-10-27T21:00:00.000Z',
  untilAt: '2026-11-03T21:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
const page = () => ({
  policy: 'staff-viewing-calendar-v1',
  asOf: '2026-10-28T09:00:00.000Z',
  window: { ...window },
  scheduled: { items: [], limit: 100, hasMore: false },
  unscheduled: { items: [], limit: 25, hasMore: false },
});
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic-calendar-v1',
    fetch,
  });
test('calendar SDK detaches one strict window and credential set before its single private read', async () => {
  let seen,
    calls = 0;
  const api = client(async (url, init) => {
    seen = { url, init };
    calls++;
    return Response.json(page());
  });
  const input = { ...window },
    options = { bearerToken: 'original-token' },
    work = api.getStaffViewingCalendar(input, options);
  input.untilAt = 'changed';
  options.bearerToken = 'changed';
  const result = await work;
  assert.equal(calls, 1);
  assert.equal(
    seen.url,
    'https://synthetic.invalid/v2/staff/viewings/calendar?fromAt=2026-10-27T21%3A00%3A00.000Z&untilAt=2026-11-03T21%3A00%3A00.000Z',
  );
  assert.equal(seen.init.body, undefined);
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.cache, 'no-store');
  assert.equal(new Headers(seen.init.headers).get('authorization'), 'Bearer original-token');
  assert.ok(Object.isFrozen(result));
});
test('calendar SDK rejects caller authority, getters and invalid ranges before network access', async () => {
  let calls = 0,
    getters = 0;
  const api = client(async () => {
    calls++;
    return Response.json(page());
  });
  const accessor = { ...window };
  Object.defineProperty(accessor, 'fromAt', {
    enumerable: true,
    get() {
      getters++;
      return window.fromAt;
    },
  });
  for (const [range, options] of [
    [{ ...window, tenantId: 'foreign' }, { bearerToken: 'token' }],
    [accessor, { bearerToken: 'token' }],
    [{ ...window, untilAt: window.fromAt }, { bearerToken: 'token' }],
    [window, { bearerToken: 'token', role: 'admin' }],
  ])
    await assert.rejects(
      () => api.getStaffViewingCalendar(range, options),
      (error) => error.kind === 'VALIDATION',
    );
  assert.equal(calls, 0);
  assert.equal(getters, 0);
});
test('calendar SDK refuses mismatched windows and private projections without retry or write uncertainty', async () => {
  for (const mutate of [
    (p) => (p.window.untilAt = '2026-11-04T21:00:00.000Z'),
    (p) => (p.email = 'private@example.invalid'),
  ]) {
    let calls = 0;
    const api = client(async () => {
      calls++;
      const data = page();
      mutate(data);
      return Response.json(data);
    });
    await assert.rejects(
      () => api.getStaffViewingCalendar(window, { bearerToken: 'token' }),
      (error) => error.kind === 'INVALID_RESPONSE' && error.submissionUncertain !== true,
    );
    assert.equal(calls, 1);
  }
});
