import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient, validateListingCreationCommand } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  actorId = id(2);
const command = () =>
  validateListingCreationCommand({
    listingId: id(3),
    operationId: id(4),
    slug: 'synthetic-creation',
    content: {
      title: 'Synthetic draft',
      pricing: { declaration: 'not_declared', charges: [] },
      location: { county: null, town: null, area: null },
    },
  });
const receipt = (c) => ({
  listingId: c.listingId,
  operationId: c.operationId,
  actorId,
  kind: 'create_listing',
  request: { slug: c.slug, content: c.content },
  outcome: 'created',
  reason: null,
  result: { listingVersion: '1', revision: 1, revisionVersion: '2' },
  completedAt: '2026-10-15T12:00:00.000Z',
});
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch: async (...args) => {
      const response = await fetch(...args);
      response.headers.set('content-type', 'application/json');
      return response;
    },
  });
const options = { bearerToken: 'synthetic' };
test('SDK creation sends one detached normalized command with route-owned operation identity', async () => {
  const input = JSON.parse(JSON.stringify(command())),
    calls = [];
  let release;
  const held = new Promise((r) => (release = r));
  const api = client(async (url, init) => {
    calls.push({ url, init });
    await held;
    return new Response(JSON.stringify(receipt(command())));
  });
  const promise = api.createListingV2(input, options);
  input.slug = 'changed';
  input.content.title = 'changed';
  release();
  assert.deepEqual(await promise, receipt(command()));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    slug: command().slug,
    content: command().content,
  });
  assert.ok(calls[0].url.endsWith('/creation-operations/' + id(4)));
});
test('SDK uncertain creation never retries and exact original recovery is GET only', async () => {
  let writes = 0;
  const api = client(async () => {
    writes++;
    throw new Error('PRIVATE network');
  });
  await assert.rejects(
    () => api.createListingV2(command(), options),
    (e) => e.kind === 'NETWORK' && e.submissionUncertain,
  );
  assert.equal(writes, 1);
  const calls = [],
    recovery = client(async (url, init) => {
      calls.push(init);
      return new Response(JSON.stringify(receipt(command())));
    });
  assert.deepEqual(
    await recovery.getListingCreationReceiptV2(command(), options),
    receipt(command()),
  );
  assert.deepEqual(
    await recovery.getListingCreationSnapshotV2(id(3), id(4), options),
    receipt(command()),
  );
  assert.ok(calls.every((c) => c.method === 'GET' && c.body === undefined));
});
test('SDK preflight rejects caller authority and executable content without dispatch', async () => {
  let calls = 0,
    reads = 0;
  const api = client(async () => {
      calls++;
      throw new Error();
    }),
    bad = { ...command(), content: { ...command().content } };
  Object.defineProperty(bad.content, 'title', {
    enumerable: true,
    get() {
      reads++;
      return 'bad';
    },
  });
  for (const input of [bad, { ...command(), tenantId: id(1) }, { ...command(), slug: 'Bad Slug' }])
    await assert.rejects(
      () => api.createListingV2(input, options),
      (e) => e.kind === 'VALIDATION' && !e.submissionUncertain,
    );
  assert.equal(calls, 0);
  assert.equal(reads, 0);
});
test('SDK malformed write receipt stays uncertain while malformed GET never claims a new submission', async () => {
  const api = client(
    async () => new Response(JSON.stringify({ ...receipt(command()), operationId: id(99) })),
  );
  await assert.rejects(
    () => api.createListingV2(command(), options),
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
  );
  await assert.rejects(
    () => api.getListingCreationReceiptV2(command(), options),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
});
test('SDK validates original request instead of adopting edited content or later draft versions', async () => {
  for (const patch of [
    { request: { slug: 'different', content: command().content } },
    { request: { slug: command().slug, content: { ...command().content, title: 'Later' } } },
    { result: { listingVersion: '1', revision: 1, revisionVersion: '3' } },
  ]) {
    const api = client(
      async () => new Response(JSON.stringify({ ...receipt(command()), ...patch })),
    );
    await assert.rejects(
      () => api.getListingCreationReceiptV2(command(), options),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
  }
});
