import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const command = {
  policy: 'listing-report-command-v1',
  operationId: id(2),
  listingId: id(1),
  reason: 'other',
  details: 'Synthetic report only.',
};
const receipt = {
  policy: 'listing-report-receipt-v1',
  operationId: id(2),
  listingId: id(1),
  status: 'recorded',
  recordedAt: '2026-10-30T04:00:00.000Z',
};
const api = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic-report-v1',
    fetch,
  });
test('private report queue and review snapshot identity and recover originals without replay', async () => {
  const decision = {
    policy: 'listing-report-decision-command-v1',
    operationId: id(3),
    reportId: id(4),
    expectedVersion: '1',
    decision: 'reviewed',
    reason: 'Synthetic review only.',
  };
  const saved = {
    policy: 'listing-report-decision-receipt-v1',
    operationId: id(3),
    reportId: id(4),
    version: '2',
    decision: 'reviewed',
    reason: decision.reason,
    actorId: id(10),
    recordedAt: receipt.recordedAt,
  };
  const queue = {
    policy: 'listing-report-queue-v1',
    items: [],
    hasMore: false,
    limit: 2,
    status: 'all',
  };
  const calls = [];
  const client = api(async (url, init) => {
    calls.push({ url, init });
    return Response.json(url.includes('?') ? queue : saved);
  });
  const options = { bearerToken: 'original-token' };
  const work = client.listListingReports({ limit: 2, status: 'all' }, options);
  options.bearerToken = 'changed-token';
  assert.deepEqual(await work, queue);
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), 'Bearer original-token');
  assert.deepEqual(await client.decideListingReport(decision, options), saved);
  assert.deepEqual(await client.getListingReportDecision(id(4), id(3), options), saved);
  assert.deepEqual(
    calls.map((c) => c.init.method),
    ['GET', 'POST', 'GET'],
  );
  assert.equal(calls[2].init.body, undefined);
  assert.equal(
    calls[0].url,
    'https://synthetic.invalid/v2/staff/listing-reports?limit=2&status=all',
  );
  assert.deepEqual(JSON.parse(calls[1].init.body), decision);
  const malformed = api(async () => Response.json({ ...saved, version: '3' }));
  await assert.rejects(
    () => malformed.decideListingReport(decision, options),
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
  );
  const wrongOriginal = api(async () => Response.json({ ...saved, reportId: id(9) }));
  await assert.rejects(
    () => wrongOriginal.getListingReportDecision(id(4), id(3), options),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
  let dispatched = 0;
  const denied = api(async () => {
    dispatched++;
    return Response.json(queue);
  });
  await assert.rejects(
    () => denied.listListingReports({ limit: 51 }, options),
    (e) => e.kind === 'VALIDATION',
  );
  await assert.rejects(
    () => denied.decideListingReport(decision, {}),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(dispatched, 0);
});
test('anonymous report sends one credential-free202 capture and original recovery is GET only', async () => {
  const calls = [];
  const client = api(async (url, init) => {
    calls.push({ url, init });
    return Response.json(receipt, { status: init.method === 'POST' ? 202 : 200 });
  });
  assert.deepEqual(await client.captureListingReport(command), receipt);
  assert.deepEqual(
    await client.getListingReportReceipt(command.listingId, command.operationId),
    receipt,
  );
  assert.deepEqual(
    calls.map((c) => c.init.method),
    ['POST', 'GET'],
  );
  assert.equal(
    calls[0].url,
    `https://synthetic.invalid/v2/public/listings/${id(1)}/reports/${id(2)}`,
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), command);
  assert.equal(calls[1].init.body, undefined);
  for (const { init } of calls) {
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.equal(new Headers(init.headers).has('authorization'), false);
    assert.equal(new Headers(init.headers).has('idempotency-key'), false);
  }
});
test('anonymous authority/accessors and changed report commands fail before transport', async () => {
  let calls = 0,
    reads = 0;
  const client = api(async () => {
    calls++;
    return Response.json(receipt, { status: 202 });
  });
  const getter = {};
  Object.defineProperty(getter, 'timeoutMs', {
    enumerable: true,
    get() {
      reads++;
      return 100;
    },
  });
  for (const options of [{ bearerToken: 'forbidden' }, { tenantId: id(9) }, getter])
    await assert.rejects(
      () => client.captureListingReport(command, options),
      (e) => e.kind === 'VALIDATION',
    );
  await assert.rejects(
    () => client.captureListingReport({ ...command, details: '<script>' }),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(calls, 0);
  assert.equal(reads, 0);
});
test('lost or counterfeit successful report replies remain uncertain and never retry automatically', async () => {
  for (const transport of [
    async () => {
      throw Error('Synthetic lost reply');
    },
    async () => Response.json({ ...receipt, operationId: id(9) }, { status: 202 }),
    async () => Response.json(receipt, { status: 200 }),
    async () =>
      new Response(JSON.stringify(receipt).replace('"status":', '"status":"wrong","status":'), {
        status: 202,
        headers: { 'content-type': 'application/json' },
      }),
  ]) {
    let calls = 0;
    const client = api(async (...args) => {
      calls++;
      return transport(...args);
    });
    await assert.rejects(
      () => client.captureListingReport(command),
      (e) => e.submissionUncertain === true,
    );
    assert.equal(calls, 1);
  }
});
