import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError, RealtorApiClient } from '../dist/index.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const LISTING = id(100),
  MEDIA = id(200),
  OTHER = id(300),
  REQUEST = id(900),
  options = { bearerToken: 'synthetic-preview-staff' };
const ORIGIN = 'https://preview.example.invalid',
  PATH = `${ORIGIN}/v2/staff/listings/${LISTING}/revisions/2/media/${MEDIA}/preview`;
const client = (fetch, extra = {}) =>
  new RealtorApiClient({ baseUrl: ORIGIN, privacyNoticeVersion: 'synthetic-v1', fetch, ...extra });
const get = (api, opts = options) => api.getStaffMediaPreviewV2(LISTING, 2, MEDIA, '7', opts);
const rejects = (operation, kind) =>
  assert.rejects(
    operation,
    (error) => error instanceof ApiClientError && error.kind === kind && !error.submissionUncertain,
  );
// A framing fixture only. The native codec/decode proof belongs to API/browser integration.
function webp(length = 24) {
  const data = new Uint8Array(length);
  data.set([82, 73, 70, 70], 0);
  new DataView(data.buffer).setUint32(4, length - 8, true);
  data.set([87, 69, 66, 80, 86, 80, 56, 32], 8);
  return data;
}
const success = (data = webp(), extra = {}) =>
  new Response(data, {
    headers: { 'Content-Type': 'image/webp', 'Content-Length': String(data.byteLength), ...extra },
  });
const envelope = (code = 'VERSION_CONFLICT', patch = {}) => ({
  error: { code, message: 'Private image preview is unavailable.' },
  requestId: REQUEST,
  ...patch,
});
const json = (value = envelope(), status = 409, extra = {}) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json', 'X-Request-Id': REQUEST, ...extra },
  });
function controlled(
  parts,
  { headers = {}, status = 200, hang = false, readError = false, ignoreCancel = false } = {},
) {
  let reads = 0,
    cancels = 0,
    releases = 0,
    index = 0;
  const reader = {
    async read() {
      reads++;
      if (readError) throw new Error('private SQL and token');
      if (hang) return new Promise(() => {});
      return index < parts.length
        ? {
            done: false,
            value: typeof parts[index] === 'function' ? parts[index++]() : parts[index++],
          }
        : { done: true, value: undefined };
    },
    cancel() {
      cancels++;
      return ignoreCancel ? new Promise(() => {}) : Promise.resolve();
    },
    releaseLock() {
      releases++;
    },
  };
  const response = {
    status,
    ok: status >= 200 && status < 300,
    redirected: false,
    url: '',
    headers: new Headers({ 'Content-Type': 'image/webp', 'Content-Length': '24', ...headers }),
    body: {
      getReader() {
        return reader;
      },
      cancel() {
        cancels++;
        return Promise.resolve();
      },
    },
    text() {
      throw new Error('Unbounded text collection is forbidden.');
    },
    arrayBuffer() {
      throw new Error('Unbounded byte collection is forbidden.');
    },
  };
  return {
    response,
    get reads() {
      return reads;
    },
    get cancels() {
      return cancels;
    },
    get releases() {
      return releases;
    },
  };
}

test('saved image GET binds the exact tuple/version without putting credentials or selectors in the URL', async () => {
  const calls = [],
    api = client(async (url, init) => {
      calls.push({ url, init });
      return url.includes('/v1/properties') ? json({ items: [], limit: 50 }, 200) : success();
    });
  const value = await api.getStaffMediaPreviewV2(
    LISTING.toUpperCase(),
    2,
    MEDIA.toUpperCase(),
    '9007199254740991',
    { bearerToken: 'first' },
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    ['listingId', 'revision', 'mediaId', 'version', 'mimeType', 'data'].sort(),
  );
  assert.deepEqual(
    { ...value, data: [...value.data] },
    {
      listingId: LISTING,
      revision: 2,
      mediaId: MEDIA,
      version: '9007199254740991',
      mimeType: 'image/webp',
      data: [...webp()],
    },
  );
  assert.ok(Object.isFrozen(value));
  assert.ok(value.data instanceof Uint8Array);
  assert.equal(value.data.buffer.byteLength, 24);
  const { url, init } = calls[0];
  assert.equal(url, PATH);
  assert.equal(init.method, 'GET');
  assert.equal(init.body, undefined);
  assert.equal(init.credentials, 'omit');
  assert.equal(init.redirect, 'error');
  assert.equal(init.cache, 'no-store');
  assert.deepEqual(init.headers, {
    Accept: 'image/webp',
    Authorization: 'Bearer first',
    'X-Revision-Version': '9007199254740991',
  });
  assert.ok(init.signal instanceof AbortSignal);
  await get(api, { bearerToken: 'second' });
  await api.listProperties();
  assert.deepEqual(
    calls.map((value) => value.init.headers.Authorization),
    ['Bearer first', 'Bearer second', undefined],
  );
  assert.equal(calls[2].init.headers.Accept, 'application/json');
});

