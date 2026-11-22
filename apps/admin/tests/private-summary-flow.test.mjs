import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startAdminAuditPreview } from '../../api/dev/admin-audit-preview.mjs';
import { startCustomerPreview } from '../../api/dev/customer-preview.mjs';
import { RealtorApiClient } from '@realtor/api-client';
import { privateSummaryRequest } from '../dist/tests/lib/private-summary-server.js';
const origin = 'http://127.0.0.1:49104';
const request = (kind, scope) =>
  new Request(origin + '/api/private-summary/' + kind, {
    headers: {
      host: '127.0.0.1:49104',
      'x-preview-instance': scope.instanceId,
      'x-preview-tenant': scope.tenantId,
      'x-preview-actor': scope.actorId,
    },
  });
const config = (fixture, token, scope) => ({
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_API_ORIGIN: fixture.origin,
  STAFF_PREVIEW_TOKEN: token,
  STAFF_PREVIEW_INSTANCE: scope.instanceId,
  STAFF_AUDIT_PREVIEW_MODE: 'synthetic-admin-audit-v1',
  STAFF_AUDIT_WEB_ORIGIN: origin,
  STAFF_PUSH_QUEUE_MODE: 'synthetic-v1',
  STAFF_PUSH_QUEUE_TENANT: scope.tenantId,
});
for (const kind of ['audit', 'push'])
  test(
    kind +
      ': signed API/SQL read is scoped and membership loss during a read suppresses the response',
    async (t) => {
      const prior = process.env.NODE_ENV;
      process.env.NODE_ENV = 'development';
      t.after(() => {
        if (prior === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prior;
      });
      const fixture =
        kind === 'audit'
          ? await startAdminAuditPreview({ mode: 'synthetic-admin-audit-v1' })
          : await startCustomerPreview({
              pushMode: 'synthetic-customer-push-v1',
              deletionMode: 'synthetic-customer-deletion-v1',
              pushQueueSummaryMode: 'synthetic-push-queue-summary-v1',
            });
      t.after(() => fixture.close());
      const control = kind === 'audit' ? undefined : await fixture.pushQueueStaff(),
        token = kind === 'audit' ? fixture.token() : control.token;
      const api = new RealtorApiClient({
        baseUrl: fixture.origin,
        allowLoopbackHttp: true,
        privacyNoticeVersion: 'test',
      });
      const lease = await api.getCurrentStaffAccessLeaseV2({ bearerToken: token });
      const scope = { instanceId: randomUUID(), tenantId: lease.tenantId, actorId: lease.actorId };
      const env = config(fixture, token, scope);
      const first = await privateSummaryRequest(request(kind, scope), kind, env);
      assert.equal(first.status, 200);
      const body = await first.json();
      assert.deepEqual(body.scope, scope);
      if (kind === 'audit') {
        assert.equal(body.data.items.length, 20);
        assert.doesNotMatch(JSON.stringify(body), /PRIVATE AUDIT SUMMARY SENTINEL/);
      } else assert.equal(body.data.policy, 'synthetic-push-queue-summary-v1');
      const wrong = { ...scope, actorId: randomUUID() };
      assert.equal((await privateSummaryRequest(request(kind, wrong), kind, env)).status, 403);
      let dataRead = false;
      const intercepted = async (url, init) => {
        const response = await fetch(url, init);
        if (url.includes(kind === 'audit' ? '/audit-events?' : '/synthetic-push-queue-summary')) {
          dataRead = true;
          if (kind === 'audit') await fixture.access(false);
          else await control.revoke();
        }
        return response;
      };
      const denied = await privateSummaryRequest(request(kind, scope), kind, env, intercepted);
      assert.equal(dataRead, true);
      assert.equal(denied.status, 403);
      assert.equal((await denied.json()).data, undefined);
    },
  );
