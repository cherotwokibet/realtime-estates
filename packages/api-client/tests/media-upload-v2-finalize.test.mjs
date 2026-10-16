import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ApiClientError,
  RealtorApiClient,
  validateMediaRegistrationReceiptV2,
  validateMediaAttachIntentV2,
} from '../dist/index.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LISTING = id(100),
  OP = id(500),
  JOB = id(600),
  MEDIA = id(700),
  OTHER = id(800),
  options = { bearerToken: 'synthetic-staff' };
const original = { operationId: OP, jobId: JOB, expectedVersion: '2' };
const registrationInput = {
  registrationId: OP,
  expectedVersion: '2',
  altText: 'Synthetic entrance',
};
const registration = (patch = {}) => ({
  kind: 'register_media_upload',
  operationId: OP,
  jobId: JOB,
  listingId: LISTING,
  revision: 2,
  expectedVersion: '2',
  altText: registrationInput.altText,
  registeredAt: '2020-01-01T00:00:00.000Z',
  expiresAt: '2020-01-02T00:00:00.000Z',
  outcome: 'registered',
  ...patch,
});
const facts = {
  kind: 'attach_media',
  operationId: OP,
  jobId: JOB,
  listingId: LISTING,
  revision: 2,
  expectedVersion: '2',
};
const ready = (patch = {}) => ({
  ...facts,
  altText: 'Synthetic entrance',
  status: 'ready',
  receipt: null,
  ...patch,
});
const applied = (patch = {}) =>
  ready({
    status: 'applied',
    receipt: {
      ...facts,
      version: '3',
      outcome: 'applied',
      reason: null,
      mediaId: MEDIA,
      position: 0,
      completedAt: '2020-01-01T00:00:00.000Z',
      ...patch,
    },
  });
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': OTHER },
  });
const raw = (value) => new Response(value, { headers: { 'Content-Type': 'application/json' } });
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://finalize.example.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch,
  });
const finalize = (api, opts = options) => api.finalizeMediaAttachIntentV2(LISTING, 2, OP, opts);
const reject = (operation, kind, uncertain = false) =>
  assert.rejects(
    operation,
    (error) =>
      error instanceof ApiClientError &&
      error.kind === kind &&
      error.submissionUncertain === uncertain,
  );

test('pure registration and attachment validators retain exact frozen original facts without transport', () => {
  const registered = validateMediaRegistrationReceiptV2(
    registration(),
    LISTING.toUpperCase(),
    2,
    OP.toUpperCase(),
    registrationInput,
  );
  assert.deepEqual(registered, registration());
  assert.ok(Object.isFrozen(registered));
  for (const value of [ready(), applied()]) {
    const parsed = validateMediaAttachIntentV2(value, LISTING, 2, OP, original);
    assert.deepEqual(parsed, value);
    assert.ok(Object.isFrozen(parsed));
    if (parsed.receipt) assert.ok(Object.isFrozen(parsed.receipt));
  }
  assert.equal(
    validateMediaRegistrationReceiptV2(
      registration({ expectedVersion: '3', altText: 'Different historical description' }),
      LISTING,
      2,
      OP,
    ).expectedVersion,
    '3',
  );
  assert.equal(validateMediaAttachIntentV2(ready({ jobId: OTHER }), LISTING, 2, OP).jobId, OTHER);
});

test('pure validators reject malformed resource and original commands before interpreting history', () => {
  for (const validate of [
    (value) => validateMediaRegistrationReceiptV2(registration(), ...value),
    (value) => validateMediaAttachIntentV2(ready(), ...value),
  ])
    for (const resource of [
      ['bad', 2, OP],
      [LISTING, 0, OP],
      [LISTING, 1.5, OP],
      [LISTING, 2147483648, OP],
      [LISTING, 2, 'bad'],
    ])
      assert.throws(
        () => validate(resource),
        (error) => error.kind === 'VALIDATION',
      );
  for (const request of [
    { ...registrationInput, registrationId: OTHER },
    { ...registrationInput, expectedVersion: '02' },
    { ...registrationInput, expectedVersion: 2 },
    { ...registrationInput, expectedVersion: '9007199254740992' },
    { ...registrationInput, altText: ' padded ' },
    { ...registrationInput, actorId: OTHER },
  ])
    assert.throws(
      () => validateMediaRegistrationReceiptV2(registration(), LISTING, 2, OP, request),
      (error) => error.kind === 'VALIDATION',
    );
  for (const request of [
    { ...original, operationId: OTHER },
    { ...original, jobId: OP },
    { ...original, jobId: 'bad' },
    { ...original, expectedVersion: '02' },
    { ...original, expectedVersion: '9007199254740991' },
    { ...original, manifest: {} },
  ])
    assert.throws(
      () => validateMediaAttachIntentV2(ready(), LISTING, 2, OP, request),
      (error) => error.kind === 'VALIDATION',
    );
});

