import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import {
  createDevelopmentMediaPreviewApi as createDraftApi,
  createDevelopmentReviewMediaPreviewApi,
  createDevelopmentMediaPreviewPair,
} from '../dist/media-preview.js';

// Boundary doubles only: these bytes prove header/hash/identity handling, not
// decoding, SQL policy, native termination or real storage correctness.
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TENANT = id(1),
  ACTOR = id(11),
  LISTING = id(100),
  MEDIA = id(200),
  OP = id(300),
  JOB = id(400),
  INPUT = id(500),
  OUTPUT = id(600),
  GEN = id(700),
  CLAIM = id(800),
  NONCE = id(900),
  REQUEST_STORE = id(1000),
  OUTPUT_STORE = id(1001),
  OTHER = id(1100);
const token = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.signature';
const route = `http://127.0.0.1/v2/staff/reviews/${LISTING}/1/media/${MEDIA}/preview`;
const TIME = '2026-10-12T01:02:03.123456Z',
  EXPIRY = '2026-10-13T01:02:03.123456Z',
  INPUT_HASH = 'b'.repeat(64),
  SQL_MANIFEST_HASH = 'd'.repeat(64);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
function bytes() {
  const value = Buffer.alloc(24);
  value.write('RIFF', 0);
  value.writeUInt32LE(value.length - 8, 4);
  value.write('WEBP', 8);
  value.write('VP8L', 12);
  value.writeUInt32LE(4, 16);
  value.set([1, 2, 3, 4], 20);
  return value;
}
function facts() {
  const context = {
    jobId: JOB,
    quarantineId: INPUT,
    outputId: OUTPUT,
    expiresAt: EXPIRY,
    pipeline: 'synthetic-codec-v1',
  };
  const capture = {
    jobId: JOB,
    generationId: GEN,
    inputBytes: 100,
    inputSha256: INPUT_HASH,
    capturedAt: TIME,
  };
  const lease = {
    jobId: JOB,
    claimId: CLAIM,
    attempt: 1,
    leaseNonce: NONCE,
    leaseExpiresAt: TIME,
    quarantineId: INPUT,
    outputId: OUTPUT,
    input: { generationId: GEN, bytes: 100, sha256: INPUT_HASH },
    pipeline: 'synthetic-codec-v1',
  };
  const manifest = {
    pipeline: 'synthetic-codec-v1',
    sourceFormat: 'png',
    inputSha256: INPUT_HASH,
    inputBytes: 100,
    format: 'webp',
    mimeType: 'image/webp',
    sha256: digest(bytes()),
    width: 1,
    height: 1,
    bytes: 24,
    encoder: { sharp: '0.35.5', vips: '8.18.7' },
    operations: [
      'auto-orient',
      'resize-inside-1920-without-enlargement',
      'strip-metadata',
      'webp-quality-82-effort-4',
    ],
  };
  const verified = {
    jobId: JOB,
    attempt: 1,
    leaseNonce: NONCE,
    outputId: OUTPUT,
    manifestSha256: SQL_MANIFEST_HASH,
    manifest,
    verifiedAt: TIME,
    outcome: 'verified',
  };
  return {
    kind: 'review_media_preview',
    tenantId: TENANT,
    listingId: LISTING,
    revision: 1,
    version: '3',
    state: 'pending',
    mediaId: MEDIA,
    operationId: OP,
    assignedAgentId: OTHER,
    actorRole: 'admin',
    context,
    capture,
    lease,
    verified,
  };
}
function requestRecord(value = facts()) {
  return {
    version: 1,
    requestStoreId: REQUEST_STORE,
    jobId: JOB,
    claimId: CLAIM,
    generationId: GEN,
    workerId: id(1200),
    journalId: id(1201),
    reservationId: id(1202),
    inputStoreId: OUTPUT_STORE,
    context: value.context,
    input: value.lease.input,
  };
}
function sealRecord(value = facts()) {
  return {
    version: 1,
    requestStoreId: REQUEST_STORE,
    jobId: JOB,
    claimId: CLAIM,
    generationId: GEN,
    lease: value.lease,
    outputStoreId: OUTPUT_STORE,
    output: { objectId: OUTPUT, generationId: NONCE, bytes: 24, sha256: digest(bytes()) },
    seal: { attempt: 1, leaseNonce: NONCE, manifest: value.verified.manifest },
  };
}
function outputRecord(data = bytes()) {
  return {
    receipt: {
      version: 1,
      storeId: OUTPUT_STORE,
      jobId: JOB,
      objectId: OUTPUT,
      generationId: NONCE,
      kind: 'output',
      bytes: data.length,
      sha256: digest(data),
    },
    data,
  };
}
const sqlError = (code) => Object.assign(new Error('PRIVATE SQL DETAIL'), { code });
function fixture({
  reads = [facts(), facts()],
  original = requestRecord(),
  sealed = sealRecord(),
  output = outputRecord(),
  verifyError,
  onRequest,
  onSeal,
  onOutput,
  prototypeDatabase = false,
} = {}) {
  const calls = {
    verify: 0,
    reads: 0,
    requests: 0,
    seals: 0,
    outputs: 0,
    closed: 0,
    sql: [],
    order: [],
    transactionActive: false,
  };
  const databaseCall = async (context, run) => {
    assert.equal(context.tenantId, TENANT);
    assert.equal(context.actorId, ACTOR);
    assert.match(context.correlationId, /^[a-f0-9-]{36}$/);
    calls.transactionActive = true;
    try {
      return await run({
        async query(sql, args) {
          calls.sql.push({ sql, args });
          calls.order.push('sql');
          const value = reads[Math.min(calls.reads++, reads.length - 1)];
          if (value instanceof Error) throw value;
          return { rows: [{ receipt: value }] };
        },
      });
    } finally {
      calls.transactionActive = false;
    }
  };
  class PrototypeDatabase {
    transaction(context, run) {
      return databaseCall(context, run);
    }
  }
  const options = {
    tenant: { tenantId: TENANT, slug: 'synthetic', hostnames: ['127.0.0.1'] },
    database: prototypeDatabase ? new PrototypeDatabase() : { transaction: databaseCall },
    verifyBearer: async (value) => {
      calls.order.push('verify');
      calls.verify++;
      assert.equal(value, token);
      if (verifyError) throw verifyError;
      return { actorId: ACTOR };
    },
    processingRequests: {
      requestStoreId: REQUEST_STORE,
      async read(binding) {
        calls.order.push('request');
        calls.requests++;
        assert.equal(calls.transactionActive, false);
        assert.deepEqual(binding, { jobId: JOB, claimId: CLAIM, generationId: GEN });
        await onRequest?.();
        if (original instanceof Error) throw original;
        return original;
      },
      async readSeal(binding) {
        calls.order.push('seal');
        calls.seals++;
        assert.equal(calls.transactionActive, false);
        assert.deepEqual(binding, { jobId: JOB, claimId: CLAIM, generationId: GEN });
        await onSeal?.();
        if (sealed instanceof Error) throw sealed;
        return sealed;
      },
      close: async () => {
        calls.closed++;
      },
    },
    outputStore: {
      storeId: OUTPUT_STORE,
      async read(reference) {
        calls.order.push('output');
        calls.outputs++;
        assert.equal(calls.transactionActive, false);
        assert.deepEqual(reference, {
          jobId: JOB,
          objectId: OUTPUT,
          generationId: NONCE,
          kind: 'output',
        });
        await onOutput?.();
        if (output instanceof Error) throw output;
        return output;
      },
      close: async () => {
        calls.closed++;
      },
    },
  };
  const api = createDevelopmentReviewMediaPreviewApi(options);
  const request = (url = route, extra = {}, method = 'GET', signal) =>
    new Request(url, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'X-Revision-Version': '3', ...extra },
      ...(signal ? { signal } : {}),
    });
  return { api, calls, request, options };
}
async function safeFailure(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('content-type'), 'application/json');
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.match(body.requestId, /^[a-f0-9-]{36}$/);
  assert.deepEqual(Object.keys(body).sort(), ['error', 'requestId']);
  const source = JSON.stringify(body);
  for (const hidden of ['PRIVATE', JOB, CLAIM, NONCE, OUTPUT_STORE, SQL_MANIFEST_HASH])
    assert.equal(source.includes(hidden), false);
}

