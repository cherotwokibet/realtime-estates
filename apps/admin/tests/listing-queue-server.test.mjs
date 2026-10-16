import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readStaffListingQueue,
  readStaffListingDetail,
} from '../dist/tests/lib/listing-queue-server.js';
import {
  staffListingFixture,
  staffListingId as id,
} from '../../../packages/domain/test-helpers/staff-listing-fixtures.mjs';
const env = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'synthetic.server.token',
    STAFF_PREVIEW_INSTANCE: id(1),
  },
  page = { items: [staffListingFixture()], limit: 25, truncated: false };
test('single listing server read fixes identity and target and rejects private or unconfigured responses', async () => {
  const calls = [];
  assert.deepEqual(
    await readStaffListingDetail(id(10), env, async (url, init) => {
      calls.push({ url, init });
      return Response.json(staffListingFixture());
    }),
    staffListingFixture(),
  );
  assert.equal(calls[0].url, 'http://127.0.0.1:4101/v2/staff/listings/' + id(10));
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(
    new Headers(calls[0].init.headers).get('authorization'),
    'Bearer ' + env.STAFF_PREVIEW_TOKEN,
  );
  await assert.rejects(() =>
    readStaffListingDetail(id(10), { ...env, NODE_ENV: 'production' }, async () => {
      throw Error('Unexpected dispatch');
    }),
  );
  await assert.rejects(
    () =>
      readStaffListingDetail(id(10), env, async () =>
        Response.json({ ...staffListingFixture(), privateAddress: 'PRIVATE' }),
      ),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
});
test('listing server reader sends fixed bounded GET with server credentials and returns only validated page', async () => {
  const calls = [];
  assert.deepEqual(
    await readStaffListingQueue(env, async (url, init) => {
      calls.push({ url, init });
      return Response.json(page);
    }),
    page,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:4101/v2/staff/listings?limit=25');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(
    new Headers(calls[0].init.headers).get('authorization'),
    'Bearer synthetic.server.token',
  );
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(JSON.stringify(page).includes(env.STAFF_PREVIEW_TOKEN), false);
});
test('listing server reader refuses production,missing mode and unsafe upstream before dispatch', async () => {
  let calls = 0;
  const fetch = async () => {
    calls++;
    return Response.json(page);
  };
  for (const patch of [
    { NODE_ENV: 'production' },
    { STAFF_PREVIEW_MODE: '' },
    { STAFF_PREVIEW_API_ORIGIN: 'https://other.invalid' },
    { STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101/?company=other' },
    { STAFF_PREVIEW_TOKEN: undefined },
    { STAFF_PREVIEW_INSTANCE: undefined },
  ])
    await assert.rejects(() => readStaffListingQueue({ ...env, ...patch }, fetch));
  assert.equal(calls, 0);
});
test('listing server reader fails closed on private or contradictory current projections', async () => {
  for (const value of [
    { ...page, items: [{ ...page.items[0], privateAddress: 'PRIVATE' }] },
    { ...page, items: [{ ...page.items[0], publishedRevision: 5 }] },
  ])
    await assert.rejects(
      () => readStaffListingQueue(env, async () => Response.json(value)),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
});
test('listing server reader denied access never returns old rows or upstream diagnostics and does not retry', async () => {
  let calls = 0;
  await assert.rejects(
    () =>
      readStaffListingQueue(env, async () => {
        calls++;
        return Response.json(
          { error: { code: 'FORBIDDEN', message: 'PRIVATE diagnostic' }, requestId: id(99) },
          { status: 403, headers: { 'X-Request-Id': id(99) } },
        );
      }),
    (e) => e.status === 403 && !e.submissionUncertain && !e.message.includes('PRIVATE'),
  );
  assert.equal(calls, 1);
});