test('pure validators bind original registration alt/version and attachment job/version without adoption', () => {
  for (const value of [
    registration({ altText: 'Changed' }),
    registration({ expectedVersion: '3' }),
    registration({ operationId: OTHER }),
    registration({ listingId: OTHER }),
    registration({ revision: 3 }),
    registration({ storageKey: 'PRIVATE' }),
  ])
    assert.throws(
      () => validateMediaRegistrationReceiptV2(value, LISTING, 2, OP, registrationInput),
      (error) => error.kind === 'INVALID_RESPONSE',
    );
  for (const value of [
    ready({ jobId: OTHER }),
    ready({ expectedVersion: '3' }),
    ready({ operationId: OTHER }),
    ready({ listingId: OTHER }),
    ready({ revision: 3 }),
    applied({ claimId: OTHER }),
  ])
    assert.throws(
      () => validateMediaAttachIntentV2(value, LISTING, 2, OP, original),
      (error) => error.kind === 'INVALID_RESPONSE',
    );
});

test('pure validators refuse hidden, symbolic, inherited and accessor fields without invoking getters', () => {
  let getters = 0;
  for (const [value, validate] of [
    [registration(), (input) => validateMediaRegistrationReceiptV2(input, LISTING, 2, OP)],
    [ready(), (input) => validateMediaAttachIntentV2(input, LISTING, 2, OP)],
  ]) {
    const accessor = { ...value };
    Object.defineProperty(accessor, 'jobId', {
      enumerable: true,
      get() {
        getters++;
        return JOB;
      },
    });
    const hidden = { ...value };
    Object.defineProperty(hidden, 'private', { value: true });
    for (const input of [
      accessor,
      hidden,
      { ...value, [Symbol('private')]: true },
      Object.assign(Object.create({ private: true }), value),
    ])
      assert.throws(
        () => validate(input),
        (error) => error.kind === 'INVALID_RESPONSE',
      );
  }
  for (const [request, validate] of [
    [
      registrationInput,
      (input) => validateMediaRegistrationReceiptV2(registration(), LISTING, 2, OP, input),
    ],
    [original, (input) => validateMediaAttachIntentV2(ready(), LISTING, 2, OP, input)],
  ]) {
    const accessor = { ...request };
    Object.defineProperty(accessor, 'expectedVersion', {
      enumerable: true,
      get() {
        getters++;
        return '2';
      },
    });
    assert.throws(
      () => validate(accessor),
      (error) => error.kind === 'VALIDATION',
    );
  }
  assert.equal(getters, 0);
});

test('finalization is an explicit single POST with no body/content type or regenerated identity', async () => {
  const calls = [],
    api = client(async (url, init) => {
      calls.push({ url, init });
      return json(
        init.method === 'POST' && !url.endsWith('/finalize')
          ? ready()
          : url.endsWith('/finalize')
            ? applied()
            : ready(),
      );
    });
  await api.createMediaAttachIntentV2(LISTING, 2, original, options);
  await api.getMediaAttachIntentV2(LISTING, 2, OP, options);
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => !call.url.endsWith('/finalize')));
  const value = await api.finalizeMediaAttachIntentV2(
      LISTING.toUpperCase(),
      2,
      OP.toUpperCase(),
      options,
    ),
    call = calls[2];
  assert.deepEqual(value, applied());
  assert.ok(Object.isFrozen(value.receipt));
  assert.equal(
    call.url,
    `https://finalize.example.invalid/v2/staff/listings/${LISTING}/revisions/2/media-attach-intents/${OP}/finalize`,
  );
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.body, undefined);
  assert.equal(call.init.headers['Content-Type'], undefined);
  assert.equal(call.init.headers['Idempotency-Key'], undefined);
  assert.equal(call.init.credentials, 'omit');
  assert.equal(call.init.redirect, 'error');
  assert.equal(call.init.cache, 'no-store');
});

test('finalization supports terminal failure facts but refuses successful ready or mismatched receipts as uncertain', async () => {
  for (const [status, reason] of [
    ['conflict', 'VERSION_CONFLICT'],
    ['rejected', 'CAPACITY_REACHED'],
    ['expired', 'JOB_EXPIRED'],
  ]) {
    const value = ready({
      status,
      receipt: {
        ...facts,
        version: '2',
        outcome: status,
        reason,
        mediaId: null,
        position: null,
        completedAt: '2020-01-01T00:00:00.000Z',
      },
    });
    assert.deepEqual(await finalize(client(async () => json(value))), value);
  }
  for (const value of [
    ready(),
    ready({ operationId: OTHER }),
    applied({ version: '4' }),
    { ...applied(), storageKey: 'PRIVATE' },
  ])
    await reject(() => finalize(client(async () => json(value))), 'INVALID_RESPONSE', true);
});

test('finalization requires per-call strict authority and a valid original URL tuple', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return json(applied());
  });
  for (const opts of [
    undefined,
    {},
    null,
    { bearerToken: '' },
    { bearerToken: 'bad\r\nheader' },
    { ...options, jobId: JOB },
  ])
    await reject(() => api.finalizeMediaAttachIntentV2(LISTING, 2, OP, opts), 'VALIDATION');
  for (const resource of [
    ['bad', 2, OP],
    [LISTING, 0, OP],
    [LISTING, 2147483648, OP],
    [LISTING, 2, 'bad'],
  ])
    await reject(() => api.finalizeMediaAttachIntentV2(...resource, options), 'VALIDATION');
  assert.equal(calls, 0);
});