test('private image resources and canonical positive safe version strings validate before IO', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return success();
  });
  const tuples = [
    ['bad', 2, MEDIA, '7'],
    [LISTING, 0, MEDIA, '7'],
    [LISTING, -1, MEDIA, '7'],
    [LISTING, 2.1, MEDIA, '7'],
    [LISTING, 2147483648, MEDIA, '7'],
    [LISTING, '2', MEDIA, '7'],
    [LISTING, 2, 'bad', '7'],
    [LISTING, 2, `${MEDIA}?private=1`, '7'],
    ...[
      '0',
      '00',
      '01',
      '+1',
      '-1',
      '1.0',
      '1e0',
      ' 1',
      '1 ',
      '9007199254740992',
      '9223372036854775807',
      1,
      undefined,
      null,
    ].map((version) => [LISTING, 2, MEDIA, version]),
  ];
  for (const tuple of tuples)
    await rejects(() => api.getStaffMediaPreviewV2(...tuple, options), 'VALIDATION');
  assert.equal(calls, 0);
  await api.getStaffMediaPreviewV2(LISTING, 2147483647, MEDIA, '1', options);
  assert.equal(calls, 1);
});

test('staff options are strict snapshotted own data and cannot add transport authority', async () => {
  let calls = 0,
    getters = 0;
  const api = client(async () => {
      calls++;
      return success();
    }),
    accessor = {};
  Object.defineProperty(accessor, 'bearerToken', {
    enumerable: true,
    get() {
      getters++;
      return 'secret';
    },
  });
  const hidden = { ...options };
  Object.defineProperty(hidden, 'tenantId', { value: OTHER });
  for (const opts of [
    null,
    {},
    accessor,
    hidden,
    { ...options, [Symbol('private')]: true },
    Object.assign(Object.create({ actorId: OTHER }), options),
    { ...options, actorId: OTHER },
    { bearerToken: '' },
    { bearerToken: 'bad\r\nheader' },
    { ...options, signal: {} },
    { ...options, timeoutMs: 0 },
  ])
    await rejects(() => get(api, opts), 'VALIDATION');
  // get() has a convenience default; exercise an explicit undefined option separately.
  await rejects(() => api.getStaffMediaPreviewV2(LISTING, 2, MEDIA, '7', undefined), 'VALIDATION');
  assert.equal(getters, 0);
  assert.equal(calls, 0);
  const mutable = { bearerToken: 'original', timeoutMs: 1000 };
  let seen;
  const pending = get(
    client(async (_, init) => {
      seen = init;
      mutable.bearerToken = 'changed';
      mutable.timeoutMs = 1;
      await new Promise((resolve) => setImmediate(resolve));
      return success();
    }),
    mutable,
  );
  mutable.bearerToken = 'another';
  await pending;
  assert.equal(seen.headers.Authorization, 'Bearer original');
  await get(api, Object.assign(Object.create(null), options));
  assert.equal(calls, 1);
});

