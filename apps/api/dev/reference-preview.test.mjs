import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { RealtorApiClient } from '@realtor/api-client';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { startStaffPreview, REFERENCE_PREVIEW_CATALOGUE } from './staff-preview.mjs';
const mode = 'synthetic-reference-draft-v1',
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('reference launcher refuses default/aliased/unsafe UI ports before opening a preview', () => {
  for (const port of ['3001', '03003', '65536', '80']) {
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../../../scripts/staff-preview.mjs', import.meta.url))],
      {
        env: {
          ...process.env,
          NODE_ENV: 'development',
          STAFF_PREVIEW_REFERENCE: mode,
          STAFF_PREVIEW_UI_PORT: port,
        },
        encoding: 'utf8',
        timeout: 10000,
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /explicit reference preview UI port/);
    assert.ok(!result.stdout.includes('Synthetic staff editor:'));
  }
});
const client = (p) =>
    new RealtorApiClient({
      baseUrl: p.origin,
      privacyNoticeVersion: 'synthetic',
      allowLoopbackHttp: true,
    }),
  options = (p) => ({ bearerToken: p.bearerToken });
const call = (p, path, init = {}) =>
  fetch(p.origin + path, {
    ...init,
    headers: { authorization: 'Bearer ' + p.bearerToken, ...init.headers },
  });
test('reference fixture rejects unsupported/combined modes and orphan response fault before listeners', async () => {
  for (const config of [
    { referenceDraftMode: 'live' },
    { referenceReplyFault: 'invalid-first-applied-v1' },
    { referenceDraftMode: mode, referenceReplyFault: 'other' },
    { referenceDraftMode: mode, seedPendingReviews: true },
    { referenceDraftMode: mode, enquiryPreview: 'synthetic-v1', seedAcceptedMedia: false },
    { referenceDraftMode: mode, successorTerminalFixture: 'approved' },
  ])
    await assert.rejects(startStaffPreview({ port: 0, ...config }));
});
test('reference fixture remains default-off and exposes no token in serializable metadata', async () => {
  const p = await startStaffPreview({ port: 0 });
  try {
    assert.equal(p.syntheticReferenceDrafts, false);
    assert.equal((await call(p, '/v3/staff/reference-session')).status, 404);
    assert.equal((await call(p, '/v3/staff/reference-catalogues/current')).status, 404);
    assert.ok(!JSON.stringify(p).includes(p.bearerToken));
  } finally {
    await p.close();
  }
});
test('signed loopback reference relay preserves one saved original after a corrupted committed reply', async (t) => {
  const p = await startStaffPreview({
    port: 0,
    referenceDraftMode: mode,
    referenceReplyFault: 'invalid-first-applied-v1',
  });
  t.after(() => p.close());
  const sdk = client(p),
    opt = options(p);
  let catalogue, command;
  await t.test(
    'ephemeral RS256 identity, exact configured company and synthetic catalogue cross real HTTP/JWKS',
    async () => {
      const session = await sdk.getSyntheticReferenceSessionV3(opt);
      assert.equal(session.actorId, id(11));
      assert.equal(session.tenantId, id(1));
      catalogue = await sdk.getSyntheticReferenceCatalogueV3('current', opt);
      assert.deepEqual(catalogue, REFERENCE_PREVIEW_CATALOGUE);
      assert.equal(p.syntheticReferenceDrafts, true);
      assert.ok(!JSON.stringify(p).includes(p.bearerToken));
    },
  );
  await t.test(
    'combined save commits once; malformed first success remains uncertain and GET recovers full original',
    async () => {
      const workspace = await sdk.getStaffDraftWorkspaceV2(p.listingId, p.revision, opt);
      command = {
        policy: mode,
        operationId: id(31300),
        listingId: p.listingId,
        revision: p.revision,
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
      await assert.rejects(
        sdk.saveSyntheticReferenceDraftV3(command, catalogue, id(11), opt),
        (e) => e.submissionUncertain === true,
      );
      const original = await sdk.getSyntheticReferenceDraftReceiptV3(
        command,
        catalogue,
        id(11),
        opt,
      );
      assert.equal(original.revisionVersion, '3');
      assert.equal(original.attributes.location.neighbourhood.id, id(31003));
      assert.equal((await sdk.getStaffDraftWorkspaceV2(p.listingId, 1, opt)).draft.version, '3');
    },
  );
  await t.test(
    'explicit identical replay retains one editorial version; stale new operation is a known conflict',
    async () => {
      await sdk.saveSyntheticReferenceDraftV3(command, catalogue, id(11), opt);
      assert.equal((await sdk.getStaffDraftWorkspaceV2(p.listingId, 1, opt)).draft.version, '3');
      await assert.rejects(
        sdk.saveSyntheticReferenceDraftV3(
          { ...command, operationId: id(31301) },
          catalogue,
          id(11),
          opt,
        ),
        (e) => e.status === 409 && !e.submissionUncertain,
      );
    },
  );
  await t.test(
    'route/method/query/browser authority/cookie/origin and forged bearer guards stay closed',
    async () => {
      for (const [path, init, status] of [
        ['/v3/staff/reference-session', { method: 'POST' }, 405],
        ['/v3/staff/reference-session?tenant=' + id(2), {}, 400],
        ['/v3/staff/reference-session', { headers: { 'x-actor-id': id(10) } }, 400],
        ['/v3/staff/reference-session', { headers: { cookie: 'not-authority' } }, 400],
        ['/v3/staff/reference-session', { headers: { origin: 'https://other.invalid' } }, 403],
        ['/v3/staff/reference-session', { headers: { authorization: 'Bearer invalid.b.c' } }, 401],
        ['/v3/staff/reference-session/extra', {}, 404],
      ])
        assert.equal((await call(p, path, init)).status, status);
    },
  );
});
test('signed reference relay denies customer, revoked and other-company identity', async () => {
  for (const actor of ['customer', 'revoked-agent', 'other-company-admin']) {
    const p = await startStaffPreview({ port: 0, referenceDraftMode: mode, actor });
    try {
      await assert.rejects(
        client(p).getSyntheticReferenceSessionV3(options(p)),
        (e) => e.status === 403,
      );
      await assert.rejects(
        client(p).getSyntheticReferenceCatalogueV3('current', options(p)),
        (e) => e.status === 403,
      );
    } finally {
      await p.close();
    }
  }
});
