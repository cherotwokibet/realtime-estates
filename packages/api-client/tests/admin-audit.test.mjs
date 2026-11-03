import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const tenant = '00000000-0000-4000-8000-000000000001';
const input = () => ({ limit: 20, before: null, actorId: null, objectId: null });
const page = () => ({
  policy: 'admin-audit-page-v1',
  tenantId: tenant,
  items: [],
  nextBefore: null,
});
const auth = { bearerToken: 'synthetic-audit-token' };
const client = (fetch, timeoutMs = 200) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'audit319',
    fetch,
    timeoutMs,
  });
const json = (p) => Response.json(p, { headers: { 'Cache-Control': 'no-store' } });
test('audit SDK pins exact filters and expected company, uses private GET once', async () => {
  let calls = 0;
  const q = { ...input(), before: '9007199254740993' };
  const c = client(async (url, init) => {
    calls++;
    assert.equal(
      url,
      'https://synthetic.invalid/v2/staff/audit-events?limit=20&before=9007199254740993',
    );
    assert.equal(init.method, 'GET');
    assert.equal(init.body, undefined);
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + auth.bearerToken);
    q.limit = 1;
    return json(page());
  });
  assert.deepEqual(await c.listAdminAuditEvents(tenant, q, auth), page());
  assert.equal(calls, 1);
  await assert.rejects(
    () => c.listAdminAuditEvents(tenant, { ...input(), limit: 21 }, auth),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () =>
      client(async () =>
        json({ ...page(), tenantId: tenant.replace(/1$/, '2') }),
      ).listAdminAuditEvents(tenant, input(), auth),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
});
test('audit SDK refuses cached, duplicate-key, excessive and private-field responses without retry', async () => {
  for (const response of [
    Response.json(page()),
    new Response(
      '{"policy":"admin-audit-page-v1","tenantId":"' +
        tenant +
        '","items":[],"items":[],"nextBefore":null}',
      { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
    ),
    json({ ...page(), summary: 'PRIVATE' }),
    new Response(' '.repeat(32769), {
      headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    }),
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        client(async () => {
          calls++;
          return response;
        }).listAdminAuditEvents(tenant, input(), auth),
      (e) => e.kind === 'INVALID_RESPONSE',
    );
    assert.equal(calls, 1);
  }
});
test('audit stalled stream and late reply cancellation settle once and never retry', async () => {
  let cancelled = false,
    calls = 0;
  await assert.rejects(
    () =>
      client(async () => {
        calls++;
        return new Response(
          new ReadableStream({
            pull() {},
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } },
        );
      }, 25).listAdminAuditEvents(tenant, input(), auth),
    (e) => e.kind === 'TIMEOUT',
  );
  assert.equal(calls, 1);
  assert.equal(cancelled, true);
  const controller = new AbortController();
  let release;
  const pending = client(
    () =>
      new Promise((r) => {
        release = r;
      }),
  ).listAdminAuditEvents(tenant, input(), { ...auth, signal: controller.signal });
  controller.abort();
  await assert.rejects(
    () => pending,
    (e) => e.kind === 'CANCELLED',
  );
  release(json(page()));
});
