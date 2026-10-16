import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError, RealtorApiClient } from '../dist/index.js';

const ID = '00000000-0000-4000-8000-000000000100',
  OP = '00000000-0000-4000-8000-000000000500';
const JOB = '00000000-0000-4000-8000-000000000600',
  OTHER = '00000000-0000-4000-8000-000000000700';
const TIME = '2026-10-10T08:00:00.123Z',
  EXPIRY = '2026-10-11T08:00:00.123Z';
const input = { registrationId: OP, expectedVersion: '2', altText: 'Synthetic entrance photo' };
const options = { bearerToken: 'synthetic-media-staff' };
const facts = {
  kind: 'register_media_upload',
  operationId: OP,
  jobId: JOB,
  listingId: ID,
  revision: 2,
  expectedVersion: '2',
  altText: input.altText,
  registeredAt: TIME,
  expiresAt: EXPIRY,
};
const receipt = (patch = {}) => ({ ...facts, outcome: 'registered', ...patch });
const job = (patch = {}) => ({ ...facts, state: 'registered', ...patch });
const json = (payload, status = 200) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
const raw = (source) => new Response(source, { headers: { 'Content-Type': 'application/json' } });
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://media.example.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch,
  });
const reject = (operation, kind, uncertain = false) =>
  assert.rejects(
    operation,
    (error) =>
      error instanceof ApiClientError &&
      error.kind === kind &&
      error.submissionUncertain === uncertain,
  );

test('every media call requires its own bearer and public calls retain no staff credentials', async () => {
  const calls = [];
  const api = client(async (url, init) => {
    calls.push({ url, init });
    return json(
      url.includes('/v1/properties')
        ? { items: [], limit: 50 }
        : url.includes('/media-jobs/')
          ? job()
          : receipt(),
    );
  });
  const operations = [
    (opts) => api.registerMediaUploadV2(ID, 2, input, opts),
    (opts) => api.getMediaRegistrationV2(ID, 2, OP, opts),
    (opts) => api.getMediaJobV2(ID, 2, JOB, opts),
  ];
  for (const call of operations)
    for (const opts of [{}, { bearerToken: '' }, { bearerToken: 'bad\r\nvalue' }, undefined])
      await reject(() => call(opts), 'VALIDATION');
  assert.equal(calls.length, 0);
  await operations[0]({ bearerToken: 'synthetic-one' });
  await operations[1]({ bearerToken: 'synthetic-two' });
  await operations[2]({ bearerToken: 'synthetic-three' });
  await api.listProperties();
  assert.deepEqual(
    calls.map((call) => call.init.headers.Authorization),
    ['Bearer synthetic-one', 'Bearer synthetic-two', 'Bearer synthetic-three', undefined],
  );
});

test('registration sends exact explicit identity/version/body and freezes a capability-free historical receipt', async () => {
  let seen;
  const result = await client(async (url, init) => {
    seen = { url, init };
    return json(receipt());
  }).registerMediaUploadV2(
    ID.toUpperCase(),
    2,
    { ...input, registrationId: OP.toUpperCase() },
    options,
  );
  assert.deepEqual(result, receipt());
  assert.ok(Object.isFrozen(result));
  assert.equal(
    seen.url,
    `https://media.example.invalid/v2/staff/listings/${ID}/revisions/2/media-registrations`,
  );
  assert.equal(seen.init.method, 'POST');
  assert.equal(seen.init.headers['Idempotency-Key'], undefined);
  assert.equal(seen.init.headers['Content-Type'], 'application/json');
  assert.equal(seen.init.credentials, 'omit');
  assert.equal(seen.init.redirect, 'error');
  assert.equal(seen.init.cache, 'no-store');
  assert.deepEqual(JSON.parse(seen.init.body), {
    registrationId: OP,
    expectedVersion: 2,
    altText: input.altText,
  });
  for (const key of [
    'quarantineId',
    'outputId',
    'uploadUrl',
    'storageKey',
    'accepted',
    'manifest',
    'tenantId',
    'requesterId',
  ])
    assert.equal(key in result, false);
});

