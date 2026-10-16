import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError, RealtorApiClient, validateMediaUploadStatusV2 } from '../dist/index.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LISTING = id(100),
  JOB = id(600),
  UPLOAD = id(700),
  OTHER = id(800),
  REQUEST = id(900),
  options = { bearerToken: 'synthetic-upload-staff' };
const status = (patch = {}) => ({
  uploadId: UPLOAD,
  jobId: JOB,
  listingId: LISTING,
  revision: 2,
  state: 'verified',
  ...patch,
});
const headers = { 'Content-Type': 'application/json', 'X-Request-Id': REQUEST };
const json = (value, code = 200, extra = {}) =>
  new Response(JSON.stringify(value), { status: code, headers: { ...headers, ...extra } });
const raw = (value) => new Response(value, { headers });
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://upload.example.invalid',
    privacyNoticeVersion: 'synthetic-v1',
    fetch,
  });
const path = `https://upload.example.invalid/v2/staff/listings/${LISTING}/revisions/2/media-jobs/${JOB}/uploads/${UPLOAD}`;
const put = (api, bytes = new Uint8Array([1]), opts = options) =>
  api.uploadMediaInputV2(LISTING, 2, JOB, UPLOAD, bytes, opts);
const get = (api, opts = options) => api.getMediaUploadStatusV2(LISTING, 2, JOB, UPLOAD, opts);
const reject = (operation, kind, uncertain = false) =>
  assert.rejects(
    operation,
    (error) =>
      error instanceof ApiClientError &&
      error.kind === kind &&
      error.submissionUncertain === uncertain,
  );

test('private binary ingress sends exact original tuple and raw bytes once with isolated per-call credentials', async () => {
  const calls = [],
    api = client(async (url, init) => {
      calls.push({ url, init });
      return json(url.includes('/v1/properties') ? { items: [], limit: 50 } : status());
    });
  const original = new Uint8Array([0, 128, 255]),
    value = await api.uploadMediaInputV2(
      LISTING.toUpperCase(),
      2,
      JOB.toUpperCase(),
      UPLOAD.toUpperCase(),
      original,
      { bearerToken: 'one' },
    );
  assert.deepEqual(value, status());
  assert.ok(Object.isFrozen(value));
  const { url, init } = calls[0];
  assert.equal(url, path);
  assert.equal(init.method, 'PUT');
  assert.equal(init.headers['Content-Type'], 'application/octet-stream');
  assert.equal(init.headers.Accept, 'application/json');
  assert.ok(init.body instanceof Uint8Array);
  assert.notEqual(init.body, original);
  assert.deepEqual([...init.body], [0, 128, 255]);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  for (const name of [
    'Content-Length',
    'Content-Encoding',
    'Idempotency-Key',
    'X-Tenant-Id',
    'X-Actor-Id',
  ])
    assert.equal(init.headers[name], undefined);
  await get(api, { bearerToken: 'two' });
  await api.listProperties();
  assert.deepEqual(
    calls.map((call) => call.init.headers.Authorization),
    ['Bearer one', 'Bearer two', undefined],
  );
  assert.equal(calls[1].url, path);
  assert.equal(calls[1].init.method, 'GET');
  assert.equal(calls[1].init.body, undefined);
  assert.equal(calls[1].init.headers['Content-Type'], undefined);
});

test('private ingress snapshots the exact byte subview and staff options before transport yields', async () => {
  const backing = Buffer.from([99, 1, 2, 3, 88]),
    bytes = backing.subarray(1, 4),
    mutable = { bearerToken: 'original', timeoutMs: 1000 };
  let seen;
  const api = client(async (_, init) => {
    seen = init;
    backing.fill(9);
    mutable.bearerToken = 'changed';
    mutable.timeoutMs = 1;
    await new Promise((resolve) => setImmediate(resolve));
    return json(status());
  });
  const pending = put(api, bytes, mutable);
  bytes.fill(8);
  await pending;
  assert.deepEqual([...seen.body], [1, 2, 3]);
  assert.equal(seen.headers.Authorization, 'Bearer original');
  assert.equal(mutable.bearerToken, 'changed');
  let getters = 0;
  const trapped = new Uint8Array([4, 5]);
  for (const field of ['buffer', 'byteOffset', 'byteLength', 'length'])
    Object.defineProperty(trapped, field, {
      get() {
        getters++;
        throw new Error('caller property trap');
      },
    });
  assert.deepEqual(
    await put(
      client(async (_, init) => {
        assert.deepEqual([...init.body], [4, 5]);
        return json(status());
      }),
      trapped,
    ),
    status(),
  );
  assert.equal(getters, 0);
});

