import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { startStaffPreview } from './staff-preview.mjs';
const mode = 'synthetic-reference-draft-v1';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('signed protocol read crosses HTTP/JWKS/restricted SQL before and after explicit reference adoption', async (t) => {
  const p = await startStaffPreview({ port: 0, referenceDraftMode: mode });
  t.after(() => p.close());
  const calls = [],
    sdk = new RealtorApiClient({
      baseUrl: p.origin,
      allowLoopbackHttp: true,
      privacyNoticeVersion: 'synthetic',
      fetch: async (url, init) => {
        calls.push({ url, method: init.method });
        return fetch(url, init);
      },
    }),
    opt = { bearerToken: p.bearerToken };
  const before = await sdk.getRevisionProtocolV3(p.listingId, 1, opt);
  assert.equal(before.protocol, 'ordinary-v2');
  assert.equal(before.editable, true);
  assert.equal(before.revisionVersion, '2');
  assert.equal(calls.length, 1);
  const workspace = await sdk.getStaffDraftWorkspaceV2(p.listingId, 1, opt),
    catalogue = await sdk.getSyntheticReferenceCatalogueV3('current', opt);
  const command = {
    policy: mode,
    operationId: id(31999),
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
      catalogueVersion: catalogue.version,
      location: { countyId: id(31001), localityId: id(31002), neighbourhoodId: id(31003) },
      amenityIds: [id(31010)],
    },
  };
  const session = await sdk.getSyntheticReferenceSessionV3(opt);
  await sdk.saveSyntheticReferenceDraftV3(command, catalogue, session.actorId, opt);
  const after = await sdk.getRevisionProtocolV3(p.listingId, 1, opt);
  assert.equal(after.protocol, 'synthetic-reference-v1');
  assert.equal(after.revisionVersion, '3');
  assert.equal(after.listingVersion, before.listingVersion);
  assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
  assert.equal((await sdk.getStaffDraftWorkspaceV2(p.listingId, 1, opt)).draft.version, '3');
  await assert.rejects(
    sdk.getRevisionProtocolV3(id(999), 1, opt),
    (e) => e.status === 404 && !e.submissionUncertain,
  );
  await assert.rejects(
    sdk.getRevisionProtocolV3(p.listingId, 1, { bearerToken: 'invalid.b.c' }),
    (e) => e.status === 401 && !e.submissionUncertain,
  );
  const res = await fetch(p.origin + `/v3/staff/listings/${p.listingId}/revision-protocol/1`, {
    headers: { authorization: 'Bearer ' + p.bearerToken, 'x-actor-id': id(10) },
  });
  assert.equal(res.status, 400);
});
