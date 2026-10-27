import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReferenceFilters from '../dist/tests/components/ReferenceFilters.js';
import SearchAreaField from '../dist/tests/components/SearchAreaField.js';
import SearchAreaMapEditor from '../dist/tests/components/SearchAreaMapEditor.js';
import {
  OSM_STANDARD_TILE_URL,
  moveSearchAreaPolygonVertex,
  searchAreaPolygonFromText,
  searchAreaPolygonText,
  searchAreaPolygonVerticesFromText,
  supportedSearchAreaTileUrl,
  undoSearchAreaMapPoint,
} from '../dist/tests/lib/search-area-editor.js';
import {
  additionalActiveFilterLabels,
  loadedPageHref,
  browseCatalogue,
} from '../dist/tests/lib/catalogue-browse.js';
import {
  parseReferenceFilters,
  referenceOptions,
} from '../dist/tests/lib/catalogue-reference-filters.js';
import { snapshotListingReferenceAttributes } from '@realtor/domain';
import {
  createCatalogueLoader,
  resolveCatalogueConfig,
  parseCatalogueFilters,
  CATALOGUE_UNAVAILABLE_MESSAGE,
} from '../dist/tests/lib/catalogue.js';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const searchArea = {
  type: 'Polygon',
  coordinates: [
    [
      [36.8, -1.3],
      [36.9, -1.3],
      [36.9, -1.2],
      [36.8, -1.2],
      [36.8, -1.3],
    ],
  ],
};
const property = (patch = {}) => ({
  id: id(100),
  slug: 'synthetic-web-studio',
  revision: 1,
  title: 'Synthetic catalogue studio',
  description: 'Synthetic web data-layer test; never live inventory.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 2000001,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic locality',
  publicPrecision: 'area',
  latitude: null,
  longitude: null,
  photos: [0, 1, 2, 3].map((position) => ({
    key: `synthetic/web-${position}.webp`,
    alt: `Synthetic metadata view ${position}`,
  })),
  pricing: {
    declaration: 'complete',
    charges: [
      {
        id: 'setup',
        name: 'Setup fee',
        amountStatus: 'known',
        amountMinor: 101,
        timing: 'one_off',
        classification: 'fee',
        mandatory: true,
      },
    ],
  },
  location: { county: 'Synthetic County', town: 'Synthetic Town', area: 'Synthetic Area' },
  ...patch,
});
const connectedEnvironment = {
  WEB_CATALOGUE_MODE: 'connected',
  API_ORIGIN: 'https://catalogue.example.invalid',
  TENANT_SLUG: 'realtime-estates',
  WEB_CATALOGUE_DATA: 'synthetic',
};
const json = (payload) =>
  new Response(JSON.stringify(payload), { headers: { 'Content-Type': 'application/json' } });
function connected(items = [property()], environment = {}, fetch) {
  return createCatalogueLoader(
    resolveCatalogueConfig({ ...connectedEnvironment, ...environment }),
    { fetch: fetch ?? (async () => json({ items, limit: 100 })) },
  );
}
const ready = (result) => {
  assert.notEqual(result.mode, 'error');
  return result;
};
const referenceEnvironment = {
  WEB_CATALOGUE_REFERENCE: 'synthetic-reference-public-v1',
  NODE_ENV: 'test',
};
const referenceProperty = () => {
  const catalogue = {
    policy: 'synthetic-reference-catalogue-v1',
    version: '1',
    country: 'KE',
    locations: [
      { id: id(200), kind: 'county', parentId: null, label: 'Synthetic County' },
      { id: id(201), kind: 'locality', parentId: id(200), label: 'Synthetic Town' },
      { id: id(202), kind: 'neighbourhood', parentId: id(201), label: 'Synthetic Area' },
    ],
    amenities: [
      { id: id(300), code: 'synthetic-lift', label: 'Synthetic lift', propertyTypes: ['studio'] },
    ],
  };
  return property({
    locality: 'Synthetic Area',
    reference: {
      revisionVersion: '5',
      attributes: snapshotListingReferenceAttributes(
        {
          catalogueVersion: '1',
          location: { countyId: id(200), localityId: id(201), neighbourhoodId: id(202) },
          amenityIds: [id(300)],
        },
        catalogue,
        'studio',
      ),
    },
  });
};

const searchPayload = (
  items,
  total,
  offset,
  limit = 12,
  sort = 'catalogue',
  reference = false,
) => ({
  policy: reference ? 'synthetic-reference-search-v1' : 'public-search-v1',
  items,
  total,
  offset,
  limit,
  sort,
  hasMore: offset + items.length < total,
  maxOffset: 10000,
});
test('global web search uses trusted SDK transport and never slices a server page twice', async () => {
  const calls = [],
    items = Array.from({ length: 12 }, (_, i) => property({ id: id(1000 + i) }));
  const loader = connected(
    items,
    { WEB_CATALOGUE_SEARCH: 'public-search-v1' },
    async (url, init) => {
      calls.push({ url, init });
      return json(searchPayload(items, 30, 12));
    },
  );
  const result = ready(
    await loader.list({
      page: '2',
      purpose: 'rent',
      period: 'month',
      min: '20000.01',
      max: '20000.02',
      beds: '0',
      location: 'Synthetic',
      tenantId: 'foreign',
      API_ORIGIN: 'https://foreign.invalid',
    }),
  );
  const browse = browseCatalogue(result, { page: '2' });
  assert.equal(browse.items.length, 12);
  assert.equal(browse.scope, 'catalogue');
  assert.equal(browse.start, 13);
  assert.equal(browse.end, 24);
  assert.equal(browse.pageCount, 3);
  assert.equal(browse.matchingLoadedCount, 30);
  assert.equal(browse.outOfRange, false);
  const url = new URL(calls[0].url);
  assert.equal(url.pathname, '/v2/properties/search');
  assert.equal(url.searchParams.get('offset'), '12');
  assert.equal(url.searchParams.get('limit'), '12');
  assert.equal(url.searchParams.get('beds'), '0');
  assert.equal(url.searchParams.get('min'), '20000.01');
  assert.equal(url.searchParams.get('max'), '20000.02');
  assert.equal(url.searchParams.get('tenantId'), null);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.headers.Authorization, undefined);
  const html = renderToStaticMarkup(
    React.createElement(
      (await import('../dist/tests/components/LoadedCataloguePager.js')).default,
      { browse, filters: result.filters },
    ),
  );
  assert.ok(html.includes('Next search page'));
  assert.ok(!html.includes('matching loaded properties'));
  assert.ok(html.includes('13–24 of 30'));
  assert.ok(html.includes('min=20000.01'));
  assert.ok(html.includes('max=20000.02'));
});

test('drawn-area query parsing is bounded, rejects repeated or malformed geometry, and fails closed without search support', async () => {
  const encoded = JSON.stringify(searchArea);
  assert.deepEqual(parseCatalogueFilters({ area: encoded }).area, searchArea);
  for (const area of [
    ['{}', '{}'],
    '{bad json',
    JSON.stringify({ type: 'Polygon', coordinates: [] }),
    'x'.repeat(8193),
  ]) {
    const filters = parseCatalogueFilters({ area });
    assert.equal(filters.area, null);
    assert.equal(filters.error, 'Choose one valid search area.');
  }

  const demoResult = await createCatalogueLoader(
    resolveCatalogueConfig({ TENANT_SLUG: 'realtime-estates' }),
  ).list({ area: encoded });
  assert.equal(demoResult.mode, 'error');
  assert.equal(demoResult.code, 'CONFIGURATION');
  assert.equal(demoResult.items, undefined);
  assert.match(demoResult.message, /connected catalogue search support/);

  const loadedOnly = connected([], {}, async () => {
    throw Error('area search must not silently fall back to loaded rows');
  });
  const loadedResult = await loadedOnly.list({ area: encoded });
  assert.equal(loadedResult.mode, 'error');
  assert.equal(loadedResult.code, 'CONFIGURATION');
});

