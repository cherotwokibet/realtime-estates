import test from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { createDevelopmentMediaPreviewApi } from '../dist/media-preview.js';

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
const route = `http://127.0.0.1/v2/staff/listings/${LISTING}/revisions/1/media/${MEDIA}/preview`;
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
    kind: 'private_media_preview',
    tenantId: TENANT,
    listingId: LISTING,
    revision: 1,
    version: '3',
    state: 'draft',
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
  factory = createDevelopmentMediaPreviewApi,
  actor = ACTOR,
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
    assert.equal(context.actorId, actor);
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
  const api = factory(options);
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

export { fixture, facts, bytes, sqlError, id, TENANT, LISTING, MEDIA, JOB, OUTPUT };
