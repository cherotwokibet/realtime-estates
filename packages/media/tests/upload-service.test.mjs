import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  createSyntheticUploadService,
  SyntheticUploadServiceError,
} from '../dist/upload-service.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const resource = () => ({
  tenantId: id(1),
  actorId: id(11),
  listingId: id(100),
  revision: 1,
  jobId: id(200),
  uploadId: id(300),
});
const code = (expected) => (error) => error?.code === expected;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const stamp = '2026-10-11T01:02:03.123456Z';
const clone = (value) => structuredClone(value);
async function* chunks(bytes = Buffer.from('synthetic stream')) {
  yield bytes;
}
function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// All dependencies are narrow deterministic doubles. These tests establish
// orchestration ordering/authority only, never SQL/native/storage/HTTP evidence.
function fixture({ authorize, run, reconcile, reserve, read, consume, closeProcessor } = {}) {
  const calls = [],
    saved = new Map(),
    live = new WeakMap();
  let count = 0,
    requestCloses = 0,
    processorCreates = 0,
    processorCloses = 0;
  const requests = {
    requestStoreId: id(400),
    rootDirectory: 'synthetic-double-only',
    async reserve(input) {
      calls.push('reserve');
      if (reserve) return reserve(input);
      if (saved.has(input.jobId)) throw new Error('PRIVATE duplicate');
      const original = {
        version: 1,
        requestStoreId: id(400),
        uploadId: input.uploadId,
        tenantId: input.tenantId,
        actorId: input.actorId,
        listingId: input.listingId,
        revision: input.revision,
        jobId: input.jobId,
        claimId: id(500 + ++count),
        generationId: id(600 + count),
        input: { bytes: input.input.length, sha256: hash(input.input) },
      };
      saved.set(input.jobId, original);
      const ticket = { kind: 'synthetic_upload' };
      live.set(ticket, { original, used: false });
      return { ticket, request: original };
    },
    consume(ticket) {
      calls.push('consume');
      if (consume) return consume(ticket);
      const entry = live.get(ticket);
      assert.ok(entry && !entry.used);
      entry.used = true;
      return entry.original;
    },
    async read(binding) {
      calls.push('read');
      if (read) return read(binding);
      const original = saved.get(binding.jobId);
      if (!original || original.uploadId !== binding.uploadId) throw new Error('PRIVATE missing');
      return original;
    },
    async close() {
      requestCloses++;
    },
  };
  function processing(original) {
    const input = { generationId: original.generationId, ...original.input },
      context = {
        jobId: original.jobId,
        quarantineId: id(701),
        outputId: id(702),
        expiresAt: '2099-01-01T00:00:00.000000Z',
        pipeline: 'synthetic-codec-v1',
      };
    const request = {
      version: 1,
      requestStoreId: id(703),
      jobId: original.jobId,
      claimId: original.claimId,
      generationId: original.generationId,
      workerId: id(704),
      journalId: id(705),
      reservationId: id(706),
      inputStoreId: id(707),
      context,
      input,
    };
    const lease = {
      jobId: original.jobId,
      claimId: original.claimId,
      attempt: 1,
      leaseNonce: id(708),
      leaseExpiresAt: '2099-01-01T00:00:00.000000Z',
      quarantineId: context.quarantineId,
      outputId: context.outputId,
      input,
      pipeline: 'synthetic-codec-v1',
    };
    const manifest = {
      pipeline: 'synthetic-codec-v1',
      sourceFormat: 'png',
      inputSha256: input.sha256,
      inputBytes: input.bytes,
      format: 'webp',
      mimeType: 'image/webp',
      sha256: 'a'.repeat(64),
      width: 2,
      height: 2,
      bytes: 42,
      encoder: { sharp: '0.35.5', vips: '8.18.7' },
      operations: [
        'auto-orient',
        'resize-inside-1920-without-enlargement',
        'strip-metadata',
        'webp-quality-82-effort-4',
      ],
    };
    const receipt = {
      jobId: original.jobId,
      attempt: 1,
      leaseNonce: lease.leaseNonce,
      outputId: context.outputId,
      manifestSha256: 'b'.repeat(64),
      manifest,
      verifiedAt: stamp,
      outcome: 'verified',
    };
    return { request, lease, receipt };
  }
  const configuration = {
    requests,
    async authorize(value, purpose) {
      calls.push('authorize-' + purpose);
      await authorize?.(value, purpose);
    },
    async createProcessor() {
      calls.push('create');
      processorCreates++;
      return {
        async run(input, options) {
          calls.push('run');
          if (run) return run(input, options);
          const original = saved.get(input.jobId);
          assert.equal(hash(input.input), original.input.sha256);
          assert.deepEqual(
            [input.claimId, input.generationId],
            [original.claimId, original.generationId],
          );
          const proof = processing(original);
          return {
            state: 'verified',
            ...proof,
            outputRef: {
              jobId: original.jobId,
              objectId: proof.lease.outputId,
              generationId: proof.lease.leaseNonce,
              kind: 'output',
            },
            reconciled: [],
          };
        },
        async reconcile(binding) {
          calls.push('reconcile');
          if (reconcile) return reconcile(binding);
          const original = saved.get(binding.jobId);
          assert.deepEqual(binding, {
            jobId: original.jobId,
            claimId: original.claimId,
            generationId: original.generationId,
          });
          return { state: 'verified', ...processing(original) };
        },
        async close() {
          calls.push('processor-close');
          processorCloses++;
          await closeProcessor?.();
        },
      };
    },
  };
  const api = createSyntheticUploadService(configuration);
  return {
    api,
    calls,
    saved,
    configuration,
    requests,
    processing,
    counts: () => ({ requestCloses, processorCreates, processorCloses }),
  };
}

