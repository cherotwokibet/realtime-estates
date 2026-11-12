import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshotListingReferenceAttributes } from '@realtor/domain';
import {
  resolveMobileReferenceConfig,
  loadMobileReferenceCatalogue,
  searchMobileReferenceItems,
} from '../dist/tests/src/reference-catalogue.js';
import {
  linkedPropertyId,
  listenForPropertyLinks,
  readLinkedProperty,
} from '../dist/tests/src/property-links.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const input = {
  mode: 'synthetic-reference-public-v1',
  apiOrigin: 'https://synthetic.invalid',
  allowLoopbackHttp: false,
};
const config = () => resolveMobileReferenceConfig(input, 'sample-homes', true);
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
  slug: 'synthetic-mobile-studio',
  revision: 1,
  title: 'Synthetic mobile studio',
  description: 'Independent synthetic facts.',
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
    key: `synthetic/mobile-${i}.webp`,
    alt: `Synthetic photo ${i}`,
  })),
  pricing: {
    declaration: 'complete',
    charges: [
      {
        id: 'setup',
        name: 'Synthetic setup',
        amountStatus: 'known',
        amountMinor: 101,
        timing: 'one_off',
        classification: 'fee',
        mandatory: true,
      },
    ],
  },
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
const page = (items = [property()]) => ({
  policy: 'synthetic-reference-public-v1',
  limit: 100,
  items,
});
test('mobile configuration defaults to demo only when absent and refuses malformed, production, credential or private configuration', () => {
  assert.deepEqual(resolveMobileReferenceConfig(undefined, 'sample-homes', false), {
    mode: 'demo',
  });
  assert.equal(config().tenantSlug, 'sample-homes');
  assert.ok(Object.isFrozen(config()));
  for (const value of [
    null,
    {},
    { ...input, mode: 'live' },
    { ...input, apiOrigin: 'http://synthetic.invalid' },
    { ...input, apiOrigin: 'https://user:secret@synthetic.invalid' },
    { ...input, bearerToken: 'PRIVATE' },
    { ...input, allowLoopbackHttp: 'true' },
    Object.defineProperty({ ...input }, 'apiOrigin', {
      get() {
        throw Error('must not invoke');
      },
    }),
  ])
    assert.equal(resolveMobileReferenceConfig(value, 'sample-homes', true).mode, 'error');
  assert.equal(resolveMobileReferenceConfig(input, 'sample-homes', false).mode, 'error');
  assert.equal(resolveMobileReferenceConfig(input, 'unknown-company', true).mode, 'error');
  assert.equal(
    resolveMobileReferenceConfig(
      { ...input, apiOrigin: 'http://127.0.0.1:4109', allowLoopbackHttp: true },
      'sample-homes',
      true,
    ).mode,
    'synthetic-reference-public-v1',
  );
});
test('mobile read crosses the real SDK once anonymously, preserves exact cents and original references, and searches only public location', async () => {
  const calls = [];
  const result = await loadMobileReferenceCatalogue(config(), {
    fetch: async (url, init) => {
      calls.push({ url, init });
      return Response.json(page());
    },
  });
  assert.equal(result.status, 'ready');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://synthetic.invalid/v3/properties?limit=100');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(result.items[0].base, 'KES 20,000.01');
  assert.equal(result.items[0].initial, 'KES 20,001.02');
  assert.equal(result.items[0].recurring, 'KES 20,000.01');
  assert.equal(result.items[0].property.reference.attributes.catalogueVersion, '1');
  assert.equal(result.items[0].amenities[0].label, 'Synthetic original lift');
  assert.equal(result.items[0].location, 'Synthetic original county');
  assert.equal(searchMobileReferenceItems(result.items, ' ORIGINAL COUNTY ').length, 1);
  assert.equal(searchMobileReferenceItems(result.items, 'mobile studio').length, 0);
  assert.ok(Object.isFrozen(result.items[0]));
});
test('mobile distinguishes legacy unknown, approved empty amenities, sale no recurring period and unresolved quote', async () => {
  const legacy = {
    ...property(),
    id: id(101),
    reference: { attributes: null, revisionVersion: null },
  };
  const empty = property();
  empty.reference.attributes = { ...empty.reference.attributes, amenities: [] };
  const sale = {
    ...property(),
    id: id(102),
    purpose: 'sale',
    rentPeriod: null,
    pricing: {
      declaration: 'incomplete',
      charges: [
        {
          id: 'quote',
          name: 'Synthetic unresolved fee',
          amountStatus: 'quote_required',
          amountMinor: null,
          timing: 'one_off',
          classification: 'fee',
          mandatory: true,
        },
      ],
    },
  };
  const result = await loadMobileReferenceCatalogue(config(), {
    fetch: async () => Response.json(page([legacy, empty, sale])),
  });
  assert.equal(result.status, 'ready');
  assert.equal(result.items[0].amenities, null);
  assert.deepEqual(result.items[1].amenities, []);
  assert.equal(result.items[2].recurring, null);
  assert.equal(result.items[2].property.pricing.hasUnresolvedMandatoryAmounts, true);
  assert.equal(result.items[2].property.pricing.charges[0].amount, null);
});
test('mobile errors, private additions and cancellation never substitute demo stock or retry', async () => {
  let calls = 0;
  assert.deepEqual(
    await loadMobileReferenceCatalogue(
      { mode: 'error' },
      {
        fetch: async () => {
          calls++;
          throw Error('No I/O');
        },
      },
    ),
    { status: 'error' },
  );
  assert.equal(calls, 0);
  for (const fetch of [
    async () => {
      calls++;
      throw Error('PRIVATE details');
    },
    async () => {
      calls++;
      return new Response('', { status: 503 });
    },
    async () => {
      calls++;
      return Response.json(page([{ ...property(), privateAddress: 'PRIVATE' }]));
    },
    async () => {
      calls++;
      return Response.json({ ...page(), limit: 99 });
    },
  ])
    assert.deepEqual(await loadMobileReferenceCatalogue(config(), { fetch }), { status: 'error' });
  assert.equal(calls, 4);
  const c = new AbortController();
  c.abort();
  assert.deepEqual(
    await loadMobileReferenceCatalogue(config(), {
      signal: c.signal,
      fetch: async () => {
        throw Error('Must be aborted');
      },
    }),
    { status: 'error' },
  );
});
test('mobile keeps empty success distinct from failure and warns when its bounded page may be incomplete', async () => {
  const empty = await loadMobileReferenceCatalogue(config(), {
    fetch: async () => Response.json(page([])),
  });
  assert.deepEqual(empty, { status: 'ready', items: [], mayBeTruncated: false });
  const full = await loadMobileReferenceCatalogue(config(), {
    fetch: async () =>
      Response.json(
        page(Array.from({ length: 100 }, (_, i) => ({ ...property(), id: id(1000 + i) }))),
      ),
  });
  assert.equal(full.status, 'ready');
  assert.equal(full.items.length, 100);
  assert.equal(full.mayBeTruncated, true);
});