test('active filter summary includes bathroom, polygon, and saved-reference criteria without leaking unavailable IDs', () => {
  const countyId = id(1);
  const amenityId = id(2);
  const filters = parseCatalogueFilters({
    privateBaths: '2',
    sharedBaths: '1',
    area: JSON.stringify(searchArea),
    countyId,
    amenityId,
  });
  const options = {
    countyId: [{ id: countyId, label: 'Synthetic County' }],
    localityId: [],
    neighbourhoodId: [],
    amenityId: [],
  };
  assert.deepEqual(additionalActiveFilterLabels(filters, options), [
    'Private bathrooms: at least 2',
    'Shared bathrooms: at least 1',
    'Custom search area',
    'Synthetic County',
    'Amenity selection unavailable',
  ]);
  assert.ok(
    additionalActiveFilterLabels(filters, options).every(
      (label) => !label.includes(countyId) && !label.includes(amenityId),
    ),
  );
});

test('search area editor offers an accessible keyboard field and can clear only the area filter', () => {
  const filters = parseCatalogueFilters({ area: JSON.stringify(searchArea), purpose: 'sale' });
  const html = renderToStaticMarkup(
    React.createElement(SearchAreaField, {
      supported: true,
      invalid: false,
      value: JSON.stringify(searchArea),
      filters,
      sort: 'catalogue',
      tileUrl: null,
    }),
  );
  assert.match(html, /legend[^>]*>Search within a polygon area/);
  assert.match(html, /aria-describedby="search-area-help"/);
  assert.match(html, /name="area"/);
  assert.match(html, /maxlength="8192"/i);
  const clearHref = html.match(/href="([^"]+)"/)[1];
  const clear = new URL(clearHref, 'https://web.example.invalid');
  assert.equal(clear.searchParams.get('area'), null);
  assert.equal(clear.searchParams.get('purpose'), 'sale');
  assert.equal(clear.hash, '#properties');

  const malformedArea = '{"type":"MultiPolygon"}';
  const malformedFilters = parseCatalogueFilters({ area: malformedArea, purpose: 'sale' });
  assert.equal(malformedFilters.error, 'Choose one valid search area.');
  const malformedHtml = renderToStaticMarkup(
    React.createElement(SearchAreaField, {
      supported: true,
      invalid: true,
      value: malformedArea,
      filters: malformedFilters,
      sort: 'catalogue',
      tileUrl: null,
    }),
  );
  const malformedClearHref = malformedHtml.match(/href="([^"]+)"/)[1];
  const malformedClear = new URL(malformedClearHref, 'https://web.example.invalid');
  assert.equal(malformedClear.searchParams.get('area'), null);
  assert.equal(malformedClear.searchParams.get('purpose'), 'sale');
  assert.equal(malformedClear.hash, '#properties');
  assert.equal(
    renderToStaticMarkup(
      React.createElement(SearchAreaField, {
        supported: false,
        invalid: false,
        value: '',
        filters,
        sort: 'catalogue',
        tileUrl: null,
      }),
    ),
    '',
  );
});

test('map-vertex serializer shares the bounded, closed, non-self-intersecting GeoJSON contract', () => {
  const text = searchAreaPolygonText([
    [36.8, -1.3],
    [36.9, -1.3],
    [36.9, -1.2],
    [36.8, -1.2],
  ]);
  assert.ok(text);
  const polygon = JSON.parse(text);
  assert.deepEqual(polygon.coordinates[0], [
    [36.8, -1.3],
    [36.9, -1.3],
    [36.9, -1.2],
    [36.8, -1.2],
    [36.8, -1.3],
  ]);
  assert.deepEqual(searchAreaPolygonFromText(text), polygon);
  assert.deepEqual(searchAreaPolygonVerticesFromText(text), [
    [36.8, -1.3],
    [36.9, -1.3],
    [36.9, -1.2],
    [36.8, -1.2],
  ]);
  assert.equal(searchAreaPolygonVerticesFromText('{'), null);
  assert.equal(searchAreaPolygonFromText('{'), null);
  assert.equal(searchAreaPolygonFromText('x'.repeat(8193)), null);
});

test('map vertex dragging validates a copy and preserves the previous boundary when a move is invalid', () => {
  const original = [
    [36.8, -1.3],
    [36.9, -1.3],
    [36.9, -1.2],
    [36.8, -1.2],
  ];
  const valid = moveSearchAreaPolygonVertex(original, 1, [36.95, -1.31]);
  assert.deepEqual(valid, [
    [36.8, -1.3],
    [36.95, -1.31],
    [36.9, -1.2],
    [36.8, -1.2],
  ]);
  assert.ok(searchAreaPolygonText(valid));
  assert.deepEqual(original, [
    [36.8, -1.3],
    [36.9, -1.3],
    [36.9, -1.2],
    [36.8, -1.2],
  ]);
  assert.equal(moveSearchAreaPolygonVertex(original, 1, [36.9, -1.2]), null);
  assert.equal(moveSearchAreaPolygonVertex(original, 9, [36.91, -1.31]), null);
});

test('drawing can undo the last point without mutating the current list', () => {
  const original = [
    [36.8, -1.3],
    [36.9, -1.3],
    [36.9, -1.2],
  ];
  assert.deepEqual(undoSearchAreaMapPoint(original), [
    [36.8, -1.3],
    [36.9, -1.3],
  ]);
  assert.deepEqual(undoSearchAreaMapPoint([]), []);
  assert.deepEqual(original, [
    [36.8, -1.3],
    [36.9, -1.3],
    [36.9, -1.2],
  ]);
});

test('map-vertex serializer refuses insufficient, duplicate, self-crossing, and oversized boundaries', () => {
  assert.equal(
    searchAreaPolygonText([
      [36.8, -1.3],
      [36.9, -1.3],
    ]),
    null,
  );
  assert.equal(
    searchAreaPolygonText([
      [36.8, -1.3],
      [36.9, -1.3],
      [36.9, -1.2],
      [36.8, -1.3],
    ]),
    null,
  );
  assert.equal(
    searchAreaPolygonText([
      [36.8, -1.3],
      [36.9, -1.2],
      [36.9, -1.3],
      [36.8, -1.2],
    ]),
    null,
  );
  const circle = Array.from({ length: 101 }, (_, index) => {
    const angle = (index * 2 * Math.PI) / 101;
    return [36.8 + 0.1 * Math.cos(angle), -1.3 + 0.1 * Math.sin(angle)];
  });
  assert.equal(searchAreaPolygonText(circle), null);
});

