import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { startStaffPreview, REFERENCE_PREVIEW_CATALOGUE } from './staff-preview.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const config = {
  port: 0,
  actor: 'agent',
  referenceDraftMode: 'synthetic-reference-draft-v1',
  referenceModerationMode: 'synthetic-reference-transition-v1',
  referenceCreationMode: 'synthetic-reference-creation-v1',
};
const client = (p) =>
  new RealtorApiClient({
    baseUrl: p.origin,
    privacyNoticeVersion: 'synthetic',
    allowLoopbackHttp: true,
  });
const opt = (p) => ({ bearerToken: p.bearerToken });
const command = (n = 35000, catalogue = REFERENCE_PREVIEW_CATALOGUE) => ({
  policy: 'synthetic-reference-creation-v1',
  listingId: id(n),
  operationId: id(n + 1),
  slug: 'synthetic-reference-created-' + n,
  content: normalizeStaffDraftContentV2({
    title: 'Synthetic signed created apartment',
    propertyType: 'apartment',
    purpose: 'rent',
    currency: 'KES',
    amountMinor: 2000001,
    rentPeriod: 'month',
    country: 'KE',
    locality: catalogue.locations.find((r) => r.id === id(31003)).label,
    location: {
      county: catalogue.locations.find((r) => r.id === id(31001)).label,
      town: catalogue.locations.find((r) => r.id === id(31002)).label,
      area: catalogue.locations.find((r) => r.id === id(31003)).label,
    },
    privateAddress: 'PRIVATE-SIGNED-CREATION',
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
    catalogueVersion: catalogue.version,
    location: { countyId: id(31001), localityId: id(31002), neighbourhoodId: id(31003) },
    amenityIds: [id(31010)],
  },
});
const call = (p, path, init = {}) =>
  fetch(p.origin + path, {
    ...init,
    headers: { authorization: 'Bearer ' + p.bearerToken, ...init.headers },
  });

test('large valid Unicode reference creation crosses 64KiB through signed HTTP and retains exact original', async (t) => {
  const p = await startStaffPreview(config);
  t.after(() => p.close());
  const sdk = client(p),
    options = opt(p);
  const actor = (await sdk.getSyntheticReferenceSessionV3(options)).actorId;
  const cat = await sdk.getSyntheticReferenceCatalogueV3('current', options);
  const base = command(35060, cat);
  const c = {
    ...base,
    content: normalizeStaffDraftContentV2({
      ...base.content,
      title: '🏠'.repeat(160),
      description: '🏠'.repeat(10000),
      privateAddress: '🏠'.repeat(1000),
      pricing: {
        declaration: 'complete',
        charges: Array.from({ length: 32 }, (_, i) => ({
          id: 'fee-' + i,
          name: '🏠'.repeat(160),
          amountStatus: 'known',
          amountMinor: 12345,
          timing: 'one_off',
          classification: 'refundable_deposit',
          mandatory: true,
        })),
      },
    }),
  };
  const bytes = Buffer.byteLength(JSON.stringify(c));
  assert.ok(
    bytes > 65536 && bytes <= 131072,
    'valid scalar-bounded content exceeds generic transport limit',
  );
  const first = await call(
    p,
    `/v3/staff/listings/${c.listingId}/reference-creation-operations/${c.operationId}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(c),
    },
  );
  assert.equal(first.status, 200, `valid ${bytes}-byte original must reach the configured API`);
  const committed = await first.json();
  const original = await sdk.createSyntheticReferenceListingV3(c, cat, actor, options);
  assert.deepEqual(original, committed);
  assert.equal(original.creation.outcome, 'created');
  assert.deepEqual(original.referenceDraft.content, c.content);
  assert.deepEqual(
    await sdk.getSyntheticReferenceCreationReceiptV3(c, cat, actor, options),
    original,
  );
  assert.deepEqual(await sdk.createSyntheticReferenceListingV3(c, cat, actor, options), original);
  const current = await sdk.getStaffDraftV2(c.listingId, 1, options);
  assert.equal(current.version, '3');
  assert.deepEqual(current.content, c.content);
  assert.equal(
    (await sdk.listStaffListingsV2({ ...options, limit: 50 })).items.filter(
      (row) => row.listingId === c.listingId,
    ).length,
    1,
  );
});
test('reference creation fixture and launcher reject orphan or incompatible modes before opening listeners', async () => {
  for (const patch of [
    { referenceCreationMode: 'live' },
    { referenceCreationMode: 'synthetic-reference-creation-v1' },
    { ...config, referenceModerationMode: undefined },
    { ...config, referencePublicMode: 'synthetic-reference-public-v1' },
    { referenceCreationReplyFault: 'invalid-first-created-v1' },
    { ...config, referenceCreationReplyFault: 'other' },
  ])
    await assert.rejects(() => startStaffPreview({ port: 0, ...patch }));
  for (const patch of [
    { STAFF_PREVIEW_REFERENCE_CREATION: 'live' },
    { STAFF_PREVIEW_REFERENCE_CREATION: 'synthetic-reference-creation-v1' },
    { STAFF_PREVIEW_REFERENCE_CREATION_REPLY_FAULT: 'invalid-first-created-v1' },
  ]) {
    const env = { ...process.env, NODE_ENV: 'development' };
    for (const k of [
      'STAFF_PREVIEW_REFERENCE',
      'STAFF_PREVIEW_REFERENCE_MODERATION',
      'STAFF_PREVIEW_REFERENCE_CREATION',
      'STAFF_PREVIEW_REFERENCE_CREATION_REPLY_FAULT',
    ])
      delete env[k];
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../../scripts/staff-preview.mjs', import.meta.url))],
      { env: { ...env, ...patch }, encoding: 'utf8', timeout: 10000 },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Creation preview requires|Creation reply fault requires/);
    assert.equal(result.stdout.includes('Synthetic staff editor:'), false);
  }
});
test('creation paths stay closed in ordinary reference moderation preview', async (t) => {
  const p = await startStaffPreview({ ...config, referenceCreationMode: undefined });
  t.after(() => p.close());
  assert.equal(p.syntheticReferenceCreation, false);
  const c = command(),
    path = `/v3/staff/listings/${c.listingId}/reference-creation-operations/${c.operationId}`;
  assert.equal((await call(p, path)).status, 404);
  assert.equal(
    (
      await call(p, path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(c),
      })
    ).status,
    404,
  );
});
test('signed HTTP creation retains one original after committed reply corruption and returns a fresh current draft', async (t) => {
  const p = await startStaffPreview({
    ...config,
    referenceCreationReplyFault: 'invalid-first-created-v1',
  });
  t.after(() => p.close());
  assert.equal(p.syntheticReferenceCreation, true);
  assert.equal(JSON.stringify(p).includes('bearerToken'), false);
  const sdk = client(p),
    options = opt(p),
    session = await sdk.getSyntheticReferenceSessionV3(options),
    cat = await sdk.getSyntheticReferenceCatalogueV3('current', options),
    c = command(35000, cat);
  assert.equal(session.actorId, id(11));
  assert.equal(cat.version, '2');
  assert.deepEqual(
    await sdk.getSyntheticReferenceCatalogueV3('1', options),
    REFERENCE_PREVIEW_CATALOGUE,
  );
  await assert.rejects(
    () => sdk.createSyntheticReferenceListingV3(c, cat, session.actorId, options),
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain === true,
  );
  const original = await sdk.getSyntheticReferenceCreationReceiptV3(
    c,
    cat,
    session.actorId,
    options,
  );
  assert.equal(original.creation.outcome, 'created');
  assert.equal(original.creation.result.revisionVersion, '2');
  assert.equal(original.referenceDraft.revisionVersion, '3');
  assert.equal(original.referenceDraft.content.amountMinor, 2000001);
  assert.equal(original.referenceDraft.content.pricing.charges[0].amountMinor, 12345);
  assert.deepEqual(
    await sdk.createSyntheticReferenceListingV3(c, cat, session.actorId, options),
    original,
  );
  const draft = await sdk.getStaffDraftV2(c.listingId, 1, options);
  assert.equal(draft.version, '3');
  assert.deepEqual(draft.content, c.content);
  const queue = await sdk.listStaffListingsV2({ ...options, limit: 50 });
  assert.equal(queue.items.filter((row) => row.listingId === c.listingId).length, 1);
  const changed = { ...c, slug: 'different-original' };
  await assert.rejects(
    () => sdk.getSyntheticReferenceCreationReceiptV3(changed, cat, session.actorId, options),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
  const second = command(35010, cat);
  assert.equal(
    (await sdk.createSyntheticReferenceListingV3(second, cat, session.actorId, options)).creation
      .outcome,
    'created',
  );
  const path = `/v3/staff/listings/${c.listingId}/reference-creation-operations/${c.operationId}`;
  for (const [route, init, status] of [
    [path, { method: 'PUT' }, 405],
    [path + '?tenant=' + id(2), {}, 400],
    [path, { headers: { 'x-actor-id': id(10) } }, 400],
    [path, { headers: { cookie: 'not-authority' } }, 400],
    [path, { headers: { origin: 'https://other.invalid' } }, 403],
    [path, { headers: { authorization: 'Bearer forged.b.c' } }, 401],
    [path + '/extra', {}, 404],
  ])
    assert.equal((await call(p, route, init)).status, status);
});
test('signed customer, revoked and other-company identities cannot allocate reference listings', async () => {
  for (const actor of ['customer', 'revoked-agent', 'other-company-admin']) {
    const p = await startStaffPreview({ ...config, actor });
    try {
      const c = command(),
        r = await call(
          p,
          `/v3/staff/listings/${c.listingId}/reference-creation-operations/${c.operationId}`,
          {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(c),
          },
        );
      assert.equal(r.status, 403);
    } finally {
      await p.close();
    }
  }
});
