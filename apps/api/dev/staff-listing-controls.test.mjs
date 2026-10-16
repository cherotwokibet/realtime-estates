import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startStaffPreview } from './staff-preview.mjs';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
for (const actor of ['agent', 'admin'])
  test(`signed ${actor} preview exposes guarded listing control reads and writes with fixed authority`, async () => {
    const p = await startStaffPreview({ port: 0, actor, successorTerminalFixture: 'approved' });
    try {
      const api = new RealtorApiClient({
          baseUrl: p.origin,
          privacyNoticeVersion: 'synthetic-v1',
          allowLoopbackHttp: true,
        }),
        options = { bearerToken: p.bearerToken };
      const before = await api.getStaffListingV2(p.listingId, options),
        q = {
          listingId: p.listingId,
          operationId: randomUUID(),
          kind: 'confirm_availability',
          expectedListingVersion: before.version,
          availability: 'sold',
        };
      const r = await api.controlListingV2(q, options);
      assert.equal(r.decision.outcome, 'applied');
      const after = await api.getStaffListingV2(p.listingId, options);
      assert.equal(after.availability, 'sold');
      assert.equal(after.publicationStatus, 'paused');
      assert.equal(after.publishedRevision, before.publishedRevision);
      assert.deepEqual(await api.getListingControlReceiptV2(q, options), r);
      assert.deepEqual(await api.controlListingV2(q, options), r);
      const archive = {
        listingId: p.listingId,
        operationId: randomUUID(),
        kind: 'set_publication',
        expectedListingVersion: after.version,
        publicationStatus: 'archived',
      };
      if (actor === 'agent')
        await assert.rejects(api.controlListingV2(archive, options), (e) => e.status === 403);
      else assert.equal((await api.controlListingV2(archive, options)).decision.outcome, 'applied');
      const path = `/v2/staff/listings/${p.listingId}/availability-operations/${q.operationId}`,
        headers = { authorization: `Bearer ${p.bearerToken}` };
      assert.equal((await fetch(p.origin + path, { method: 'DELETE', headers })).status, 405);
      assert.equal((await fetch(p.origin + path + '?actorId=x', { headers })).status, 400);
      assert.equal((await fetch(p.origin + path)).status, 401);
    } finally {
      await p.close();
    }
  });