test('interactive map stays explicit opt-in and keeps the GeoJSON field when no supported tiles are configured', () => {
  assert.equal(supportedSearchAreaTileUrl(undefined), null);
  assert.equal(supportedSearchAreaTileUrl('http://tile.openstreetmap.org/{z}/{x}/{y}.png'), null);
  assert.equal(supportedSearchAreaTileUrl('https://tiles.example.invalid/{z}/{x}/{y}.png'), null);
  assert.equal(supportedSearchAreaTileUrl(OSM_STANDARD_TILE_URL), OSM_STANDARD_TILE_URL);
  const filters = parseCatalogueFilters({ purpose: 'sale' });
  const html = renderToStaticMarkup(
    React.createElement(SearchAreaField, {
      supported: true,
      invalid: false,
      value: '',
      filters,
      sort: 'catalogue',
      tileUrl: null,
    }),
  );
  assert.match(html, /Interactive map drawing is not configured here/);
  assert.match(html, /name="area"/);
  assert.doesNotMatch(html, /class="search-area-map-editor__map"/);
  const configured = renderToStaticMarkup(
    React.createElement(SearchAreaMapEditor, {
      tileUrl: OSM_STANDARD_TILE_URL,
      textareaId: 'search-area-polygon',
    }),
  );
  assert.match(configured, /Start a new boundary/);
  assert.match(configured, /aria-label="Map for drawing a search boundary"/);
  assert.match(configured, /Map data/);
});
test('global web original detail is addressed by ID beyond the original loaded page without fallback', async () => {
  const target = property({ id: id(999) }),
    calls = [];
  const loader = connected([], { WEB_CATALOGUE_SEARCH: 'public-search-v1' }, async (url) => {
    calls.push(url);
    return json(searchPayload([target], 1, 0, 1));
  });
  const result = await loader.detail(target.id);
  assert.equal(result.status, 'found');
  assert.equal(result.property.id, target.id);
  assert.equal(new URL(calls[0]).searchParams.get('id'), target.id);
  assert.equal(calls.length, 1);
  const bad = connected([], { WEB_CATALOGUE_SEARCH: 'public-search-v1' }, async () =>
    json(searchPayload([target], 1, 0, 1)),
  );
  assert.equal((await bad.detail(id(998))).mode, 'error');
});
test('global web search keeps exact out-of-range totals and refuses unsupported pages before transport', async () => {
  let calls = 0;
  const loader = connected([], { WEB_CATALOGUE_SEARCH: 'public-search-v1' }, async () => {
    calls++;
    return json(searchPayload([], 30, 48));
  });
  const result = ready(await loader.list({ page: '5' }));
  const browse = browseCatalogue(result, { page: '5' });
  assert.equal(browse.outOfRange, true);
  assert.equal(browse.matchingLoadedCount, 30);
  assert.equal(browse.pageCount, 3);
  assert.deepEqual(browse.items, []);
  const invalid = ready(await loader.list({ page: '835' }));
  assert.ok(invalid.filters.error);
  assert.equal(calls, 1);
  assert.equal(
    resolveCatalogueConfig({ WEB_CATALOGUE_MODE: 'demo', WEB_CATALOGUE_SEARCH: 'public-search-v1' })
      .status,
    'error',
  );
});
test('global reference web search sends saved IDs and ordinary search refuses them without broadening', async () => {
  const source = referenceProperty();
  let calls = 0;
  const loader = connected(
    [source],
    { ...referenceEnvironment, WEB_CATALOGUE_SEARCH: 'public-search-v1' },
    async (url) => {
      calls++;
      const q = new URL(url);
      if (q.pathname === '/v3/property-reference-options')
        return json({
          policy: 'synthetic-reference-options-v1',
          maximumPerCategory: 5000,
          options: {
            countyId: [{ id: id(200), label: 'Synthetic County' }],
            localityId: [],
            neighbourhoodId: [],
            amenityId: [{ id: id(300), label: 'Synthetic lift' }],
          },
        });
      assert.equal(q.pathname, '/v3/properties/search');
      assert.equal(q.searchParams.get('countyId'), id(200));
      assert.equal(q.searchParams.get('amenityId'), id(300));
      return json(searchPayload([source], 1, 0, 12, 'catalogue', true));
    },
  );
  const result = ready(await loader.list({ countyId: id(200), amenityId: id(300) }));
  assert.equal(result.items[0].reference.attributes.location.county.id, id(200));
  assert.equal(result.searchPage.total, 1);
  const ordinary = connected([], { WEB_CATALOGUE_SEARCH: 'public-search-v1' }, async () => {
    throw Error('must not broaden');
  });
  assert.ok(ready(await ordinary.list({ countyId: id(200) })).filters.error);
  assert.equal(calls, 2);
});

test('global dropdown choices survive empty matching pages and never infer IDs from page labels', async () => {
  const options = {
    countyId: [{ id: id(200), label: 'Approved other-page County' }],
    localityId: [],
    neighbourhoodId: [],
    amenityId: [{ id: id(300), label: 'Approved other-page lift' }],
  };
  const calls = [];
  const loader = connected(
    [],
    { ...referenceEnvironment, WEB_CATALOGUE_SEARCH: 'public-search-v1' },
    async (url) => {
      calls.push(url);
      return json(
        new URL(url).pathname === '/v3/property-reference-options'
          ? { policy: 'synthetic-reference-options-v1', maximumPerCategory: 5000, options }
          : searchPayload([], 0, 0, 12, 'catalogue', true),
      );
    },
  );
  const result = ready(await loader.list({ countyId: id(999) }));
  assert.deepEqual(result.items, []);
  assert.equal(result.referenceOptionsScope, 'catalogue');
  assert.deepEqual(result.referenceOptions, options);
  assert.equal(calls.length, 2);
  assert.equal(new URL(calls.find((url) => url.includes('property-reference-options'))).search, '');
  const html = renderToStaticMarkup(
    React.createElement(ReferenceFilters, {
      values: result.filters.reference,
      options: result.referenceOptions,
      invalid: [],
      scope: result.referenceOptionsScope,
    }),
  );
  assert.ok(html.includes('approved public properties'));
  assert.ok(html.includes('Approved other-page lift'));
  assert.ok(html.includes('Selected option unavailable in current public choices'));
});
test('global choice read failure refuses the reference search display without fallback to current-page choices', async () => {
  const source = referenceProperty();
  let calls = 0;
  const loader = connected(
    [source],
    { ...referenceEnvironment, WEB_CATALOGUE_SEARCH: 'public-search-v1' },
    async (url) => {
      calls++;
      return new URL(url).pathname === '/v3/property-reference-options'
        ? new Response('unavailable', { status: 503 })
        : json(searchPayload([source], 1, 0, 12, 'catalogue', true));
    },
  );
  assert.equal((await loader.list()).mode, 'error');
  assert.equal(calls, 2);
});

test('public ID filtering uses saved identities rather than identical labels or legacy text', async () => {
  const first = referenceProperty(),
    other = structuredClone(first);
  other.id = id(101);
  other.reference.attributes.location.county.id = id(210);
  other.reference.attributes.location.locality.id = id(211);
  other.reference.attributes.location.neighbourhood.id = id(212);
  other.reference.attributes.amenities[0].id = id(310);
  const legacy = property({ id: id(102), reference: { attributes: null, revisionVersion: null } });
  const loader = connected([first, other, legacy], referenceEnvironment, async () =>
    json({ policy: 'synthetic-reference-public-v1', items: [first, other, legacy], limit: 100 }),
  );
  assert.deepEqual(
    ready(
      await loader.list({
        countyId: id(200),
        localityId: id(201),
        neighbourhoodId: id(202),
        amenityId: id(300),
      }),
    ).items.map((x) => x.id),
    [first.id],
  );
  assert.equal(ready(await loader.list({ countyId: id(210), amenityId: id(300) })).items.length, 0);
  assert.equal(ready(await loader.list({ neighbourhoodId: id(999) })).items.length, 0);
  assert.equal(ready(await loader.list()).items.length, 3);
});

test('reference GET filters reject repeated/malformed/oversized identities without widening results', async () => {
  const source = referenceProperty();
  const loader = connected([source], referenceEnvironment, async () =>
    json({ policy: 'synthetic-reference-public-v1', items: [source], limit: 100 }),
  );
  for (const key of ['countyId', 'localityId', 'neighbourhoodId', 'amenityId'])
    for (const value of [
      [id(200)],
      ' ' + id(200),
      id(200) + ' ',
      'Synthetic County',
      id(200).toUpperCase().replace('4000', 'A000'),
      'x'.repeat(10000),
    ]) {
      const result = ready(await loader.list({ [key]: value }));
      assert.equal(result.items.length, 0);
      assert.equal(
        result.filters.error,
        'Choose one supported location or amenity option per field.',
      );
      assert.deepEqual(parseReferenceFilters({ [key]: value }).invalid, [key]);
    }
});

test('public reference facets use unfiltered loaded snapshots and preserve exact source limits', async () => {
  const source = referenceProperty(),
    calls = [];
  const loader = connected([source], referenceEnvironment, async (url, init) => {
    calls.push({ url, init });
    return json({
      policy: 'synthetic-reference-public-v1',
      items: Array.from({ length: 100 }, (_, i) => ({
        ...source,
        id: id(1000 + i),
        slug: 'synthetic-' + i,
      })),
      limit: 100,
    });
  });
  const result = ready(
    await loader.list({
      amenityId: id(999),
      beds: '0',
      purpose: 'rent',
      period: 'month',
      max: '20000.01',
    }),
  );
  assert.equal(result.items.length, 0);
  assert.equal(result.sourceCount, 100);
  assert.equal(result.mayBeTruncated, true);
  assert.equal(result.limit, 100);
  assert.deepEqual(result.referenceOptions.amenityId, [{ id: id(300), label: 'Synthetic lift' }]);
  assert.equal(
    result.referenceOptions.neighbourhoodId[0].label,
    'Synthetic County › Synthetic Town › Synthetic Area',
  );
  assert.ok(Object.isFrozen(result.referenceOptions));
  assert.ok(Object.isFrozen(result.referenceOptions.countyId));
  assert.ok(Object.isFrozen(result.referenceOptions.countyId[0]));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/v3/properties?limit=100'));
  assert.equal(calls[0].init.headers.Authorization, undefined);
});