const publicOrigin = 'https://catalogue.synthetic.invalid';
const shared = (propertyId) => publicOrigin + '/properties/' + propertyId;

test('property links accept the configured origin and an exact canonical listing path', () => {
  assert.equal(linkedPropertyId(publicOrigin, shared(id(100))), id(100));
  for (const invalid of [
    null,
    'http://catalogue.synthetic.invalid/properties/' + id(100),
    'https://other.synthetic.invalid/properties/' + id(100),
    'https://catalogue.synthetic.invalid:443/properties/' + id(100),
    'https://catalogue.synthetic.invalid.evil.invalid/properties/' + id(100),
    'https://user@catalogue.synthetic.invalid/properties/' + id(100),
    publicOrigin + '/hidden/../properties/' + id(100),
    publicOrigin + '/properties/%30' + id(100).slice(1),
    shared(id(100)) + '?source=unknown',
    shared(id(100)) + '#extra',
    shared(id(100)) + '/',
    shared(id(100)) + '\n',
  ])
    assert.equal(linkedPropertyId(publicOrigin, invalid), null, invalid);
  assert.equal(
    resolveMobileReferenceConfig(
      { ...input, propertyLinkOrigin: publicOrigin },
      'sample-homes',
      true,
    ).propertyLinkOrigin,
    publicOrigin,
  );
  assert.equal(
    resolveMobileReferenceConfig(
      { ...input, propertyLinkOrigin: 'http://catalogue.synthetic.invalid' },
      'sample-homes',
      true,
    ).mode,
    'error',
  );
});

