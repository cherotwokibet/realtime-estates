import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
import { normalizeStaffDraftContentV2, snapshotListingReferenceAttributes } from '@realtor/domain';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const catalogue = () => ({
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [],
  amenities: [],
});
const command = () => ({
  policy: 'synthetic-reference-draft-v1',
  operationId: id(300),
  listingId: id(100),
  revision: 1,
  expectedVersion: '2',
  content: normalizeStaffDraftContentV2({
    title: 'Synthetic SDK draft',
    location: { county: null, town: null, area: null },
    pricing: { declaration: 'not_declared', charges: [] },
  }),
  selection: {
    catalogueVersion: '1',
    location: { countyId: null, localityId: null, neighbourhoodId: null },
    amenityIds: [],
  },
});
const receipt = () => ({
  ...command(),
  actorId: id(10),
  revisionVersion: '3',
  attributes: snapshotListingReferenceAttributes(command().selection, catalogue(), null),
});
const options = { bearerToken: 'synthetic' },
  client = (fetch) =>
    new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic',
      fetch,
    });
const save = (sdk, c = command(), cat = catalogue(), opts = options) =>
  sdk.saveSyntheticReferenceDraftV3(c, cat, id(10), opts);
const recover = (sdk, c = command(), cat = catalogue(), opts = options) =>
  sdk.getSyntheticReferenceDraftReceiptV3(c, cat, id(10), opts);
test('reference SDK captures one original write and fixed GET with detached catalogue and exact actor binding', async () => {
  const calls = [],
    original = structuredClone(command()),
    cat = catalogue();
  const sdk = client(async (url, init) => {
    calls.push({ url, init });
    original.content.title = 'Changed after dispatch';
    cat.version = '2';
    return Response.json(receipt());
  });
  const result = await save(sdk, original, cat);
  assert.equal(result.content.title, 'Synthetic SDK draft');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.headers['Idempotency-Key'], undefined);
  assert.deepEqual(JSON.parse(calls[0].init.body), command());
  await recover(sdk);
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.body, undefined);
});
test('reference SDK refuses invalid context, stale catalogue and pre-aborted writes before dispatch', async () => {
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    return Response.json(receipt());
  });
  for (const c of [
    { ...command(), actorId: id(10) },
    { ...command(), expectedVersion: '02' },
    { ...command(), content: { ...command().content, locality: 'Unbound' } },
  ])
    await assert.rejects(
      () => save(sdk, c),
      (e) => e.kind === 'VALIDATION' && !e.submissionUncertain,
    );
  await assert.rejects(
    () => save(sdk, command(), { ...catalogue(), version: '2' }),
    (e) => e.kind === 'VALIDATION',
  );
  await assert.rejects(
    () => sdk.getSyntheticReferenceCatalogueV3('01', options),
    (e) => e.kind === 'VALIDATION',
  );
  await assert.rejects(
    () => save(sdk, command(), catalogue(), { ...options, actorId: id(10) }),
    (e) => e.kind === 'VALIDATION',
  );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    () => save(sdk, command(), catalogue(), { ...options, signal: abort.signal }),
    (e) => e.kind === 'CANCELLED' && !e.submissionUncertain,
  );
  assert.equal(calls, 0);
});
test('catalogue transport accepts valid Unicode payload above1MiB and binds requested historical version', async () => {
  const large = {
    ...catalogue(),
    locations: Array.from({ length: 1800 }, (_, n) => ({
      id: id(1000 + n),
      kind: 'county',
      parentId: null,
      label: '🙂'.repeat(160),
    })),
  };
  assert.ok(new TextEncoder().encode(JSON.stringify(large)).length > 1024 * 1024);
  const sdk = client(async () => Response.json(large));
  assert.equal(
    (await sdk.getSyntheticReferenceCatalogueV3('current', options)).locations.length,
    1800,
  );
  await assert.rejects(
    () => sdk.getSyntheticReferenceCatalogueV3('2', options),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
});
test('reference transport rejects duplicate fields, decimal revisions, bad encoding, length and modified originals', async () => {
  const variants = [
    new Response(JSON.stringify(receipt()).replace('"revision":1', '"revision":1,"revision":1'), {
      headers: { 'content-type': 'application/json' },
    }),
    new Response(JSON.stringify(receipt()).replace('"revision":1', '"revision":1.0'), {
      headers: { 'content-type': 'application/json' },
    }),
    new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    Response.json(receipt(), { headers: { 'content-encoding': 'gzip' } }),
    Response.json(receipt(), { headers: { 'content-length': '1' } }),
    Response.json({ ...receipt(), actorId: id(11) }),
    Response.json({ ...receipt(), revisionVersion: '4' }),
  ];
  for (const response of variants) {
    let calls = 0;
    await assert.rejects(
      () =>
        save(
          client(async () => {
            calls++;
            return response;
          }),
        ),
      (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
    );
    assert.equal(calls, 1);
  }
});
test('lost write response stays uncertain and explicit original recovery sends GET only', async () => {
  const calls = [];
  const sdk = client(async (_, init) => {
    calls.push(init.method);
    if (init.method === 'POST') throw Error('Synthetic lost response');
    return Response.json(receipt());
  });
  await assert.rejects(
    () => save(sdk),
    (e) => e.kind === 'NETWORK' && e.submissionUncertain,
  );
  assert.deepEqual(calls, ['POST']);
  assert.deepEqual(await recover(sdk), receipt());
  assert.deepEqual(calls, ['POST', 'GET']);
});
test('late and stalled reference responses time out without retry or waiting for cancellation', async () => {
  let finish,
    cancelled = false,
    calls = 0;
  const sdk = client(() => {
    calls++;
    return new Promise((resolve) => {
      finish = resolve;
    });
  });
  await assert.rejects(
    () => save(sdk, command(), catalogue(), { ...options, timeoutMs: 100 }),
    (e) => e.kind === 'TIMEOUT' && e.submissionUncertain,
  );
  const stream = new ReadableStream({
    cancel() {
      cancelled = true;
      return new Promise(() => {});
    },
  });
  finish(new Response(stream, { headers: { 'content-type': 'application/json' } }));
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
  const stalled = new ReadableStream({
    cancel() {
      return new Promise(() => {});
    },
  });
  await assert.rejects(
    () =>
      recover(
        client(
          async () => new Response(stalled, { headers: { 'content-type': 'application/json' } }),
        ),
        command(),
        catalogue(),
        { ...options, timeoutMs: 100 },
      ),
    (e) => e.kind === 'TIMEOUT' && !e.submissionUncertain,
  );
});
test('empty frames and separate receipt/catalogue byte limits cancel hostile bodies promptly', async () => {
  for (const mode of ['empty', 'receipt', 'catalogue']) {
    let cancelled = false;
    const stream = new ReadableStream({
        pull(c) {
          c.enqueue(
            mode === 'empty'
              ? new Uint8Array()
              : new Uint8Array((mode === 'catalogue' ? 6 : 1) * 1024 * 1024 + 1),
          );
        },
        cancel() {
          cancelled = true;
          return new Promise(() => {});
        },
      }),
      sdk = client(
        async () => new Response(stream, { headers: { 'content-type': 'application/json' } }),
      );
    await assert.rejects(
      () =>
        mode === 'catalogue'
          ? sdk.getSyntheticReferenceCatalogueV3('current', options)
          : recover(sdk),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
    assert.equal(cancelled, true);
  }
});