test('demo/legacy amenity labels do not invent public reference identities', async () => {
  const demo = ready(
    await createCatalogueLoader(
      resolveCatalogueConfig({ WEB_CATALOGUE_MODE: 'demo', TENANT_SLUG: 'realtime-estates' }),
    ).list(),
  );
  assert.ok(demo.items.length > 0);
  assert.deepEqual(demo.referenceOptions, {
    countyId: [],
    localityId: [],
    neighbourhoodId: [],
    amenityId: [],
  });
  const result = ready(
    await createCatalogueLoader(
      resolveCatalogueConfig({ WEB_CATALOGUE_MODE: 'demo', TENANT_SLUG: 'realtime-estates' }),
    ).list({ amenityId: id(300) }),
  );
  assert.equal(result.items.length, 0);
});

test('historic labels and same-label different IDs remain distinct immutable choices', async () => {
  const source = referenceProperty(),
    old = structuredClone(source),
    other = structuredClone(source);
  old.id = id(101);
  old.reference.attributes.catalogueVersion = '2';
  old.reference.attributes.amenities[0].label = 'Earlier lift';
  other.id = id(102);
  other.reference.attributes.amenities[0].id = id(301);
  const loader = connected([source, old, other], referenceEnvironment, async () =>
    json({ policy: 'synthetic-reference-public-v1', items: [source, old, other], limit: 100 }),
  );
  const result = ready(await loader.list({ amenityId: id(300) }));
  assert.equal(result.items.length, 2);
  assert.deepEqual(result.referenceOptions.amenityId, [
    { id: id(300), label: 'Earlier lift / Synthetic lift' },
    { id: id(301), label: 'Synthetic lift' },
  ]);
});

test('reference identity filters compose with room and exact-cent budget constraints', async () => {
  const source = referenceProperty();
  const loader = connected([source], referenceEnvironment, async () =>
    json({ policy: 'synthetic-reference-public-v1', items: [source], limit: 100 }),
  );
  const query = {
    countyId: id(200),
    amenityId: id(300),
    beds: '0',
    privateBaths: '1',
    purpose: 'rent',
    period: 'month',
    max: '20000.01',
  };
  assert.equal(ready(await loader.list(query)).items.length, 1);
  for (const extra of [{ sharedBaths: '0' }, { max: '20000.00' }, { beds: '1' }])
    assert.equal(ready(await loader.list({ ...query, ...extra })).items.length, 0);
  const href = loadedPageHref(parseCatalogueFilters(query), 'title', 2),
    url = new URL(href, 'https://web.example.invalid');
  for (const [key, value] of Object.entries(query)) assert.equal(url.searchParams.get(key), value);
  assert.equal(url.searchParams.get('page'), '2');
});

test('reference controls label options, preserve unavailable selections and escape supplied labels', () => {
  const values = parseReferenceFilters({ countyId: id(200), amenityId: id(999) }).values;
  const options = {
    ...referenceOptions([]),
    countyId: [{ id: id(200), label: '<script>County</script>' }],
  };
  const html = renderToStaticMarkup(
    React.createElement(ReferenceFilters, { values, options, invalid: ['amenityId'] }),
  );
  assert.ok(html.includes('&lt;script&gt;County&lt;/script&gt;'));
  assert.ok(!html.includes('<script>'));
  assert.match(html, new RegExp('value="' + id(999) + '" selected=""'));
  assert.ok(html.includes('Selected option unavailable in loaded selection'));
  assert.match(
    html,
    /<select(?=[^>]*name="amenityId")(?=[^>]*aria-invalid="true")(?=[^>]*aria-describedby="search-error")[^>]*>/,
  );
  assert.ok(html.includes('All selected locations and the amenity must match the same property'));
  assert.equal(
    renderToStaticMarkup(
      React.createElement(ReferenceFilters, {
        values: parseReferenceFilters({}).values,
        options: referenceOptions([]),
        invalid: [],
      }),
    ),
    '',
  );
});
test('explicit synthetic reference web mode maps approved historical amenities and exact pricing through the real SDK', async () => {
  const source = referenceProperty(),
    calls = [];
  const loader = connected([source], referenceEnvironment, async (url, init) => {
    calls.push({ url, init });
    return json({ policy: 'synthetic-reference-public-v1', items: [source], limit: 100 });
  });
  const result = ready(await loader.list({ location: 'Synthetic Town' }));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.endsWith('/v3/properties?limit=100'));
  assert.equal(calls[0].init.headers.Authorization, undefined);
  assert.equal(result.sourceLabel, 'API connected · Synthetic reference preview');
  assert.equal(result.items[0].priceMinor, 2000001);
  assert.deepEqual(result.items[0].amenities, ['Synthetic lift']);
  assert.equal(result.items[0].amenitiesKnown, true);
  assert.equal(result.items[0].reference.revisionVersion, '5');
  assert.equal(result.items[0].reference.attributes.location.county.id, id(200));
  assert.ok(Object.isFrozen(result.items[0].reference.attributes.amenities));
});
test('legacy absence stays unknown and an adopted empty amenity selection stays explicitly empty', async () => {
  const adopted = structuredClone(referenceProperty());
  adopted.reference.attributes.amenities = [];
  const legacy = property({ id: id(101), reference: { attributes: null, revisionVersion: null } });
  const result = ready(
    await connected([adopted, legacy], referenceEnvironment, async () =>
      json({ policy: 'synthetic-reference-public-v1', items: [adopted, legacy], limit: 100 }),
    ).list(),
  );
  assert.equal(result.items[0].amenitiesKnown, true);
  assert.deepEqual(result.items[0].amenities, []);
  assert.equal(result.items[1].amenitiesKnown, false);
  assert.deepEqual(result.items[1].amenities, []);
  assert.equal(result.items[1].reference.attributes, null);
});
test('reference web mode refuses production, demo, unspecified data and unknown modes without a request', async () => {
  let calls = 0;
  for (const patch of [
    { NODE_ENV: 'production' },
    { WEB_CATALOGUE_MODE: 'demo' },
    { WEB_CATALOGUE_DATA: 'unspecified' },
    { WEB_CATALOGUE_REFERENCE: 'live' },
  ]) {
    const result = await connected([], { ...referenceEnvironment, ...patch }, async () => {
      calls++;
      throw Error();
    }).list();
    assert.equal(result.mode, 'error');
    assert.equal(result.code, 'CONFIGURATION');
  }
  assert.equal(calls, 0);
});
test('reference read errors and changed public labels remain errors with no v2 or demo fallback', async () => {
  for (const mode of ['missing', 'renamed']) {
    let calls = 0;
    const source = structuredClone(referenceProperty());
    source.reference.attributes.location.county.label = 'Newer label';
    const result = await connected([], referenceEnvironment, async () => {
      calls++;
      if (mode === 'missing') throw Error();
      return json({ policy: 'synthetic-reference-public-v1', items: [source], limit: 100 });
    }).list();
    assert.equal(result.mode, 'error');
    assert.equal(result.code, 'UNAVAILABLE');
    assert.equal(calls, 1);
  }
});

test('default mode stays synthetic demo even with an API origin, with company-separated immutable fixtures', async () => {
  let calls = 0;
  const realtime = createCatalogueLoader(
    resolveCatalogueConfig({ API_ORIGIN: 'https://ignored.example.invalid' }),
    {
      fetch: async () => {
        calls++;
        throw new Error('Demo must not connect');
      },
    },
  );
  const result = ready(await realtime.list());
  assert.equal(result.mode, 'demo');
  assert.equal(result.dataKind, 'synthetic');
  assert.equal(result.items.length, 4);
  assert.equal(result.limit, null);
  assert.equal(result.mayBeTruncated, false);
  assert.equal(calls, 0);
  const sample = createCatalogueLoader(resolveCatalogueConfig({ TENANT_SLUG: 'sample-homes' }));
  const other = ready(await sample.list());
  assert.deepEqual(
    other.items.map((item) => item.id),
    ['sample-property-1'],
  );
  assert.equal(
    result.items.some((item) => item.id === 'sample-property-1'),
    false,
  );
  assert.equal((await sample.detail('demo-langata-1')).status, 'not_found');
  const first = result.items[0];
  assert.equal(first.revision, null);
  assert.equal(first.pricing.disclosureDeclaration, 'not_declared');
  assert.equal(first.pricing.mandatoryAmountsComplete, false);
  assert.equal(first.pricing.hasUnresolvedMandatoryAmounts, true);
  assert.equal(first.areaSqm, 24);
  assert.equal(first.bathrooms, 1);
  assert.equal(first.privateBathrooms, null);
  assert.equal(first.sharedBathrooms, null);
  assert.equal(first.amenitiesKnown, true);
  assert.deepEqual(first.photos, []);
  for (const value of [result, result.items, first, first.location, first.amenities, first.pricing])
    assert.ok(Object.isFrozen(value));
});

