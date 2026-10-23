import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
import { normalizeStaffDraftContentV2, snapshotListingReferenceAttributes } from '@realtor/domain';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cat = () => ({
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [{ id: id(1), kind: 'county', parentId: null, label: 'Synthetic original county' }],
  amenities: [],
});
const review = () => ({
  policy: 'synthetic-reference-revision-v1',
  listingId: id(100),
  revision: 1,
  listingVersion: '2',
  revisionVersion: '3',
  state: 'pending',
  availability: 'available',
  availabilityConfirmedAt: '2026-10-23T12:00:00.000Z',
  publicationStatus: 'paused',
  publishedRevision: 1,
  content: normalizeStaffDraftContentV2({
    bedrooms: 1,
    locality: 'Synthetic original county',
    location: { county: 'Synthetic original county', town: null, area: null },
    pricing: { declaration: 'not_declared', charges: [] },
    privateAddress: 'PRIVATE SDK ONLY',
  }),
  attributes: snapshotListingReferenceAttributes(
    {
      catalogueVersion: '1',
      location: { countyId: id(1), localityId: null, neighbourhoodId: null },
      amenityIds: [],
    },
    cat(),
    null,
  ),
  photos: [
    {
      id: id(2),
      position: 0,
      altText: 'Synthetic image',
      accepted: true,
      sealed: true,
      sha256: 'a'.repeat(64),
    },
  ],
});
const command = (action = 'approve') => ({
  policy: 'synthetic-reference-transition-v1',
  operationId: id(300),
  listingId: id(100),
  revision: 1,
  action,
  review: { ...review(), state: action === 'submit' ? 'draft' : 'pending' },
  reason: action === 'reject' ? 'Synthetic reason' : null,
});
const receipt = (c) => ({
  ...c,
  actorId: id(10),
  revisionVersion: '4',
  state: { submit: 'pending', withdraw: 'draft', approve: 'approved', reject: 'rejected' }[
    c.action
  ],
});
const options = { bearerToken: 'synthetic' },
  client = (fetch) =>
    new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic',
      fetch,
    });
const write = (sdk, c = command(), catalogue = cat(), opts = options) =>
  sdk.transitionSyntheticReferenceRevisionV3(c, catalogue, id(10), opts);
const recover = (sdk, c = command(), catalogue = cat(), opts = options) =>
  sdk.getSyntheticReferenceTransitionReceiptV3(c, catalogue, id(10), opts);
const read = (sdk, catalogue = cat(), opts = options) =>
  sdk.getSyntheticReferenceReviewV3(id(100), 1, '3', catalogue, opts);