test('registration snapshots request facts before transport and explicit replay sends the original body once per call', async () => {
  const mutable = { ...input },
    bodies = [];
  const api = client(async (_, init) => {
    bodies.push(init.body);
    mutable.expectedVersion = '3';
    mutable.altText = 'Changed after sending';
    return json(receipt());
  });
  assert.deepEqual(await api.registerMediaUploadV2(ID, 2, mutable, options), receipt());
  assert.deepEqual(await api.registerMediaUploadV2(ID, 2, { ...input }, options), receipt());
  assert.equal(bodies.length, 2);
  assert.equal(bodies[0], bodies[1]);
});

test('registration validates UUIDs, canonical safe version and trimmed bounded Unicode alt before transport', async () => {
  let calls = 0;
  const api = client(async (_, init) => {
    calls++;
    return json(
      receipt({
        expectedVersion: String(JSON.parse(init.body).expectedVersion),
        altText: JSON.parse(init.body).altText,
      }),
    );
  });
  for (const patch of [
    { registrationId: 'invalid' },
    { expectedVersion: 2 },
    { expectedVersion: '02' },
    { expectedVersion: '0' },
    { expectedVersion: '2e0' },
    { expectedVersion: ' 2' },
    { expectedVersion: '9007199254740992' },
    { expectedVersion: '9223372036854775807' },
    { altText: '' },
    { altText: ' ' },
    { altText: ' padded ' },
    { altText: 'a\nb' },
    { altText: 'a\tb' },
    { altText: 'a\u0085b' },
    { altText: '\ud800' },
    { altText: '😀'.repeat(301) },
    { tenantId: ID },
    { actorId: OTHER },
    { role: 'admin' },
    { jobId: JOB },
    { quarantineId: OTHER },
    { outputId: OTHER },
    { storageKey: 'private' },
    { sha256: 'a'.repeat(64) },
    { accepted: true },
    { manifest: {} },
  ])
    await reject(
      () => api.registerMediaUploadV2(ID, 2, { ...input, ...patch }, options),
      'VALIDATION',
    );
  for (const [listingId, revision] of [
    ['bad', 2],
    [ID, 0],
    [ID, 1.5],
    [ID, 2147483648],
  ])
    await reject(
      () => api.registerMediaUploadV2(listingId, revision, input, options),
      'VALIDATION',
    );
  await reject(() => api.getMediaRegistrationV2(ID, 2, 'bad', options), 'VALIDATION');
  await reject(() => api.getMediaJobV2(ID, 2, 'bad', options), 'VALIDATION');
  assert.equal(calls, 0);
  const altText = '😀'.repeat(300);
  assert.equal(
    (
      await api.registerMediaUploadV2(
        ID,
        2,
        { ...input, altText, expectedVersion: '9007199254740991' },
        options,
      )
    ).altText,
    altText,
  );
  assert.equal(calls, 1);
});

test('registration response requires exact fields and original tuple/operation/version/alt facts', async () => {
  const missing = receipt();
  delete missing.registeredAt;
  for (const payload of [
    missing,
    receipt({ kind: 'attach_media' }),
    receipt({ outcome: 'accepted' }),
    receipt({ operationId: OTHER }),
    receipt({ jobId: 'bad' }),
    receipt({ jobId: OP }),
    receipt({ listingId: OTHER }),
    receipt({ revision: 3 }),
    receipt({ revision: 2.5 }),
    receipt({ expectedVersion: '3' }),
    receipt({ expectedVersion: 2 }),
    receipt({ expectedVersion: '02' }),
    receipt({ expectedVersion: '0' }),
    receipt({ expectedVersion: '9007199254740992' }),
    receipt({ altText: 'Different photo' }),
    receipt({ accepted: true }),
    receipt({ uploadUrl: 'https://private.invalid/upload' }),
  ])
    await reject(
      () => client(async () => json(payload)).registerMediaUploadV2(ID, 2, input, options),
      'INVALID_RESPONSE',
      true,
    );
});