test('malformed deployment configuration fails generically and never triggers transport or demo fallback', async () => {
  const invalid = [
    { WEB_CATALOGUE_MODE: '' },
    { WEB_CATALOGUE_MODE: 'automatic' },
    { TENANT_SLUG: 'forged-company' },
    { WEB_CATALOGUE_DATA: 'live' },
    { WEB_CATALOGUE_MODE: 'connected' },
    ...[
      'http://public.example.invalid',
      'https://user:private-secret@example.invalid',
      'https://example.invalid/v2',
      'https://example.invalid/?token=private-secret',
      ' https://example.invalid',
    ].map((API_ORIGIN) => ({ WEB_CATALOGUE_MODE: 'connected', API_ORIGIN })),
  ];
  for (const environment of invalid) {
    let calls = 0;
    const resolution = resolveCatalogueConfig(environment);
    assert.equal(resolution.status, 'error');
    const result = await createCatalogueLoader(resolution, {
      fetch: async () => {
        calls++;
        throw new Error('Must not connect');
      },
    }).list();
    assert.equal(result.mode, 'error');
    assert.equal(result.code, 'CONFIGURATION');
    assert.equal(calls, 0);
    assert.equal(result.message.includes('private-secret'), false);
    assert.equal('items' in result, false);
  }
});

test('loopback HTTP requires exact development-only opt-in', () => {
  const base = { WEB_CATALOGUE_MODE: 'connected', API_ORIGIN: 'http://127.0.0.1:4100' };
  for (const environment of [
    { ...base },
    { ...base, ALLOW_LOOPBACK_API: 'false', NODE_ENV: 'development' },
    { ...base, ALLOW_LOOPBACK_API: '1', NODE_ENV: 'development' },
    { ...base, ALLOW_LOOPBACK_API: 'true', NODE_ENV: 'production' },
    { ...base, ALLOW_LOOPBACK_API: 'true' },
  ])
    assert.equal(resolveCatalogueConfig(environment).status, 'error');
  for (const NODE_ENV of ['development', 'test'])
    assert.equal(
      resolveCatalogueConfig({ ...base, ALLOW_LOOPBACK_API: 'true', NODE_ENV }).status,
      'ready',
    );
  assert.equal(
    resolveCatalogueConfig({
      ...base,
      API_ORIGIN: 'http://localhost.evil.invalid',
      ALLOW_LOOPBACK_API: 'true',
      NODE_ENV: 'development',
    }).status,
    'error',
  );
  assert.equal(
    resolveCatalogueConfig({ ...connectedEnvironment, NODE_ENV: 'production' }).status,
    'ready',
  );
});

test('connected projection preserves exact v2 disclosure and location while undisclosed fields remain unknown', async () => {
  let seen;
  const result = ready(
    await connected(undefined, {}, async (url, init) => {
      seen = { url, init };
      return json({ items: [property()], limit: 100 });
    }).list(),
  );
  assert.equal(result.mode, 'connected');
  assert.equal(result.dataKind, 'synthetic');
  assert.equal(result.sourceLabel, 'API connected · Preview environment');
  const item = result.items[0];
  assert.equal(item.priceMinor, 2000001);
  assert.equal(item.pricing.knownMandatory.initialSubtotal.minorUnits, 2000102);
  assert.equal(item.pricing.mandatoryAmountsComplete, true);
  assert.equal(item.rentalPeriod, 'month');
  assert.equal(item.bedrooms, 0);
  assert.deepEqual(item.location, {
    county: 'Synthetic County',
    town: 'Synthetic Town',
    area: 'Synthetic Area',
  });
  assert.equal(item.areaSqm, null);
  assert.deepEqual(item.amenities, []);
  assert.equal(item.amenitiesKnown, false);
  assert.equal(item.bathrooms, null);
  assert.equal(item.privateBathrooms, 1);
  assert.equal(item.sharedBathrooms, null);
  assert.equal(item.photos[0].key, 'synthetic/web-0.webp');
  assert.equal(
    item.photos.some((photo) => photo.key.startsWith('/demo/')),
    false,
  );
  assert.equal(seen.url, 'https://catalogue.example.invalid/v2/properties?limit=100');
  assert.equal(seen.init.cache, 'no-store');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.redirect, 'error');
  assert.equal(seen.init.headers.Authorization, undefined);
  for (const value of [
    result,
    result.items,
    item,
    item.location,
    item.amenities,
    item.photos,
    item.photos[0],
    item.pricing,
  ])
    assert.ok(Object.isFrozen(value));
});

test('connected maximum-price filters compare exact cents inclusively and preserve existing invalid-input messages', async () => {
  const loader = connected();
  assert.equal(
    ready(await loader.list({ purpose: 'rent', max: '20000.01', period: 'month' })).items.length,
    1,
  );
  assert.equal(
    ready(await loader.list({ purpose: 'rent', max: '20000.00', period: 'month' })).items.length,
    0,
  );
  for (const [max, error] of [
    ['0', 'Enter a positive maximum price in KES.'],
    ['-1', 'Enter a valid KES amount with at most two decimal places.'],
    ['20000.001', 'Enter a valid KES amount with at most two decimal places.'],
  ]) {
    const result = ready(await loader.list({ max, period: 'month' }));
    assert.equal(result.filters.error, error);
    assert.equal(result.items.length, 0);
  }
});

test('rental price filters require an explicit period and never convert mixed rent periods or hide sales', async () => {
  const periods = ['day', 'week', 'month', 'year'];
  const amounts = [100001, 800001, 2000001, 20000001];
  const properties = periods.map((rentPeriod, index) =>
    property({
      id: id(100 + index),
      slug: `synthetic-${rentPeriod}`,
      rentPeriod,
      amountMinor: amounts[index],
    }),
  );
  properties.push(
    property({ id: id(104), slug: 'synthetic-sale', purpose: 'sale', rentPeriod: null }),
  );
  const loader = connected(properties);
  const all = ready(await loader.list());
  assert.equal(all.filters.period, '');
  assert.equal(all.items.length, 5);
  assert.deepEqual(
    ready(await loader.list({ period: 'month' })).items.map((item) => item.id),
    [id(102), id(104)],
  );
  assert.deepEqual(
    ready(await loader.list({ purpose: 'rent', period: 'week' })).items.map((item) => item.id),
    [id(101)],
  );
  for (const purpose of ['', 'rent']) {
    const result = ready(await loader.list({ purpose, max: '20000.01' }));
    assert.equal(
      result.filters.error,
      purpose
        ? 'Choose a rental period when filtering rent by price.'
        : 'Choose rent or buy before filtering by price.',
    );
    assert.equal(result.items.length, 0);
  }
  assert.deepEqual(
    ready(await loader.list({ purpose: 'rent', period: 'month', max: '20000.01' })).items.map(
      (item) => item.id,
    ),
    [id(102)],
  );
  assert.equal(
    ready(await loader.list({ purpose: 'rent', period: 'year', max: '20000.01' })).items.length,
    0,
  );
  assert.deepEqual(
    ready(await loader.list({ purpose: 'sale', max: '20000.01' })).items.map((item) => item.id),
    [id(104)],
  );
  assert.deepEqual(
    ready(await loader.list({ purpose: 'sale', period: 'day', max: '20000.01' })).items.map(
      (item) => item.id,
    ),
    [id(104)],
  );
});

