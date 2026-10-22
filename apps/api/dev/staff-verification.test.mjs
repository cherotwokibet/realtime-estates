import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startStaffPreview } from './staff-preview.mjs';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
test('signed synthetic preview records original assessment, pages older history and preserves current listing', async () => {
  const p = await startStaffPreview({ port: 0, actor: 'admin' });
  try {
    const api = new RealtorApiClient({
        baseUrl: p.origin,
        privacyNoticeVersion: 'synthetic-v1',
        allowLoopbackHttp: true,
      }),
      options = { bearerToken: p.bearerToken },
      listing = await api.getStaffListingV2(p.listingId, options),
      target = {
        listingId: p.listingId,
        listingVersion: listing.version,
        revision: listing.latest.revision,
        revisionVersion: listing.latest.version,
      };
    const commands = [];
    for (let version = 0; version < 3; version++) {
      const command = {
        operationId: randomUUID(),
        policy: 'synthetic-check-record-v1',
        target,
        expectedVerificationVersion: String(version),
        subject: 'identity',
        outcome: 'inconclusive',
        evidenceReference: null,
        note: 'Synthetic signed-preview assessment.',
        observedAt: '2026-01-01T00:00:00.000Z',
      };
      commands.push(command);
      const result = await api.recordSyntheticListingVerificationV2(command, options);
      assert.equal(result.decision.outcome, 'recorded');
      assert.equal(result.decision.record.verificationVersion, String(version + 1));
    }
    const first = await api.getListingVerificationReceiptV2(commands[0], options);
    assert.equal(first.decision.record.verificationVersion, '1');
    assert.deepEqual(await api.recordSyntheticListingVerificationV2(commands[0], options), first);
    const latest = await api.getListingVerificationHistoryV2(p.listingId, 2, options);
    assert.deepEqual(
      latest.records.map((r) => r.verificationVersion),
      ['3', '2'],
    );
    assert.equal(latest.hasMore, true);
    const older = await api.getListingVerificationHistoryV2(p.listingId, 2, options, '2');
    assert.deepEqual(
      older.records.map((r) => r.verificationVersion),
      ['1'],
    );
    assert.equal(older.hasMore, false);
    assert.deepEqual(await api.getStaffListingV2(p.listingId, options), listing);
    const path = `/v2/staff/listings/${p.listingId}/verification-history`,
      headers = { authorization: `Bearer ${p.bearerToken}` };
    for (const query of [
      '?limit=2&beforeVersion=0',
      '?limit=2&beforeVersion=2&actorId=x',
      '?beforeVersion=2&limit=2',
    ])
      assert.equal((await fetch(p.origin + path + query, { headers })).status, 400);
    assert.equal((await fetch(p.origin + path + '?limit=2')).status, 401);
  } finally {
    await p.close();
  }
});
test('signed agent cannot read assessment history or record a check even on assigned stock', async () => {
  const p = await startStaffPreview({ port: 0, actor: 'agent' });
  try {
    const api = new RealtorApiClient({
        baseUrl: p.origin,
        privacyNoticeVersion: 'synthetic-v1',
        allowLoopbackHttp: true,
      }),
      options = { bearerToken: p.bearerToken },
      listing = await api.getStaffListingV2(p.listingId, options);
    await assert.rejects(
      () => api.getListingVerificationHistoryV2(p.listingId, 20, options),
      (e) => e.status === 403,
    );
    await assert.rejects(
      () =>
        api.recordSyntheticListingVerificationV2(
          {
            operationId: randomUUID(),
            policy: 'synthetic-check-record-v1',
            target: {
              listingId: p.listingId,
              listingVersion: listing.version,
              revision: listing.latest.revision,
              revisionVersion: listing.latest.version,
            },
            expectedVerificationVersion: '0',
            subject: 'identity',
            outcome: 'inconclusive',
            evidenceReference: null,
            note: 'Synthetic denied assessment.',
            observedAt: '2026-01-01T00:00:00.000Z',
          },
          options,
        ),
      (e) => e.status === 403,
    );
  } finally {
    await p.close();
  }
});
