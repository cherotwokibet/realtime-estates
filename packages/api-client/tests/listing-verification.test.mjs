import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
import { planListingVerification } from '@realtor/domain';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  now = '2026-10-22T20:00:00.000Z';
const command = () => ({
  operationId: id(300),
  policy: 'synthetic-check-record-v1',
  target: { listingId: id(100), listingVersion: '1', revision: 1, revisionVersion: '2' },
  expectedVerificationVersion: '0',
  subject: 'identity',
  outcome: 'supported',
  evidenceReference: 'synthetic:identity-fixture',
  note: 'Synthetic identity assessment.',
  observedAt: '2026-01-01T00:00:00.000Z',
});
const record = () =>
  planListingVerification(
    command(),
    { target: command().target, verificationVersion: '0', lastRecordedAt: null },
    'admin',
    id(10),
    now,
  ).record;
const receipt = () => ({
  kind: 'listing_verification_receipt',
  operationId: id(300),
  listingId: id(100),
  actorId: id(10),
  request: command(),
  decision: { outcome: 'recorded', reason: null, record: record() },
  completedAt: now,
});
const options = { bearerToken: 'synthetic' },
  client = (fetch) =>
    new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic',
      fetch,
    });
test('verification SDK captures exact one-write original and fixed GET-only recovery without caller authority', async () => {
  const calls = [],
    original = command(),
    sdk = client(async (url, init) => {
      calls.push({ url, init });
      original.note = 'Changed after dispatch';
      return Response.json(receipt());
    });
  const result = await sdk.recordSyntheticListingVerificationV2(original, options);
  assert.equal(result.request.note, 'Synthetic identity assessment.');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), command());
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers['Idempotency-Key'], undefined);
  await sdk.getListingVerificationReceiptV2(command(), options);
  await sdk.getListingVerificationOriginalV2(id(100), id(300), options);
  assert.ok(calls.slice(1).every((x) => x.init.method === 'GET' && x.init.body === undefined));
});
test('verification SDK invalid input never dispatches and bounded history uses exact fixed limit', async () => {
  let calls = 0;
  const sdk = client(async (url, init) => {
    calls++;
    assert.equal(
      url,
      `https://synthetic.invalid/v2/staff/listings/${id(100)}/verification-history?limit=20`,
    );
    assert.equal(init.method, 'GET');
    return Response.json({
      kind: 'listing_verification_history',
      beforeVersion: null,
      listingId: id(100),
      verificationVersion: '1',
      records: [record()],
      hasMore: false,
    });
  });
  await assert.rejects(
    () => sdk.recordSyntheticListingVerificationV2({ ...command(), actorId: id(11) }, options),
    (e) => e.kind === 'VALIDATION' && !e.submissionUncertain,
  );
  await assert.rejects(
    () => sdk.getListingVerificationHistoryV2(id(100), 26, options),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(calls, 0);
  assert.equal((await sdk.getListingVerificationHistoryV2(id(100), 20, options)).records.length, 1);
  assert.equal(calls, 1);
});
test('verification SDK malformed/lost write replies stay uncertain, reads never retry or become writes', async () => {
  for (const transport of [
    async () => {
      throw Error('private');
    },
    async () => Response.json({ ...receipt(), request: { ...command(), note: 'Wrong' } }),
    async () =>
      new Response('x'.repeat(1048577), { headers: { 'content-type': 'application/json' } }),
  ]) {
    let calls = 0;
    const sdk = client(async (...args) => {
      calls++;
      return transport(...args);
    });
    await assert.rejects(
      () => sdk.recordSyntheticListingVerificationV2(command(), options),
      (e) => e.submissionUncertain === true,
    );
    assert.equal(calls, 1);
  }
  const sdk = client(async () =>
    Response.json({ ...receipt(), request: { ...command(), note: 'Wrong' } }),
  );
  await assert.rejects(
    () => sdk.getListingVerificationReceiptV2(command(), options),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
});
test('verification SDK cancels a stalled body and retains write versus read uncertainty', async () => {
  for (const write of [true, false]) {
    let cancelled = false,
      calls = 0;
    const sdk = client(async () => {
      calls++;
      return new Response(
        new ReadableStream({
          cancel() {
            cancelled = true;
          },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    });
    const opts = { ...options, timeoutMs: 20 };
    await assert.rejects(
      () =>
        write
          ? sdk.recordSyntheticListingVerificationV2(command(), opts)
          : sdk.getListingVerificationReceiptV2(command(), opts),
      (e) => e.kind === 'TIMEOUT' && e.submissionUncertain === write,
    );
    assert.equal(cancelled, true);
    assert.equal(calls, 1);
  }
});
test('verification wire revision tokens cannot round fractional or exponential aliases into the original', async () => {
  for (const token of ['1.0', '1.0000000000000001', '1e0']) {
    const raw = JSON.stringify(receipt()).replaceAll('"revision":1', `"revision":${token}`),
      sdk = client(
        async () => new Response(raw, { headers: { 'content-type': 'application/json' } }),
      );
    await assert.rejects(
      () => sdk.recordSyntheticListingVerificationV2(command(), options),
      (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
    );
    await assert.rejects(
      () => sdk.getListingVerificationReceiptV2(command(), options),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
  }
  const duplicate = JSON.stringify(receipt()).replace(
    '"note":"Synthetic identity assessment."',
    '"note":"Changed","note":"Synthetic identity assessment."',
  );
  const sdk = client(
    async () => new Response(duplicate, { headers: { 'content-type': 'application/json' } }),
  );
  await assert.rejects(
    () => sdk.getListingVerificationReceiptV2(command(), options),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
});
test('verification history SDK fixes and validates cursor-bound older pages', async () => {
  let calls = 0;
  const page = {
    kind: 'listing_verification_history',
    listingId: id(100),
    verificationVersion: '2',
    beforeVersion: '2',
    records: [record()],
    hasMore: false,
  };
  const sdk = client(async (url) => {
    calls++;
    assert.equal(
      url,
      `https://synthetic.invalid/v2/staff/listings/${id(100)}/verification-history?limit=1&beforeVersion=2`,
    );
    return Response.json(page);
  });
  assert.equal(
    (await sdk.getListingVerificationHistoryV2(id(100), 1, options, '2')).records[0]
      .verificationVersion,
    '1',
  );
  for (const before of ['0', '02', '9007199254740992'])
    await assert.rejects(
      () => sdk.getListingVerificationHistoryV2(id(100), 1, options, before),
      (e) => e.kind === 'VALIDATION',
    );
  assert.equal(calls, 1);
  const altered = client(async () => Response.json({ ...page, beforeVersion: '3' }));
  await assert.rejects(
    () => altered.getListingVerificationHistoryV2(id(100), 1, options, '2'),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
});