test('registration and job GET bind exact paths and do not equate historical receipt with current state', async () => {
  const calls = [];
  const api = client(async (url, init) => {
    calls.push({ url, init });
    return json(url.includes('/media-jobs/') ? job({ state: 'expired' }) : receipt());
  });
  assert.deepEqual(await api.getMediaRegistrationV2(ID, 2, OP, options), receipt());
  const current = await api.getMediaJobV2(ID, 2, JOB, options);
  assert.equal(current.state, 'expired');
  assert.ok(Object.isFrozen(current));
  assert.equal('outcome' in current, false);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      `https://media.example.invalid/v2/staff/listings/${ID}/revisions/2/media-registrations/${OP}`,
      `https://media.example.invalid/v2/staff/listings/${ID}/revisions/2/media-jobs/${JOB}`,
    ],
  );
  assert.ok(calls.every((call) => call.init.method === 'GET' && call.init.body === undefined));
  for (const patch of [
    { operationId: OTHER },
    { listingId: OTHER },
    { revision: 3 },
    { state: 'expired' },
  ])
    await reject(
      () => client(async () => json(receipt(patch))).getMediaRegistrationV2(ID, 2, OP, options),
      'INVALID_RESPONSE',
    );
  const missing = job();
  delete missing.state;
  for (const payload of [
    missing,
    job({ jobId: OTHER }),
    job({ listingId: OTHER }),
    job({ revision: 3 }),
    job({ state: 'verified' }),
    job({ state: 'attached' }),
    job({ outcome: 'registered' }),
    job({ manifest: {} }),
  ])
    await reject(
      () => client(async () => json(payload)).getMediaJobV2(ID, 2, JOB, options),
      'INVALID_RESPONSE',
    );
});

test('media timestamps are canonical, exactly 24h apart and historical expiry is accepted without renewal', async () => {
  const past = { registeredAt: '2020-01-01T08:00:00.000Z', expiresAt: '2020-01-02T08:00:00.000Z' };
  assert.equal(
    (await client(async () => json(receipt(past))).getMediaRegistrationV2(ID, 2, OP, options))
      .expiresAt,
    past.expiresAt,
  );
  assert.equal(
    (
      await client(async () => json(job({ ...past, state: 'expired' }))).getMediaJobV2(
        ID,
        2,
        JOB,
        options,
      )
    ).state,
    'expired',
  );
  for (const patch of [
    { registeredAt: null },
    { registeredAt: '2026-02-30T08:00:00.123Z' },
    { registeredAt: '2026-10-10T08:00:00Z' },
    { registeredAt: '2026-10-10T08:00:00.123+00:00' },
    { expiresAt: TIME },
    { expiresAt: '2026-10-11T08:00:00.124Z' },
    { expiresAt: '2026-10-12T08:00:00.123Z' },
  ])
    await reject(
      () => client(async () => json(receipt(patch))).getMediaRegistrationV2(ID, 2, OP, options),
      'INVALID_RESPONSE',
    );
});