test('upload authorizes before source iteration, reauthorizes before admission and runs one exact original binding', async () => {
  const f = fixture(),
    original = resource(),
    source = {
      async *[Symbol.asyncIterator]() {
        f.calls.push('iterate');
        yield Buffer.from('synthetic current upload');
      },
    },
    result = await f.api.upload(original, source, { declaredBytes: 24 });
  assert.deepEqual(f.calls, [
    'authorize-new',
    'iterate',
    'authorize-new',
    'reserve',
    'consume',
    'create',
    'run',
    'processor-close',
  ]);
  assert.deepEqual(result, {
    uploadId: original.uploadId,
    jobId: original.jobId,
    listingId: original.listingId,
    revision: 1,
    state: 'verified',
  });
  assert.ok(Object.isFrozen(result));
  for (const word of [
    'tenantId',
    'actorId',
    'claimId',
    'generationId',
    'worker',
    'manifest',
    'storage',
    'context',
    'lease',
  ])
    assert.equal(JSON.stringify(result).includes(word), false, word);
  assert.equal(f.counts().requestCloses, 0);
});

test('current authorization denial never touches a source factory or admission and strips unknown private errors', async () => {
  for (const error of [
    new SyntheticUploadServiceError('NOT_AUTHORIZED'),
    new Error('PRIVATE authorization detail'),
  ]) {
    let touched = 0;
    const f = fixture({
        authorize: async () => {
          throw error;
        },
      }),
      source = {
        get [Symbol.asyncIterator]() {
          touched++;
          throw new Error('PRIVATE source');
        },
      };
    await assert.rejects(
      f.api.upload(resource(), source),
      (failure) =>
        failure.code ===
          (error instanceof SyntheticUploadServiceError ? 'NOT_AUTHORIZED' : 'BLOCKED') &&
        !failure.message.includes('PRIVATE'),
    );
    assert.equal(touched, 0);
    assert.deepEqual(f.calls, ['authorize-new']);
  }
});

test('revocation while bytes are collected blocks before permanent admission or processor creation', async () => {
  let current = true;
  const f = fixture({
    authorize: async () => {
      if (!current) throw new SyntheticUploadServiceError('NOT_AUTHORIZED');
    },
  });
  async function* source() {
    yield Buffer.from('synthetic revoked');
    current = false;
  }
  await assert.rejects(f.api.upload(resource(), source()), code('NOT_AUTHORIZED'));
  assert.deepEqual(f.calls, ['authorize-new', 'authorize-new']);
  assert.equal(f.saved.size, 0);
});

test('cancellation during the second authorization stops before permanent admission', async () => {
  const controller = new AbortController();
  let checks = 0;
  const f = fixture({
    authorize: async () => {
      if (++checks === 2) controller.abort();
    },
  });
  await assert.rejects(
    f.api.upload(resource(), chunks(), { signal: controller.signal }),
    code('ABORTED'),
  );
  assert.deepEqual(f.calls, ['authorize-new', 'authorize-new']);
  assert.equal(f.saved.size, 0);
});

