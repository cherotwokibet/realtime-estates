import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '@realtor/api-client';
import { startStaffPreview } from './staff-preview.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('real signed ordinary staff context works for each configured company without isolated reference schema', async () => {
  for (const [tenantSlug, actor, tenant, user] of [
    ['realtime-estates', 'agent', 1, 11],
    ['realtime-estates', 'admin', 1, 10],
    ['sample-homes', 'agent', 2, 21],
  ]) {
    const p = await startStaffPreview({ port: 0, tenantSlug, actor });
    try {
      const sdk = new RealtorApiClient({
        baseUrl: p.origin,
        privacyNoticeVersion: 'synthetic',
        allowLoopbackHttp: true,
      });
      assert.deepEqual(await sdk.getCurrentStaffSessionV2({ bearerToken: p.bearerToken }), {
        policy: 'current-staff-session-v2',
        tenantId: id(tenant),
        actorId: id(user),
      });
      assert.equal(p.syntheticReferenceDrafts, false);
      assert.equal(
        (
          await fetch(p.origin + '/v3/staff/reference-session', {
            headers: { authorization: 'Bearer ' + p.bearerToken },
          })
        ).status,
        404,
      );
    } finally {
      await p.close();
    }
  }
});
test('real signed customer/revoked/foreign identities cannot read ordinary staff context', async () => {
  for (const actor of ['customer', 'revoked-agent', 'other-company-admin', 'other-company-agent']) {
    const p = await startStaffPreview({ port: 0, actor });
    try {
      const r = await fetch(p.origin + '/v2/staff/session', {
        headers: { authorization: 'Bearer ' + p.bearerToken },
      });
      assert.equal(r.status, 403);
      assert.ok(!(await r.text()).includes('current-staff-session-v2'));
    } finally {
      await p.close();
    }
  }
});
