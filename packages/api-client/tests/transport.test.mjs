import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient, ApiClientError } from '../dist/index.js';

const ID = '00000000-0000-4000-8000-000000000100';
const KEY = '00000000-0000-4000-8000-000000000300';
const REFERENCE = '00000000-0000-4000-8000-000000000500';
const property = {
  id: ID,
  slug: 'synthetic-studio',
  revision: 1,
  title: 'Synthetic studio',
  description: 'Synthetic client transport test property.',
  purpose: 'rent',
  propertyType: 'studio',
  currency: 'KES',
  amountMinor: 1800001,
  rentPeriod: 'month',
  bedrooms: 0,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic area',
  publicPrecision: 'area',
  latitude: null,
  longitude: null,
  photos: [0, 1, 2, 3].map((position) => ({
    key: `synthetic/photo-${position}.webp`,
    alt: `Synthetic view ${position}`,
  })),
};
const enquiry = {
  listingId: ID,
  name: 'Synthetic Prospect',
  phone: '0700000000',
  message: 'Synthetic test enquiry.',
  origin: 'web',
  noticeVersion: 'synthetic-v1',
  noticeAcknowledged: true,
};
const json = (payload, status = 200, headers = {}) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
const client = (fetch, options = {}) =>
  new RealtorApiClient({
    baseUrl: 'https://api.example.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch,
    ...options,
  });
const rejects = (operation, kind) =>
  assert.rejects(operation, (error) => error instanceof ApiClientError && error.kind === kind);