test('shared property reads use the exact anonymous search with no cache or stale fallback', async () => {
  const signal = new AbortController().signal;
  let calls = 0;
  const request =
    (items, total = items.length) =>
    async (url, init) => {
      calls++;
      const target = new URL(url);
      assert.equal(target.origin, 'https://synthetic.invalid');
      assert.equal(target.pathname, '/v3/properties/search');
      assert.equal(target.searchParams.get('id'), id(100));
      assert.equal(target.searchParams.get('limit'), '1');
      assert.equal(init.signal.aborted, false);
      assert.equal(init.cache, 'no-store');
      assert.equal(new Headers(init.headers).has('authorization'), false);
      return Response.json({
        policy: 'synthetic-reference-search-v1',
        items,
        total,
        limit: 1,
        offset: 0,
        sort: 'catalogue',
        hasMore: total > 1,
        maxOffset: 10000,
      });
    };
  const found = await readLinkedProperty(config(), id(100), signal, request([property()]));
  assert.equal(found.status, 'found');
  assert.equal(found.item.property.title, property().title);
  assert.deepEqual(await readLinkedProperty(config(), id(100), signal, request([])), {
    status: 'unavailable',
  });
  assert.deepEqual(
    await readLinkedProperty(config(), id(100), signal, request([{ ...property(), id: id(101) }])),
    { status: 'error' },
  );
  assert.deepEqual(await readLinkedProperty(config(), id(100), signal, request([property()], 2)), {
    status: 'error',
  });
  assert.deepEqual(
    await readLinkedProperty(config(), id(100), signal, async () => {
      throw Error('offline');
    }),
    { status: 'error' },
  );
  assert.equal(calls, 4);
});

function nativeLinks() {
  const initial = Promise.withResolvers();
  let listener;
  const calls = [];
  const states = [];
  const source = {
    getInitialURL: () => initial.promise,
    addEventListener(type, fn) {
      assert.equal(type, 'url');
      listener = fn;
      return {
        remove: () => {
          listener = undefined;
        },
      };
    },
  };
  const control = listenForPropertyLinks(
    source,
    publicOrigin,
    (id, signal) => {
      const response = Promise.withResolvers();
      calls.push({ id, signal, response });
      return response.promise;
    },
    (state) => states.push(state),
  );
  return { initial, states, calls, control, send: (url) => listener?.({ url }) };
}

test('cold-start and foreground events resolve only the newest request', async () => {
  const { initial, states, calls, control, send } = nativeLinks();
  send('https://other.synthetic.invalid/properties/' + id(102));
  initial.resolve(shared(id(100)));
  await initial.promise;
  assert.deepEqual(
    calls.map((call) => call.id),
    [id(100)],
  );
  send(shared(id(101)));
  assert.equal(calls[0].signal.aborted, true);
  calls[1].response.resolve({ status: 'unavailable' });
  await calls[1].response.promise;
  calls[0].response.resolve({ status: 'found', item: { old: true } });
  await calls[0].response.promise;
  assert.deepEqual(states, [
    { status: 'loading', id: id(100) },
    { status: 'loading', id: id(101) },
    { status: 'unavailable', id: id(101) },
  ]);
  control.stop();
});

test('a late initial URL cannot override a foreground link or a dismissed read', async () => {
  const { initial, states, calls, control, send } = nativeLinks();
  send(shared(id(101)));
  initial.resolve(shared(id(100)));
  await initial.promise;
  assert.equal(calls.length, 1);
  control.dismiss();
  assert.equal(calls[0].signal.aborted, true);
  calls[0].response.resolve({ status: 'unavailable' });
  await calls[0].response.promise;
  assert.equal(states.at(-1), null);
  send(shared(id(102)));
  control.stop();
  assert.equal(calls[1].signal.aborted, true);
  send(shared(id(100)));
  assert.equal(calls.length, 2);
});
