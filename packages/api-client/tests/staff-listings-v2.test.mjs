import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
import {
  staffListingFixture,
  staffListingId,
} from '../../domain/test-helpers/staff-listing-fixtures.mjs';
const options = { bearerToken: 'synthetic' },
  page = { items: [staffListingFixture()], limit: 25, truncated: false },
  client = (fetch) =>
    new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic-v1',
      fetch,
    });

test('single listing SDK reads exact target with one GET and rejects private or rounded identity replies', async () => {
  const calls = [],
    api = client(async (url, init) => {
      calls.push({ url, init });
      return Response.json(staffListingFixture());
    });
  assert.deepEqual(await api.getStaffListingV2(staffListingId(10), options), staffListingFixture());
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/v2/staff/listings/' + staffListingId(10)));
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  for (const value of [
    { ...staffListingFixture(), privateAddress: 'PRIVATE' },
    staffListingFixture(11),
  ])
    await assert.rejects(
      () => client(async () => Response.json(value)).getStaffListingV2(staffListingId(10), options),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
  const rounded = client(
    async () =>
      new Response(
        JSON.stringify(staffListingFixture()).replace(
          '"revision":2',
          '"revision":2.00000000000000001',
        ),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  await assert.rejects(
    () => rounded.getStaffListingV2(staffListingId(10), options),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
});
test('listing SDK performs one bounded authenticated GET and detaches strict minimal projection', async () => {
  const calls = [],
    api = client(async (url, init) => {
      calls.push({ url, init });
      return Response.json(page);
    });
  assert.deepEqual(await api.listStaffListingsV2(options), page);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/v2/staff/listings?limit=25'));
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer synthetic');
});
test('listing SDK invalid options never dispatch and malformed/private successful projections stay read-only', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return Response.json({ ...page, items: [{ ...page.items[0], privateAddress: 'private' }] });
  });
  for (const opts of [
    { ...options, limit: 51 },
    { ...options, limit: 1.5 },
    { ...options, tenantId: staffListingId(9) },
  ])
    await assert.rejects(
      () => api.listStaffListingsV2(opts),
      (e) => e.kind === 'VALIDATION',
    );
  assert.equal(calls, 0);
  await assert.rejects(
    () => api.listStaffListingsV2(options),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
  assert.equal(calls, 1);
});
test('listing SDK denies unsafe error envelopes and never retries a failed read', async () => {
  const requestId = staffListingId(99);
  for (const value of [
    new Error('PRIVATE diagnostics'),
    Response.json(
      { error: { code: 'FORBIDDEN', message: 'PRIVATE diagnostics' }, requestId },
      { status: 403, headers: { 'X-Request-Id': requestId } },
    ),
  ]) {
    let calls = 0;
    const api = client(async () => {
      calls++;
      if (value instanceof Error) throw value;
      return value;
    });
    await assert.rejects(
      () => api.listStaffListingsV2(options),
      (e) => !e.submissionUncertain && !e.message.includes('PRIVATE'),
    );
    assert.equal(calls, 1);
  }
});