test('review consumer pins reviewer SQL and validates trusted bytes between two current authorizations', async () => {
  const f = fixture();
  try {
    const r = await f.api.handle(f.request());
    assert.equal(r.status, 200);
    assert.deepEqual(Buffer.from(await r.arrayBuffer()), bytes());
    assert.deepEqual(f.calls.order, ['verify', 'sql', 'request', 'seal', 'output', 'sql']);
    assert.ok(
      f.calls.sql.every(
        (q) =>
          q.sql ===
          'SELECT app_api.read_review_media_preview($1::uuid,$2::integer,$3::uuid,$4::bigint) AS receipt',
      ),
    );
    assert.ok(
      f.calls.sql.every((q) => JSON.stringify(q.args) === JSON.stringify([LISTING, 1, MEDIA, '3'])),
    );
    assert.equal(r.headers.get('content-type'), 'image/webp');
    assert.match(r.headers.get('cache-control'), /private/);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await f.api.close();
  }
});
test('draft kind, nonpending state and assigned agent role never enter reviewer storage IO', async () => {
  for (const patch of [
    { kind: 'private_media_preview' },
    { state: 'draft' },
    { state: 'approved' },
    { state: 'rejected' },
    { actorRole: 'agent', assignedAgentId: ACTOR },
    { actorRole: 'customer' },
  ]) {
    const f = fixture({ reads: [{ ...facts(), ...patch }] });
    try {
      await safeFailure(await f.api.handle(f.request()), 503, 'SERVICE_UNAVAILABLE');
      assert.equal(f.calls.outputs, 0);
      assert.equal(f.calls.requests, 0);
      assert.equal(f.calls.seals, 0);
    } finally {
      await f.api.close();
    }
  }
});
test('current reviewer SQL denial occurs before IO and is sanitized', async () => {
  for (const [code, status, name] of [
    ['P0002', 404, 'NOT_FOUND'],
    ['42501', 404, 'NOT_FOUND'],
    ['40001', 409, 'VERSION_CONFLICT'],
  ]) {
    const f = fixture({ reads: [sqlError(code)] });
    try {
      await safeFailure(await f.api.handle(f.request()), status, name);
      assert.equal(f.calls.outputs, 0);
      assert.equal(f.calls.requests, 0);
    } finally {
      await f.api.close();
    }
  }
});
test('review decision access loss or version change after IO emits no image', async () => {
  for (const value of [
    sqlError('P0002'),
    sqlError('42501'),
    sqlError('40001'),
    { ...facts(), state: 'approved' },
    { ...facts(), actorRole: 'agent' },
    { ...facts(), version: '4' },
  ]) {
    const f = fixture({ reads: [facts(), value] });
    try {
      const r = await f.api.handle(f.request());
      assert.notEqual(r.status, 200);
      assert.equal(r.headers.get('content-type'), 'application/json');
      assert.equal(f.calls.reads, 2);
      assert.equal(f.calls.outputs, 1);
    } finally {
      await f.api.close();
    }
  }
});
test('reviewer association or sealed provenance fingerprint cannot change across IO', async () => {
  for (const patch of [
    { assignedAgentId: id(1101) },
    { operationId: id(301) },
    { verified: { ...facts().verified, manifestSha256: 'e'.repeat(64) } },
    { capture: { ...facts().capture, capturedAt: '2026-10-12T01:02:04.123456Z' } },
  ]) {
    const f = fixture({ reads: [facts(), { ...facts(), ...patch }] });
    try {
      await safeFailure(await f.api.handle(f.request()), 503, 'SERVICE_UNAVAILABLE');
      assert.equal(f.calls.outputs, 1);
    } finally {
      await f.api.close();
    }
  }
});
test('review and draft factories reject each others routes and caller policy options', async () => {
  const f = fixture(),
    draft = createDraftApi(f.options);
  try {
    const draftRoute = `http://127.0.0.1/v2/staff/listings/${LISTING}/revisions/1/media/${MEDIA}/preview`;
    assert.equal((await f.api.handle(f.request(draftRoute))).status, 404);
    assert.equal((await draft.handle(f.request())).status, 404);
    assert.equal(f.calls.verify, 0);
    assert.throws(() => createDraftApi({ ...f.options, policy: 'review' }));
    assert.throws(() => createDevelopmentReviewMediaPreviewApi({ ...f.options, policy: 'draft' }));
  } finally {
    await f.api.close();
    await draft.close();
  }
});
test('review consumer rejects mismatched output bytes and bad authentication without alternate reads', async () => {
  const bad = fixture({ output: outputRecord(Buffer.from('invalid')) });
  try {
    await safeFailure(await bad.api.handle(bad.request()), 503, 'SERVICE_UNAVAILABLE');
    assert.equal(bad.calls.reads, 1);
  } finally {
    await bad.api.close();
  }
  const f = fixture({ verifyError: Error('PRIVATE') });
  try {
    await safeFailure(await f.api.handle(f.request()), 401, 'UNAUTHENTICATED');
    assert.equal(f.calls.reads, 0);
    assert.equal(f.calls.outputs, 0);
  } finally {
    await f.api.close();
  }
});

