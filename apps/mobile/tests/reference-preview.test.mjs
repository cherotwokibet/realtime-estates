import test from 'node:test';
import assert from 'node:assert/strict';
import { startStaffPreview } from '../../api/dev/staff-preview.mjs';
import {
  loadMobileReferenceCatalogue,
  resolveMobileReferenceConfig,
} from '../dist/tests/src/reference-catalogue.js';
test('mobile adapter reads the real anonymous HTTP/SQL approved historical projection for two fixed companies', async (t) => {
  const rows = [];
  for (const tenantSlug of ['realtime-estates', 'sample-homes']) {
    const preview = await startStaffPreview({
      port: 0,
      tenantSlug,
      referenceDraftMode: 'synthetic-reference-draft-v1',
      referenceModerationMode: 'synthetic-reference-transition-v1',
      referencePublicMode: 'synthetic-reference-public-v1',
    });
    t.after(() => preview.close());
    const config = resolveMobileReferenceConfig(
      { mode: 'synthetic-reference-public-v1', apiOrigin: preview.origin, allowLoopbackHttp: true },
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
    assert.ok(!JSON.stringify(result).includes('PRIVATE SYNTHETIC STAFF FIXTURE ADDRESS'));
    assert.ok(!JSON.stringify(result).includes(preview.bearerToken));
    rows.push(item.property.id);
  }
  assert.notEqual(rows[0], rows[1]);
});
