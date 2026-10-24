import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { startStaffPreview } from './staff-preview.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const config = {
  port: 0,
  actor: 'agent',
  referenceDraftMode: 'synthetic-reference-draft-v1',
  referenceModerationMode: 'synthetic-reference-transition-v1',
  referenceSuccessorMode: 'synthetic-reference-successor-v1',
};
const sdk = (p) =>
  new RealtorApiClient({
    baseUrl: p.origin,
    privacyNoticeVersion: 'synthetic',
    allowLoopbackHttp: true,
  });
const opt = (p) => ({ bearerToken: p.bearerToken });
const path = (c) =>
  `/v3/staff/listings/${c.listingId}/reference-successor-operations/${c.operationId}`;
const call = (p, route, init = {}) =>
  fetch(p.origin + route, {
    ...init,
    headers: { authorization: 'Bearer ' + p.bearerToken, ...init.headers },
  });
function command(listing, cat, operation = 39000) {
  return {
    policy: 'synthetic-reference-successor-v1',
    listingId: listing.listingId,
    operationId: id(operation),
    expectedListingVersion: listing.version,
    predecessor: {
      revision: listing.latest.revision,
      version: listing.latest.version,
      state: listing.latest.state,
    },
    content: normalizeStaffDraftContentV2({
      title: 'Synthetic signed successor apartment',
      description: 'Synthetic successor only',
      privateAddress: 'PRIVATE-SIGNED-SUCCESSOR',
      propertyType: 'apartment',
      purpose: 'rent',
      currency: 'KES',
      amountMinor: 2000001,
      rentPeriod: 'month',
      country: 'KE',
      locality: cat.locations.find((r) => r.id === id(31003)).label,
      location: {
        county: cat.locations.find((r) => r.id === id(31001)).label,
        town: cat.locations.find((r) => r.id === id(31002)).label,
        area: cat.locations.find((r) => r.id === id(31003)).label,
      },
      pricing: {
        declaration: 'incomplete',
        charges: [
          {
            id: 'deposit',
            name: 'Synthetic deposit',
            amountStatus: 'known',
            amountMinor: 12345,
            timing: 'one_off',
            classification: 'refundable_deposit',
            mandatory: true,
          },
        ],
      },
    }),
    selection: {
      catalogueVersion: cat.version,
      location: { countyId: id(31001), localityId: id(31002), neighbourhoodId: id(31003) },
      amenityIds: [id(31010)],
    },
  };
}
test('successor fixture/launcher reject orphan, incompatible and fault modes before listeners', async () => {
  for (const patch of [
    { referenceSuccessorMode: 'live' },
    { referenceSuccessorMode: config.referenceSuccessorMode },
    { ...config, referenceModerationMode: undefined },
    { ...config, referencePublicMode: 'synthetic-reference-public-v1' },
    { referenceSuccessorReplyFault: 'invalid-first-successor-v1' },
    { ...config, referenceSuccessorReplyFault: 'other' },
    { ...config, seedAcceptedMedia: false },
  ])
    await assert.rejects(() => startStaffPreview(patch));
  for (const patch of [
    { STAFF_PREVIEW_REFERENCE_SUCCESSOR: 'live' },
    { STAFF_PREVIEW_REFERENCE_SUCCESSOR: config.referenceSuccessorMode },
    { STAFF_PREVIEW_REFERENCE_SUCCESSOR_REPLY_FAULT: 'invalid-first-successor-v1' },
  ]) {
    const env = { ...process.env, NODE_ENV: 'development' };
    for (const k of [
      'STAFF_PREVIEW_REFERENCE',
      'STAFF_PREVIEW_REFERENCE_MODERATION',
      'STAFF_PREVIEW_REFERENCE_SUCCESSOR',
      'STAFF_PREVIEW_REFERENCE_SUCCESSOR_REPLY_FAULT',
    ])
      delete env[k];
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../../scripts/staff-preview.mjs', import.meta.url))],
      { env: { ...env, ...patch }, encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /Successor preview requires|Successor reply fault requires/);
    assert.equal(r.stdout.includes('Synthetic staff editor:'), false);
  }
});
test('successor routes stay closed in ordinary reference moderation preview', async (t) => {
  const p = await startStaffPreview({ ...config, referenceSuccessorMode: undefined });
  t.after(() => p.close());
  assert.equal(p.syntheticReferenceSuccessor, false);
  const route = path({ listingId: p.listingId, operationId: id(39000) });
  assert.equal((await call(p, route)).status, 404);
  assert.equal(
    (
      await call(p, route, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      })
    ).status,
    404,
  );
});
test('signed HTTP committed successor corrupts one reply, recovers exact original, keeps one empty successor and public pointer, then edits fresh current draft', async (t) => {
  const p = await startStaffPreview({
    ...config,
    referenceSuccessorReplyFault: 'invalid-first-successor-v1',
  });
  t.after(() => p.close());
  assert.equal(p.syntheticReferenceSuccessor, true);
  assert.equal(JSON.stringify(p).includes('bearerToken'), false);
  const client = sdk(p),
    options = opt(p),
    actor = (await client.getSyntheticReferenceSessionV3(options)).actorId,
    cat = await client.getSyntheticReferenceCatalogueV3('current', options),
    before = await client.getStaffListingV2(p.listingId, options),
    c = command(before, cat);
  assert.equal(before.latest.state, 'approved');
  assert.equal(before.publishedRevision, 1);
  assert.equal(cat.version, '2');
  // GET absence and a refused stale POST do not consume the deliberate post-commit fault.
  assert.equal((await call(p, path(c))).status, 404);
  const stale = { ...c, expectedListingVersion: '1' };
  assert.equal(
    (
      await call(p, path(stale), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(stale),
      })
    ).status,
    409,
  );
  await assert.rejects(
    () => client.startSyntheticReferenceSuccessorV3(c, cat, actor, options),
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
  );
  const current = await client.getStaffListingV2(p.listingId, options);
  assert.equal(current.latest.state, 'draft');
  assert.equal(current.latest.revision, 2);
  assert.equal(current.publishedRevision, 1);
  assert.equal(current.publicationStatus, before.publicationStatus);
  const original = await client.getSyntheticReferenceSuccessorReceiptV3(c, cat, actor, options);
  assert.equal(original.successor.decision.outcome, 'applied');
  assert.equal(original.referenceDraft.revisionVersion, '3');
  assert.deepEqual(original.referenceDraft.content, c.content);
  assert.deepEqual(
    await client.startSyntheticReferenceSuccessorV3(c, cat, actor, options),
    original,
  );
  const workspace = await client.getStaffDraftWorkspaceV2(p.listingId, 2, options);
  assert.equal(workspace.draft.version, '3');
  assert.deepEqual(workspace.photos, []);
  const edited = {
    ...workspace.draft.content,
    title: 'Synthetic fresh edit after original recovery',
  };
  await assert.rejects(
    () =>
      client.saveStaffDraftV2(
        p.listingId,
        2,
        { expectedVersion: workspace.draft.version, content: edited },
        options,
      ),
    (e) => e.status === 422 && !e.submissionUncertain,
  );
  const saved = await client.saveSyntheticReferenceDraftV3(
    {
      policy: 'synthetic-reference-draft-v1',
      listingId: p.listingId,
      revision: 2,
      operationId: id(39002),
      expectedVersion: workspace.draft.version,
      content: edited,
      selection: c.selection,
    },
    cat,
    actor,
    options,
  );
  assert.equal(saved.revisionVersion, '4');
  assert.deepEqual(
    await client.getSyntheticReferenceSuccessorReceiptV3(c, cat, actor, options),
    original,
  );
  assert.equal((await client.getStaffDraftV2(p.listingId, 2, options)).content.title, edited.title);
  assert.equal((await client.getStaffListingV2(p.listingId, options)).latest.revision, 2);
  const changed = { ...c, operationId: id(39001) };
  await assert.rejects(() =>
    client.startSyntheticReferenceSuccessorV3(changed, cat, actor, options),
  );
  for (const [route, init, status] of [
    [path(c), { method: 'PUT' }, 405],
    [path(c) + '?tenant=' + id(2), {}, 400],
    [path(c), { headers: { 'x-actor-id': id(10) } }, 400],
    [path(c), { headers: { cookie: 'not-authority' } }, 400],
    [path(c), { headers: { origin: 'https://other.invalid' } }, 403],
    [path(c), { headers: { authorization: 'Bearer forged.b.c' } }, 401],
    [path(c) + '/extra', {}, 404],
  ])
    assert.equal((await call(p, route, init)).status, status);
});
test('signed customer, revoked and other-company identities cannot start or read reference successor originals', async () => {
  for (const actor of ['customer', 'revoked-agent', 'other-company-admin', 'other-company-agent']) {
    const p = await startStaffPreview({ ...config, actor });
    try {
      const route = path({ listingId: p.listingId, operationId: id(39000) });
      assert.equal((await call(p, route)).status, 403);
      assert.equal(
        (
          await call(p, route, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({}),
          })
        ).status,
        403,
      );
    } finally {
      await p.close();
    }
  }
});
