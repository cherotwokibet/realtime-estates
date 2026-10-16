import test from 'node:test';
import assert from 'node:assert/strict';
import { ApiClientError, RealtorApiClient } from '../dist/index.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ID = id(100),
  OP = id(500),
  OTHER = id(700),
  MEDIA = id(800),
  A = id(801),
  B = id(802),
  options = { bearerToken: 'synthetic-staff' };
const removal = { operationId: OP, mediaId: MEDIA, expectedVersion: '2' },
  ordering = { operationId: OP, orderedIds: [B, A], expectedVersion: '2' };
const receipt = (patch = {}) => ({
  kind: 'remove_media',
  operationId: OP,
  listingId: ID,
  revision: 2,
  expectedVersion: '2',
  version: '3',
  outcome: 'applied',
  reason: null,
  mediaId: MEDIA,
  orderedIds: [A, B],
  completedAt: '2020-01-01T00:00:00.000Z',
  ...patch,
});
const reordered = (patch = {}) =>
  receipt({ kind: 'reorder_media', mediaId: null, orderedIds: [B, A], ...patch });
const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });
const raw = (value) => new Response(value, { headers: { 'Content-Type': 'application/json' } });
const client = (fetch) =>
  new RealtorApiClient({
    baseUrl: 'https://gallery.example.invalid',
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
const commands = [
  ['removeDraftMediaV2', removal, receipt],
  ['reorderDraftMediaV2', ordering, reordered],
];

test('gallery commands and history require per-call bearer; public requests retain no credentials', async () => {
  const calls = [],
    api = client(async (url, init) => {
      calls.push({ url, init });
      return json(
        url.includes('/v1/properties')
          ? { items: [], limit: 50 }
          : url.endsWith('media-reorders')
            ? reordered()
            : receipt(),
      );
    });
  for (const opts of [{}, undefined, { bearerToken: '' }, { bearerToken: 'bad\r\nheader' }]) {
    for (const [method, input] of commands)
      await reject(() => api[method](ID, 2, input, opts), 'VALIDATION');
    await reject(() => api.getMediaOperationV2(ID, 2, OP, opts), 'VALIDATION');
  }
  assert.equal(calls.length, 0);
  await api.removeDraftMediaV2(ID, 2, removal, { bearerToken: 'one' });
  await api.reorderDraftMediaV2(ID, 2, ordering, { bearerToken: 'two' });
  await api.getMediaOperationV2(ID, 2, OP, { bearerToken: 'three' });
  await api.listProperties();
  assert.deepEqual(
    calls.map((call) => call.init.headers.Authorization),
    ['Bearer one', 'Bearer two', 'Bearer three', undefined],
  );
});
test('gallery sends exact original command, URL tuple and no idempotency header', async () => {
  for (const [method, input, result] of commands) {
    let seen;
    const value = await client(async (url, init) => {
      seen = { url, init };
      return json(result());
    })[method](ID.toUpperCase(), 2, input, options);
    assert.deepEqual(value, result());
    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(value.orderedIds));
    assert.equal(
      seen.url,
      `https://gallery.example.invalid/v2/staff/listings/${ID}/revisions/2/${method === 'removeDraftMediaV2' ? 'media-removals' : 'media-reorders'}`,
    );
    assert.equal(seen.init.method, 'POST');
    assert.equal(seen.init.credentials, 'omit');
    assert.equal(seen.init.redirect, 'error');
    assert.equal(seen.init.cache, 'no-store');
    assert.equal(seen.init.headers['Idempotency-Key'], undefined);
    assert.deepEqual(JSON.parse(seen.init.body), { ...input, expectedVersion: 2 });
  }
});
test('gallery snapshots original own input and dense order before transport', async () => {
  for (const [method, input, result] of commands) {
    const mutable = {
        ...input,
        ...(input.orderedIds ? { orderedIds: [...input.orderedIds] } : {}),
      },
      bodies = [],
      api = client(async (_, init) => {
        bodies.push(init.body);
        mutable.expectedVersion = '3';
        if (mutable.orderedIds) mutable.orderedIds.reverse();
        else mutable.mediaId = OTHER;
        return json(result());
      });
    assert.deepEqual(await api[method](ID, 2, mutable, options), result());
    assert.deepEqual(await api[method](ID, 2, input, options), result());
    assert.equal(bodies[0], bodies[1]);
  }
  let calls = 0,
    getters = 0;
  const api = client(async () => {
    calls++;
    return json(receipt());
  });
  for (const [method, input] of commands) {
    const accessor = { ...input };
    Object.defineProperty(accessor, 'expectedVersion', {
      enumerable: true,
      get() {
        getters++;
        return '2';
      },
    });
    const hidden = { ...input };
    Object.defineProperty(hidden, 'private', { value: true });
    for (const value of [
      accessor,
      hidden,
      { ...input, [Symbol('private')]: true },
      Object.assign(Object.create({ private: true }), input),
    ])
      await reject(() => api[method](ID, 2, value, options), 'VALIDATION');
  }
  const getterOrder = [B, A];
  Object.defineProperty(getterOrder, '0', {
    enumerable: true,
    get() {
      getters++;
      return B;
    },
  });
  const hiddenOrder = [B, A];
  Object.defineProperty(hiddenOrder, 'private', { value: true });
  const symbolicOrder = [B, A];
  symbolicOrder[Symbol('private')] = true;
  const inheritedOrder = [B, A];
  Object.setPrototypeOf(inheritedOrder, Object.create(Array.prototype));
  for (const orderedIds of [getterOrder, hiddenOrder, symbolicOrder, inheritedOrder, new Array(2)])
    await reject(
      () => api.reorderDraftMediaV2(ID, 2, { ...ordering, orderedIds }, options),
      'VALIDATION',
    );
  assert.equal(calls, 0);
  assert.equal(getters, 0);
});
test('gallery validates exact fields, UUIDs and canonical incrementable decimal version', async () => {
  let calls = 0;
  const api = client(async (_, init) => {
    calls++;
    const body = JSON.parse(init.body);
    return json(
      receipt({
        expectedVersion: String(body.expectedVersion),
        version: String(BigInt(body.expectedVersion) + 1n),
      }),
    );
  });
  for (const [method, input] of commands) {
    for (const patch of [
      { operationId: 'bad' },
      { expectedVersion: 2 },
      { expectedVersion: '02' },
      { expectedVersion: '0' },
      { expectedVersion: '2e0' },
      { expectedVersion: ' 2' },
      { expectedVersion: '9007199254740991' },
      { expectedVersion: '9223372036854775807' },
      ...[
        'tenantId',
        'actorId',
        'manifest',
        'storageKey',
        'accepted',
        'version',
        'receipt',
        'position',
        'jobId',
      ].map((key) => ({ [key]: 'forged' })),
    ])
      await reject(() => api[method](ID, 2, { ...input, ...patch }, options), 'VALIDATION');
    for (const key of Object.keys(input)) {
      const missing = { ...input };
      delete missing[key];
      await reject(() => api[method](ID, 2, missing, options), 'VALIDATION');
    }
    for (const [listing, revision] of [
      ['bad', 2],
      [ID, 0],
      [ID, 1.5],
      [ID, 2147483648],
    ])
      await reject(() => api[method](listing, revision, input, options), 'VALIDATION');
  }
  await reject(
    () => api.removeDraftMediaV2(ID, 2, { ...removal, mediaId: 'bad' }, options),
    'VALIDATION',
  );
  await reject(() => api.getMediaOperationV2(ID, 2, 'bad', options), 'VALIDATION');
  assert.equal(calls, 0);
  assert.equal(
    (
      await api.removeDraftMediaV2(
        ID,
        2,
        { ...removal, expectedVersion: '9007199254740990' },
        options,
      )
    ).version,
    '9007199254740991',
  );
});
test('gallery rejects malformed full order before transport and supports canonical empty reorder noop', async () => {
  let calls = 0;
  const api = client(async () => {
    calls++;
    return json(reordered({ orderedIds: [], outcome: 'noop', version: '2' }));
  });
  for (const orderedIds of [
    null,
    {},
    ['bad'],
    [A, A],
    [A, null],
    [[A]],
    Array.from({ length: 13 }, (_, n) => id(900 + n)),
  ])
    await reject(
      () => api.reorderDraftMediaV2(ID, 2, { ...ordering, orderedIds }, options),
      'VALIDATION',
    );
  assert.equal(calls, 0);
  assert.deepEqual(
    await api.reorderDraftMediaV2(ID, 2, { ...ordering, orderedIds: [] }, options),
    reordered({ orderedIds: [], outcome: 'noop', version: '2' }),
  );
  assert.equal(calls, 1);
});
test('gallery GET binds exact history URL and accepts historical result without current version adoption', async () => {
  let seen;
  const api = client(async (url, init) => {
      seen = { url, init };
      return json(receipt());
    }),
    value = await api.getMediaOperationV2(ID, 2, OP, options);
  assert.deepEqual(value, receipt());
  assert.equal(
    seen.url,
    `https://gallery.example.invalid/v2/staff/listings/${ID}/revisions/2/media-operations/${OP}`,
  );
  assert.equal(seen.init.method, 'GET');
  assert.equal(seen.init.body, undefined);
  for (const key of [
    'tenantId',
    'requesterId',
    'manifest',
    'storageKey',
    'sha256',
    'jobId',
    'accepted',
  ])
    assert.equal(key in value, false);
  for (const patch of [{ operationId: OTHER }, { listingId: OTHER }, { revision: 3 }])
    await reject(
      () => client(async () => json(receipt(patch))).getMediaOperationV2(ID, 2, OP, options),
      'INVALID_RESPONSE',
    );
});
test('gallery mutation receipts bind original kind, target, expected version and full requested order', async () => {
  for (const value of [
    receipt({ kind: 'reorder_media', mediaId: null }),
    receipt({ mediaId: A }),
    receipt({ expectedVersion: '3', version: '4' }),
  ])
    await reject(
      () => client(async () => json(value)).removeDraftMediaV2(ID, 2, removal, options),
      'INVALID_RESPONSE',
      true,
    );
  for (const value of [
    receipt(),
    reordered({ orderedIds: [A, B] }),
    reordered({ expectedVersion: '3', version: '4' }),
  ])
    await reject(
      () => client(async () => json(value)).reorderDraftMediaV2(ID, 2, ordering, options),
      'INVALID_RESPONSE',
      true,
    );
});
test('gallery terminal parser checks every field and correlated state, version, order and timestamp', async () => {
  const missing = receipt();
  delete missing.reason;
  const invalid = [
    missing,
    ...[
      { kind: 'attach_media' },
      { outcome: 'ready' },
      { version: '4' },
      { version: '03' },
      { version: '9007199254740992' },
      { expectedVersion: '9007199254740991' },
      { mediaId: null },
      { mediaId: 'bad' },
      { orderedIds: [A, A] },
      { orderedIds: [MEDIA, A] },
      { reason: 'VERSION_CONFLICT' },
      { outcome: 'noop', version: '2' },
      { outcome: 'conflict', reason: 'VERSION_CONFLICT', version: '2' },
      { outcome: 'rejected', reason: 'JOB_EXPIRED' },
      { outcome: 'rejected', reason: 'MEDIA_NOT_FOUND', version: '2', orderedIds: [MEDIA, A] },
      { completedAt: '2026-02-30T00:00:00.000Z' },
      { completedAt: '2020-01-01T00:00:00.000000Z' },
      { completedAt: null },
      { storageKey: 'PRIVATE' },
    ].map(receipt),
    reordered({ outcome: 'rejected', reason: 'MEDIA_NOT_FOUND' }),
  ];
  for (const value of invalid)
    await reject(
      () => client(async () => json(value)).getMediaOperationV2(ID, 2, OP, options),
      'INVALID_RESPONSE',
    );
  const valid = [
    reordered({ outcome: 'noop', version: '2' }),
    receipt({
      outcome: 'conflict',
      reason: 'VERSION_CONFLICT',
      version: '4',
      orderedIds: [MEDIA, A],
    }),
    ...['REVISION_NOT_DRAFT', 'MEDIA_NOT_FOUND', 'MEDIA_SET_CHANGED'].map((reason) =>
      receipt({
        outcome: 'rejected',
        reason,
        version: '2',
        orderedIds: reason === 'MEDIA_NOT_FOUND' ? [A, B] : [MEDIA, A],
      }),
    ),
  ];
  for (const value of valid)
    assert.deepEqual(
      await client(async () => json(value)).getMediaOperationV2(ID, 2, OP, options),
      value,
    );
});
test('gallery raw response checks duplicate decoded keys and original integer revision literals', async () => {
  const source = JSON.stringify(receipt());
  for (const value of [
    source.replace('"revision":2', '"revision":2,"revi\\u0073ion":2'),
    source.replace('"revision":2', '"revision":2.00000000000000001'),
    source.replace('"revision":2', '"revision":2e0'),
    source.replace('"version":"3"', '"version":"3","ver\\u0073ion":"3"'),
    source.replace('"orderedIds":', '"orderedIds":[],"orderedIds":'),
  ]) {
    await reject(
      () => client(async () => raw(value)).getMediaOperationV2(ID, 2, OP, options),
      'INVALID_RESPONSE',
    );
    await reject(
      () => client(async () => raw(value)).removeDraftMediaV2(ID, 2, removal, options),
      'INVALID_RESPONSE',
      true,
    );
  }
});
test('gallery typed durable conflicts return facts without retry or adopting later version', async () => {
  for (const [method, input, result] of commands) {
    let calls = 0;
    const value = result({
      outcome: 'conflict',
      reason: 'VERSION_CONFLICT',
      version: '4',
      ...(method === 'removeDraftMediaV2' ? { orderedIds: [MEDIA, A, B] } : {}),
    });
    const api = client(async () => {
      calls++;
      return json(value);
    });
    assert.deepEqual(await api[method](ID, 2, input, options), value);
    assert.deepEqual(await api[method](ID, 2, input, options), value);
    assert.equal(calls, 2);
  }
});
test('gallery safe definite HTTP failures cause no mutation retry', async () => {
  for (const [method, input] of commands)
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
              { error: { code, message: 'PRIVATE SQL DETAIL' }, requestId: OTHER },
              status,
            );
          })[method](ID, 2, input, options),
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
test('gallery uncertain writes stay single-attempt across loss, malformed success, redirect and timeout', async () => {
  for (const [method, input, result] of commands)
    for (const [transport, kind] of [
      [
        async () => {
          throw new Error('PRIVATE');
        },
        'NETWORK',
      ],
      [async () => json(result({ version: '4' })), 'INVALID_RESPONSE'],
      [async () => json(result(), 201), 'INVALID_RESPONSE'],
      [async () => new Response(null, { status: 302 }), 'REDIRECT'],
      [
        async () =>
          json(
            { error: { code: 'SERVICE_UNAVAILABLE', message: 'PRIVATE' }, requestId: OTHER },
            503,
          ),
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
          })[method](ID, 2, input, { ...options, timeoutMs: 20 }),
        kind,
        true,
      );
      assert.equal(calls, 1);
    }
  let calls = 0;
  await reject(
    () =>
      client(async () => {
        calls++;
        throw new Error('PRIVATE');
      }).getMediaOperationV2(ID, 2, OP, options),
    'NETWORK',
  );
  assert.equal(calls, 1);
});
test('gallery cancellation before admission sends nothing; after admission remains uncertain', async () => {
  for (const [method, input, result] of commands) {
    const before = new AbortController();
    before.abort();
    let calls = 0;
    await reject(
      () =>
        client(async () => {
          calls++;
          return json(result());
        })[method](ID, 2, input, { ...options, signal: before.signal }),
      'CANCELLED',
    );
    assert.equal(calls, 0);
    const during = new AbortController();
    await reject(
      () =>
        client(async () => {
          calls++;
          during.abort();
          return new Promise(() => {});
        })[method](ID, 2, input, { ...options, signal: during.signal }),
      'CANCELLED',
      true,
    );
    assert.equal(calls, 1);
  }
});