test('finalization raw JSON guards cover the nested finalize path and terminal receipt tokens', async () => {
  const source = JSON.stringify(applied());
  for (const value of [
    source.replace('"revision":2', '"revision":2.00000000000000001'),
    source.replace('"revision":2', '"revision":2e0'),
    source.replace('"position":0', '"position":0.00000000000000001'),
    source.replace('"position":0', '"position":0e0'),
    source.replace('"version":"3"', '"version":"3","ver\\u0073ion":"3"'),
  ])
    await reject(() => finalize(client(async () => raw(value))), 'INVALID_RESPONSE', true);
});

test('finalization lost write reply is single-attempt and original GET readback never finalizes again', async () => {
  const calls = [],
    api = client(async (url, init) => {
      calls.push({ url, init });
      if (init.method === 'POST') throw new Error('PRIVATE lost reply');
      return json(applied());
    });
  await reject(() => finalize(api), 'NETWORK', true);
  assert.deepEqual(await api.getMediaAttachIntentV2(LISTING, 2, OP, options), applied());
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.init.method),
    ['POST', 'GET'],
  );
  assert.ok(calls[1].url.endsWith(`/media-attach-intents/${OP}`));
  for (const [transport, kind] of [
    [async () => new Promise(() => {}), 'TIMEOUT'],
    [async () => json(applied(), 201), 'INVALID_RESPONSE'],
    [async () => new Response(null, { status: 302 }), 'REDIRECT'],
    [
      async () =>
        json({ error: { code: 'SERVICE_UNAVAILABLE', message: 'PRIVATE' }, requestId: OTHER }, 503),
      'HTTP',
    ],
  ]) {
    let attempts = 0;
    await reject(
      () =>
        finalize(
          client(async (...args) => {
            attempts++;
            return transport(...args);
          }),
          { ...options, timeoutMs: 20 },
        ),
      kind,
      true,
    );
    assert.equal(attempts, 1);
  }
});

test('finalization preserves explicit post-invocation uncertainty even when current authorization is revoked', async () => {
  for (const [code, http, extra, uncertain] of [
    ['NOT_FOUND', 404, {}, false],
    ['NOT_FOUND', 404, { submissionUncertain: true }, true],
    ['UNAUTHENTICATED', 401, {}, false],
    ['FORBIDDEN', 403, {}, false],
    ['INVALID_INPUT', 400, {}, false],
    ['REQUEST_ABORTED', 400, {}, false],
    ['ATTACHMENT_UNCONFIRMED', 503, { submissionUncertain: true }, true],
    ['SERVICE_UNAVAILABLE', 503, {}, true],
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        finalize(
          client(async () => {
            calls++;
            return json(
              { error: { code, message: 'PRIVATE SQL detail' }, requestId: OTHER, ...extra },
              http,
            );
          }),
        ),
      (error) =>
        error instanceof ApiClientError &&
        error.kind === 'HTTP' &&
        error.serverCode === code &&
        error.status === http &&
        error.requestId === OTHER &&
        error.submissionUncertain === uncertain &&
        !error.message.includes('PRIVATE'),
    );
    assert.equal(calls, 1);
  }
});

test('finalization errors require exact safe envelopes, matching reference and valid optional uncertainty', async () => {
  const value = { error: { code: 'NOT_FOUND', message: 'PRIVATE' }, requestId: OTHER };
  for (const payload of [
    { ...value, submissionUncertain: false },
    { ...value, submissionUncertain: 'true' },
    { ...value, claimId: JOB },
    { ...value, requestId: JOB },
    { ...value, error: { code: 'PRIVATE', message: 'PRIVATE' } },
    { ...value, error: { ...value.error, storageKey: 'PRIVATE' } },
  ])
    await reject(() => finalize(client(async () => json(payload, 404))), 'INVALID_RESPONSE', true);
  const duplicate = JSON.stringify({ ...value, submissionUncertain: true }).replace(
    '"submissionUncertain":true',
    '"submissionUncertain":true,"submissionUncertain":true',
  );
  await reject(
    () =>
      finalize(
        client(
          async () =>
            new Response(duplicate, {
              status: 404,
              headers: { 'Content-Type': 'application/json', 'X-Request-Id': OTHER },
            }),
        ),
      ),
    'INVALID_RESPONSE',
    true,
  );
});

test('finalization cancellation before send is definite and after sending remains uncertain', async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  await reject(
    () =>
      finalize(
        client(async () => {
          calls++;
          return json(applied());
        }),
        { ...options, signal: before.signal },
      ),
    'CANCELLED',
  );
  assert.equal(calls, 0);
  const during = new AbortController();
  await reject(
    () =>
      finalize(
        client(async () => {
          calls++;
          during.abort();
          return new Promise(() => {});
        }),
        { ...options, signal: during.signal },
      ),
    'CANCELLED',
    true,
  );
  assert.equal(calls, 1);
});
