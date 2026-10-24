import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { startStaffPreview } from '../../api/dev/staff-preview.mjs';
import { readRevisionProtocolScreen } from '../dist/tests/lib/revision-protocol-screen.js';
import {
  readMixedDraftScreen,
  readReferenceEntryScreen,
} from '../dist/tests/lib/mixed-draft-screen.js';
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

test('mixed-row server handoff crosses signed HTTP before adoption and preserves saved IDs plus read-only pending recovery', async (t) => {
  const p = await startStaffPreview({
    port: 0,
    referenceDraftMode: 'synthetic-reference-draft-v1',
    referenceModerationMode: 'synthetic-reference-transition-v1',
  });
  t.after(() => p.close());
  const calls = [],
    transport = async (url, init) => {
      calls.push({ path: new URL(url).pathname, method: init.method });
      return fetch(url, init);
    };
  const config = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
    STAFF_PREVIEW_REFERENCE_MODERATION: 'synthetic-reference-transition-v1',
    STAFF_PREVIEW_API_ORIGIN: p.origin,
    STAFF_PREVIEW_TOKEN: p.bearerToken,
    STAFF_PREVIEW_INSTANCE: id(991),
  };
  const client = new RealtorApiClient({
      baseUrl: p.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic',
      fetch: transport,
    }),
    opt = { bearerToken: p.bearerToken };
  const content = normalizeStaffDraftContentV2({
    title: 'Synthetic mixed-row draft',
    propertyType: 'apartment',
    pricing: { declaration: 'not_declared', charges: [] },
    location: { county: null, town: null, area: null },
  });
  await client.createListingV2(
    { listingId: id(480), operationId: id(34800), slug: 'synthetic-mixed-draft', content },
    opt,
  );
  const ordinary = await readMixedDraftScreen(id(480), '1', config, transport);
  assert.equal(ordinary.kind, 'ordinary');
  const entry = await readReferenceEntryScreen(id(480), '1', config, transport);
  assert.equal(entry.expectedVersion, '2');
  const catalogue = await client.getSyntheticReferenceCatalogueV3('current', opt);
  const label = (number) => catalogue.locations.find((row) => row.id === id(number)).label;
  const command = {
    policy: 'synthetic-reference-draft-v1',
    operationId: id(34801),
    listingId: id(480),
    revision: 1,
    expectedVersion: '2',
    content: normalizeStaffDraftContentV2({
      ...content,
      locality: label(31003),
      location: {
        county: label(31001),
        town: label(31002),
        area: label(31003),
      },
    }),
    selection: {
      catalogueVersion: catalogue.version,
      location: { countyId: id(31001), localityId: id(31002), neighbourhoodId: id(31003) },
      amenityIds: [id(31010)],
    },
  };
  await client.saveSyntheticReferenceDraftV3(command, catalogue, id(11), opt);
  const before = calls.filter((c) => c.method === 'POST').length;
  const adopted = await readMixedDraftScreen(id(480), '1', config, transport);
  assert.equal(adopted.kind, 'reference');
  assert.equal(adopted.screen.initialSelection.location.neighbourhoodId, id(31003));
  assert.deepEqual(adopted.screen.initialSelection.amenityIds, [id(31010)]);
  assert.equal(adopted.screen.editingDisabled, false);
  assert.equal(adopted.screen.expectedVersion, '3');
  const pending = await readMixedDraftScreen(p.listingId, '1', config, transport);
  assert.equal(pending.kind, 'reference');
  assert.equal(pending.screen.editingDisabled, true);
  const receipt = await client.getSyntheticReferenceDraftReceiptV3(command, catalogue, id(11), opt);
  assert.equal(receipt.revisionVersion, '3');
  assert.equal(calls.filter((c) => c.method === 'POST').length, before);
  assert.ok(!JSON.stringify(adopted).includes(p.bearerToken));
});
