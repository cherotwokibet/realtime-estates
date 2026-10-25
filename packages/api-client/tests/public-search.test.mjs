import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const property = () => ({
  id: id(100),
  slug: 'synthetic-search',
  revision: 1,
  title: 'Synthetic studio',
  description: 'Synthetic search facts',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2000001,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic area',
  publicPrecision: 'area',
  latitude: null,
  longitude: null,
  photos: Array.from({ length: 4 }, (_, i) => ({
    key: `synthetic/search-${i}.webp`,
    alt: `Synthetic view ${i}`,
  })),
  location: { county: null, town: null, area: null },
  pricing: { declaration: 'complete', charges: [] },
});
const page = (items = [], extra = {}) => ({
  policy: 'public-search-v1',
  items,
  total: items.length,
  limit: 24,
  offset: 0,
  sort: 'catalogue',
  hasMore: false,
  maxOffset: 10000,
  ...extra,
});
const json = (body) =>
  new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://search.example.invalid',
    privacyNoticeVersion: 'search-read-only',
    fetch,
  });
test('public search validates inputs and anonymous scope before transport, without invoking getters', async () => {
  let calls = 0,
    reads = 0;
  const api = client(async () => {
    calls++;
    return json(page());
  });
  for (const input of [
    { limit: 0 },
    { offset: 10001 },
    { beds: '00' },
    { period: 'hour' },
    { max: '1.001' },
    { min: '1.001' },
    { purpose: 'sale', min: '0' },
    { purpose: 'sale', min: '-1' },
    { purpose: 'sale', min: '1e4' },
    { purpose: 'sale', min: '100000000000000000000' },
    { purpose: 'sale', min: '20000.02', max: '20000.01' },
    { purpose: 'rent', min: '100' },
    { sort: 'price_low' },
    { purpose: 'rent', max: '100' },
    { tenantId: id(1) },
    { countyId: id(1) },
    { location: 'a'.repeat(161) },
    { id: 'invalid' },
  ])
    await assert.rejects(
      () => api.searchPropertiesV2(input),
      (e) => e.kind === 'VALIDATION',
    );
  const getter = {};
  Object.defineProperty(getter, 'location', {
    enumerable: true,
    get() {
      reads++;
      return 'secret';
    },
  });
  await assert.rejects(
    () => api.searchPropertiesV2(getter),
    (e) => e.kind === 'VALIDATION',
  );
  await assert.rejects(
    () => api.searchPropertiesV2({}, { bearerToken: 'secret' }),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(calls, 0);
  assert.equal(reads, 0);
});
test('public search keeps exact facts, snapshots query and uses fixed anonymous no-store transport', async () => {
  let release, observed;
  const input = {
    purpose: 'rent',
    period: 'month',
    min: '20000.01',
    max: '20000.01',
    beds: '0',
    limit: 1,
  };
  const api = client(async (url, init) => {
    observed = { url, init };
    await new Promise((resolve) => (release = resolve));
    return json(page([property()], { limit: 1 }));
  });
  const pending = api.searchPropertiesV2(input);
  input.max = '1';
  input.min = '2';
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  release();
  const result = await pending;
  assert.equal(new URL(observed.url).pathname, '/v2/properties/search');
  assert.equal(new URL(observed.url).searchParams.get('max'), '20000.01');
  assert.equal(new URL(observed.url).searchParams.get('min'), '20000.01');
  assert.equal(observed.init.credentials, 'omit');
  assert.equal(observed.init.cache, 'no-store');
  assert.equal(observed.init.redirect, 'error');
  assert.equal(observed.init.headers.Authorization, undefined);
  assert.equal(result.items[0].amountMinor, 2000001);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.items));
});

test('reference search validates minimum ranges before I/O and preserves the exact decimal bound', async () => {
  const calls = [];
  const api = client(async (url) => {
    calls.push(url);
    return json(page([], { policy: 'synthetic-reference-search-v1' }));
  });
  for (const query of [
    { min: '1' },
    { purpose: 'rent', min: '1' },
    { purpose: 'sale', min: ['1', '2'] },
    { purpose: 'sale', min: '20000.02', max: '20000.01' },
    { purpose: 'sale', min: 'NaN' },
  ])
    await assert.rejects(
      () => api.searchSyntheticReferencePropertiesV3(query),
      (e) => e.kind === 'VALIDATION',
    );
  assert.equal(calls.length, 0);
  await api.searchSyntheticReferencePropertiesV3({
    purpose: 'rent',
    period: 'month',
    min: '20000.01',
  });
  assert.equal(new URL(calls[0]).pathname, '/v3/properties/search');
  assert.equal(new URL(calls[0]).searchParams.get('min'), '20000.01');
});