test('binary input is bounded to 1 byte through 10 MiB and only ordinary Uint8 bytes are accepted', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return json(status());
  });
  const detached = new Uint8Array([1]);
  structuredClone(detached, { transfer: [detached.buffer] });
  const bad = [
    undefined,
    null,
    'bytes',
    [],
    {},
    new Uint8Array(),
    new Uint8Array(10485761),
    new Uint8ClampedArray([1]),
    new Uint16Array([1]),
    new DataView(new ArrayBuffer(1)),
    new Proxy(new Uint8Array([1]), {}),
    detached,
  ];
  if (typeof SharedArrayBuffer === 'function') bad.push(new Uint8Array(new SharedArrayBuffer(1)));
  for (const bytes of bad)
    await reject(
      () => api.uploadMediaInputV2(LISTING, 2, JOB, UPLOAD, bytes, options),
      'VALIDATION',
    );
  assert.equal(calls, 0);
  await put(api, new Uint8Array([1]));
  await put(api, Buffer.from([2]));
  await put(api, new Uint8Array(10485760));
  assert.equal(calls, 3);
});

test('private upload/status validate all URL identities and int32 revision before contacting transport', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return json(status());
  });
  const tuples = [
    ['bad', 2, JOB, UPLOAD],
    [LISTING, 0, JOB, UPLOAD],
    [LISTING, -1, JOB, UPLOAD],
    [LISTING, 1.5, JOB, UPLOAD],
    [LISTING, 2147483648, JOB, UPLOAD],
    [LISTING, '2', JOB, UPLOAD],
    [LISTING, 2, 'bad', UPLOAD],
    [LISTING, 2, JOB, 'bad'],
    [LISTING, 2, JOB, `${UPLOAD}?retry=1`],
  ];
  for (const tuple of tuples) {
    await reject(
      () => api.uploadMediaInputV2(...tuple, new Uint8Array([1]), options),
      'VALIDATION',
    );
    await reject(() => api.getMediaUploadStatusV2(...tuple, options), 'VALIDATION');
  }
  assert.equal(calls, 0);
});

test('private options reject hidden/accessor/inherited authority and require a fresh valid bearer', async () => {
  let calls = 0,
    getters = 0;
  const api = client(async () => {
      calls++;
      return json(status());
    }),
    accessor = {};
  Object.defineProperty(accessor, 'bearerToken', {
    enumerable: true,
    get() {
      getters++;
      return options.bearerToken;
    },
  });
  const hidden = { ...options };
  Object.defineProperty(hidden, 'private', { value: true });
  for (const opts of [
    undefined,
    {},
    null,
    { bearerToken: '' },
    { bearerToken: 'bad\r\nheader' },
    { ...options, tenantId: OTHER },
    { ...options, timeoutMs: 0 },
    { ...options, signal: {} },
    accessor,
    hidden,
    { ...options, [Symbol('private')]: true },
    Object.assign(Object.create({ private: true }), options),
  ]) {
    await reject(
      () => api.uploadMediaInputV2(LISTING, 2, JOB, UPLOAD, new Uint8Array([1]), opts),
      'VALIDATION',
    );
    await reject(() => api.getMediaUploadStatusV2(LISTING, 2, JOB, UPLOAD, opts), 'VALIDATION');
  }
  assert.equal(calls, 0);
  assert.equal(getters, 0);
  const own = Object.assign(Object.create(null), options);
  assert.deepEqual(await get(api, own), status());
});

test('all narrow upload states are accepted without granting attachment or exposing internals', async () => {
  for (const state of ['verified', 'processing', 'blocked', 'native_failed']) {
    const value = status({ state });
    assert.deepEqual(await put(client(async () => json(value))), value);
    assert.deepEqual(await get(client(async () => json(value))), value);
    assert.ok(Object.isFrozen(validateMediaUploadStatusV2(value, LISTING, 2, JOB, UPLOAD)));
  }
  for (const key of [
    'claimId',
    'generationId',
    'manifest',
    'objectKey',
    'storageKey',
    'tenantId',
    'actorId',
    'workerId',
    'coordinator',
    'accepted',
    'receipt',
    'sha256',
  ])
    assert.equal(key in status(), false);
});