test('incremental reads snapshot reused byte subviews without invoking caller byte descriptors', async () => {
  const original = webp(),
    backing = new Uint8Array(26),
    view = backing.subarray(1, 25);
  view.set(original);
  let getters = 0;
  for (const field of ['buffer', 'byteOffset', 'byteLength', 'length'])
    Object.defineProperty(view, field, {
      get() {
        getters++;
        throw new Error('caller descriptor');
      },
    });
  const stream = controlled([
    view,
    () => {
      backing.fill(255);
      return new Uint8Array();
    },
  ]);
  const result = await get(client(async () => stream.response));
  assert.deepEqual([...result.data], [...original]);
  assert.equal(getters, 0);
  assert.equal(stream.reads, 3);
  assert.ok(stream.releases >= 1);
  result.data[0] = 0;
  assert.equal(original[0], 82);
  assert.equal(result.data.buffer.byteLength, 24);
});

test('bounded native readable streams accept exact chunked bodies through the 10 MiB cap', async () => {
  for (const length of [20, 24, 10485760]) {
    const bytes = webp(length);
    let offset = 0;
    const body = new ReadableStream(
      {
        pull(controller) {
          if (offset === bytes.length) {
            controller.close();
            return;
          }
          const end = Math.min(bytes.length, offset + 65536);
          controller.enqueue(bytes.slice(offset, end));
          offset = end;
        },
      },
      { highWaterMark: 0 },
    );
    const value = await get(
      client(
        async () =>
          new Response(body, {
            headers: { 'Content-Type': 'image/webp', 'Content-Length': String(length) },
          }),
      ),
    );
    assert.equal(value.data.byteLength, length);
    assert.deepEqual(value.data, bytes);
  }
});

test('unsupported declared lengths fail before reading bytes and cancel the body', async () => {
  for (const length of [
    null,
    '',
    '0',
    '19',
    '10485761',
    '99999999',
    '020',
    '+24',
    '-24',
    '24.0',
    '24e0',
    '24, 24',
  ]) {
    const stream = controlled([webp()]);
    if (length === null) stream.response.headers.delete('content-length');
    else stream.response.headers.set('content-length', length);
    await rejects(() => get(client(async () => stream.response)), 'INVALID_RESPONSE');
    assert.equal(stream.reads, 0);
    assert.equal(stream.cancels, 1);
  }
});

test('exact body length is enforced incrementally on truncation and oversized chunks', async () => {
  for (const parts of [
    [webp().subarray(0, 23)],
    [webp(), new Uint8Array([9])],
    [new Uint8Array(10485761)],
  ]) {
    const stream = controlled(parts);
    await rejects(() => get(client(async () => stream.response)), 'INVALID_RESPONSE');
    assert.ok(stream.cancels >= 1);
    assert.ok(stream.releases >= 1);
  }
  const stream = controlled([
    webp(),
    new Uint8Array([1]),
    () => {
      throw new Error('Do not keep reading after excess.');
    },
  ]);
  await rejects(() => get(client(async () => stream.response)), 'INVALID_RESPONSE');
  assert.equal(stream.reads, 2);
});

test('only ordinary nonshared Uint8 chunks are accepted without coercion or fallback', async () => {
  const detached = new Uint8Array([1]);
  structuredClone(detached, { transfer: [detached.buffer] });
  const chunks = [
    undefined,
    null,
    'bytes',
    [1],
    {},
    new Uint8ClampedArray([1]),
    new Uint16Array([1]),
    new DataView(new ArrayBuffer(1)),
    new Proxy(new Uint8Array([1]), {}),
    detached,
  ];
  if (typeof SharedArrayBuffer === 'function')
    chunks.push(new Uint8Array(new SharedArrayBuffer(24)));
  for (const chunk of chunks) {
    const stream = controlled([chunk]);
    await rejects(() => get(client(async () => stream.response)), 'INVALID_RESPONSE');
    assert.ok(stream.cancels >= 1);
  }
  for (const response of [
    {
      status: 200,
      ok: true,
      headers: new Headers({ 'Content-Type': 'image/webp', 'Content-Length': '24' }),
      body: null,
    },
    controlled([]).response,
  ]) {
    if (response.body)
      response.body.getReader = () => ({
        read: async () => ({ done: 'yes' }),
        cancel: async () => {},
        releaseLock() {},
      });
    await rejects(() => get(client(async () => response)), 'INVALID_RESPONSE');
  }
});