test('v2/v3 strict Over modes require a valid positive bound and price basis before transport', async () => {
  let calls = 0,
    reads = 0;
  const api = client(async () => {
    calls++;
    return json(page());
  });
  for (const search of [
    (query) => api.searchPropertiesV2(query),
    (query) => api.searchSyntheticReferencePropertiesV3(query),
  ]) {
    for (const input of [
      { minMode: 'over' },
      { purpose: 'sale', minMode: 'over' },
      { purpose: 'sale', min: '', minMode: 'over' },
      { purpose: 'sale', max: '100', minMode: 'over' },
      { purpose: 'sale', min: '0', minMode: 'over' },
      { purpose: 'sale', min: '1.001', minMode: 'over' },
      { purpose: 'sale', min: '90071992547409.92', minMode: 'over' },
      { purpose: 'sale', min: '1', minMode: 'Over' },
      { purpose: 'sale', min: '1', minMode: 'inclusive' },
      { purpose: 'sale', min: '1', minMode: ' ' },
      { purpose: 'sale', min: '1', minMode: ['over', 'over'] },
      { purpose: 'sale', min: '1', minMode: null },
      { purpose: 'sale', min: '1', minMode: true },
      { purpose: 'rent', min: '1', minMode: 'over' },
      { period: 'month', min: '1', minMode: 'over' },
      { purpose: 'sale', min: '2', max: '1', minMode: 'over' },
    ])
      await assert.rejects(
        () => search(input),
        (e) => e.kind === 'VALIDATION',
      );
    const getter = { purpose: 'sale', min: '1' };
    Object.defineProperty(getter, 'minMode', {
      enumerable: true,
      get() {
        reads++;
        return 'over';
      },
    });
    await assert.rejects(
      () => search(getter),
      (e) => e.kind === 'VALIDATION',
    );
  }
  assert.equal(calls, 0);
  assert.equal(reads, 0);
});