test('resource and options values are strict frozen snapshots and getters/proxies never authorize', async () => {
  let checked;
  const wait = deferred(),
    f = fixture({
      authorize: async (value) => {
        checked = value;
        await wait.promise;
      },
    }),
    original = resource(),
    options = { declaredBytes: 1, timeoutMs: 2000 },
    pending = f.api.upload(original, chunks(Buffer.from([1])), options);
  original.actorId = id(99);
  original.uploadId = id(98);
  options.declaredBytes = 2;
  wait.resolve();
  const result = await pending;
  assert.equal(result.uploadId, id(300));
  assert.equal(checked.actorId, id(11));
  assert.ok(Object.isFrozen(checked));
  let touched = 0;
  const trap = resource();
  Object.defineProperty(trap, 'actorId', {
    enumerable: true,
    get() {
      touched++;
      return id(11);
    },
  });
  const settings = {};
  Object.defineProperty(settings, 'timeoutMs', {
    enumerable: true,
    get() {
      touched++;
      return 1000;
    },
  });
  for (const [value, opts] of [
    [trap, {}],
    [{ ...resource(), tenant: 'forged' }, {}],
    [{ ...resource(), revision: 1.5 }, {}],
    [{ ...resource(), jobId: 'bad' }, {}],
    [resource(), settings],
    [resource(), { tenantId: id(2) }],
    [resource(), { declaredBytes: 0 }],
    [resource(), { timeoutMs: 30001 }],
    [new Proxy(resource(), {}), {}],
  ]) {
    const clean = fixture();
    await assert.rejects(clean.api.upload(value, chunks(), opts), code('INVALID_INPUT'));
    assert.deepEqual(clean.calls, []);
  }
  assert.equal(touched, 0);
});

test('bounded body failures remain safe and never reserve a request or create a processor', async () => {
  const aborted = new AbortController();
  aborted.abort();
  for (const [source, options, expected] of [
    [chunks(Buffer.alloc(0)), {}, 'EMPTY_INPUT'],
    [chunks(Buffer.from([1])), { declaredBytes: 2 }, 'LENGTH_MISMATCH'],
    [chunks(Buffer.alloc(10485761)), {}, 'INPUT_TOO_LARGE'],
    [chunks(Buffer.from([1])), { signal: aborted.signal }, 'ABORTED'],
    [
      {
        [Symbol.asyncIterator]() {
          return { next: () => new Promise(() => {}) };
        },
      },
      { timeoutMs: 5 },
      'TIMED_OUT',
    ],
  ]) {
    const f = fixture();
    await assert.rejects(f.api.upload(resource(), source, options), code(expected));
    assert.deepEqual(f.calls, ['authorize-new']);
  }
});

test('one upload singleflight rejects another before iteration while authorized read remains available', async () => {
  const hold = deferred(),
    entered = deferred(),
    f = fixture({
      run: async () => {
        entered.resolve();
        await hold.promise;
        return {
          state: 'native_failed',
          outcome: {
            state: 'cancelled',
            termination: 'job_empty',
            exitCode: null,
            activeProcesses: 0,
            safeCode: 'CANCELLED',
          },
        };
      },
    }),
    pending = f.api.upload(resource(), chunks());
  await entered.promise;
  let touched = 0;
  await assert.rejects(
    f.api.upload(
      { ...resource(), jobId: id(201) },
      {
        get [Symbol.asyncIterator]() {
          touched++;
          return () => {};
        },
      },
    ),
    code('BUSY'),
  );
  assert.equal(touched, 0);
  assert.equal((await f.api.read(resource())).state, 'verified');
  hold.resolve();
  assert.equal((await pending).state, 'native_failed');
  assert.equal(f.calls.filter((value) => value === 'run').length, 1);
});

test('original verified status recovers through history-only reconciliation and repeated upload never runs again', async () => {
  const f = fixture(),
    original = resource();
  const discarded = await f.api.upload(original, chunks());
  assert.equal(discarded.state, 'verified');
  f.calls.length = 0;
  const recovery = await f.api.read(original);
  assert.deepEqual(recovery, discarded);
  assert.deepEqual(f.calls, [
    'authorize-history',
    'read',
    'create',
    'reconcile',
    'processor-close',
  ]);
  f.calls.length = 0;
  await assert.rejects(f.api.upload(original, chunks()), code('BLOCKED'));
  assert.deepEqual(f.calls, ['authorize-new', 'authorize-new', 'reserve']);
  assert.equal(f.counts().processorCreates, 2);
  const reopened = createSyntheticUploadService(f.configuration);
  assert.deepEqual(await reopened.read(original), discarded);
  assert.equal(f.calls.filter((value) => value === 'run').length, 0);
  await reopened.close();
});

