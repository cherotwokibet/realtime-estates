import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const command = (publication = false) => ({
  listingId: id(3),
  operationId: id(4),
  expectedListingVersion: '3',
  kind: publication ? 'set_publication' : 'confirm_availability',
  ...(publication ? { publicationStatus: 'archived' } : { availability: 'sold' }),
});
const receipt = (c) => ({
  listingId: c.listingId,
  operationId: c.operationId,
  actorId: id(2),
  kind: c.kind,
  request: {
    expectedListingVersion: c.expectedListingVersion,
    ...(c.kind === 'confirm_availability'
      ? { availability: c.availability }
      : { publicationStatus: c.publicationStatus }),
  },
  decision: { outcome: 'applied', reason: null, result: { listingVersion: '4' } },
  completedAt: '2026-10-16T17:00:00.123456Z',
});
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch,
  });
const options = { bearerToken: 'synthetic' };
const response = (d) =>
  new Response(JSON.stringify(d), { headers: { 'content-type': 'application/json' } });
test('SDK captures detached command and uses exact control route/body for both kinds', async () => {
  for (const pub of [false, true]) {
    const input = command(pub),
      calls = [];
    let release;
    const held = new Promise((r) => (release = r));
    const api = client(async (url, init) => {
      calls.push({ url, init });
      await held;
      return response(receipt(command(pub)));
    });
    const pending = api.controlListingV2(input, options);
    input.expectedListingVersion = '9';
    release();
    assert.deepEqual(await pending, receipt(command(pub)));
    assert.equal(calls.length, 1);
    assert.ok(
      calls[0].url.endsWith(`/${pub ? 'publication' : 'availability'}-operations/${id(4)}`),
    );
    assert.deepEqual(JSON.parse(calls[0].init.body), receipt(command(pub)).request);
  }
});
test('uncertain controls never retry; retained receipt and route-kind snapshot recovery use GET only', async () => {
  let writes = 0;
  const bad = client(async () => {
    writes++;
    throw Error('PRIVATE network');
  });
  await assert.rejects(
    bad.controlListingV2(command(), options),
    (e) => e.kind === 'NETWORK' && e.submissionUncertain,
  );
  assert.equal(writes, 1);
  const calls = [],
    api = client(async (url, init) => {
      calls.push(init);
      return response(receipt(command()));
    });
  assert.deepEqual(await api.getListingControlReceiptV2(command(), options), receipt(command()));
  assert.deepEqual(
    await api.getListingControlSnapshotV2(id(3), id(4), 'confirm_availability', options),
    receipt(command()),
  );
  assert.ok(calls.every((c) => c.method === 'GET' && c.body === undefined));
});
test('malformed or executable commands fail before transport; altered write receipts are uncertain', async () => {
  let calls = 0,
    reads = 0;
  const api = client(async () => {
    calls++;
    return response({ ...receipt(command()), operationId: id(9) });
  });
  const q = command();
  Object.defineProperty(q, 'availability', {
    enumerable: true,
    get() {
      reads++;
      return 'sold';
    },
  });
  await assert.rejects(api.controlListingV2(q, options), (e) => e.kind === 'VALIDATION');
  await assert.rejects(
    api.controlListingV2({ ...command(), actorId: id(2) }, options),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(reads, 0);
  assert.equal(calls, 0);
  await assert.rejects(
    api.controlListingV2(command(), options),
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
  );
  assert.equal(calls, 1);
});