test('v2/v3 snapshot exact Over bounds and accept empty equality while blank mode stays inclusive', async () => {
  for (const reference of [false, true]) {
    let release, observed;
    const api = client(async (url, init) => {
      observed = { url: new URL(url), init };
      await new Promise((resolve) => (release = resolve));
      return json(
        page([], { policy: reference ? 'synthetic-reference-search-v1' : 'public-search-v1' }),
      );
    });
    const search = (input) =>
      reference ? api.searchSyntheticReferencePropertiesV3(input) : api.searchPropertiesV2(input);
    const input = {
      purpose: 'rent',
      period: 'month',
      min: '20000.01',
      minMode: 'over',
      max: '20000.01',
    };
    const pending = search(input);
    input.min = '1';
    input.minMode = '';
    input.max = '2';
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    release();
    assert.equal((await pending).total, 0);
    assert.equal(observed.url.pathname, `/v${reference ? 3 : 2}/properties/search`);
    assert.equal(observed.url.searchParams.get('min'), '20000.01');
    assert.equal(observed.url.searchParams.get('minMode'), 'over');
    assert.equal(observed.url.searchParams.get('max'), '20000.01');
    assert.equal(observed.init.credentials, 'omit');
    assert.equal(observed.init.headers.Authorization, undefined);

    for (const mode of [{}, { minMode: '' }]) {
      release = undefined;
      const inclusive = search({ purpose: 'sale', min: '90071992547409.91', ...mode });
      while (!release) await new Promise((resolve) => setImmediate(resolve));
      release();
      await inclusive;
      assert.equal(observed.url.searchParams.get('min'), '90071992547409.91');
      assert.equal(observed.url.searchParams.has('minMode'), false);
    }
    release = undefined;
    const largest = search({ purpose: 'sale', min: '90071992547409.91', minMode: 'over' });
    while (!release) await new Promise((resolve) => setImmediate(resolve));
    release();
    await largest;
    assert.equal(observed.url.searchParams.get('min'), '90071992547409.91');
    assert.equal(observed.url.searchParams.get('minMode'), 'over');
  }
});
test('search rejects inconsistent count/order/page metadata, duplicate identities and private DTO fields', async () => {
  for (const extra of [
    { total: 1 },
    { total: -1 },
    { total: 1.1 },
    { total: '0' },
    { offset: 1 },
    { limit: 12 },
    { sort: 'title' },
    { hasMore: true },
    { maxOffset: 9999 },
    { policy: 'other' },
    { secret: 'private' },
  ])
    await assert.rejects(
      () => client(async () => json(page([], extra))).searchPropertiesV2(),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
  for (const items of [
    [property(), property()],
    [{ ...property(), privateAddress: 'must not display' }],
  ])
    await assert.rejects(
      () => client(async () => json(page(items))).searchPropertiesV2(),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
});
test('search streaming is bounded and duplicate JSON keys do not replace authoritative totals', async () => {
  for (const body of [
    '{"policy":"public-search-v1","total":0,"total":1}',
    ' '.repeat(3 * 1024 * 1024 + 1),
  ])
    await assert.rejects(
      () =>
        client(
          async () => new Response(body, { headers: { 'content-type': 'application/json' } }),
        ).searchPropertiesV2(),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
});

const choices = () => ({
  policy: 'synthetic-reference-options-v1',
  maximumPerCategory: 5000,
  options: {
    countyId: [
      { id: id(200), label: 'Synthetic County' },
      { id: id(201), label: 'Synthetic County' },
    ],
    localityId: [],
    neighbourhoodId: [],
    amenityId: [{ id: id(300), label: 'Synthetic lift' }],
  },
});
test('global public choices preserve same-label distinct IDs and freeze validated anonymous results', async () => {
  let call;
  const api = client(async (url, init) => {
    call = { url, init };
    return json(choices());
  });
  const result = await api.getSyntheticReferenceSearchOptions();
  assert.equal(new URL(call.url).pathname, '/v3/property-reference-options');
  assert.equal(new URL(call.url).search, '');
  assert.equal(call.init.credentials, 'omit');
  assert.equal(call.init.cache, 'no-store');
  assert.equal(result.countyId.length, 2);
  assert.notEqual(result.countyId[0].id, result.countyId[1].id);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.countyId));
  assert.ok(Object.isFrozen(result.countyId[0]));
  await assert.rejects(
    () => api.getSyntheticReferenceSearchOptions({ bearerToken: 'secret' }),
    (e) => e.kind === 'VALIDATION',
  );
});
test('global choices refuse incomplete authority metadata, duplicate IDs, malformed labels and overflows', async () => {
  const variants = [
    { ...choices(), maximumPerCategory: 4999 },
    { ...choices(), privateAddress: 'secret' },
  ];
  for (const mutate of [
    (p) => p.options.countyId.push(p.options.countyId[0]),
    (p) => p.options.amenityId.push({ id: id(200), label: 'Reused ID' }),
    (p) => delete p.options.localityId,
    (p) => (p.options.countyId[0].label = ' space '),
    (p) => (p.options.countyId[0].label = 'e\u0301'),
    (p) => (p.options.countyId[0].label = 'x'.repeat(513)),
    (p) => (p.options.countyId[0].id = 'bad'),
    (p) => (p.options.countyId[0].privateAddress = 'secret'),
    (p) =>
      (p.options.amenityId = Array.from({ length: 5001 }, (_, i) => ({
        id: id(1000 + i),
        label: 'Large',
      }))),
  ]) {
    const p = choices();
    mutate(p);
    variants.push(p);
  }
  for (const body of variants)
    await assert.rejects(
      () => client(async () => json(body)).getSyntheticReferenceSearchOptions(),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
});
test('otherwise valid v2/v3 search and options refuse duplicate and rounded metadata JSON tokens', async () => {
  for (const reference of [false, true])
    for (const raw of [
      JSON.stringify(
        page([], { policy: reference ? 'synthetic-reference-search-v1' : 'public-search-v1' }),
      ).replace('"total":0', '"total":0,"total":0'),
      JSON.stringify(
        page([], { policy: reference ? 'synthetic-reference-search-v1' : 'public-search-v1' }),
      ).replace('"total":0', '"total":0e0'),
    ]) {
      const api = client(
        async () => new Response(raw, { headers: { 'content-type': 'application/json' } }),
      );
      await assert.rejects(
        () => (reference ? api.searchSyntheticReferencePropertiesV3() : api.searchPropertiesV2()),
        (e) => e.kind === 'INVALID_RESPONSE',
      );
    }
  const raw = JSON.stringify(choices()).replace(
    '"maximumPerCategory":5000',
    '"maximumPerCategory":5000,"maximumPerCategory":5000',
  );
  await assert.rejects(
    () =>
      client(
        async () => new Response(raw, { headers: { 'content-type': 'application/json' } }),
      ).getSyntheticReferenceSearchOptions(),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
});