test('rental period input validates malformed, repeated and unknown choices while keeping price validation specific', async () => {
  const loader = connected();
  for (const period of [['day', 'month'], [], 42]) {
    const result = ready(await loader.list({ period }));
    assert.equal(result.filters.error, 'Use one value for each search filter.');
    assert.equal(result.items.length, 0);
  }
  for (const period of ['annually', 'MONTH']) {
    const result = ready(await loader.list({ period }));
    assert.equal(result.filters.error, 'Choose a supported rental period.');
    assert.equal(result.items.length, 0);
  }
  assert.equal(parseCatalogueFilters({ period: ' month ' }).period, 'month');
  assert.equal(
    parseCatalogueFilters({ period: '', max: 'not-money' }).error,
    'Enter a valid KES amount with at most two decimal places.',
  );
  assert.equal(parseCatalogueFilters({ purpose: 'sale', max: '20000.01' }).error, null);
});

test('local location filtering uses known county, town, area and locality without converting nulls into places', async () => {
  const loader = connected();
  for (const location of ['county', 'TOWN', 'Synthetic Area', 'locality'])
    assert.equal(ready(await loader.list({ location })).items.length, 1);
  const unknown = connected([
    property({
      location: { county: null, town: null, area: null },
      locality: 'Somewhere supplied',
    }),
  ]);
  assert.equal(ready(await unknown.list({ location: 'null' })).items.length, 0);
  assert.equal(ready(await unknown.list({ location: 'somewhere' })).items.length, 1);
});

test('all nine API property types can be filtered while malformed/repeated filters retain shared validation', async () => {
  const types = [
    'apartment',
    'bedsitter',
    'studio',
    'maisonette',
    'townhouse',
    'bungalow',
    'villa',
    'land',
    'commercial',
  ];
  const properties = types.map((propertyType, index) =>
    property({
      id: id(100 + index),
      slug: `synthetic-${propertyType}`,
      propertyType,
      bedrooms: ['studio', 'bedsitter'].includes(propertyType)
        ? 0
        : ['land', 'commercial'].includes(propertyType)
          ? null
          : 2,
    }),
  );
  const loader = connected(properties);
  for (const type of types) {
    const result = ready(await loader.list({ type }));
    assert.equal(result.filters.error, null);
    assert.deepEqual(
      result.items.map((item) => item.type),
      [type],
    );
  }
  for (const [query, error] of [
    [{ purpose: 'lease' }, 'Choose rent or buy.'],
    [{ type: 'castle' }, 'Choose a supported property type.'],
    [{ location: ['one', 'two'] }, 'Use one value for each search filter.'],
    [{ type: ['studio', 'villa'] }, 'Use one value for each search filter.'],
  ]) {
    const result = ready(await loader.list(query));
    assert.equal(result.filters.error, error);
    assert.equal(result.items.length, 0);
  }
  assert.equal(parseCatalogueFilters({ type: ' villa ', purpose: 'rent' }).type, 'villa');
});

test('connected upstream failures, malformed/private responses and precision violations never become demo or empty success', async () => {
  const transports = [
    async () => {
      throw new Error('PRIVATE synthetic transport detail');
    },
    async () =>
      new Response('<html>PRIVATE failure</html>', {
        status: 500,
        headers: { 'Content-Type': 'text/html' },
      }),
    async () =>
      json({ items: [property({ privateAddress: 'PRIVATE synthetic address' })], limit: 100 }),
    async () =>
      new Response(
        JSON.stringify({ items: [property()], limit: 100 }).replace(
          '"amountMinor":2000001',
          '"amountMinor":2000001.00000000001',
        ),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  ];
  for (const fetch of transports) {
    const result = await connected(undefined, {}, fetch).list();
    assert.equal(result.mode, 'error');
    assert.equal(result.sourceMode, 'connected');
    assert.equal(result.message, CATALOGUE_UNAVAILABLE_MESSAGE);
    assert.equal('items' in result, false);
    assert.equal(result.message.includes('PRIVATE'), false);
  }
});

test('an empty connected catalogue is an explicit successful empty result', async () => {
  const loader = connected([]);
  const result = ready(await loader.list());
  assert.equal(result.mode, 'connected');
  assert.equal(result.sourceCount, 0);
  assert.equal(result.items.length, 0);
  assert.equal(result.mayBeTruncated, false);
  assert.equal((await loader.detail(id(999))).status, 'not_found');
});

test('a full bounded catalogue warns about truncation and a missing detail remains incomplete rather than a false 404', async () => {
  const items = Array.from({ length: 100 }, (_, index) =>
    property({ id: id(index + 100), slug: `synthetic-bounded-${index}` }),
  );
  const loader = connected(items);
  const result = ready(await loader.list({ purpose: 'rent', max: '0.01', period: 'month' }));
  assert.equal(result.items.length, 0);
  assert.equal(result.sourceCount, 100);
  assert.equal(result.limit, 100);
  assert.equal(result.mayBeTruncated, true);
  const found = await loader.detail(id(199));
  assert.equal(found.status, 'found');
  assert.equal(found.property.id, id(199));
  const missing = await loader.detail(id(999));
  assert.equal(missing.status, 'incomplete');
  assert.equal(missing.limit, 100);
  const complete = connected(items.slice(0, 99));
  assert.equal((await complete.detail(id(999))).status, 'not_found');
});

test('every load makes a fresh no-store read and browser query values cannot select origin or company', async () => {
  const calls = [];
  const loader = connected(undefined, {}, async (url, init) => {
    calls.push({ url, init });
    return json({ items: [property({ amountMinor: 2000000 + calls.length })], limit: 100 });
  });
  const first = ready(
    await loader.list({
      API_ORIGIN: 'https://forged.example.invalid',
      TENANT_SLUG: 'sample-homes',
    }),
  );
  const second = ready(await loader.list());
  assert.equal(first.items[0].priceMinor, 2000001);
  assert.equal(second.items[0].priceMinor, 2000002);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.url, 'https://catalogue.example.invalid/v2/properties?limit=100');
    assert.equal(call.init.cache, 'no-store');
  }
});

test('connected source alone never declares data real or live', async () => {
  const result = ready(await connected(undefined, { WEB_CATALOGUE_DATA: undefined }).list());
  assert.equal(result.dataKind, 'unspecified');
  assert.equal(result.sourceLabel, 'API connected · Preview environment');
  assert.equal('isLive' in result, false);
});

test('bedroom filters preserve explicit zero and match exact counts while excluding unknown bedrooms', async () => {
  const loader = connected([
    property(),
    property({ id: id(101), slug: 'two-bed', propertyType: 'apartment', bedrooms: 2 }),
    property({ id: id(102), slug: 'unknown-bed', propertyType: 'land', bedrooms: null }),
  ]);
  assert.deepEqual(
    ready(await loader.list({ beds: '0' })).items.map((p) => p.id),
    [id(100)],
  );
  assert.deepEqual(
    ready(await loader.list({ beds: '2' })).items.map((p) => p.id),
    [id(101)],
  );
  const any = ready(await loader.list({ beds: '' }));
  assert.equal(any.items.length, 3);
  assert.equal(any.filters.bedsText, '');
  assert.equal(ready(await loader.list({ beds: '0' })).filters.bedsText, '0');
});
test('7+ bedrooms includes declared 7 through 100 while exact 7, 8, 9, 10 and studio zero stay distinct', async () => {
  const counts = [0, 6, 7, 8, 9, 10, 100, null];
  const loader = connected(
    counts.map((bedrooms, index) =>
      property({
        id: id(2000 + index),
        slug: 'declared-bedroom-' + index,
        bedrooms,
        propertyType: bedrooms === null ? 'land' : bedrooms === 0 ? 'studio' : 'apartment',
      }),
    ),
  );
  const grouped = ready(
    await loader.list({
      beds: '7',
      bedsMode: 'at_least',
      type: 'apartment',
      purpose: 'rent',
      period: 'month',
      min: '20000.00',
      minMode: 'over',
      max: '20000.01',
    }),
  );
  assert.equal(grouped.filters.error, null);
  assert.equal(grouped.filters.bedsText, '7');
  assert.equal(grouped.filters.bedsMode, 'at_least');
  assert.deepEqual(
    grouped.items.map((item) => item.bedrooms),
    [7, 8, 9, 10, 100],
  );
  for (const beds of ['7', '8', '9', '10']) {
    const exact = ready(await loader.list({ beds }));
    assert.equal(exact.filters.bedsMode, '');
    assert.deepEqual(
      exact.items.map((item) => item.bedrooms),
      [Number(beds)],
    );
  }
  assert.deepEqual(
    ready(await loader.list({ beds: '0', type: 'studio' })).items.map((item) => item.bedrooms),
    [0],
  );
  assert.deepEqual(
    ready(await loader.list({ beds: '0', bedsMode: 'at_least' })).items.map(
      (item) => item.bedrooms,
    ),
    [0, 6, 7, 8, 9, 10, 100],
  );
  const reset = ready(await loader.list({ beds: '', bedsMode: '' }));
  assert.equal(reset.filters.error, null);
  assert.equal(reset.filters.bedsText, '');
  assert.equal(reset.filters.bedsMode, '');
  assert.equal(reset.items.length, counts.length);
});