test('history validates every original principal/resource/store field before creating a processor', async () => {
  const original = resource();
  for (const key of [
    'tenantId',
    'actorId',
    'listingId',
    'revision',
    'jobId',
    'uploadId',
    'requestStoreId',
  ]) {
    const f = fixture();
    await f.api.upload(original, chunks());
    const record = f.saved.get(original.jobId);
    record[key] = key === 'revision' ? 2 : id(999);
    f.calls.length = 0;
    await assert.rejects(f.api.read(original), code('BLOCKED'));
    assert.deepEqual(f.calls, ['authorize-history', 'read']);
  }
  const f = fixture({
    authorize: async (_value, purpose) => {
      if (purpose === 'history') throw new SyntheticUploadServiceError('NOT_AUTHORIZED');
    },
  });
  await f.api.upload(original, chunks());
  f.calls.length = 0;
  await assert.rejects(f.api.read(original), code('NOT_AUTHORIZED'));
  assert.deepEqual(f.calls, ['authorize-history']);
});

test('changed consumed binding or byte facts never create/run a processor', async () => {
  for (const patch of [
    { claimId: id(999) },
    { generationId: id(998) },
    { input: { bytes: 1, sha256: 'a'.repeat(64) } },
  ]) {
    let f;
    f = fixture({
      consume() {
        return { ...f.saved.get(id(200)), ...patch };
      },
    });
    await assert.rejects(f.api.upload(resource(), chunks()), code('BLOCKED'));
    assert.deepEqual(f.calls, ['authorize-new', 'authorize-new', 'reserve', 'consume']);
  }
});

test('unconfirmed or recorded processing readback stays descriptive and never launches native work', async () => {
  for (const state of ['blocked', 'processing']) {
    let f;
    f = fixture({
      reconcile: async (binding) => {
        const proof = f.processing(f.saved.get(binding.jobId));
        return state === 'blocked'
          ? { state, reason: 'UNCONFIRMED', request: proof.request }
          : { state, request: proof.request, lease: proof.lease };
      },
    });
    await f.api.upload(resource(), chunks());
    f.calls.length = 0;
    assert.equal((await f.api.read(resource())).state, state);
    assert.deepEqual(f.calls, [
      'authorize-history',
      'read',
      'create',
      'reconcile',
      'processor-close',
    ]);
  }
  const f = fixture({
    reconcile: async () => ({ state: 'blocked', reason: 'UNCONFIRMED', request: null }),
  });
  await f.api.upload(resource(), chunks());
  assert.equal((await f.api.read(resource())).state, 'blocked');
});

test('reconciliation rejects replacement claims/generations, altered input, wrong lease and forged verified projections', async () => {
  for (const mutate of [
    (value) => {
      value.request.claimId = id(999);
    },
    (value) => {
      value.request.generationId = id(999);
    },
    (value) => {
      value.request.input.sha256 = 'f'.repeat(64);
    },
    (value) => {
      value.lease.claimId = id(999);
    },
    (value) => {
      value.receipt.outputId = id(999);
    },
    (value) => {
      value.receipt.manifest.inputBytes = 999;
    },
    (value) => {
      value.receipt.verifiedAt = '2026-02-30T01:02:03.123456Z';
    },
    (value) => {
      value.state = 'unknown';
    },
    (value) => {
      value.context = 'PRIVATE';
    },
  ]) {
    let f;
    f = fixture({
      reconcile: async (binding) => {
        const result = { state: 'verified', ...clone(f.processing(f.saved.get(binding.jobId))) };
        mutate(result);
        return result;
      },
    });
    await f.api.upload(resource(), chunks());
    f.calls.length = 0;
    await assert.rejects(f.api.read(resource()), code('BLOCKED'));
    assert.equal(f.calls.includes('run'), false);
    assert.equal(f.calls.at(-1), 'processor-close');
  }
});

test('uncertain processing/close failures retain original admission for explicit readback and never retry', async () => {
  let failed = true;
  const f = fixture({
    run: async () => {
      throw new Error('PRIVATE commit/native uncertainty');
    },
    closeProcessor: async () => {
      if (failed) {
        failed = false;
        throw new Error('PRIVATE close uncertainty');
      }
    },
  });
  await assert.rejects(
    f.api.upload(resource(), chunks()),
    (error) => error.code === 'BLOCKED' && !error.message.includes('PRIVATE'),
  );
  assert.equal(f.calls.filter((value) => value === 'run').length, 1);
  assert.equal(f.counts().processorCloses, 1);
  assert.equal(f.saved.size, 1);
  assert.equal((await f.api.read(resource())).state, 'verified');
  assert.equal(f.calls.filter((value) => value === 'run').length, 1);
});

