import test from 'node:test';
import assert from 'node:assert/strict';
import { privateSummaryRequest } from '../dist/tests/lib/private-summary-server.js';
import { readPrivateSummary } from '../dist/tests/lib/private-summary-client.js';
import { readPushQueuePreview } from '../dist/tests/lib/push-queue-preview-server.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope = { instanceId: id(90), tenantId: id(1), actorId: id(10) };
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:49000',
  STAFF_PREVIEW_INSTANCE: scope.instanceId,
  STAFF_PREVIEW_TOKEN: 'synthetic.staff.signature',
  STAFF_AUDIT_PREVIEW_MODE: 'synthetic-admin-audit-v1',
  STAFF_AUDIT_WEB_ORIGIN: 'http://127.0.0.1:49001',
  STAFF_PUSH_QUEUE_MODE: 'synthetic-v1',
  STAFF_PUSH_QUEUE_TENANT: scope.tenantId,
};
const audit = {
  policy: 'admin-audit-page-v1',
  tenantId: scope.tenantId,
  items: [],
  nextBefore: null,
};
const push = {
  policy: 'synthetic-push-queue-summary-v1',
  tenantId: scope.tenantId,
  asOf: '2026-11-22T04:00:00.000Z',
  due: 0,
  scheduled: 0,
  waitingForRetry: 0,
  captured: 0,
  suppressed: 0,
  oldestDueAgeSeconds: null,
  oldestRetryAgeSeconds: null,
  nextRetryAt: null,
};
const lease = (patch = {}) => {
  const now = Date.now();
  return {
    policy: 'staff-access-lease-v1',
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    role: 'admin',
    checkedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 30000).toISOString(),
    ...patch,
  };
};
const request = (kind, headers = {}, suffix = '') =>
  new Request('http://127.0.0.1:49001/api/private-summary/' + kind + suffix, {
    headers: {
      host: '127.0.0.1:49001',
      'x-preview-instance': scope.instanceId,
      'x-preview-tenant': scope.tenantId,
      'x-preview-actor': scope.actorId,
      ...headers,
    },
  });
for (const kind of ['audit', 'push']) {
  test(
    kind +
      ': pinned read rechecks admin/scope after data and never releases data after changed authority',
    async () => {
      for (const changed of [null, { role: 'agent' }, { actorId: id(11) }, { tenantId: id(2) }]) {
        let leases = 0,
          reads = 0;
        const paths = [];
        const api = async (url, init) => {
          paths.push({ url, cache: init.cache, auth: !!init.headers.Authorization });
          assert.equal(init.headers.Authorization, 'Bearer ' + env.STAFF_PREVIEW_TOKEN);
          assert.equal(init.cache, 'no-store');
          if (url.endsWith('/session-lease'))
            return Response.json(lease(++leases === 2 && changed ? changed : {}));
          reads++;
          return Response.json(kind === 'audit' ? audit : push, {
            headers: { 'cache-control': 'no-store' },
          });
        };
        const r = await privateSummaryRequest(request(kind), kind, env, api);
        assert.equal(r.status, changed ? 403 : 200, JSON.stringify(paths));
        assert.equal(leases, 2);
        assert.equal(reads, 1);
        assert.match(r.headers.get('cache-control'), /no-store/);
        const body = await r.json();
        if (changed) assert.equal(body.data, undefined);
        else assert.deepEqual(body.scope, scope);
      }
    },
  );
  test(
    kind +
      ': default/production/caller authority, bad scope, framing and query ambiguity fail before data',
    async () => {
      const forbidden = () => assert.fail('Unexpected upstream');
      assert.equal(
        (
          await privateSummaryRequest(
            request(kind),
            kind,
            { ...env, NODE_ENV: 'production' },
            forbidden,
          )
        ).status,
        403,
      );
      for (const headers of [
        { cookie: 'x' },
        { 'x-role': 'admin' },
        { 'content-type': 'application/json' },
        { 'x-preview-actor': 'bad' },
        { 'x-preview-tenant': id(2) },
      ]) {
        let data = 0;
        const r = await privateSummaryRequest(request(kind, headers), kind, env, async () => {
          data++;
          return Response.json(lease());
        });
        assert.ok(r.status >= 400);
        assert.ok(data <= 1);
      }
      for (const suffix of kind === 'audit'
        ? ['?limit=5&limit=5', '?tenantId=' + id(2)]
        : ['?', '?limit=5'])
        assert.equal(
          (await privateSummaryRequest(request(kind, {}, suffix), kind, env, forbidden)).status,
          400,
        );
      for (const status of [401, 403])
        assert.equal(
          (
            await privateSummaryRequest(
              request(kind),
              kind,
              env,
              async () => new Response(null, { status }),
            )
          ).status,
          status,
        );
    },
  );
  test(
    kind +
      ': browser adapter binds envelope and URL, omits credentials, rejects changed actor, malformed DTO and cancellation',
    async () => {
      let seen;
      const body = {
        policy: 'private-summary-v1',
        scope,
        kind,
        data: kind === 'audit' ? audit : push,
      };
      const transport = async (url, init) => {
        seen = { url, init };
        return Response.json(body);
      };
      assert.deepEqual(
        await readPrivateSummary(scope, kind, new AbortController().signal, undefined, transport),
        body.data,
      );
      assert.equal(seen.init.credentials, 'omit');
      assert.equal(seen.init.cache, 'no-store');
      assert.equal(seen.init.headers['X-Preview-Actor'], scope.actorId);
      assert.ok(!new Headers(seen.init.headers).has('authorization'));
      for (const patch of [
        { scope: { ...scope, actorId: id(11) } },
        { kind: 'other' },
        { data: { ...body.data, privateSummary: 'secret' } },
      ])
        await assert.rejects(
          readPrivateSummary(scope, kind, new AbortController().signal, undefined, async () =>
            Response.json({ ...body, ...patch }),
          ),
        );
      const aborted = new AbortController();
      aborted.abort();
      await assert.rejects(readPrivateSummary(scope, kind, aborted.signal, undefined, transport));
    },
  );
}
test('legacy actor-unbound push reader is retired without data', async () => {
  const r = await readPushQueuePreview(request('push'));
  assert.equal(r.status, 410);
  assert.doesNotMatch(await r.text(), /scheduled|captured/);
});
