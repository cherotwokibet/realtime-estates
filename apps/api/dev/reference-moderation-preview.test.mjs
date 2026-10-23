import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RealtorApiClient } from '@realtor/api-client';
import { startStaffPreview, REFERENCE_PREVIEW_CATALOGUE } from './staff-preview.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const draftMode = 'synthetic-reference-draft-v1',
  mode = 'synthetic-reference-transition-v1';
const config = {
  port: 0,
  actor: 'admin',
  referenceDraftMode: draftMode,
  referenceModerationMode: mode,
};
const client = (p) =>
  new RealtorApiClient({
    baseUrl: p.origin,
    privacyNoticeVersion: 'synthetic',
    allowLoopbackHttp: true,
  });
const options = (p) => ({ bearerToken: p.bearerToken });
const command = (review, action, operation, reason = null) => ({
  policy: mode,
  operationId: id(operation),
  listingId: review.listingId,
  revision: review.revision,
  review,
  action,
  reason,
});
const call = (p, path, init = {}) =>
  fetch(p.origin + path, {
    ...init,
    headers: { authorization: 'Bearer ' + p.bearerToken, ...init.headers },
  });
test('moderation fixture refuses unsupported and orphan modes before opening listeners', async () => {
  for (const bad of [
    { referenceModerationMode: mode },
    { referenceDraftMode: draftMode, referenceModerationMode: 'live' },
    { ...config, seedAcceptedMedia: false },
    { ...config, nativeUploads: { mode: 'synthetic-native-v1' } },
    { referenceModerationReplyFault: 'invalid-first-transition-v1' },
    { ...config, referenceModerationReplyFault: 'other' },
  ])
    await assert.rejects(() => startStaffPreview(bad));
  for (const env of [
    { STAFF_PREVIEW_REFERENCE_MODERATION: mode },
    { STAFF_PREVIEW_REFERENCE: draftMode, STAFF_PREVIEW_REFERENCE_MODERATION: 'live' },
  ]) {
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../../scripts/staff-preview.mjs', import.meta.url))],
      {
        env: { ...process.env, NODE_ENV: 'development', ...env },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.equal(r.status, 1);
    assert.match(r.stderr, /explicit reference draft and transition modes/);
    assert.ok(!r.stdout.includes('Synthetic staff editor:'));
  }
});
test('signed moderation context and lost committed approval recover the original across real HTTP and JWKS', async (t) => {
  const p = await startStaffPreview({
    ...config,
    referenceModerationReplyFault: 'invalid-first-transition-v1',
  });
  t.after(() => p.close());
  const sdk = client(p),
    opt = options(p);
  assert.equal(p.syntheticReferenceModeration, true);
  assert.equal(p.referenceReviewVersion, '4');
  assert.equal(p.acceptedMediaMetadataOnly, true);
  assert.equal(p.nativeUploads, false);
  assert.ok(!JSON.stringify(p).includes(p.bearerToken));
  const session = await sdk.getSyntheticReferenceSessionV3(opt);
  assert.equal(session.actorId, id(10));
  const initial = await sdk.getSyntheticReferenceReviewContextV3(p.listingId, 1, '4', opt);
  assert.deepEqual(initial.catalogue, REFERENCE_PREVIEW_CATALOGUE);
  assert.equal(initial.review.attributes.catalogueVersion, '1');
  assert.equal(initial.review.photos.length, 4);
  assert.ok(initial.review.photos.every((p) => p.altText.includes('image bytes unavailable')));
  assert.equal((await sdk.getSyntheticReferenceCatalogueV3('current', opt)).version, '2');
  const original = command(initial.review, 'approve', 34000);
  await assert.rejects(
    () =>
      sdk.transitionSyntheticReferenceRevisionV3(original, initial.catalogue, session.actorId, opt),
    (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
  );
  assert.equal(
    (await sdk.getSyntheticReferenceRevisionContextV3(p.listingId, 1, '5', opt)).review.state,
    'approved',
  );
  await assert.rejects(
    () => sdk.getSyntheticReferenceReviewContextV3(p.listingId, 1, '4', opt),
    (e) => e.status === 409,
  );
  await assert.rejects(
    () => sdk.getSyntheticReferenceReviewContextV3(p.listingId, 1, '5', opt),
    (e) => e.status === 404,
  );
  const receipt = await sdk.getSyntheticReferenceTransitionReceiptV3(
    original,
    initial.catalogue,
    session.actorId,
    opt,
  );
  assert.equal(receipt.state, 'approved');
  assert.equal(receipt.revisionVersion, '5');
  assert.deepEqual(
    await sdk.transitionSyntheticReferenceRevisionV3(
      original,
      initial.catalogue,
      session.actorId,
      opt,
    ),
    receipt,
  );
  const changed = structuredClone(original);
  changed.review.content.privateAddress = 'Changed retained private fact';
  await assert.rejects(
    () =>
      sdk.getSyntheticReferenceTransitionReceiptV3(
        changed,
        initial.catalogue,
        session.actorId,
        opt,
      ),
    (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
  );
  assert.equal(
    (await sdk.getSyntheticReferenceRevisionContextV3(p.listingId, 1, '5', opt)).review
      .revisionVersion,
    '5',
  );
});
test('signed rejection retains its exact private reason and refuses forged context or other-company rows', async (t) => {
  const p = await startStaffPreview(config);
  t.after(() => p.close());
  const sdk = client(p),
    opt = options(p);
  const initial = await sdk.getSyntheticReferenceReviewContextV3(p.listingId, 1, '4', opt);
  const original = command(
    initial.review,
    'reject',
    34001,
    'Synthetic missing disclosure; please revise.',
  );
  const result = await sdk.transitionSyntheticReferenceRevisionV3(
    original,
    initial.catalogue,
    id(10),
    opt,
  );
  assert.equal(result.state, 'rejected');
  assert.equal(result.reason, original.reason);
  assert.deepEqual(
    await sdk.getSyntheticReferenceTransitionReceiptV3(original, initial.catalogue, id(10), opt),
    result,
  );
  for (const [path, init, status] of [
    [`/v3/staff/reviews/${id(500)}/reference-revisions/1/4/context`, {}, 404],
    [`/v3/staff/listings/${p.listingId}/reference-revisions/1/5/context?catalogue=2`, {}, 400],
    [
      `/v3/staff/listings/${p.listingId}/reference-revisions/1/5/context`,
      { headers: { 'x-actor-id': id(11) } },
      400,
    ],
    ['/v3/staff/reference-session', { headers: { authorization: 'Bearer forged.b.c' } }, 401],
    ['/v3/staff/reference-session', { headers: { origin: 'https://other.invalid' } }, 403],
  ])
    assert.equal((await call(p, path, init)).status, status);
});
test('draft-only mode leaves moderation paths closed and agent cannot enter reviewer context', async (t) => {
  const draft = await startStaffPreview({ port: 0, referenceDraftMode: draftMode });
  t.after(() => draft.close());
  assert.equal(draft.syntheticReferenceModeration, false);
  assert.equal(
    (await call(draft, `/v3/staff/reviews/${draft.listingId}/reference-revisions/1/4/context`))
      .status,
    404,
  );
  const agent = await startStaffPreview({ ...config, actor: 'agent' });
  t.after(() => agent.close());
  await assert.rejects(
    () =>
      client(agent).getSyntheticReferenceReviewContextV3(agent.listingId, 1, '4', options(agent)),
    (e) => e.status === 403,
  );
  const own = await client(agent).getSyntheticReferenceRevisionContextV3(
    agent.listingId,
    1,
    '4',
    options(agent),
  );
  assert.equal(own.review.state, 'pending');
});