test('native pair shares one active and one queued output across draft and review, then drains both', async () => {
  let release, entered;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const started = new Promise((resolve) => {
    entered = resolve;
  });
  let outputCalls = 0;
  const f = fixture({
    onOutput: async () => {
      if (++outputCalls === 1) {
        entered();
        await gate;
      }
    },
  });
  const options = {
    ...f.options,
    database: {
      async transaction(context, run) {
        assert.equal(context.actorId, ACTOR);
        return run({
          async query(sql) {
            const review = sql.includes('read_review_media_preview');
            assert.ok(review || sql.includes('read_private_media_preview'));
            return {
              rows: [
                {
                  receipt: {
                    ...facts(),
                    kind: review ? 'review_media_preview' : 'private_media_preview',
                    state: review ? 'pending' : 'draft',
                  },
                },
              ],
            };
          },
        });
      },
    },
  };
  const pair = createDevelopmentMediaPreviewPair(options);
  const draftRoute = `http://127.0.0.1/v2/staff/listings/${LISTING}/revisions/1/media/${MEDIA}/preview`;
  try {
    const first = pair.handle(f.request(draftRoute));
    await started;
    const second = pair.handle(f.request());
    // Await the third request: both preceding authorizations have already queued their reads.
    await safeFailure(await pair.handle(f.request()), 503, 'SERVICE_UNAVAILABLE');
    assert.equal(outputCalls, 1);
    let drained = false;
    const closing = pair.close().then(() => {
      drained = true;
    });
    await Promise.resolve();
    assert.equal(drained, false);
    await safeFailure(await pair.handle(f.request()), 503, 'SERVICE_UNAVAILABLE');
    await safeFailure(await pair.handle(f.request(draftRoute)), 503, 'SERVICE_UNAVAILABLE');
    release();
    assert.equal((await first).status, 200);
    assert.equal((await second).status, 200);
    await closing;
    assert.equal(outputCalls, 2);
    assert.equal(f.calls.closed, 0);
  } finally {
    release();
    await pair.close();
    await f.api.close();
  }
});