test('RIFF and WEBP bytes and little-endian length are exact, including high-bit rejection', async () => {
  const malformed = [];
  for (const index of [0, 1, 2, 3, 8, 9, 10, 11]) {
    const bytes = webp();
    bytes[index] |= 128;
    malformed.push(bytes);
  }
  for (const patch of [
    (bytes) => bytes[4]++,
    (bytes) => new DataView(bytes.buffer).setUint32(4, bytes.length - 8, false),
    (bytes) => bytes.fill(0),
  ]) {
    const bytes = webp();
    patch(bytes);
    malformed.push(bytes);
  }
  for (const bytes of malformed)
    await rejects(() => get(client(async () => success(bytes))), 'INVALID_RESPONSE');
});

test('image success requires exact MIME/status and refuses encoding/range before body collection', async () => {
  for (const headers of [
    { 'Content-Type': 'application/json' },
    { 'Content-Type': 'image/WebP' },
    { 'Content-Type': 'image/webp; charset=utf-8' },
    { 'Content-Type': 'image/jpeg' },
    { 'Content-Encoding': 'identity' },
    { 'Content-Encoding': 'gzip' },
    { 'Content-Range': 'bytes 0-23/24' },
  ]) {
    const stream = controlled([webp()], { headers });
    await rejects(() => get(client(async () => stream.response)), 'INVALID_RESPONSE');
    assert.equal(stream.reads, 0);
    assert.ok(stream.cancels >= 1);
  }
  for (const status of [201, 202, 206])
    await rejects(
      () =>
        get(
          client(
            async () =>
              new Response(webp(), {
                status,
                headers: { 'Content-Type': 'image/webp', 'Content-Length': '24' },
              }),
          ),
        ),
      'INVALID_RESPONSE',
    );
});

test('redirect status, followed flags and any changed response URL are refused without retries', async () => {
  const changed = success();
  Object.defineProperty(changed, 'url', {
    value: `${ORIGIN}/v2/staff/listings/${OTHER}/revisions/2/media/${MEDIA}/preview`,
  });
  const followed = success();
  Object.defineProperty(followed, 'redirected', { value: true });
  const query = success();
  Object.defineProperty(query, 'url', { value: `${PATH}?private=1` });
  for (const response of [
    new Response(null, { status: 302, headers: { Location: 'https://foreign.invalid/secret' } }),
    changed,
    followed,
    query,
  ]) {
    let calls = 0;
    await rejects(
      () =>
        get(
          client(async () => {
            calls++;
            return response;
          }),
        ),
      'REDIRECT',
    );
    assert.equal(calls, 1);
  }
  const exact = success();
  Object.defineProperty(exact, 'url', { value: PATH });
  assert.equal((await get(client(async () => exact))).mediaId, MEDIA);
});

test('safe image HTTP errors validate exact status/reference and never expose server details or uncertainty', async () => {
  for (const [code, status] of [
    ['NOT_FOUND', 404],
    ['METHOD_NOT_ALLOWED', 405],
    ['INVALID_INPUT', 400],
    ['FORBIDDEN', 403],
    ['UNAUTHENTICATED', 401],
    ['VERSION_CONFLICT', 409],
    ['REQUEST_ABORTED', 400],
    ['SERVICE_UNAVAILABLE', 503],
  ]) {
    let calls = 0;
    const value = envelope(code);
    value.error.message = 'private path SQL token';
    await assert.rejects(
      () =>
        get(
          client(async () => {
            calls++;
            return json(value, status);
          }),
        ),
      (error) =>
        error instanceof ApiClientError &&
        error.kind === 'HTTP' &&
        error.status === status &&
        error.serverCode === code &&
        error.requestId === REQUEST &&
        !error.submissionUncertain &&
        !JSON.stringify(error).includes('private path SQL token') &&
        !error.message.includes('SQL'),
    );
    assert.equal(calls, 1);
  }
});

