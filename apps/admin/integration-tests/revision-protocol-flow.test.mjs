import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { startStaffPreview } from '../../api/dev/staff-preview.mjs';
import { readRevisionProtocolScreen } from '../dist/tests/lib/revision-protocol-screen.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('server-only protocol context uses signed HTTP authority and follows explicit persisted adoption', async (t) => {
  const p = await startStaffPreview({
    port: 0,
    referenceDraftMode: 'synthetic-reference-draft-v1',
  });
  t.after(() => p.close());
  const env = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
    STAFF_PREVIEW_API_ORIGIN: p.origin,
    STAFF_PREVIEW_TOKEN: p.bearerToken,
    STAFF_PREVIEW_INSTANCE: id(990),
  };
  const before = await readRevisionProtocolScreen(p.listingId, '1', env);
  assert.deepEqual(before.scope, { instanceId: id(990), tenantId: id(1), actorId: id(11) });
  assert.equal(before.protocol.protocol, 'ordinary-v2');
  assert.equal(before.protocol.revisionVersion, '2');
  const client = new RealtorApiClient({
      baseUrl: p.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic',
    }),
    opt = { bearerToken: p.bearerToken };
  const workspace = await client.getStaffDraftWorkspaceV2(p.listingId, 1, opt),
    catalogue = await client.getSyntheticReferenceCatalogueV3('current', opt);
  const original = {
    policy: 'synthetic-reference-draft-v1',
    operationId: id(33999),
    listingId: p.listingId,
    revision: 1,
    expectedVersion: workspace.draft.version,
    content: normalizeStaffDraftContentV2({
      ...workspace.draft.content,
      locality: 'Synthetic preview block',
      location: {
        county: 'Synthetic preview county',
        town: 'Synthetic preview town',
        area: 'Synthetic preview block',
      },
    }),
    selection: {
      catalogueVersion: '1',
      location: { countyId: id(31001), localityId: id(31002), neighbourhoodId: id(31003) },
      amenityIds: [id(31010)],
    },
  };
  await client.saveSyntheticReferenceDraftV3(original, catalogue, id(11), opt);
  const after = await readRevisionProtocolScreen(p.listingId, '1', env);
  assert.deepEqual(after.scope, before.scope);
  assert.equal(after.protocol.protocol, 'synthetic-reference-v1');
  assert.equal(after.protocol.revisionVersion, '3');
  assert.ok(!JSON.stringify(after).includes(p.bearerToken));
  await assert.rejects(readRevisionProtocolScreen(id(999), '1', env));
  await assert.rejects(
    readRevisionProtocolScreen(p.listingId, '1', { ...env, STAFF_PREVIEW_TOKEN: 'invalid.b.c' }),
  );
});
