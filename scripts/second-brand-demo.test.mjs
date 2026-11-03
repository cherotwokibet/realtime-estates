import test from 'node:test';
import assert from 'node:assert/strict';
import {
  prepareSecondBrandDemo,
  secondBrandManifest,
  secondBrandProfile,
} from './second-brand-fixture.mjs';
import { resolveTenantManifest } from '../apps/web/dist/tests/lib/tenant-manifest.js';

test('two independently configured synthetic brands retain distinct public identities, contact addresses, stock and signed reminder captures', async () => {
  const proofs = [];
  for (const slug of ['realtime-estates', 'sample-homes']) {
    const p = await prepareSecondBrandDemo(slug);
    try {
      const manifest = resolveTenantManifest(JSON.stringify(p.manifest), slug);
      assert.equal(manifest.status, 'configured');
      assert.equal(manifest.manifest.companyContent.contact.email, p.proof.email);
      assert.equal(manifest.manifest.brand.tenantId, p.proof.tenantId);
      proofs.push(p.proof);
    } finally {
      await p.preview.close();
    }
  }
  for (const field of ['tenantId', 'name', 'email', 'primary', 'listingId'])
    assert.notEqual(proofs[0][field], proofs[1][field]);
  for (const field of ['enquiryId', 'viewingId', 'actorId', 'operationId'])
    assert.notEqual(proofs[0].notification[field], proofs[1].notification[field]);
  assert.ok(proofs[0].inventoryIds.every((id) => !proofs[1].inventoryIds.includes(id)));
  console.log(JSON.stringify({ policy: 'synthetic-second-brand-proof-v1', brands: proofs }));
});
test('brand demonstration refuses unknown identity, production and swapped presentation scope', async () => {
  assert.throws(() => secondBrandProfile('other'));
  assert.equal(
    resolveTenantManifest(JSON.stringify(secondBrandManifest('sample-homes')), 'realtime-estates')
      .status,
    'invalid',
  );
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    await assert.rejects(() => prepareSecondBrandDemo('sample-homes'));
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
