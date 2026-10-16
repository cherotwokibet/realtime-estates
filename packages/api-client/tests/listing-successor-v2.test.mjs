import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient, validateListingSuccessorCommand } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const command = () =>
  validateListingSuccessorCommand({
    listingId: id(3),
    operationId: id(4),
    expectedListingVersion: '3',
    predecessor: { revision: 2, version: '4', state: 'rejected' },
    content: {
      title: 'Synthetic successor',
      pricing: { declaration: 'not_declared', charges: [] },
      location: { county: null, town: null, area: null },
    },
  });
const receipt = (c) => ({
  listingId: c.listingId,
  operationId: c.operationId,
  actorId: id(2),
  kind: 'start_revision',
  request: {
    expectedListingVersion: c.expectedListingVersion,
    predecessor: c.predecessor,
    content: c.content,
  },
  decision: {
    outcome: 'applied',
    reason: null,
    result: { listingVersion: '4', revision: 3, revisionVersion: '2' },
  },
  completedAt: '2026-10-16T01:00:00.000Z',
});
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch,
  });
const response = (data) =>
  new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
const options = { bearerToken: 'synthetic' };
test('SDK successor sends one detached explicit command and keeps IDs in the fixed route', async () => {
  const input = structuredClone(command()),
    calls = [];
  let release;
  const held = new Promise((r) => (release = r)),
    api = client(async (url, init) => {
      calls.push({ url, init });
      await held;
      return response(receipt(command()));
    });
  const pending = api.startListingRevisionV2(input, options);
  input.content.title = 'changed';
  input.predecessor.version = '9';
  release();
  assert.deepEqual(await pending, receipt(command()));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.ok(calls[0].url.endsWith('/revision-operations/' + id(4)));
  assert.deepEqual(JSON.parse(calls[0].init.body), receipt(command()).request);
});
test('uncertain successor never retries and original receipt and snapshot recovery send GET only', async () => {
  let writes = 0;
  const api = client(async () => {
    writes++;
    throw Error('PRIVATE network');
  });
  await assert.rejects(
    () => api.startListingRevisionV2(command(), options),
    (e) => e.kind === 'NETWORK' && e.submissionUncertain,
  );
  assert.equal(writes, 1);
  const calls = [],
    recover = client(async (url, init) => {
      calls.push(init);
      return response(receipt(command()));
    });
  assert.deepEqual(
    await recover.getListingSuccessorReceiptV2(command(), options),
    receipt(command()),
  );
  assert.deepEqual(
    await recover.getListingSuccessorSnapshotV2(id(3), id(4), options),
    receipt(command()),
  );
  assert.ok(calls.every((x) => x.method === 'GET' && x.body === undefined));
});
test('SDK successor preflight rejects authority and executable facts without dispatch or getter invocation', async () => {
  let calls = 0,
    reads = 0;
  const api = client(async () => {
      calls++;
      throw Error();
    }),
    bad = structuredClone(command());
  Object.defineProperty(bad.predecessor, 'state', {
    enumerable: true,
    get() {
      reads++;
      return 'rejected';
    },
  });
  for (const input of [
    bad,
    { ...command(), actorId: id(2) },
    { ...command(), expectedListingVersion: '0' },
  ])
    await assert.rejects(
      () => api.startListingRevisionV2(input, options),
      (e) => e.kind === 'VALIDATION' && !e.submissionUncertain,
    );
  assert.equal(calls, 0);
  assert.equal(reads, 0);
});
test('malformed successor write stays uncertain while malformed original GET is read-only failure', async () => {
  const api = client(async () => response({ ...receipt(command()), operationId: id(99) }));
  await assert.rejects(
    () => api.startListingRevisionV2(command(), options),
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
  );
  await assert.rejects(
    () => api.getListingSuccessorReceiptV2(command(), options),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
  await assert.rejects(
    () => api.getListingSuccessorSnapshotV2(id(3), id(4), options),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
});

test('successor SDK rejects a reply whose fractional revision token rounds into the expected revision', async () => {
  const api = client(
    async () =>
      new Response(
        JSON.stringify(receipt(command())).replace(
          '"revision":3',
          '"revision":3.00000000000000001',
        ),
        { headers: { 'content-type': 'application/json' } },
      ),
  );
  await assert.rejects(
    () => api.startListingRevisionV2(command(), options),
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
  );
  await assert.rejects(
    () => api.getListingSuccessorSnapshotV2(id(3), id(4), options),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
});
