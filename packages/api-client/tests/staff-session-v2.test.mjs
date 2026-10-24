import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const body = () => ({ policy: 'current-staff-session-v2', tenantId: id(1), actorId: id(2) }),
  options = { bearerToken: 'synthetic' };
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic',
    fetch,
  });
test('ordinary session SDK sends one fixed body-free authenticated GET and freezes only validated identity', async () => {
  const calls = [],
    sdk = client(async (url, init) => {
      calls.push({ url, init });
      return Response.json(body());
    });
  const r = await sdk.getCurrentStaffSessionV2(options);
  assert.deepEqual(r, body());
  assert.ok(Object.isFrozen(r));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://synthetic.invalid/v2/staff/session');
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.redirect, 'error');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(calls[0].init.headers.Authorization, 'Bearer synthetic');
});
test('ordinary session SDK rejects malformed/extra/duplicate/forged policy identity without retries or write uncertainty', async () => {
  for (const value of [
    null,
    [],
    { ...body(), role: 'admin' },
    { ...body(), policy: 'synthetic-reference-session-v1' },
    { ...body(), actorId: 'bad' },
    { policy: 'current-staff-session-v2', actorId: id(2) },
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        client(async () => {
          calls++;
          return Response.json(value);
        }).getCurrentStaffSessionV2(options),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
    assert.equal(calls, 1);
  }
  await assert.rejects(
    () =>
      client(
        async () =>
          new Response(
            JSON.stringify(body()).replace('"actorId":', '"actorId":"' + id(9) + '","actorId":'),
            { headers: { 'content-type': 'application/json' } },
          ),
      ).getCurrentStaffSessionV2(options),
    (e) => e.kind === 'INVALID_RESPONSE',
  );
});
test('ordinary session SDK enforces 8192-byte streaming/framing bound and strict UTF-8', async () => {
  for (const response of [
    () => new Response('x'.repeat(8193), { headers: { 'content-type': 'application/json' } }),
    () =>
      new Response(JSON.stringify(body()), {
        headers: { 'content-type': 'application/json', 'content-length': '1' },
      }),
    () =>
      new Response(JSON.stringify(body()), {
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      }),
    () => new Response(Uint8Array.of(0xff), { headers: { 'content-type': 'application/json' } }),
  ])
    await assert.rejects(
      () => client(async () => response()).getCurrentStaffSessionV2(options),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
});
test('ordinary session SDK never retries denied/redirected reads and cancels before dispatch', async () => {
  for (const status of [403, 302]) {
    let calls = 0;
    await assert.rejects(
      () =>
        client(async () => {
          calls++;
          return status === 302
            ? new Response(null, { status })
            : Response.json(
                { error: { code: 'FORBIDDEN', message: 'denied' }, requestId: id(9) },
                { status },
              );
        }).getCurrentStaffSessionV2(options),
      (e) => !e.submissionUncertain,
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  const a = new AbortController();
  a.abort();
  await assert.rejects(
    () =>
      client(async () => {
        calls++;
        return Response.json(body());
      }).getCurrentStaffSessionV2({ ...options, signal: a.signal }),
    (e) => e.kind === 'CANCELLED' && !e.submissionUncertain,
  );
  assert.equal(calls, 0);
});