test('upload status parser rejects missing/extra fields and every mismatched original tuple fact', async () => {
  const missing = status();
  delete missing.jobId;
  const invalid = [
    missing,
    ...[
      { uploadId: OTHER },
      { jobId: OTHER },
      { listingId: OTHER },
      { revision: 3 },
      { revision: 2.5 },
      { revision: '2' },
      { state: 'registered' },
      { state: 'applied' },
      { state: null },
      { claimId: OTHER },
      { receipt: {} },
      { accepted: true },
    ].map(status),
  ];
  for (const value of invalid) {
    await reject(() => put(client(async () => json(value))), 'INVALID_RESPONSE', true);
    await reject(() => get(client(async () => json(value))), 'INVALID_RESPONSE');
  }
});

test('pure upload parser validates resource arguments and strict own descriptors without executing getters', () => {
  let getters = 0;
  const accessor = status();
  Object.defineProperty(accessor, 'state', {
    enumerable: true,
    get() {
      getters++;
      return 'verified';
    },
  });
  const hidden = status();
  Object.defineProperty(hidden, 'private', { value: true });
  for (const value of [
    accessor,
    hidden,
    { ...status(), [Symbol('private')]: true },
    Object.assign(Object.create({ private: true }), status()),
  ])
    assert.throws(
      () => validateMediaUploadStatusV2(value, LISTING, 2, JOB, UPLOAD),
      (error) => error instanceof ApiClientError && error.kind === 'INVALID_RESPONSE',
    );
  assert.equal(getters, 0);
  for (const tuple of [
    ['bad', 2, JOB, UPLOAD],
    [LISTING, 0, JOB, UPLOAD],
    [LISTING, 2147483648, JOB, UPLOAD],
    [LISTING, 2, 'bad', UPLOAD],
    [LISTING, 2, JOB, 'bad'],
  ])
    assert.throws(
      () => validateMediaUploadStatusV2(status(), ...tuple),
      (error) => error instanceof ApiClientError && error.kind === 'VALIDATION',
    );
  assert.deepEqual(
    validateMediaUploadStatusV2(
      status(),
      LISTING.toUpperCase(),
      2,
      JOB.toUpperCase(),
      UPLOAD.toUpperCase(),
    ),
    status(),
  );
});

test('upload raw JSON rejects duplicate decoded keys and pre-rounding numeric aliases', async () => {
  const source = JSON.stringify(status());
  for (const value of [
    source.replace('"revision":2', '"revision":2,"revi\\u0073ion":2'),
    source.replace('"revision":2', '"revision":2.00000000000000001'),
    source.replace('"revision":2', '"revision":2e0'),
    source.replace('"state":"verified"', '"state":"blocked","sta\\u0074e":"verified"'),
    source.replace('"uploadId":', '"uploadId":"discarded","uploadId":'),
  ]) {
    await reject(() => put(client(async () => raw(value))), 'INVALID_RESPONSE', true);
    await reject(() => get(client(async () => raw(value))), 'INVALID_RESPONSE');
  }
});

test('private adapter definite errors use exact safe code/status/header facts with no retry', async () => {
  for (const [code, http] of [
    ['NOT_FOUND', 404],
    ['METHOD_NOT_ALLOWED', 405],
    ['INVALID_UPLOAD', 400],
    ['UNAUTHENTICATED', 401],
    ['EXPECTATION_FAILED', 417],
    ['BINARY_REQUIRED', 415],
    ['BODY_TOO_LARGE', 413],
    ['UPLOAD_BUSY', 409],
    ['UPLOAD_TIMEOUT', 408],
    ['UPLOAD_ABORTED', 400],
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        put(
          client(async () => {
            calls++;
            return json({ error: code }, http);
          }),
        ),
      (error) =>
        error instanceof ApiClientError &&
        error.kind === 'HTTP' &&
        error.status === http &&
        error.serverCode === code &&
        error.requestId === REQUEST &&
        !error.submissionUncertain &&
        !error.message.includes('SQL'),
    );
    assert.equal(calls, 1);
  }
});

test('unconfirmed ingress and service failure retain uncertain write identity for explicit status GET', async () => {
  for (const [code, http] of [
    ['UPLOAD_UNCONFIRMED', 409],
    ['SERVICE_UNAVAILABLE', 503],
  ]) {
    const calls = [],
      api = client(async (url, init) => {
        calls.push({ url, init });
        return init.method === 'PUT' ? json({ error: code }, http) : json(status());
      });
    await assert.rejects(
      () => put(api),
      (error) => error.kind === 'HTTP' && error.serverCode === code && error.submissionUncertain,
    );
    assert.deepEqual(await get(api), status());
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((call) => call.url),
      [path, path],
    );
    assert.deepEqual(
      calls.map((call) => call.init.method),
      ['PUT', 'GET'],
    );
    assert.equal(calls[1].init.body, undefined);
    await assert.rejects(
      () => get(client(async () => json({ error: code }, http))),
      (error) => error.kind === 'HTTP' && !error.submissionUncertain,
    );
  }
});