test('error envelopes reject extra facts, mismatched references, code/status aliases and duplicate decoded keys', async () => {
  const missing = envelope();
  delete missing.requestId;
  for (const [value, status, headers] of [
    [missing, 409, {}],
    [envelope('UNKNOWN'), 409, {}],
    [envelope('NOT_FOUND'), 409, {}],
    [envelope('VERSION_CONFLICT', { claimId: OTHER }), 409, {}],
    [envelope('VERSION_CONFLICT', { submissionUncertain: true }), 409, {}],
    [
      {
        ...envelope(),
        error: { code: 'VERSION_CONFLICT', message: 'private', storageKey: 'secret' },
      },
      409,
      {},
    ],
    [envelope(), 409, { 'X-Request-Id': OTHER }],
    [envelope(), 409, { 'X-Request-Id': '' }],
    [{ ...envelope(), error: { code: 'VERSION_CONFLICT', message: '' } }, 409, {}],
    [{ ...envelope(), error: { code: 'VERSION_CONFLICT', message: 'x'.repeat(1025) } }, 409, {}],
  ])
    await rejects(() => get(client(async () => json(value, status, headers))), 'INVALID_RESPONSE');
  const raw = JSON.stringify(envelope());
  for (const body of [
    raw.replace('"requestId":', '"requestId":"discarded","requestId":'),
    raw.replace('"code":', '"co\\u0064e":"NOT_FOUND","code":'),
    '{bad',
    new Uint8Array([255, 254]),
  ])
    await rejects(
      () =>
        get(
          client(
            async () =>
              new Response(body, {
                status: 409,
                headers: { 'Content-Type': 'application/json', 'X-Request-Id': REQUEST },
              }),
          ),
        ),
      'INVALID_RESPONSE',
    );
  const noHeader = json();
  noHeader.headers.delete('x-request-id');
  await rejects(() => get(client(async () => noHeader)), 'INVALID_RESPONSE');
});

test('error collection is bounded at 4 KiB and enforces an optional declared exact length', async () => {
  const encoded = new TextEncoder().encode(JSON.stringify(envelope()));
  const valid = new Uint8Array(4096);
  valid.fill(32);
  valid.set(encoded);
  await assert.rejects(
    () =>
      get(
        client(
          async () =>
            new Response(valid, {
              status: 409,
              headers: { 'Content-Type': 'application/json', 'X-Request-Id': REQUEST },
            }),
        ),
      ),
    (error) => error.kind === 'HTTP' && !error.submissionUncertain,
  );
  for (const [parts, length] of [
    [[encoded, new Uint8Array(4097)], null],
    [[encoded], '4097'],
    [[encoded], String(encoded.byteLength + 1)],
    [[encoded], String(encoded.byteLength - 1)],
  ]) {
    const stream = controlled(parts, {
      status: 409,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': REQUEST },
    });
    if (length === null) stream.response.headers.delete('content-length');
    else stream.response.headers.set('content-length', length);
    await rejects(() => get(client(async () => stream.response)), 'INVALID_RESPONSE');
    assert.ok(stream.cancels >= 1);
    if (length === '4097') assert.equal(stream.reads, 0);
  }
  for (const response of [
    new Response('private HTML', { status: 503, headers: { 'Content-Type': 'text/html' } }),
    new Response('{}', {
      status: 409,
      headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' },
    }),
  ])
    await rejects(() => get(client(async () => response)), 'INVALID_RESPONSE');
});

test('pre-cancellation prevents transport and in-flight fetch cancellation sends only one request', async () => {
  const before = new AbortController();
  before.abort();
  let calls = 0;
  await rejects(
    () =>
      get(
        client(async () => {
          calls++;
          return success();
        }),
        { ...options, signal: before.signal },
      ),
    'CANCELLED',
  );
  assert.equal(calls, 0);
  const active = new AbortController();
  let signal;
  const pending = get(
    client(async (_, init) => {
      calls++;
      signal = init.signal;
      return new Promise(() => {});
    }),
    { ...options, signal: active.signal },
  );
  active.abort();
  await rejects(() => pending, 'CANCELLED');
  assert.equal(signal.aborted, true);
  assert.equal(calls, 1);
});

