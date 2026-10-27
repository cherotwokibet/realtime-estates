import test from 'node:test';
import assert from 'node:assert/strict';
import { startStaffPreview } from '../../api/dev/staff-preview.mjs';
import {
  loadMobileReferenceCatalogue,
  resolveMobileReferenceConfig,
} from '../dist/tests/src/reference-catalogue.js';
import {
  createCatalogueLoader,
  resolveCatalogueConfig,
} from '../../web/dist/tests/lib/catalogue.js';
import { browseCatalogue } from '../../web/dist/tests/lib/catalogue-browse.js';
test('mobile adapter reads the real anonymous HTTP/SQL approved historical projection for two fixed companies', async () => {
  const rows = [];
  for (const tenantSlug of ['realtime-estates', 'sample-homes']) {
    const preview = await startStaffPreview({
      port: 0,
      tenantSlug,
      referenceDraftMode: 'synthetic-reference-draft-v1',
      referenceModerationMode: 'synthetic-reference-transition-v1',
      referencePublicMode: 'synthetic-reference-public-v1',
    });
    try {
      const config = resolveMobileReferenceConfig(
        {
          mode: 'synthetic-reference-public-v1',
          apiOrigin: preview.origin,
          allowLoopbackHttp: true,
        },
        tenantSlug,
        true,
      );
      const result = await loadMobileReferenceCatalogue(config);
      assert.equal(result.status, 'ready');
      assert.equal(result.items.length, 1);
      const item = result.items[0];
      assert.equal(item.property.id, preview.referencePublicListingId);
      assert.equal(item.property.reference.attributes.catalogueVersion, '1');
      assert.equal(item.property.reference.revisionVersion, '5');
      assert.equal(item.base, 'KES 20,000');
      assert.equal(item.recurring, 'KES 21,000');
      assert.equal(item.initial, 'KES 41,500');
      assert.equal(item.amenities[0].label, 'Synthetic preview lift');
      assert.match(item.location, /Synthetic preview town/);
      const searches = await loadMobileReferenceCatalogue(config, {
        search: { location: 'Synthetic preview town', limit: 1, offset: 0 },
      });
      assert.equal(searches.status, 'ready');
      assert.equal(searches.searchPage.total, 1);
      assert.equal(searches.items[0].property.id, item.property.id);
      assert.equal(searches.mayBeTruncated, false);
      const countyId = item.property.reference.attributes.location.county.id,
        amenityId = item.amenities[0].id;
      const web = createCatalogueLoader(
        resolveCatalogueConfig({
          WEB_CATALOGUE_MODE: 'connected',
          WEB_CATALOGUE_SEARCH: 'public-search-v1',
          WEB_CATALOGUE_REFERENCE: 'synthetic-reference-public-v1',
          WEB_CATALOGUE_DATA: 'synthetic',
          TENANT_SLUG: tenantSlug,
          API_ORIGIN: preview.origin,
          ALLOW_LOOPBACK_API: 'true',
          NODE_ENV: 'test',
        }),
      );
      const webPage = await web.list({
        countyId,
        amenityId,
        beds: '0',
        purpose: 'rent',
        period: 'month',
        sort: 'price_low',
      });
      assert.equal(webPage.mode, 'connected');
      assert.equal(webPage.searchPage.total, 1);
      assert.equal(webPage.referenceOptionsScope, 'catalogue');
      assert.equal(webPage.referenceOptions.countyId[0].id, countyId);
      assert.equal(webPage.referenceOptions.amenityId[0].id, amenityId);
      assert.equal(webPage.items[0].id, item.property.id);
      assert.equal(browseCatalogue(webPage, {}).matchingLoadedCount, 1);
      assert.equal((await web.detail(item.property.id)).status, 'found');
      const none = await web.list({ countyId: '00000000-0000-4000-8000-999999999999' });
      assert.equal(none.searchPage.total, 0);
      assert.deepEqual(none.items, []);
      assert.equal(none.referenceOptions.amenityId[0].id, amenityId);
      const empty = await loadMobileReferenceCatalogue(config, {
        search: { location: 'No matching synthetic area', limit: 24 },
      });
      assert.equal(empty.status, 'ready');
      assert.equal(empty.searchPage.total, 0);
      assert.ok(!JSON.stringify(result).includes('PRIVATE SYNTHETIC STAFF FIXTURE ADDRESS'));
      assert.ok(!JSON.stringify(result).includes(preview.bearerToken));
      rows.push(item.property.id);
    } finally {
      // Release this database before allocating the next company's preview.
      await preview.close();
    }
  }
  assert.notEqual(rows[0], rows[1]);
});