test('native failure projection requires confirmed empty work and cannot hide containment uncertainty', async () => {
  for (const outcome of [
    {
      state: 'failed',
      termination: 'job_empty',
      exitCode: 2,
      activeProcesses: 0,
      safeCode: 'FAILED',
    },
    {
      state: 'timed_out',
      termination: 'job_empty',
      exitCode: null,
      activeProcesses: 0,
      safeCode: 'TIMED_OUT',
    },
  ]) {
    const f = fixture({ run: async () => ({ state: 'native_failed', outcome }) });
    assert.equal((await f.api.upload(resource(), chunks())).state, 'native_failed');
  }
  for (const outcome of [
    {
      state: 'containment_unknown',
      termination: 'unconfirmed',
      cleanupAllowed: false,
      safeCode: 'PRIVATE',
    },
    {
      state: 'exited',
      termination: 'job_empty',
      exitCode: 0,
      activeProcesses: 0,
      safeCode: 'EXITED',
    },
    {
      state: 'failed',
      termination: 'job_empty',
      exitCode: 2,
      activeProcesses: 1,
      safeCode: 'FAILED',
    },
  ]) {
    const f = fixture({ run: async () => ({ state: 'native_failed', outcome }) });
    await assert.rejects(f.api.upload(resource(), chunks()), code('BLOCKED'));
    assert.equal(f.counts().processorCloses, 1);
  }
});

test('historical native failure readback binds the original request and lease without issuing a launch or accepting unknown containment', async () => {
  const mismatch = id(99999);
  const outcome = {
    state: 'cancelled',
    termination: 'job_empty',
    exitCode: null,
    activeProcesses: 0,
    safeCode: 'CANCELLED',
  };
  let mutate = (value) => value;
  const f = fixture({
    run: async () => ({ state: 'native_failed', outcome }),
    reconcile: async (binding) => {
      const proof = f.processing(f.saved.get(binding.jobId));
      return mutate(
        structuredClone({
          state: 'native_failed',
          request: proof.request,
          lease: proof.lease,
          outcome,
        }),
      );
    },
  });
  assert.equal((await f.api.upload(resource(), chunks())).state, 'native_failed');
  assert.equal((await f.api.read(resource())).state, 'native_failed');
  for (const change of [
    (value) => ({ ...value, request: { ...value.request, jobId: mismatch } }),
    (value) => ({ ...value, lease: { ...value.lease, claimId: mismatch } }),
    (value) => ({ ...value, outcome: { ...value.outcome, activeProcesses: 1 } }),
    (value) => ({
      ...value,
      outcome: {
        state: 'containment_unknown',
        termination: 'unconfirmed',
        cleanupAllowed: false,
        safeCode: 'UNKNOWN',
      },
    }),
    (value) => ({ ...value, outcome: { ...value.outcome, state: 'exited', exitCode: 0 } }),
    (value) => ({ ...value, permit: 'forged' }),
  ]) {
    mutate = change;
    await assert.rejects(f.api.read(resource()), code('BLOCKED'));
  }
  assert.equal(f.calls.filter((value) => value === 'run').length, 1);
  assert.equal(f.calls.filter((value) => value === 'reserve').length, 1);
});

test('adapter close drains admitted work, blocks new calls and leaves caller-owned requests open', async () => {
  const hold = deferred(),
    entered = deferred(),
    f = fixture({
      run: async () => {
        entered.resolve();
        await hold.promise;
        return {
          state: 'native_failed',
          outcome: {
            state: 'failed',
            termination: 'job_empty',
            exitCode: 1,
            activeProcesses: 0,
            safeCode: 'FAILED',
          },
        };
      },
    }),
    pending = f.api.upload(resource(), chunks());
  await entered.promise;
  let complete = false;
  const closing = f.api.close().then(() => {
    complete = true;
  });
  await Promise.resolve();
  assert.equal(complete, false);
  await assert.rejects(f.api.upload(resource(), chunks()), code('CLOSED'));
  await assert.rejects(f.api.read(resource()), code('CLOSED'));
  hold.resolve();
  await pending;
  await closing;
  assert.equal(f.counts().requestCloses, 0);
  assert.equal(f.counts().processorCloses, 1);
});

test('configuration snapshots only exact own data properties and refuses accessor traps', () => {
  const f = fixture();
  let touched = 0;
  const trapped = { ...f.configuration };
  Object.defineProperty(trapped, 'authorize', {
    enumerable: true,
    get() {
      touched++;
      return f.configuration.authorize;
    },
  });
  for (const value of [
    null,
    {},
    trapped,
    { ...f.configuration, coordinator: 'PRIVATE' },
    { ...f.configuration, authorize: null },
    { ...f.configuration, requests: { ...f.requests, owner: 'PRIVATE' } },
  ])
    assert.throws(() => createSyntheticUploadService(value), code('INVALID_CONFIGURATION'));
  assert.equal(touched, 0);
});