test('deadline includes ignored fetch and streamed body waits without awaiting uncooperative cancellation', async () => {
  let calls = 0;
  await rejects(
    () =>
      get(
        client(async () => {
          calls++;
          return new Promise(() => {});
        }),
        { ...options, timeoutMs: 5 },
      ),
    'TIMEOUT',
  );
  assert.equal(calls, 1);
  const body = controlled([], { hang: true, ignoreCancel: true });
  await rejects(
    () =>
      get(
        client(async () => body.response),
        { ...options, timeoutMs: 5 },
      ),
    'TIMEOUT',
  );
  assert.equal(body.reads, 1);
  assert.ok(body.cancels >= 1);
  assert.ok(body.releases >= 1);
});

test('cancellation during native body read cancels stream, releases its lock and ignores late response work', async () => {
  let cancelled = 0;
  const active = new AbortController(),
    body = new ReadableStream(
      {
        cancel() {
          cancelled++;
        },
      },
      { highWaterMark: 0 },
    );
  const response = new Response(body, {
    headers: { 'Content-Type': 'image/webp', 'Content-Length': '24' },
  });
  const pending = get(
    client(async () => response),
    { ...options, signal: active.signal },
  );
  await new Promise((resolve) => setImmediate(resolve));
  active.abort();
  await rejects(() => pending, 'CANCELLED');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
  assert.equal(body.locked, false);
  const late = controlled([webp()]),
    second = new AbortController();
  let finish;
  const ignored = get(
    client(
      async () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    ),
    { ...options, signal: second.signal },
  );
  second.abort();
  await rejects(() => ignored, 'CANCELLED');
  finish(late.response);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(late.reads, 0);
  assert.ok(late.cancels >= 1);
});

test('an endless resolved stream of empty chunks cannot starve the overall deadline', async () => {
  let reads = 0,
    cancels = 0;
  const response = controlled([]).response;
  response.body.getReader = () => ({
    read() {
      reads++;
      return Promise.resolve({ done: false, value: new Uint8Array() });
    },
    cancel() {
      cancels++;
      return Promise.resolve();
    },
    releaseLock() {},
  });
  await rejects(
    () =>
      get(
        client(async () => response),
        { ...options, timeoutMs: 5 },
      ),
    'TIMEOUT',
  );
  assert.ok(reads > 0);
  assert.ok(cancels >= 1);
});

test('transport and mid-body failures remain safe read errors with no uncertain-write flag or retry', async () => {
  for (const thrown of [
    new Error('private token'),
    new ApiClientError('HTTP', 'private token', { submissionUncertain: true, status: 503 }),
  ]) {
    let calls = 0;
    await assert.rejects(
      () =>
        get(
          client(async () => {
            calls++;
            throw thrown;
          }),
        ),
      (error) =>
        error.kind === 'NETWORK' && !error.submissionUncertain && !error.message.includes('token'),
    );
    assert.equal(calls, 1);
  }
  const stream = controlled([], { readError: true });
  await assert.rejects(
    () => get(client(async () => stream.response)),
    (error) =>
      error.kind === 'NETWORK' && !error.submissionUncertain && !error.message.includes('SQL'),
  );
  assert.equal(stream.reads, 1);
  assert.ok(stream.cancels >= 1);
});

test('completion removes cancellation work and preserves HTTPS and explicit loopback-only HTTP policy', async () => {
  const active = new AbortController(),
    stream = controlled([webp()]);
  await get(
    client(async () => stream.response),
    { ...options, signal: active.signal },
  );
  const cancels = stream.cancels;
  active.abort();
  assert.equal(stream.cancels, cancels);
  for (const baseUrl of [
    'http://preview.example.invalid',
    'http://127.0.0.1:4000',
    'https://user:secret@preview.example.invalid',
    'https://preview.example.invalid/path',
    'https://preview.example.invalid?token=secret',
  ])
    assert.throws(
      () => client(async () => success(), { baseUrl }),
      (error) => error.kind === 'CONFIGURATION' && !error.submissionUncertain,
    );
  let called;
  await get(
    client(
      async (url) => {
        called = url;
        return success();
      },
      { baseUrl: 'http://127.0.0.1:4000', allowLoopbackHttp: true },
    ),
  );
  assert.equal(called, PATH.replace(ORIGIN, 'http://127.0.0.1:4000'));
});
