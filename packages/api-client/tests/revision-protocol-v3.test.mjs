import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '../dist/index.js';
const id = '00000000-0000-4000-8000-000000000001';
const row = () => ({
  listingId: id,
  revision: 1,
  listingVersion: '1',
  revisionVersion: '2',
  state: 'draft',
  editable: true,
  protocol: 'synthetic-reference-v1',
});
const opt = { bearerToken: 'synthetic' },
  client = (fetch) =>
    new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic',
      fetch,
    });
test('protocol SDK performs one authenticated body-free no-store GET and target-matches frozen result', async () => {
  const calls = [],
    sdk = client(async (url, init) => {
      calls.push({ url, init });
      return Response.json(row());
    });
  const value = await sdk.getRevisionProtocolV3(id, 1, opt);
  assert.deepEqual(value, row());
  assert.ok(Object.isFrozen(value));
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    `https://synthetic.invalid/v3/staff/listings/${id}/revision-protocol/1`,
  );
  const init = calls[0].init;
  assert.equal(init.method, 'GET');
  assert.equal(init.body, undefined);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  assert.equal(init.headers.Authorization, 'Bearer synthetic');
});
test('protocol SDK validates targets before network and refuses contradictory or missing results without fallback', async () => {
  let calls = 0;
  const sdk = client(async () => {
    calls++;
    return Response.json(row());
  });
  for (const revision of [0, -1, 1.1, '1', 2147483648])
    await assert.rejects(
      sdk.getRevisionProtocolV3(id, revision, opt),
      (e) => e.kind === 'VALIDATION',
    );
  await assert.rejects(
    sdk.getRevisionProtocolV3('invalid', 1, opt),
    (e) => e.kind === 'VALIDATION',
  );
  assert.equal(calls, 0);
  for (const response of [
    null,
    { ...row(), revision: 2 },
    { ...row(), protocol: 'ordinary-default' },
    { ...row(), editable: false },
    { ...row(), role: 'admin' },
  ]) {
    let n = 0;
    await assert.rejects(
      client(async () => {
        n++;
        return Response.json(response);
      }).getRevisionProtocolV3(id, 1, opt),
      (e) => e.kind === 'INVALID_RESPONSE' && !e.submissionUncertain,
    );
    assert.equal(n, 1);
  }
});
test('protocol SDK bounds streaming/framing/UTF8/duplicate keys and does not retry failures', async () => {
  const json = JSON.stringify(row());
  for (const response of [
    () => new Response('x'.repeat(8193), { headers: { 'content-type': 'application/json' } }),
    () =>
      new Response(json, {
        headers: { 'content-type': 'application/json', 'content-length': '1' },
      }),
    () =>
      new Response(json, {
        headers: { 'content-type': 'application/json', 'content-encoding': 'gzip' },
      }),
    () => new Response(Uint8Array.of(0xff), { headers: { 'content-type': 'application/json' } }),
    () =>
      new Response(json.replace('"protocol":', '"protocol":"ordinary-v2","protocol":'), {
        headers: { 'content-type': 'application/json' },
      }),
    () => Response.json({ error: { code: 'FORBIDDEN', message: 'denied' } }, { status: 403 }),
    () => new Response(null, { status: 302 }),
  ]) {
    let calls = 0;
    await assert.rejects(
      client(async () => {
        calls++;
        return response();
      }).getRevisionProtocolV3(id, 1, opt),
      (e) => !e.submissionUncertain,
    );
    assert.equal(calls, 1);
  }
});
