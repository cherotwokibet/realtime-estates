import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolvePublicSeoPolicy,
  propertyPageMetadata,
  publicPageMetadata,
  publicRobots,
  publicSitemap,
} from '../dist/tests/lib/public-seo.js';
import { createCatalogueLoader, resolveCatalogueConfig } from '../dist/tests/lib/catalogue.js';
const production = {
  NODE_ENV: 'production',
  TENANT_SLUG: 'sample-homes',
  WEB_CATALOGUE_MODE: 'connected',
  WEB_CATALOGUE_SEARCH: 'public-search-v1',
  API_ORIGIN: 'https://api.synthetic.invalid',
  WEB_PUBLIC_ORIGIN: 'https://homes.synthetic.invalid',
  WEB_INDEXING: 'approved',
};
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

test('indexing defaults off and cannot be approved for demo, synthetic/reference or untrusted origin configurations', () => {
  assert.deepEqual(resolvePublicSeoPolicy({}), { origin: null, index: false });
  assert.equal(resolvePublicSeoPolicy(production).index, true);
  for (const change of [
    { WEB_CATALOGUE_MODE: 'demo' },
    { WEB_CATALOGUE_DATA: 'synthetic' },
    { WEB_CATALOGUE_REFERENCE: 'synthetic-reference-public-v1' },
    { NODE_ENV: 'development' },
    { WEB_CATALOGUE_SEARCH: undefined },
    { WEB_PUBLIC_ORIGIN: undefined },
    { WEB_INDEXING: 'true' },
    ...[
      'http://homes.synthetic.invalid',
      'https://user:secret@homes.synthetic.invalid',
      'https://homes.synthetic.invalid/path',
      'https://homes.synthetic.invalid/',
      'https://homes.synthetic.invalid?token=secret',
      'https://homes.synthetic.invalid#private',
      'https://localhost',
      'https://127.0.0.1',
    ].map((WEB_PUBLIC_ORIGIN) => ({ WEB_PUBLIC_ORIGIN })),
  ])
    assert.throws(() => resolvePublicSeoPolicy({ ...production, ...change }));
  assert.equal(
    resolvePublicSeoPolicy({
      ...production,
      WEB_INDEXING: 'disabled',
      WEB_CATALOGUE_DATA: 'synthetic',
    }).index,
    false,
  );
  assert.throws(
    () => resolvePublicSeoPolicy({ WEB_PUBLIC_ORIGIN: 'PRIVATE-INVALID-INPUT' }),
    (error) =>
      error.message === 'Invalid public SEO origin.' &&
      !JSON.stringify(error).includes('PRIVATE-INVALID-INPUT'),
  );
});

test('synthetic property sharing uses public facts and stable canonical ID while always retaining noindex', async () => {
  const loader = createCatalogueLoader(resolveCatalogueConfig({ TENANT_SLUG: 'sample-homes' }));
  const catalogue = await loader.list();
  const detail = await loader.detail(catalogue.items[0].id);
  assert.equal(detail.status, 'found');
  const policy = resolvePublicSeoPolicy(production);
  const metadata = propertyPageMetadata(policy, 'Sample Homes', detail);
  assert.equal(
    metadata.alternates.canonical,
    `https://homes.synthetic.invalid/properties/${detail.property.id}`,
  );
  assert.equal(metadata.robots.index, false);
  assert.match(metadata.description, /Synthetic preview.*No real availability/);
  assert.equal(metadata.openGraph.url, metadata.alternates.canonical);
  assert.equal(metadata.twitter.images[0], 'https://homes.synthetic.invalid/sharing-card');
  const actual = propertyPageMetadata(policy, 'Sample Homes', {
    ...detail,
    mode: 'connected',
    dataKind: 'unspecified',
    property: {
      ...detail.property,
      id: id(1),
      priceMinor: 2000001,
      rentalPeriod: 'month',
      description: 'PRIVATE BODY NOT FOR SUMMARY',
    },
  });
  assert.equal(actual.robots.index, true);
  assert.match(actual.description, /KES 20,000\.01 per month base price/);
  assert.ok(!JSON.stringify(actual).includes('PRIVATE BODY'));
  assert.equal(
    propertyPageMetadata(policy, 'Sample Homes', {
      mode: 'connected',
      dataKind: 'unspecified',
      status: 'not_found',
    }).robots.index,
    false,
  );
});

test('preview omits invented absolute URLs and filtered pages retain noindex with the trusted root canonical', () => {
  const metadata = publicPageMetadata(
    { origin: null, index: false },
    'Sample Homes',
    '/',
    'Find a home',
    'Preview',
  );
  assert.equal(metadata.alternates, undefined);
  assert.equal(metadata.openGraph.url, undefined);
  const filtered = publicPageMetadata(
    resolvePublicSeoPolicy(production),
    'Sample Homes',
    '/',
    'Find a home',
    'Results',
    false,
  );
  assert.equal(filtered.robots.index, false);
  assert.equal(filtered.robots.follow, true);
  assert.equal(filtered.alternates.canonical, 'https://homes.synthetic.invalid/');
  assert.deepEqual(publicRobots({ origin: null, index: false }), {
    rules: { userAgent: '*', disallow: '/' },
  });
});

test('sitemap includes all approved paged IDs once, no synthetic stock or fabricated modification dates', async () => {
  const offsets = [];
  const urls = await publicSitemap(resolvePublicSeoPolicy(production), async (offset) => {
    offsets.push(offset);
    const total = 105;
    return {
      total,
      offset,
      limit: 100,
      hasMore: offset + 100 < total,
      items: Array.from({ length: Math.min(100, total - offset) }, (_, i) => ({
        id: id(offset + i),
      })),
    };
  });
  assert.deepEqual(offsets, [0, 100]);
  assert.equal(urls.length, 106);
  assert.equal(urls[105].url, `https://homes.synthetic.invalid/properties/${id(104)}`);
  assert.ok(urls.every((row) => row.lastModified === undefined));
  assert.deepEqual(
    await publicSitemap({ origin: null, index: false }, async () => {
      throw Error('Must not read synthetic catalogue');
    }),
    [],
  );
});

test('sitemap refuses capped, changing, duplicate or failed inventory instead of silently publishing a partial list', async () => {
  const policy = resolvePublicSeoPolicy(production);
  for (const read of [
    async () => ({ total: 10001, offset: 0, limit: 100, items: [], hasMore: true }),
    async () => ({
      total: 2,
      offset: 0,
      limit: 100,
      items: [{ id: id(1) }, { id: id(1) }],
      hasMore: false,
    }),
    async () => ({
      total: 1,
      offset: 0,
      limit: 100,
      items: [{ id: 'synthetic-demo-id' }],
      hasMore: false,
    }),
    async (offset) => ({
      total: offset === 0 ? 101 : 102,
      offset,
      limit: 100,
      items: Array.from({ length: offset === 0 ? 100 : 2 }, (_, i) => ({ id: id(offset + i) })),
      hasMore: offset === 0,
    }),
    async () => {
      throw Error('Transport unavailable');
    },
  ])
    await assert.rejects(publicSitemap(policy, read));
});