test('global v2 and v3 grouped bedroom searches preserve both comparison modes in transport and paging', async () => {
  for (const reference of [false, true]) {
    const calls = [];
    const loader = connected(
      [],
      {
        ...(reference ? referenceEnvironment : {}),
        WEB_CATALOGUE_SEARCH: 'public-search-v1',
      },
      async (url) => {
        calls.push(new URL(url));
        return json(
          new URL(url).pathname === '/v3/property-reference-options'
            ? {
                policy: 'synthetic-reference-options-v1',
                maximumPerCategory: 5000,
                options: { countyId: [], localityId: [], neighbourhoodId: [], amenityId: [] },
              }
            : searchPayload([], 0, 12, 12, 'price_low', reference),
        );
      },
    );
    const result = ready(
      await loader.list({
        beds: '7',
        bedsMode: 'at_least',
        purpose: 'rent',
        period: 'month',
        min: '20000.00',
        minMode: 'over',
        max: '20000.01',
        sort: 'price_low',
        page: '2',
      }),
    );
    assert.equal(result.filters.error, null);
    const request = calls.find((url) => url.pathname.endsWith('/properties/search'));
    assert.equal(request.pathname, reference ? '/v3/properties/search' : '/v2/properties/search');
    assert.equal(request.searchParams.get('beds'), '7');
    assert.equal(request.searchParams.get('bedsMode'), 'at_least');
    assert.equal(request.searchParams.get('minMode'), 'over');
    assert.equal(request.searchParams.get('max'), '20000.01');
    assert.equal(request.searchParams.get('offset'), '12');
    const next = new URL(
      loadedPageHref(result.filters, 'price_low', 3),
      'https://synthetic.invalid',
    );
    assert.equal(next.searchParams.get('beds'), '7');
    assert.equal(next.searchParams.get('bedsMode'), 'at_least');
    assert.equal(next.searchParams.get('minMode'), 'over');
    assert.equal(next.searchParams.get('page'), '3');
  }
});

test('bedroom comparison errors retain correction state and refuse global search before transport', async () => {
  let calls = 0;
  const loader = connected([], { WEB_CATALOGUE_SEARCH: 'public-search-v1' }, async () => {
    calls++;
    throw Error('invalid grouped bedrooms must not dispatch');
  });
  for (const bedsMode of [
    'unknown',
    'AT_LEAST',
    ' ',
    ' at_least ',
    ['at_least'],
    ['at_least', ''],
    ['at_least', 'at_least'],
  ]) {
    const result = ready(await loader.list({ beds: '7', bedsMode }));
    assert.ok(result.filters.error, String(bedsMode));
    assert.equal(result.filters.bedsText, '7');
    if (typeof bedsMode === 'string') assert.equal(result.filters.bedsMode, bedsMode);
    assert.deepEqual(result.items, []);
  }
  for (const beds of [undefined, '', ' ', '7+', '-1', '01', '1.5', '1e1', '101', ['7']]) {
    const result = ready(await loader.list({ beds, bedsMode: 'at_least' }));
    assert.ok(result.filters.error, String(beds));
    assert.equal(result.filters.bedsMode, 'at_least');
    assert.deepEqual(result.items, []);
  }
  assert.equal(calls, 0);
  assert.equal(parseCatalogueFilters({ beds: '7' }).bedsMode, '');
  assert.equal(parseCatalogueFilters({ beds: '', bedsMode: '' }).error, null);
});
test('private and shared bathroom minima stay separate and null never qualifies as declared zero', async () => {
  const loader = connected([
    property({ privateBathrooms: 0, sharedBathrooms: 2 }),
    property({ id: id(101), slug: 'private-two', privateBathrooms: 2, sharedBathrooms: 0 }),
    property({ id: id(102), slug: 'unknown-baths', privateBathrooms: null, sharedBathrooms: null }),
  ]);
  assert.deepEqual(
    ready(await loader.list({ privateBaths: '1' })).items.map((p) => p.id),
    [id(101)],
  );
  assert.deepEqual(
    ready(await loader.list({ sharedBaths: '1' })).items.map((p) => p.id),
    [id(100)],
  );
  assert.deepEqual(
    ready(await loader.list({ privateBaths: '0', sharedBaths: '0' })).items.map((p) => p.id),
    [id(100), id(101)],
  );
  assert.equal(ready(await loader.list({ privateBaths: '2', sharedBaths: '2' })).items.length, 0);
});
test('room query boundaries reject repeated, fractional, signed, exponential and out-of-range values', () => {
  for (const key of ['beds', 'privateBaths', 'sharedBaths']) {
    for (const bad of [['1', '2'], '-1', '+1', '1.5', '1e1', '01', '101', '9999999999999999999999'])
      assert.ok(parseCatalogueFilters({ [key]: bad }).error, `${key}: ${bad}`);
    assert.equal(parseCatalogueFilters({ [key]: '100' }).error, null);
    assert.equal(parseCatalogueFilters({ [key]: ' 0 ' }).error, null);
  }
});
test('room filters combine with exact cents, type and rental period without claiming global counts', async () => {
  const items = Array.from({ length: 100 }, (_, i) =>
    property({ id: id(100 + i), slug: 'bounded-room-' + i, privateBathrooms: i === 0 ? 1 : 0 }),
  );
  const result = ready(
    await connected(items).list({
      beds: '0',
      privateBaths: '1',
      type: 'studio',
      purpose: 'rent',
      period: 'month',
      max: '20000.01',
    }),
  );
  assert.equal(result.items.length, 1);
  assert.equal(result.sourceCount, 100);
  assert.equal(result.mayBeTruncated, true);
  assert.equal(result.items[0].priceMinor, 2000001);
  assert.equal(
    ready(
      await connected(items).list({
        beds: '0',
        privateBaths: '1',
        purpose: 'rent',
        period: 'month',
        max: '20000.00',
      }),
    ).items.length,
    0,
  );
});
test('demo general bathroom counts never become private/shared bathroom claims', async () => {
  const loader = createCatalogueLoader(resolveCatalogueConfig({ TENANT_SLUG: 'realtime-estates' }));
  assert.ok(ready(await loader.list()).items.length > 0);
  assert.equal(ready(await loader.list({ privateBaths: '0' })).items.length, 0);
  assert.equal(ready(await loader.list({ sharedBaths: '0' })).items.length, 0);
});

test('minimum base price includes the exact cent and composes with maximum and rental period', async () => {
  const loader = connected([
    property({ amountMinor: 2000000 }),
    property({ id: id(101), slug: 'exact-bound', amountMinor: 2000001 }),
    property({ id: id(102), slug: 'upper-bound', amountMinor: 2000002 }),
    property({ id: id(103), slug: 'other-period', amountMinor: 2000001, rentPeriod: 'day' }),
  ]);
  const exact = ready(
    await loader.list({ purpose: 'rent', period: 'month', min: '20000.01', max: '20000.01' }),
  );
  assert.deepEqual(
    exact.items.map((item) => item.id),
    [id(101)],
  );
  assert.equal(exact.filters.minText, '20000.01');
  assert.deepEqual(
    ready(await loader.list({ purpose: 'rent', period: 'month', min: '20000.01' })).items.map(
      (item) => item.id,
    ),
    [id(101), id(102)],
  );
  const invalid = ready(
    await loader.list({ purpose: 'rent', period: 'month', min: '20000.02', max: '20000.01' }),
  );
  assert.match(invalid.filters.error, /Minimum price/);
  assert.deepEqual(invalid.items, []);
  assert.equal(ready(await loader.list()).filters.minText, '');
});