test('malformed/private/incorrect-status error envelopes fail closed and never expose server details', async () => {
  const malformed = [
    json({ error: 'PRIVATE SQL stack' }, 409),
    json({ error: 'UPLOAD_BUSY', claimId: OTHER }, 409),
    json({ error: 'SERVICE_UNAVAILABLE' }, 409),
    json({ error: { code: 'CONFLICT', message: 'PRIVATE SQL' }, requestId: REQUEST }, 409),
    new Response('{"error":"UPLOAD_BUSY"}', {
      status: 409,
      headers: { 'Content-Type': 'application/json' },
    }),
    json({ error: 'UPLOAD_BUSY' }, 409, { 'X-Request-Id': 'PRIVATE' }),
  ];
  for (const response of malformed)
    await assert.rejects(
      () => put(client(async () => response)),
      (error) =>
        error.kind === 'INVALID_RESPONSE' &&
        error.submissionUncertain &&
        !error.message.includes('PRIVATE'),
    );
  const duplicate = '{"error":"UPLOAD_BUSY","err\\u006fr":"UPLOAD_BUSY"}';
  await reject(
    () => put(client(async () => new Response(duplicate, { status: 409, headers }))),
    'INVALID_RESPONSE',
    true,
  );
});

test('upload write loss, malformed success and redirect remain uncertain and single-attempt', async () => {
  const cases = [
    [
      async () => {
        throw new Error('PRIVATE network');
      },
      'NETWORK',
    ],
    [async () => json(status(), 201), 'INVALID_RESPONSE'],
    [
      async () => new Response('not JSON', { headers: { 'Content-Type': 'text/plain' } }),
      'INVALID_RESPONSE',
    ],
    [async () => raw(' '.repeat(4097)), 'INVALID_RESPONSE'],
    [async () => raw('{'), 'INVALID_RESPONSE'],
    [async () => new Response(null, { status: 302 }), 'REDIRECT'],
    [async () => Object.defineProperty(json(status()), 'redirected', { value: true }), 'REDIRECT'],
    [
      async () =>
        Object.defineProperty(json(status()), 'url', {
          value: 'https://elsewhere.example.invalid/',
        }),
      'REDIRECT',
    ],
  ];
  for (const [transport, kind] of cases) {
    let calls = 0;
    await reject(
      () =>
        put(
          client(async (...args) => {
            calls++;
            return transport(...args);
          }),
        ),
      kind,
      true,
    );
    assert.equal(calls, 1);
  }
  let calls = 0;
  const api = client(async (_, init) => {
    calls++;
    if (init.method === 'PUT') throw new Error('lost acknowledgement');
    return json(status());
  });
  await reject(() => put(api), 'NETWORK', true);
  assert.deepEqual(await get(api), status());
  assert.equal(calls, 2);
});

test('upload cancellation before send is definite and cancellation/deadline after send remain uncertain', async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  await reject(
    () =>
      put(
        client(async () => {
          calls++;
          return json(status());
        }),
        new Uint8Array([1]),
        { ...options, signal: before.signal },
      ),
    'CANCELLED',
  );
  assert.equal(calls, 0);
  const during = new AbortController();
  await reject(
    () =>
      put(
        client(async () => {
          calls++;
          during.abort();
          return new Promise(() => {});
        }),
        new Uint8Array([1]),
        { ...options, signal: during.signal },
      ),
    'CANCELLED',
    true,
  );
  assert.equal(calls, 1);
  let deadlineCalls = 0;
  await reject(
    () =>
      put(
        client(async () => {
          deadlineCalls++;
          return new Promise(() => {});
        }),
        new Uint8Array([1]),
        { ...options, timeoutMs: 20 },
      ),
    'TIMEOUT',
    true,
  );
  assert.equal(deadlineCalls, 1);
  for (const [fetch, kind] of [
    [
      async () => {
        throw new Error('PRIVATE');
      },
      'NETWORK',
    ],
    [async () => new Promise(() => {}), 'TIMEOUT'],
  ])
    await reject(() => get(client(fetch), { ...options, timeoutMs: 20 }), kind);
});

test('response-body read cancellation is within the same upload deadline', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return {
      status: 200,
      ok: true,
      url: '',
      redirected: false,
      headers: new Headers(headers),
      text: () => new Promise(() => {}),
    };
  });
  await reject(() => put(api, new Uint8Array([1]), { ...options, timeoutMs: 20 }), 'TIMEOUT', true);
  assert.equal(calls, 1);
});
