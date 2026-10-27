import test from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyMobileReferenceFilters,
  prepareMobileReferenceSearch,
  mobileReferenceSearchSummary,
} from '../dist/tests/src/reference-search.js';
import {
  loadMobileReferenceCatalogue,
  resolveMobileReferenceConfig,
} from '../dist/tests/src/reference-catalogue.js';

test('connected mobile filters cross the anonymous SDK with exact cents, open-plan and bathroom criteria', async () => {
  const prepared = prepareMobileReferenceSearch({
    ...emptyMobileReferenceFilters,
    location: ' Synthetic town ',
    purpose: 'rent',
    type: 'studio',
    period: 'month',
    min: '20000.01',
    max: '30000.99',
    minMode: 'over',
    beds: '0',
    bedsMode: 'at_least',
    privateBaths: '1',
    sharedBaths: '0',
    sort: 'price_low',
  });
  assert.equal(prepared.status, 'ready');
  let requested;
  const result = await loadMobileReferenceCatalogue(
    resolveMobileReferenceConfig(
      {
        mode: 'synthetic-reference-public-v1',
        apiOrigin: 'https://synthetic.invalid',
        allowLoopbackHttp: false,
      },
      'sample-homes',
      true,
    ),
    {
      search: prepared.input,
      fetch: async (url, init) => {
        requested = new URL(url);
        assert.equal(new Headers(init.headers).has('authorization'), false);
        return Response.json({
          policy: 'synthetic-reference-search-v1',
          items: [],
          total: 0,
          limit: 24,
          offset: 0,
          sort: 'price_low',
          hasMore: false,
          maxOffset: 10000,
        });
      },
    },
  );
  assert.equal(result.status, 'ready');
  assert.equal(requested.pathname, '/v3/properties/search');
  assert.deepEqual(Object.fromEntries(requested.searchParams), {
    sort: 'price_low',
    location: 'Synthetic town',
    purpose: 'rent',
    type: 'studio',
    period: 'month',
    min: '20000.01',
    max: '30000.99',
    minMode: 'over',
    beds: '0',
    privateBaths: '1',
    sharedBaths: '0',
    bedsMode: 'at_least',
    limit: '24',
    offset: '0',
  });
  assert.match(
    mobileReferenceSearchSummary(prepared.input),
    /over KES 20000\.01.*0\+ bedrooms.*1\+ private bathrooms.*0\+ shared bathrooms/,
  );
});

test('mobile rejects incomparable prices and malformed boundaries before replacing applied filters', () => {
  for (const change of [
    { min: '1' },
    { sort: 'price_low' },
    { purpose: 'rent', min: '1' },
    { purpose: 'sale', period: 'month' },
    { purpose: 'sale', min: '0' },
    { purpose: 'sale', min: '1.001' },
    { purpose: 'sale', min: '2', max: '1.99' },
    { minMode: 'over' },
    { bedsMode: 'at_least' },
    { beds: '101' },
    { beds: '-1' },
    { privateBaths: '1.5' },
    { sharedBaths: '01' },
    { location: 'x'.repeat(161) },
    { location: 'a\nb' },
  ])
    assert.equal(
      prepareMobileReferenceSearch({ ...emptyMobileReferenceFilters, ...change }).status,
      'invalid',
      JSON.stringify(change),
    );
  const sale = prepareMobileReferenceSearch({
    ...emptyMobileReferenceFilters,
    purpose: 'sale',
    min: '1.00',
    max: '1.00',
    beds: '0',
  });
  assert.equal(sale.status, 'ready');
  assert.equal(sale.input.beds, '0');
  assert.ok(Object.isFrozen(sale.input));
  assert.deepEqual(prepareMobileReferenceSearch({ ...emptyMobileReferenceFilters }), {
    status: 'ready',
    input: { offset: 0, sort: 'catalogue' },
  });
});
