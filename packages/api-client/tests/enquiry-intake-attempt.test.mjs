import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient, ApiClientError } from '../dist/index.js';
const key = '00000000-0000-4000-8000-000000000900',
  id = '00000000-0000-4000-8000-000000000901';
const input = () => ({
  name: '  Synthetic prospect  ',
  email: 'SAMPLE@example.invalid',
  message: '  A synthetic enquiry.  ',
  origin: 'web',
  noticeVersion: 'synthetic-v1',
  noticeAcknowledged: true,
});
const receipt = () =>
  new Response(JSON.stringify({ id }), {
    status: 201,
    headers: { 'content-type': 'application/json' },
  });
const api = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://api.example.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch,
  });
test('preparation validates without a request and freezes a private raw copy', () => {
  let calls = 0;
  const client = api(async () => {
      calls++;
      return receipt();
    }),
    raw = input(),
    attempt = client.preparePublicEnquiry(raw, key);
  raw.name = 'Changed';
  assert.equal(attempt.input.name, '  Synthetic prospect  ');
  assert.equal(attempt.state.status, 'ready');
  assert.equal(calls, 0);
  assert.ok(
    Object.isFrozen(attempt) && Object.isFrozen(attempt.input) && Object.isFrozen(attempt.state),
  );
  for (const bad of [
    { ...input(), noticeAcknowledged: false },
    { ...input(), noticeVersion: 'old' },
    { ...input(), tenantId: id },
  ])
    assert.throws(() => client.preparePublicEnquiry(bad, key));
  assert.throws(() => client.preparePublicEnquiry(input(), 'bad'));
  assert.equal(calls, 0);
});
test('one request is locked synchronously and a received enquiry cannot be resubmitted', async () => {
  let release,
    calls = 0;
  const attempt = api(async () => {
    calls++;
    return new Promise((resolve) => (release = resolve));
  }).preparePublicEnquiry(input(), key);
  const pending = attempt.submit();
  assert.equal(attempt.state.status, 'sending');
  await assert.rejects(attempt.submit());
  await assert.rejects(attempt.retryOriginal());
  assert.equal(calls, 1);
  release(receipt());
  assert.deepEqual(await pending, { id });
  assert.equal(attempt.state.status, 'received');
  await assert.rejects(attempt.submit());
  await assert.rejects(attempt.retryOriginal());
  assert.equal(calls, 1);
});
test('lost reply requires explicit original replay with byte-identical body/key and no bearer', async () => {
  const calls = [];
  const raw = input(),
    attempt = api(async (_, init) => {
      calls.push(init);
      if (calls.length === 1) throw Error('lost');
      return receipt();
    }).preparePublicEnquiry(raw, key);
  await assert.rejects(attempt.submit(), (e) => e.submissionUncertain);
  assert.equal(attempt.state.status, 'uncertain');
  assert.equal(calls.length, 1);
  raw.message = 'Different';
  await assert.rejects(attempt.submit());
  assert.equal(calls.length, 1);
  await attempt.retryOriginal();
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].headers['Idempotency-Key'], calls[1].headers['Idempotency-Key']);
  assert.equal(calls[1].headers.Authorization, undefined);
  assert.equal(attempt.input.message, '  A synthetic enquiry.  ');
});
test('later definite rejection does not erase an earlier uncertain commit', async () => {
  let calls = 0;
  const attempt = api(async () => {
    calls++;
    if (calls === 1) throw Error('lost');
    return new Response(
      JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Wait' }, requestId: id }),
      { status: 429, headers: { 'content-type': 'application/json' } },
    );
  }).preparePublicEnquiry(input(), key);
  await assert.rejects(attempt.submit());
  await assert.rejects(attempt.retryOriginal());
  assert.equal(attempt.state.status, 'uncertain');
  assert.equal(calls, 2);
});
test('public attempt refuses authority/key overrides and invalid timeouts before state changes', async () => {
  let calls = 0;
  const attempt = api(async () => {
    calls++;
    return receipt();
  }).preparePublicEnquiry(input(), key);
  for (const options of [
    { bearerToken: 'secret' },
    { idempotencyKey: id },
    { tenantId: id },
    { timeoutMs: 0 },
  ])
    await assert.rejects(attempt.submit(options));
  assert.equal(attempt.state.status, 'ready');
  assert.equal(calls, 0);
  await attempt.submit();
  assert.equal(calls, 1);
});
test('already cancelled initial request is definite; invalid successful receipt stays uncertain', async () => {
  let calls = 0;
  const client = api(async () => {
    calls++;
    return new Response('{"id":"bad"}', {
      status: 201,
      headers: { 'content-type': 'application/json' },
    });
  });
  const aborted = client.preparePublicEnquiry(input(), key),
    controller = new AbortController();
  controller.abort();
  await assert.rejects(
    aborted.submit({ signal: controller.signal }),
    (e) => e.kind === 'CANCELLED',
  );
  assert.equal(aborted.state.status, 'rejected');
  assert.equal(calls, 0);
  const malformed = client.preparePublicEnquiry(input(), key);
  await assert.rejects(
    malformed.submit(),
    (e) => e instanceof ApiClientError && e.submissionUncertain,
  );
  assert.equal(malformed.state.status, 'uncertain');
});
