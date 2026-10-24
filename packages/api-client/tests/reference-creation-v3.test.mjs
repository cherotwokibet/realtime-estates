import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
import { catalogue, command, receipt, id } from './fixtures/reference-creation.mjs';
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic',
    fetch,
  });
const options = { bearerToken: 'synthetic' };
test('creation SDK validates before I/O and performs one exact staff POST or explicit original GET', async () => {
  const calls = [],
    sdk = client(async (url, init) => {
      calls.push({ url, init });
      return Response.json(receipt());
    });
  await assert.rejects(
    () =>
      sdk.createSyntheticReferenceListingV3(
        { ...command(), actorId: id(10) },
        catalogue(),
        id(10),
        options,
      ),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(calls.length, 0);
  assert.deepEqual(
    await sdk.createSyntheticReferenceListingV3(command(), catalogue(), id(10), options),
    receipt(),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(
    calls[0].url,
    `https://synthetic.invalid/v3/staff/listings/${id(100)}/reference-creation-operations/${id(1000)}`,
  );
  assert.deepEqual(JSON.parse(calls[0].init.body), command());
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.deepEqual(
    await sdk.getSyntheticReferenceCreationReceiptV3(command(), catalogue(), id(10), options),
    receipt(),
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.body, undefined);
});
test('lost or malformed committed success is uncertain and causes no automatic replay or recovery', async () => {
  for (const fetch of [
    async () => {
      throw Error('lost reply');
    },
    async () => Response.json({ ...receipt(), privateAddress: 'PRIVATE' }),
    async () => new Response('broken', { headers: { 'content-type': 'application/json' } }),
  ]) {
    let calls = 0;
    const sdk = client(async (...args) => {
      calls++;
      return fetch(...args);
    });
    await assert.rejects(
      () => sdk.createSyntheticReferenceListingV3(command(), catalogue(), id(10), options),
      (e) => e.submissionUncertain === true,
    );
    assert.equal(calls, 1);
  }
});
test('original GET rejects actor, retained request or catalogue substitution without becoming an uncertain write', async () => {
  for (const change of [
    (r) => (r.creation.actorId = id(11)),
    (r) => (r.creation.request.slug = 'changed'),
    (r) => (r.referenceDraft.attributes.location.county.label = 'Changed'),
    (r) => (r.referenceDraft.revisionVersion = '4'),
  ]) {
    const r = structuredClone(receipt());
    change(r);
    await assert.rejects(
      () =>
        client(async () => Response.json(r)).getSyntheticReferenceCreationReceiptV3(
          command(),
          catalogue(),
          id(10),
          options,
        ),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
  }
});
test('composite response has a dedicated streamed allowance above ordinary 128 KiB with strict framing and integer tokens', async () => {
  const cat = catalogue('1', true),
    c = command(100, 1000, cat, true),
    r = receipt(c, cat),
    raw = JSON.stringify(r);
  assert.ok(new TextEncoder().encode(raw).byteLength > 131072);
  assert.deepEqual(
    await client(async () => Response.json(r)).createSyntheticReferenceListingV3(
      c,
      cat,
      id(10),
      options,
    ),
    r,
  );
  for (const make of [
    () =>
      new Response(raw.replace('"revision":1', '"revision":1.0'), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(raw.replace('"creation":', '"creation":{},"creation":'), {
        headers: { 'content-type': 'application/json' },
      }),
    () => Response.json(r, { headers: { 'content-length': '262273' } }),
    () => Response.json(r, { headers: { 'content-encoding': 'gzip' } }),
    () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
  ])
    await assert.rejects(
      () =>
        client(async () => make()).getSyntheticReferenceCreationReceiptV3(c, cat, id(10), options),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
});
test('creation response streaming cancels oversized or stalled originals within its own allowance', async () => {
  let cancelled = false;
  const large = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(262273));
    },
    cancel() {
      cancelled = true;
    },
  });
  await assert.rejects(
    () =>
      client(
        async () => new Response(large, { headers: { 'content-type': 'application/json' } }),
      ).getSyntheticReferenceCreationReceiptV3(command(), catalogue(), id(10), options),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
  assert.equal(cancelled, true);
  let stopped = false;
  const stalled = new ReadableStream({
    cancel() {
      stopped = true;
    },
  });
  await assert.rejects(
    () =>
      client(
        async () => new Response(stalled, { headers: { 'content-type': 'application/json' } }),
      ).getSyntheticReferenceCreationReceiptV3(command(), catalogue(), id(10), {
        ...options,
        timeoutMs: 30,
      }),
    (e) => e.kind === 'TIMEOUT' && !e.submissionUncertain,
  );
  assert.equal(stopped, true);
});
