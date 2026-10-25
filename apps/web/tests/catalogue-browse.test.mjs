import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  browseLoadedCatalogue,
  loadedPageHref,
  LOADED_PAGE_SIZE,
} from '../dist/tests/lib/catalogue-browse.js';
import {
  parseCatalogueFilters,
  createCatalogueLoader,
  resolveCatalogueConfig,
} from '../dist/tests/lib/catalogue.js';
import LoadedCataloguePager from '../dist/tests/components/LoadedCataloguePager.js';
const filters = (q) => parseCatalogueFilters(q ?? {});
const rows = () =>
  Array.from({ length: 25 }, (_, i) =>
    Object.freeze({
      id: String(i).padStart(3, '0'),
      title: i < 2 ? 'Same title' : 'Title ' + String(25 - i).padStart(2, '0'),
      priceMinor: i < 2 ? 10001 : 10000 + i,
      purpose: 'rent',
      rentalPeriod: 'month',
    }),
  );
test('loaded pages partition exactly with preserved source order and no source mutation', () => {
  const source = Object.freeze(rows()),
    before = JSON.stringify(source),
    ids = [];
  for (let page = 1; page <= 3; page++) {
    const result = browseLoadedCatalogue(source, filters(), { page: String(page) });
    assert.equal(result.error, null);
    assert.equal(result.pageCount, 3);
    assert.equal(result.matchingLoadedCount, 25);
    assert.equal(result.items.length, page === 3 ? 1 : 12);
    ids.push(...result.items.map((x) => x.id));
    assert.ok(Object.isFrozen(result));
    assert.ok(Object.isFrozen(result.items));
  }
  assert.equal(LOADED_PAGE_SIZE, 12);
  assert.deepEqual(
    ids,
    source.map((x) => x.id),
  );
  assert.equal(new Set(ids).size, 25);
  assert.equal(JSON.stringify(source), before);
});
test('base-price orders preserve exact cents and stable ID ties on the selected rental basis', () => {
  const source = rows(),
    f = filters({ purpose: 'rent', period: 'month' });
  const low = browseLoadedCatalogue(source, f, { sort: 'price_low' }),
    high = browseLoadedCatalogue(source, f, { sort: 'price_high' });
  assert.deepEqual(
    low.items.slice(0, 2).map((x) => x.id),
    ['000', '001'],
  );
  assert.equal(low.items[0].priceMinor, 10001);
  assert.equal(high.items[0].priceMinor, 10024);
  const second = browseLoadedCatalogue(source, f, { sort: 'price_low', page: '2' });
  assert.ok(low.items.at(-1).priceMinor <= second.items[0].priceMinor);
});
test('price order refuses mixed purposes, absent rent period or wrong loaded rental basis', () => {
  for (const q of [{}, { purpose: 'rent' }, { period: 'month' }])
    assert.match(
      browseLoadedCatalogue(rows(), filters(q), { sort: 'price_low' }).error,
      /Choose rent/,
    );
  const bad = [
    ...rows(),
    { id: 'bad', title: 'Other period', priceMinor: 1, purpose: 'rent', rentalPeriod: 'day' },
  ];
  assert.match(
    browseLoadedCatalogue(bad, filters({ purpose: 'rent', period: 'month' }), { sort: 'price_low' })
      .error,
    /price basis/,
  );
  const sale = rows().map((x) => ({ ...x, purpose: 'sale', rentalPeriod: null }));
  assert.equal(
    browseLoadedCatalogue(sale, filters({ purpose: 'sale' }), { sort: 'price_high' }).error,
    null,
  );
});
test('title ordering is deterministic with ID ties and default order remains unchanged', () => {
  const input = [
    { id: 'b', title: 'alpha' },
    { id: 'a', title: 'Alpha' },
    { id: 'c', title: 'beta' },
  ];
  assert.deepEqual(
    browseLoadedCatalogue(input, filters(), { sort: 'title' }).items.map((x) => x.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    browseLoadedCatalogue(input, filters(), {}).items.map((x) => x.id),
    ['b', 'a', 'c'],
  );
});
test('invalid page/order query is explicit; out-of-range and zero matches are distinct from silently clamped pages', () => {
  for (const page of [['1', '2'], '0', '01', '-1', '1.5', '1e2', '1000001']) {
    const r = browseLoadedCatalogue(rows(), filters(), { page });
    assert.ok(r.error);
    assert.equal(r.errorField, 'page');
    assert.equal(r.items.length, 0);
  }
  for (const sort of [['title', 'price_low'], 'unknown', 'javascript:alert(1)'])
    assert.equal(browseLoadedCatalogue(rows(), filters(), { sort }).errorField, 'sort');
  const outside = browseLoadedCatalogue(rows(), filters(), { page: '99' });
  assert.equal(outside.outOfRange, true);
  assert.equal(outside.page, 99);
  assert.equal(outside.matchingLoadedCount, 25);
  assert.equal(outside.items.length, 0);
  const empty = browseLoadedCatalogue([], filters(), {});
  assert.equal(empty.outOfRange, false);
  assert.equal(empty.start, 0);
  assert.equal(empty.end, 0);
  assert.equal(empty.pageCount, 1);
  assert.equal(browseLoadedCatalogue(rows(), filters({ beds: '-1' }), {}).items.length, 0);
});
test('paging URLs preserve allowlisted filters and explicit zero while encoding text and omitting origin/company overrides', () => {
  const f = filters({
    location: 'Synthetic & <Town>',
    purpose: 'rent',
    period: 'month',
    type: 'studio',
    min: '20000.00',
    max: '20000.01',
    beds: '0',
    privateBaths: '1',
    sharedBaths: '0',
    API_ORIGIN: 'https://forged.invalid',
    TENANT_SLUG: 'other',
  });
  const href = loadedPageHref(f, 'price_low', 2),
    url = new URL(href, 'https://synthetic.invalid');
  assert.equal(url.pathname, '/');
  assert.equal(url.hash, '#properties');
  for (const [key, value] of Object.entries({
    location: 'Synthetic & <Town>',
    beds: '0',
    privateBaths: '1',
    sharedBaths: '0',
    min: '20000.00',
    max: '20000.01',
    sort: 'price_low',
    page: '2',
  }))
    assert.equal(url.searchParams.get(key), value);
  assert.equal(url.searchParams.has('API_ORIGIN'), false);
  assert.equal(url.searchParams.has('TENANT_SLUG'), false);
  assert.ok(!loadedPageHref(f, 'price_low', 1).includes('page='));
  assert.throws(() => loadedPageHref(f, 'title', 0));
});
test('loaded browsing never changes the catalogue detail lookup or invents global count/cursor semantics', async () => {
  const loader = createCatalogueLoader(resolveCatalogueConfig({ TENANT_SLUG: 'realtime-estates' }));
  const result = await loader.list();
  const last = result.items.at(-1);
  const page = browseLoadedCatalogue(result.items, result.filters, { page: '999' });
  assert.equal(page.items.length, 0);
  assert.equal((await loader.detail(last.id)).status, 'found');
  assert.equal('globalCount' in page, false);
  assert.equal('cursor' in page, false);
});
test('pager markup names loaded counts, preserves links and gives an explicit unavailable-page recovery', () => {
  const f = filters({ beds: '0' }),
    b = browseLoadedCatalogue(rows(), f, { page: '2' });
  const html = renderToStaticMarkup(
    React.createElement(LoadedCataloguePager, { browse: b, filters: f }),
  );
  assert.ok(html.includes('13–24 of 25 matching loaded properties'));
  assert.ok(html.includes('rel="prev"'));
  assert.ok(html.includes('rel="next"'));
  assert.ok(html.includes('beds=0'));
  assert.ok(html.includes('Loaded catalogue pages'));
  const outside = renderToStaticMarkup(
    React.createElement(LoadedCataloguePager, {
      browse: browseLoadedCatalogue(rows(), f, { page: '99' }),
      filters: f,
    }),
  );
  assert.ok(outside.includes('Return to first loaded page'));
  assert.ok(!outside.includes('Next loaded page'));
  const error = renderToStaticMarkup(
    React.createElement(LoadedCataloguePager, {
      browse: browseLoadedCatalogue(rows(), f, { page: '0' }),
      filters: f,
    }),
  );
  assert.equal(error, '');
});