test('media raw response rejects decoded duplicate keys and fractional/exponent revision aliases before rounding', async () => {
  const source = JSON.stringify(receipt());
  for (const malformed of [
    source.replace('"revision":2', '"revision":2,"revision":2'),
    source.replace('"revision":2', '"revision":2,"revi\\u0073ion":2'),
    source.replace('"revision":2', '"revision":2.00000000000000001'),
    source.replace('"revision":2', '"revi\\u0073ion":2e0'),
    source.replace('"altText":', '"altText":"discarded","altText":'),
  ]) {
    await reject(
      () => client(async () => raw(malformed)).getMediaRegistrationV2(ID, 2, OP, options),
      'INVALID_RESPONSE',
    );
    await reject(
      () => client(async () => raw(malformed)).registerMediaUploadV2(ID, 2, input, options),
      'INVALID_RESPONSE',
      true,
    );
  }
  const duplicateError =
    '{"error":{"code":"FORBIDDEN","co\\u0064e":"FORBIDDEN","message":"private"},"requestId":"' +
    OTHER +
    '"}';
  await reject(
    () =>
      client(
        async () =>
          new Response(duplicateError, {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          }),
      ).getMediaJobV2(ID, 2, JOB, options),
    'INVALID_RESPONSE',
  );
  const quoted = {
    ...input,
    altText: 'Photo text containing "revision":2.0001 and {"same":1,"same":2}',
  };
  assert.equal(
    (
      await client(async () => json(receipt({ altText: quoted.altText }))).registerMediaUploadV2(
        ID,
        2,
        quoted,
        options,
      )
    ).altText,
    quoted.altText,
  );
});

test('media definite HTTP authorization/input/state conflicts expose safe codes and never retry', async () => {
  for (const [status, code] of [
    [400, 'INVALID_INPUT'],
    [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'],
    [404, 'NOT_FOUND'],
    [409, 'CONFLICT'],
    [422, 'INVALID_STATE'],
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        client(async () => {
          calls++;
          return json(
            { error: { code, message: 'PRIVATE synthetic SQL/provider detail' }, requestId: OTHER },
            status,
          );
        }).registerMediaUploadV2(ID, 2, input, options),
      (error) =>
        error.kind === 'HTTP' &&
        error.status === status &&
        error.serverCode === code &&
        !error.submissionUncertain &&
        !error.message.includes('PRIVATE'),
    );
    assert.equal(calls, 1);
  }
});

test('media write loss, timeout, redirects, invalid receipts and server failure remain uncertain without automatic retry', async () => {
  for (const [transport, kind] of [
    [
      async () => {
        throw new Error('PRIVATE network detail');
      },
      'NETWORK',
    ],
    [async () => json(receipt({ operationId: OTHER })), 'INVALID_RESPONSE'],
    [async () => json(receipt(), 201), 'INVALID_RESPONSE'],
    [async () => new Response(null, { status: 302 }), 'REDIRECT'],
    [
      async () =>
        json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'PRIVATE' }, requestId: OTHER }, 503),
      'HTTP',
    ],
    [async () => new Promise(() => {}), 'TIMEOUT'],
  ]) {
    let calls = 0;
    await reject(
      () =>
        client(async (...args) => {
          calls++;
          return transport(...args);
        }).registerMediaUploadV2(ID, 2, input, { ...options, timeoutMs: 20 }),
      kind,
      true,
    );
    assert.equal(calls, 1);
  }
});

test('pre-cancelled registration sends nothing; cancellation after transport starts remains uncertain', async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  await reject(
    () =>
      client(async () => {
        calls++;
        return json(receipt());
      }).registerMediaUploadV2(ID, 2, input, { ...options, signal: before.signal }),
    'CANCELLED',
  );
  assert.equal(calls, 0);
  const during = new AbortController();
  const api = client(async () => {
    calls++;
    during.abort();
    return new Promise(() => {});
  });
  await reject(
    () => api.registerMediaUploadV2(ID, 2, input, { ...options, signal: during.signal }),
    'CANCELLED',
    true,
  );
  assert.equal(calls, 1);
});

test('media read transport failure is never labelled an uncertain write', async () => {
  for (const call of [
    (api) => api.getMediaRegistrationV2(ID, 2, OP, options),
    (api) => api.getMediaJobV2(ID, 2, JOB, options),
  ]) {
    let calls = 0;
    await reject(
      () =>
        call(
          client(async () => {
            calls++;
            throw new Error('PRIVATE');
          }),
        ),
      'NETWORK',
    );
    assert.equal(calls, 1);
  }
});