test('review route admits canonical multi-digit revisions before exact SQL authorization', async () => {
  const f = fixture({ reads: [sqlError('P0002')] });
  try {
    await safeFailure(
      await f.api.handle(f.request(route.replace('/1/media/', '/12/media/'))),
      404,
      'NOT_FOUND',
    );
    assert.equal(f.calls.verify, 1);
    assert.equal(f.calls.sql[0].args[1], 12);
    assert.equal(f.calls.outputs, 0);
  } finally {
    await f.api.close();
  }
});

test('verified identity expiry metadata is accepted without permitting extra authority fields', async () => {
  const f = fixture();
  let api;
  try {
    api = createDevelopmentReviewMediaPreviewApi({
      ...f.options,
      verifyBearer: async () => ({ actorId: ACTOR, expiresAt: Date.now() + 60000 }),
    });
    assert.equal((await api.handle(f.request())).status, 200);
  } finally {
    await api?.close();
    await f.api.close();
  }
  for (const value of [0, Date.now() - 1, NaN, Date.now() + 0.5]) {
    const f = fixture(),
      api = createDevelopmentReviewMediaPreviewApi({
        ...f.options,
        verifyBearer: async () => ({ actorId: ACTOR, expiresAt: value }),
      });
    try {
      await safeFailure(await api.handle(f.request()), 401, 'UNAUTHENTICATED');
      assert.equal(f.calls.reads, 0);
      assert.equal(f.calls.outputs, 0);
    } finally {
      await api.close();
      await f.api.close();
    }
  }
  const g = fixture(),
    bad = createDevelopmentReviewMediaPreviewApi({
      ...g.options,
      verifyBearer: async () => ({ actorId: ACTOR, expiresAt: Date.now() + 60000, role: 'admin' }),
    });
  try {
    await safeFailure(await bad.handle(g.request()), 401, 'UNAUTHENTICATED');
    assert.equal(g.calls.reads, 0);
  } finally {
    await bad.close();
    await g.api.close();
  }
});
test('credential expiration during media IO suppresses bytes without extending the verified deadline', async (t) => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  const expiry = now + 1000;
  const f = fixture({
      onOutput: () => {
        now = expiry;
      },
    }),
    api = createDevelopmentReviewMediaPreviewApi({
      ...f.options,
      verifyBearer: async () => ({ actorId: ACTOR, expiresAt: expiry }),
    });
  try {
    await safeFailure(await api.handle(f.request()), 401, 'UNAUTHENTICATED');
    assert.equal(f.calls.outputs, 1);
    assert.equal(f.calls.reads, 1);
  } finally {
    await api.close();
    await f.api.close();
  }
});