test('API origin permits HTTPS or explicitly opted-in loopback HTTP only', () => {
  for (const baseUrl of [
    'http://api.example.invalid',
    'http://localhost.evil.invalid',
    'ftp://example.invalid',
    '//example.invalid',
    'https://user:secret@example.invalid',
    'https://example.invalid/v1',
    'https://example.invalid/?token=secret',
    'https://example.invalid/#fragment',
    ' https://example.invalid',
  ])
    assert.throws(
      () => client(async () => json({}), { baseUrl }),
      (error) => error.kind === 'CONFIGURATION',
    );
  assert.throws(
    () => client(async () => json({}), { baseUrl: 'http://127.0.0.1:3000' }),
    (error) => error.kind === 'CONFIGURATION',
  );
  for (const baseUrl of [
    'https://example.invalid',
    'http://localhost:4000',
    'http://127.0.0.1:4000',
    'http://[::1]:4000',
  ])
    assert.doesNotThrow(() => client(async () => json({}), { baseUrl, allowLoopbackHttp: true }));
  assert.throws(
    () =>
      new RealtorApiClient({ baseUrl: 'https://api.example.invalid', privacyNoticeVersion: '' }),
    (error) => error.kind === 'CONFIGURATION',
  );
});
test('public request uses no ambient credentials, refuses redirects, preserves exact money and unknown fields remain absent', async () => {
  let seen;
  const api = client(async (url, init) => {
    seen = { url, init };
    return json({ items: [property], limit: 7 });
  });
  const page = await api.listProperties({ limit: 7 });
  assert.equal(seen.url, 'https://api.example.invalid/v1/properties?limit=7');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.redirect, 'error');
  assert.equal(seen.init.headers.Authorization, undefined);
  assert.equal(page.items[0].amountMinor, 1800001);
  assert.equal(page.items[0].sharedBathrooms, null);
  assert.equal('fees' in page.items[0], false);
  assert.equal('tenantId' in page.items[0], false);
  assert.ok(
    Object.isFrozen(page) &&
      Object.isFrozen(page.items) &&
      Object.isFrozen(page.items[0].photos[0]),
  );
});
test('bearer token is explicit per call and never persists to the next request', async () => {
  const headers = [];
  const api = client(async (_, init) => {
    headers.push(init.headers);
    return json({ id: ID }, 201);
  });
  await api.submitEnquiry(enquiry, { idempotencyKey: KEY, bearerToken: 'synthetic-token' });
  await api.submitEnquiry(enquiry, { idempotencyKey: KEY });
  assert.equal(headers[0].Authorization, 'Bearer synthetic-token');
  assert.equal(headers[1].Authorization, undefined);
  await rejects(
    () =>
      api.submitEnquiry(enquiry, { idempotencyKey: KEY, bearerToken: 'token\r\nX-Evil: value' }),
    'VALIDATION',
  );
});
test('public DTO rejects unsafe money, currency/period/count/type errors and precise area leaks', async () => {
  const invalid = [
    { amountMinor: 0 },
    { amountMinor: -1 },
    { amountMinor: 1.5 },
    { amountMinor: '1800001' },
    { amountMinor: 100000000000001 },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { currency: 'USD' },
    { purpose: 'sale', rentPeriod: 'month' },
    { rentPeriod: null },
    { rentPeriod: ['month'] },
    { propertyType: 'unknown' },
    { propertyType: 'land', bedrooms: 0 },
    { bedrooms: 8 },
    { privateBathrooms: -1 },
    { sharedBathrooms: undefined },
    { latitude: -1.3, longitude: 36.7 },
    { publicPrecision: 'exact', latitude: -1.3, longitude: null },
    { publicPrecision: 'exact', latitude: 91, longitude: 36 },
  ];
  for (const patch of invalid) {
    const api = client(async () => json({ items: [{ ...property, ...patch }], limit: 50 }));
    await rejects(() => api.listProperties(), 'INVALID_RESPONSE');
  }
});
test('public DTO rejects extra tenant/private fields at page, property and photo levels', async () => {
  for (const field of [
    'tenantId',
    'tenant_id',
    'privateAddress',
    'private_address',
    'assignedAgentId',
    'decision_reason',
    'phone',
    'fees',
  ]) {
    const api = client(async () =>
      json({ items: [{ ...property, [field]: 'synthetic-private-value' }], limit: 50 }),
    );
    await rejects(() => api.listProperties(), 'INVALID_RESPONSE');
  }
  await rejects(
    () =>
      client(async () =>
        json({ items: [property], limit: 50, tenantId: 'forged' }),
      ).listProperties(),
    'INVALID_RESPONSE',
  );
  await rejects(
    () =>
      client(async () =>
        json({
          items: [
            {
              ...property,
              photos: [{ ...property.photos[0], ownerId: 'forged' }, ...property.photos.slice(1)],
            },
          ],
          limit: 50,
        }),
      ).listProperties(),
    'INVALID_RESPONSE',
  );
});
test('public photo keys cannot be URLs/traversal, repeated or unreviewed-size arrays', async () => {
  for (const key of [
    'https://example.invalid/photo.jpg',
    '//example.invalid/photo.jpg',
    '../private.jpg',
    '/absolute/photo.jpg',
    'photo.jpg?secret=one',
    'photo.svg',
  ])
    await rejects(
      () =>
        client(async () =>
          json({
            items: [
              { ...property, photos: [{ key, alt: 'Synthetic' }, ...property.photos.slice(1)] },
            ],
            limit: 50,
          }),
        ).listProperties(),
      'INVALID_RESPONSE',
    );
  for (const photos of [
    [],
    property.photos.slice(0, 3),
    [property.photos[0], property.photos[0], ...property.photos.slice(2)],
  ])
    await rejects(
      () =>
        client(async () => json({ items: [{ ...property, photos }], limit: 50 })).listProperties(),
      'INVALID_RESPONSE',
    );
});
test('malformed pages, responses and unexpected success statuses fail rather than defaulting empty data', async () => {
  for (const response of [
    json({ items: [property], limit: 99 }),
    json({ items: null, limit: 50 }),
    json({ items: [property], limit: 50 }, 201),
    new Response('<html>private error</html>', { headers: { 'Content-Type': 'text/html' } }),
    new Response('{bad json', { headers: { 'Content-Type': 'application/json' } }),
  ])
    await rejects(() => client(async () => response).listProperties(), 'INVALID_RESPONSE');
  const response = new Response(' '.repeat(3 * 1024 * 1024 + 1), {
    headers: { 'Content-Type': 'application/json' },
  });
  await rejects(() => client(async () => response).listProperties(), 'INVALID_RESPONSE');
});
test('redirect statuses and followed-response indicators are rejected without another call', async () => {
  for (const response of [
    new Response(null, { status: 302, headers: { Location: 'https://untrusted.invalid' } }),
    Object.assign(json({ items: [property], limit: 50 }), {}),
  ]) {
    if (response.status === 200) Object.defineProperty(response, 'redirected', { value: true });
    let calls = 0;
    await rejects(
      () =>
        client(async () => {
          calls++;
          return response;
        }).listProperties({ bearerToken: 'synthetic-token' }),
      'REDIRECT',
    );
    assert.equal(calls, 1);
  }
  const changed = json({ items: [property], limit: 50 });
  Object.defineProperty(changed, 'url', { value: 'https://untrusted.invalid/v1/properties' });
  await rejects(() => client(async () => changed).listProperties(), 'REDIRECT');
});
test('enquiry requires caller-retained UUID key, current notice acknowledgement and a contact channel before network', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return json({ id: ID }, 201);
  });
  for (const patch of [
    { noticeAcknowledged: false },
    { noticeVersion: 'old-version' },
    { name: ' ' },
    { message: ' ' },
    { phone: null, email: null },
    { email: 'bad email' },
    { origin: 'staff' },
    { tenantId: 'forged' },
    { assignedAgentId: ID },
  ])
    await rejects(
      () => api.submitEnquiry({ ...enquiry, ...patch }, { idempotencyKey: KEY }),
      'VALIDATION',
    );
  for (const idempotencyKey of ['', undefined, 'not-a-uuid'])
    await rejects(() => api.submitEnquiry(enquiry, { idempotencyKey }), 'VALIDATION');
  assert.equal(calls, 0);
});
test('manual retries preserve key and normalized body; no retry, delivery promise or zero-fee inference', async () => {
  const calls = [];
  const api = client(async (url, init) => {
    calls.push({ url, init });
    return json({ id: ID }, 201);
  });
  assert.deepEqual(
    await api.submitEnquiry(
      { ...enquiry, name: ' Synthetic Prospect ', email: 'DEMO@EXAMPLE.INVALID' },
      { idempotencyKey: KEY },
    ),
    { id: ID },
  );
  await api.submitEnquiry(
    { ...enquiry, name: ' Synthetic Prospect ', email: 'DEMO@EXAMPLE.INVALID' },
    { idempotencyKey: KEY },
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].init.headers['Idempotency-Key'], KEY);
  assert.equal(calls[1].init.headers['Idempotency-Key'], KEY);
  assert.equal(calls[0].init.body, calls[1].init.body);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.name, 'Synthetic Prospect');
  assert.equal(body.email, 'demo@example.invalid');
  assert.equal(body.noticeAcknowledged, true);
  assert.equal('tenantId' in body, false);
});
test('typed HTTP errors contain safe code/reference/retry time, never the raw server message', async () => {
  const api = client(async () =>
    json(
      {
        error: { code: 'RATE_LIMITED', message: 'Private token synthetic-sensitive-value' },
        requestId: REFERENCE,
      },
      429,
      { 'X-Request-Id': REFERENCE, 'Retry-After': '37' },
    ),
  );
  await assert.rejects(
    () => api.submitEnquiry(enquiry, { idempotencyKey: KEY }),
    (error) => {
      assert.equal(error.kind, 'HTTP');
      assert.equal(error.status, 429);
      assert.equal(error.serverCode, 'RATE_LIMITED');
      assert.equal(error.requestId, REFERENCE);
      assert.equal(error.retryAfterSeconds, 37);
      assert.equal(error.submissionUncertain, false);
      assert.equal(JSON.stringify(error).includes('synthetic-sensitive-value'), false);
      assert.equal(error.message.includes('synthetic-sensitive-value'), false);
      return true;
    },
  );
});
test('POST network failures never auto-retry and flag uncertain submission without exposing transport details', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    throw new Error('Bearer synthetic-secret / contact payload');
  });
  await assert.rejects(
    () => api.submitEnquiry(enquiry, { idempotencyKey: KEY }),
    (error) => {
      assert.equal(error.kind, 'NETWORK');
      assert.equal(error.submissionUncertain, true);
      assert.equal(error.message.includes('synthetic-secret'), false);
      return true;
    },
  );
  assert.equal(calls, 1);
});
test('pre-cancellation sends nothing; in-flight cancellation and timeouts are typed including body reads', async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  await assert.rejects(
    () =>
      client(async () => {
        calls++;
        return json({ id: ID }, 201);
      }).submitEnquiry(enquiry, { idempotencyKey: KEY, signal: before.signal }),
    (error) => error.kind === 'CANCELLED' && !error.submissionUncertain,
  );
  assert.equal(calls, 0);
  const active = new AbortController();
  const api = client(async () => new Promise(() => {}));
  const pending = api.submitEnquiry(enquiry, { idempotencyKey: KEY, signal: active.signal });
  active.abort();
  await assert.rejects(
    () => pending,
    (error) => error.kind === 'CANCELLED' && error.submissionUncertain,
  );
  await assert.rejects(
    () => api.submitEnquiry(enquiry, { idempotencyKey: KEY, timeoutMs: 5 }),
    (error) => error.kind === 'TIMEOUT' && error.submissionUncertain,
  );
  const hangingBody = new Response(new ReadableStream({ start() {} }), {
    headers: { 'Content-Type': 'application/json' },
  });
  await rejects(() => client(async () => hangingBody).listProperties({ timeoutMs: 5 }), 'TIMEOUT');
});
test('a malformed receipt is not called accepted and remains retryable only with original key/body', async () => {
  for (const payload of [
    { id: 'not-a-uuid' },
    { id: ID, sent: true },
    { id: ID, tenantId: 'forged' },
  ])
    await assert.rejects(
      () => client(async () => json(payload, 201)).submitEnquiry(enquiry, { idempotencyKey: KEY }),
      (error) => error.kind === 'INVALID_RESPONSE' && error.submissionUncertain,
    );
});