test('invalid minimum price or inverted range refuses global search before transport', async () => {
  let calls = 0;
  const loader = connected([], { WEB_CATALOGUE_SEARCH: 'public-search-v1' }, async () => {
    calls++;
    throw Error('must not dispatch invalid filters');
  });
  for (const min of [['1', '2'], '0', '-1', '1e2', '1.001', 'NaN', '100000000000000000000']) {
    const result = ready(await loader.list({ purpose: 'sale', min }));
    assert.ok(result.filters.error, String(min));
    assert.deepEqual(result.items, []);
  }
  for (const query of [
    { purpose: 'rent', min: '1' },
    { purpose: 'sale', min: '20000.02', max: '20000.01' },
  ])
    assert.ok(ready(await loader.list(query)).filters.error);
  assert.equal(calls, 0);
});

test('Over compares exact base-price cents on the explicit rental or sale basis in bounded catalogues', async () => {
  const loader = connected([
    property({ amountMinor: 2000000 }),
    property({ id: id(101), slug: 'exact-threshold', amountMinor: 2000001 }),
    property({ id: id(102), slug: 'one-cent-above', amountMinor: 2000002 }),
    property({ id: id(103), slug: 'other-period-over', amountMinor: 2000002, rentPeriod: 'day' }),
    property({
      id: id(104),
      slug: 'sale-over',
      amountMinor: 2000002,
      purpose: 'sale',
      rentPeriod: null,
    }),
  ]);
  const query = { purpose: 'rent', period: 'month', min: '20000.01', max: '20000.02' };
  const strict = ready(await loader.list({ ...query, minMode: 'over' }));
  assert.equal(strict.filters.error, null);
  assert.equal(strict.filters.minMode, 'over');
  assert.deepEqual(
    strict.items.map((item) => item.id),
    [id(102)],
  );
  assert.deepEqual(
    ready(await loader.list(query)).items.map((item) => item.id),
    [id(101), id(102)],
  );
  const equal = ready(await loader.list({ ...query, max: query.min, minMode: 'over' }));
  assert.equal(equal.filters.error, null);
  assert.deepEqual(equal.items, []);
  assert.deepEqual(
    ready(await loader.list({ ...query, purpose: 'sale', minMode: 'over' })).items.map(
      (item) => item.id,
    ),
    [id(104)],
  );
  const demo = createCatalogueLoader(resolveCatalogueConfig({ TENANT_SLUG: 'realtime-estates' }));
  const demoQuery = { purpose: 'rent', period: 'month', min: '18000', max: '18000' };
  assert.deepEqual(
    ready(await demo.list(demoQuery)).items.map((item) => item.id),
    ['demo-ruaka-1'],
  );
  const demoStrict = ready(await demo.list({ ...demoQuery, minMode: 'over' }));
  assert.equal(demoStrict.filters.error, null);
  assert.deepEqual(demoStrict.items, []);
});

test('global v2 and v3 searches retain Over and exact bounds through SDK transport and page URLs', async () => {
  for (const reference of [false, true]) {
    const calls = [];
    const loader = connected(
      [],
      { ...(reference ? referenceEnvironment : {}), WEB_CATALOGUE_SEARCH: 'public-search-v1' },
      async (url) => {
        calls.push(new URL(url));
        return json(
          new URL(url).pathname === '/v3/property-reference-options'
            ? {
                policy: 'synthetic-reference-options-v1',
                maximumPerCategory: 5000,
                options: { countyId: [], localityId: [], neighbourhoodId: [], amenityId: [] },
              }
            : searchPayload([], 0, 12, 12, 'price_low', reference),
        );
      },
    );
    const result = ready(
      await loader.list({
        purpose: 'rent',
        period: 'month',
        min: '20000.01',
        minMode: 'over',
        max: '20000.01',
        area: JSON.stringify(searchArea),
        sort: 'price_low',
        page: '2',
      }),
    );
    assert.equal(result.filters.error, null);
    assert.deepEqual(result.items, []);
    const search = calls.find((url) => url.pathname.endsWith('/properties/search'));
    assert.equal(search.pathname, reference ? '/v3/properties/search' : '/v2/properties/search');
    assert.equal(search.searchParams.get('minMode'), 'over');
    assert.equal(search.searchParams.get('min'), '20000.01');
    assert.equal(search.searchParams.get('max'), '20000.01');
    assert.deepEqual(JSON.parse(search.searchParams.get('area')), searchArea);
    assert.equal(search.searchParams.get('offset'), '12');
    const next = new URL(
      loadedPageHref(result.filters, 'price_low', 3),
      'https://synthetic.invalid',
    );
    assert.equal(next.searchParams.get('minMode'), 'over');
    assert.equal(next.searchParams.get('min'), '20000.01');
    assert.equal(next.searchParams.get('max'), '20000.01');
    assert.deepEqual(JSON.parse(next.searchParams.get('area')), searchArea);
    assert.equal(next.searchParams.get('page'), '3');
  }
});

test('invalid minimum comparison state refuses global search while retaining the correction values', async () => {
  let calls = 0;
  const loader = connected([], { WEB_CATALOGUE_SEARCH: 'public-search-v1' }, async () => {
    calls++;
    throw Error('invalid comparison must not dispatch');
  });
  for (const minMode of [
    'unknown',
    'OVER',
    ' ',
    ' over ',
    ['over'],
    ['over', ''],
    ['over', 'over'],
  ]) {
    const result = ready(await loader.list({ purpose: 'sale', min: '20000.01', minMode }));
    assert.ok(result.filters.error, String(minMode));
    assert.equal(result.filters.minText, '20000.01');
    if (typeof minMode === 'string') assert.equal(result.filters.minMode, minMode);
    assert.deepEqual(result.items, []);
  }
  for (const query of [
    { purpose: 'sale', minMode: 'over' },
    { purpose: 'sale', min: '', minMode: 'over' },
    { purpose: 'sale', min: '0', minMode: 'over' },
    { purpose: 'sale', min: '-1', minMode: 'over' },
    { purpose: 'rent', min: '20000.01', minMode: 'over' },
    { period: 'month', min: '20000.01', minMode: 'over' },
    { purpose: 'sale', min: '20000.02', minMode: 'over', max: '20000.01' },
  ]) {
    const result = ready(await loader.list(query));
    assert.ok(result.filters.error, JSON.stringify(query));
    assert.equal(result.filters.minMode, 'over');
    assert.deepEqual(result.items, []);
  }
  assert.equal(calls, 0);
  for (const minMode of [undefined, '']) {
    const result = parseCatalogueFilters({ min: '', minMode });
    assert.equal(result.error, null);
    assert.equal(result.minText, '');
    assert.equal(result.minMode, '');
  }
});

test('either price bound requires an explicit purpose even with a period, across demo and connected modes', async () => {
  let globalCalls = 0;
  const global = connected([], { WEB_CATALOGUE_SEARCH: 'public-search-v1' }, async () => {
    globalCalls++;
    throw Error('invalid search must not dispatch');
  });
  const bounded = connected([
    property(),
    property({ id: id(101), slug: 'synthetic-sale-price', purpose: 'sale', rentPeriod: null }),
  ]);
  const demo = createCatalogueLoader(resolveCatalogueConfig({ TENANT_SLUG: 'realtime-estates' }));
  for (const loader of [demo, bounded, global]) {
    for (const bounds of [
      { min: '20000.01' },
      { max: '20000.01' },
      { min: '20000.00', max: '20000.01' },
    ]) {
      for (const purpose of [undefined, '']) {
        const result = ready(await loader.list({ ...bounds, purpose, period: 'month' }));
        assert.equal(result.filters.error, 'Choose rent or buy before filtering by price.');
        assert.equal(result.filters.period, 'month');
        assert.equal(result.filters.minText, bounds.min ?? '');
        assert.equal(result.filters.maxText, bounds.max ?? '');
        assert.deepEqual(result.items, []);
      }
    }
  }
  assert.equal(globalCalls, 0);
});
