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
  const input = { purpose: 'rent', period: 'month', max: '20000.01', beds: '0', limit: 1 };
  const api = client(async (url, init) => {
    observed = { url, init };
    await new Promise((resolve) => (release = resolve));
    return json(page([property()], { limit: 1 }));
  });
  const pending = api.searchPropertiesV2(input);
  input.max = '1';
  while (!release) await new Promise((resolve) => setImmediate(resolve));
  release();
  const result = await pending;
  assert.equal(new URL(observed.url).pathname, '/v2/properties/search');
  assert.equal(new URL(observed.url).searchParams.get('max'), '20000.01');
  assert.equal(observed.init.credentials, 'omit');
  assert.equal(observed.init.cache, 'no-store');
  assert.equal(observed.init.redirect, 'error');
  assert.equal(observed.init.headers.Authorization, undefined);
  assert.equal(result.items[0].amountMinor, 2000001);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.items));
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
