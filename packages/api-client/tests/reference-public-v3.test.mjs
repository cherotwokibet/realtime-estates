import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
import { snapshotListingReferenceAttributes } from '@realtor/domain';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const catalogue = {
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [{ id: id(200), kind: 'county', parentId: null, label: 'Synthetic original county' }],
  amenities: [
    {
      id: id(300),
      code: 'synthetic-lift',
      label: 'Synthetic original lift',
      propertyTypes: ['studio'],
    },
  ],
};
const property = () => ({
  id: id(100),
  slug: 'synthetic-reference-public',
  revision: 1,
  title: 'Synthetic studio',
  description: 'Independent synthetic public facts.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2000001,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic original county',
  publicPrecision: 'area',
  latitude: null,
  longitude: null,
  photos: [0, 1, 2, 3].map((i) => ({
    key: `synthetic/public-${i}.webp`,
    alt: `Synthetic photo ${i}`,
  })),
  pricing: { declaration: 'not_declared', charges: [] },
  location: { county: 'Synthetic original county', town: null, area: null },
  reference: {
    attributes: snapshotListingReferenceAttributes(
      {
        catalogueVersion: '1',
        location: { countyId: id(200), localityId: null, neighbourhoodId: null },
        amenityIds: [id(300)],
      },
      catalogue,
      'studio',
    ),
    revisionVersion: '5',
  },
});
const page = () => ({ policy: 'synthetic-reference-public-v1', limit: 10, items: [property()] });
const client = (transport) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic',
    fetch: transport,
  });
const read = (sdk, options = { limit: 10 }) => sdk.getSyntheticReferencePropertiesV3(options);
test('public reference SDK uses one anonymous bounded GET and preserves explicit legacy absence', async () => {
  const calls = [],
    input = page();
  input.items.push({
    ...property(),
    id: id(101),
    reference: { attributes: null, revisionVersion: null },
  });
  const sdk = client(async (url, init) => {
    calls.push({ url, init });
    return Response.json(input);
  });
  const out = await read(sdk);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://synthetic.invalid/v3/properties?limit=10');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(out.items[0].amountMinor, 2000001);
  assert.equal(
    out.items[0].reference.attributes.location.county.label,
    'Synthetic original county',
  );
  assert.equal(out.items[0].reference.revisionVersion, '5');
  assert.deepEqual(out.items[1].reference, { attributes: null, revisionVersion: null });
  assert.ok(
    Object.isFrozen(out.items[0].reference.attributes.amenities[0]) && Object.isFrozen(out.items),
  );
  assert.ok(!JSON.stringify(out).includes('referenceCatalogue'));
});
test('public reference SDK rejects mismatched labels, private additions and malformed extension or page', async () => {
  for (const mutate of [
    (p) => (p.policy = 'other'),
    (p) => (p.limit = 11),
    (p) => (p.actorId = id(1)),
    (p) => (p.items[0].privateAddress = 'PRIVATE'),
    (p) => (p.items[0].reference.reason = 'PRIVATE'),
    (p) => (p.items[0].reference.attributes.location.county.privateAddress = 'PRIVATE'),
    (p) => (p.items[0].reference.attributes.location.county.label = 'Newer label'),
    (p) => (p.items[0].reference.revisionVersion = null),
    (p) => (p.items[0].reference.attributes = null),
    (p) => (p.items[0].reference.attributes.amenities[0].code = 'Invalid Code'),
    (p) => (p.items[0].reference.revisionVersion = '01'),
    (p) => p.items.push(...Array(11).fill(property())),
  ]) {
    const p = structuredClone(page());
    mutate(p);
    await assert.rejects(
      () => read(client(async () => Response.json(p))),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
  }
});
test('public reference path retains duplicate/integer/UTF8/framing checks and a streamed 3 MiB bound', async () => {
  const raw = JSON.stringify(page());
  for (const make of [
    () =>
      new Response(raw.replace('"revision":1', '"revision":1.0'), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(raw.replace('"amountMinor":2000001', '"amountMinor":2000001.000000001'), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(raw.replace('"bedrooms":0', '"bedrooms":0e0'), {
        headers: { 'content-type': 'application/json' },
      }),
    () =>
      new Response(raw.replace('"reference":', '"reference":{},"reference":'), {
        headers: { 'content-type': 'application/json' },
      }),
    () => new Response(new Uint8Array([255]), { headers: { 'content-type': 'application/json' } }),
    () => Response.json(page(), { headers: { 'content-encoding': 'gzip' } }),
    () => Response.json(page(), { headers: { 'content-length': '1' } }),
  ])
    await assert.rejects(
      () => read(client(async () => make())),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
  let cancelled = false;
  await assert.rejects(
    () =>
      read(
        client(
          async () =>
            new Response(
              new ReadableStream({
                start(ctrl) {
                  ctrl.enqueue(new Uint8Array(3 * 1024 * 1024 + 1));
                },
                cancel() {
                  cancelled = true;
                  return new Promise(() => {});
                },
              }),
              { headers: { 'content-type': 'application/json' } },
            ),
        ),
      ),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
  assert.equal(cancelled, true);
});
test('public reference invalid options and preabort do not dispatch; ignored transport still times out as a read', async () => {
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    return Response.json(page());
  });
  for (const options of [
    { limit: 0 },
    { limit: 101 },
    { limit: 1.1 },
    { limit: 10, tenantId: id(2) },
  ])
    await assert.rejects(
      () => read(sdk, options),
      (e) => e.kind === 'VALIDATION',
    );
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(
    () => read(sdk, { limit: 10, signal: abort.signal }),
    (e) => e.kind === 'CANCELLED',
  );
  assert.equal(calls, 0);
  await assert.rejects(
    () =>
      read(
        client(() => new Promise(() => {})),
        { limit: 10, timeoutMs: 100 },
      ),
    (e) => e.kind === 'TIMEOUT' && !e.submissionUncertain,
  );
});