test('SDK captures complete originals before await and uses one fixed POST/explicit GET for every action', async () => {
  for (const action of ['submit', 'withdraw', 'approve', 'reject']) {
    const c = structuredClone(command(action)),
      catalogue = cat(),
      expected = receipt(command(action)),
      calls = [];
    const sdk = client(async (url, init) => {
      calls.push({ url, init });
      c.review.content.privateAddress = 'CHANGED';
      catalogue.locations[0].label = 'CHANGED';
      return Response.json(expected);
    });
    const out = await write(sdk, c, catalogue);
    assert.deepEqual(out, expected);
    assert.ok(Object.isFrozen(out.review.photos[0]));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), command(action));
    assert.equal(calls[0].init.credentials, 'omit');
    assert.equal(calls[0].init.redirect, 'error');
    assert.equal(calls[0].init.headers['Idempotency-Key'], undefined);
    await recover(sdk, command(action));
    assert.equal(calls[1].init.method, 'GET');
    assert.equal(calls[1].init.body, undefined);
    assert.match(calls[1].url, /reference-transition-operations/);
  }
});
test('revision and review reads use exact versioned routes and reject wrong state, target, version or historical labels', async () => {
  const calls = [],
    sdk = client(async (url, init) => {
      calls.push({ url, init });
      return Response.json(review());
    });
  assert.deepEqual(await read(sdk), review());
  assert.deepEqual(
    await sdk.getSyntheticReferenceRevisionV3(id(100), 1, '3', cat(), options),
    review(),
  );
  assert.match(calls[0].url, /staff\/reviews\/.+\/reference-revisions\/1\/3$/);
  assert.match(calls[1].url, /staff\/listings\//);
  assert.ok(calls.every((c) => c.init.method === 'GET' && c.init.body === undefined));
  for (const mutate of [
    (r) => (r.state = 'draft'),
    (r) => (r.listingId = id(101)),
    (r) => (r.revisionVersion = '4'),
    (r) => (r.attributes.location.county.label = 'Renamed'),
    (r) => (r.actorId = id(10)),
  ]) {
    const r = structuredClone(review());
    mutate(r);
    await assert.rejects(
      () => read(client(async () => Response.json(r))),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
  }
});
test('local invalid original, options, canonical path and preabort validation cause no dispatch', async () => {
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    return Response.json(receipt(command()));
  });
  for (const c of [
    { ...command(), actorId: id(10) },
    { ...command(), reason: 'unrequested' },
    { ...command(), review: { ...review(), revisionVersion: '9007199254740991' } },
  ])
    await assert.rejects(
      () => write(sdk, c),
      (e) => e.kind === 'VALIDATION' && !e.submissionUncertain,
    );
  await assert.rejects(
    () => write(sdk, command(), { ...cat(), version: '2' }),
    (e) => e.kind === 'VALIDATION',
  );
  await assert.rejects(
    () => write(sdk, command(), cat(), { ...options, actorId: id(11) }),
    (e) => e.kind === 'VALIDATION',
  );
  for (const [listing, rev, version] of [
    ['bad', 1, '3'],
    [id(100), 0, '3'],
    [id(100), 1, '03'],
    [id(100), 1, '9007199254740992'],
  ])
    await assert.rejects(
      () => sdk.getSyntheticReferenceReviewV3(listing, rev, version, cat(), options),
      (e) => e.kind === 'VALIDATION',
    );
  const ctrl = new AbortController();
  ctrl.abort();
  await assert.rejects(
    () => write(sdk, command(), cat(), { ...options, signal: ctrl.signal }),
    (e) => e.kind === 'CANCELLED' && !e.submissionUncertain,
  );
  assert.equal(calls, 0);
});
test('original receipt must match complete retained command, actor, exact next version and outcome', async () => {
  for (const mutate of [
    (r) => (r.actorId = id(11)),
    (r) => (r.action = 'reject'),
    (r) => (r.operationId = id(301)),
    (r) => (r.reason = 'other'),
    (r) => (r.revisionVersion = '5'),
    (r) => (r.state = 'rejected'),
    (r) => (r.review.content.privateAddress = 'Changed'),
    (r) => (r.review.listingVersion = '3'),
    (r) => (r.review.photos[0].sha256 = 'b'.repeat(64)),
  ]) {
    const r = structuredClone(receipt(command()));
    mutate(r);
    await assert.rejects(
      () => write(client(async () => Response.json(r))),
      (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
    );
    await assert.rejects(
      () => recover(client(async () => Response.json(r))),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
  }
});
test('all moderation paths use strict bounded UTF8/duplicate/integer/framing transport', async () => {
  const json = JSON.stringify(review());
  const responses = [
    () =>
      new Response(json.replace('"revision":1', '"revision":1,"revision":1'), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(json.replace('"revision":1', '"revision":1.0'), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(json.replace('"position":0', '"position":0.0'), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(json.replace('"publishedRevision":1', '"publishedRevision":1e0'), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(json.replace('"bedrooms":1', '"bedrooms":1.00000000000000001'), {
        headers: { 'content-type': 'application/json' },
      }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
    () => Response.json(review(), { headers: { 'content-encoding': 'gzip' } }),
    () => Response.json(review(), { headers: { 'content-length': '1' } }),
  ];
  for (const response of responses)
    await assert.rejects(
      () => read(client(async () => response())),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
  for (const method of ['read', 'write', 'recover'])
    for (const empty of [false, true]) {
      let cancelled = false;
      const sdk = client(
        async () =>
          new Response(
            new ReadableStream({
              pull(c) {
                c.enqueue(empty ? new Uint8Array() : new Uint8Array(131073));
              },
              cancel() {
                cancelled = true;
                return new Promise(() => {});
              },
            }),
            { headers: { 'content-type': 'application/json' } },
          ),
      );
      await assert.rejects(
        () => ({ read, write, recover })[method](sdk),
        (e) =>
          e.kind === 'INVALID_RESPONSE' && Boolean(e.submissionUncertain) === (method === 'write'),
      );
      assert.equal(cancelled, true);
    }
});
test('post timeout and late response cancellation remain uncertain; original GET stall remains a read failure', async () => {
  let finish,
    cancelled = false,
    calls = 0;
  const sdk = client(() => {
    calls++;
    return new Promise((resolve) => (finish = resolve));
  });
  await assert.rejects(
    () => write(sdk, command(), cat(), { ...options, timeoutMs: 100 }),
    (e) => e.kind === 'TIMEOUT' && e.submissionUncertain,
  );
  finish(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
          return new Promise(() => {});
        },
      }),
      { headers: { 'content-type': 'application/json' } },
    ),
  );
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(cancelled, true);
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      recover(
        client(
          async () =>
            new Response(
              new ReadableStream({
                cancel() {
                  return new Promise(() => {});
                },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
        ),
        command(),
        cat(),
        { ...options, timeoutMs: 100 },
      ),
    (e) => e.kind === 'TIMEOUT' && !e.submissionUncertain,
  );
});
