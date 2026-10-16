import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { lstat, mkdir, mkdtemp, readFile, readdir, rmdir, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDurableSyntheticStore, reopenDurableSyntheticStore } from '../dist/durable-store.js';
import { createSyntheticProcessingRequests } from '../dist/processing-request.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const code = (expected) => (error) => error?.code === expected;
const json = (value) => Buffer.from(JSON.stringify(value) + '\n');
const stamp = '2099-01-01T00:00:00.000000Z';
let sequence = 1;
// This file verifies durable command metadata only. Its synthetic hashes/lengths
// are not byte provenance, SQL acceptance or native process evidence.
async function exists(location) {
  try {
    return await lstat(location);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'realtor-processing-request-'));
  const store = await createDurableSyntheticStore(parent),
    stores = new Set([store]),
    controllers = new Set(),
    jobs = new Set();
  t.after(async () => {
    for (const controller of controllers) await controller.close();
    for (const opened of stores) await opened.close();
    const root = store.rootDirectory;
    assert.equal(path.dirname(root), parent);
    assert.deepEqual((await readdir(root)).sort(), ['objects', 'store.json']);
    const objects = path.join(root, 'objects'),
      s = await lstat(objects);
    assert.ok(s.isDirectory() && !s.isSymbolicLink());
    for (const jobId of await readdir(objects))
      assert.ok(jobs.has(jobId), `Unknown request job retained: ${jobId}`);
    for (const jobId of jobs) {
      const job = path.join(objects, jobId);
      if (!(await exists(job))) continue;
      const stat = await lstat(job);
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
      for (const kind of await readdir(job)) assert.ok(['quarantine', 'output'].includes(kind));
      for (const kind of ['quarantine', 'output']) {
        const directory = path.join(job, kind);
        if (!(await exists(directory))) continue;
        const ds = await lstat(directory);
        assert.ok(ds.isDirectory() && !ds.isSymbolicLink());
        for (const name of await readdir(directory)) {
          assert.ok(['data.bin', 'receipt.json'].includes(name));
          const file = path.join(directory, name),
            fs = await lstat(file);
          assert.ok(fs.isFile() && !fs.isSymbolicLink() && fs.nlink === 1);
          await unlink(file);
        }
        await rmdir(directory);
      }
      await rmdir(job);
    }
    await rmdir(objects);
    const marker = path.join(root, 'store.json'),
      ms = await lstat(marker);
    assert.ok(ms.isFile() && !ms.isSymbolicLink() && ms.nlink === 1);
    await unlink(marker);
    await rmdir(root);
    assert.deepEqual(await readdir(parent), []);
    await rmdir(parent);
  });
  function input() {
    const n = sequence++,
      jobId = id(n),
      generationId = id(10000 + n);
    jobs.add(jobId);
    return {
      jobId,
      claimId: id(20000 + n),
      generationId,
      workerId: id(30000 + n),
      journalId: id(40000 + n),
      reservationId: id(50000 + n),
      inputStoreId: id(60000 + n),
      context: {
        jobId,
        quarantineId: id(70000 + n),
        outputId: id(80000 + n),
        expiresAt: stamp,
        pipeline: 'synthetic-codec-v1',
      },
      input: { generationId, bytes: 64, sha256: 'c'.repeat(64) },
    };
  }
  async function open(supplied) {
    const opened =
      supplied ?? (await reopenDurableSyntheticStore(store.rootDirectory, store.storeId));
    stores.add(opened);
    const controller = await createSyntheticProcessingRequests({ store: opened });
    controllers.add(controller);
    return controller;
  }
  const binding = (value) => ({
    jobId: value.jobId,
    claimId: value.claimId,
    generationId: value.generationId,
  });
  function seal(value) {
    const leaseNonce = id(90000 + sequence++),
      lease = {
        jobId: value.jobId,
        claimId: value.claimId,
        attempt: 1,
        leaseNonce,
        leaseExpiresAt: stamp,
        quarantineId: value.context.quarantineId,
        outputId: value.context.outputId,
        input: { ...value.input },
        pipeline: 'synthetic-codec-v1',
      };
    const manifest = {
      pipeline: 'synthetic-codec-v1',
      sourceFormat: 'png',
      inputSha256: value.input.sha256,
      inputBytes: value.input.bytes,
      format: 'webp',
      mimeType: 'image/webp',
      sha256: 'd'.repeat(64),
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
    return {
      lease,
      outputStoreId: value.inputStoreId,
      output: {
        objectId: value.context.outputId,
        generationId: leaseNonce,
        bytes: 42,
        sha256: manifest.sha256,
      },
      seal: { attempt: 1, leaseNonce, manifest },
    };
  }
  return { parent, store, jobs, input, binding, seal, open };
}

test('request intent persists original input/claim/worker identities before issuing one same-instance consumable ticket', async (t) => {
  const f = await fixture(t),
    controller = await f.open(),
    input = f.input(),
    reserved = await controller.reserve(input);
  assert.ok(
    Object.isFrozen(reserved) &&
      Object.isFrozen(reserved.ticket) &&
      Object.isFrozen(reserved.request) &&
      Object.isFrozen(reserved.request.input) &&
      Object.isFrozen(reserved.request.context),
  );
  assert.deepEqual(reserved.ticket, { kind: 'synthetic_processing' });
  assert.deepEqual(reserved.request, { version: 1, requestStoreId: f.store.storeId, ...input });
  assert.deepEqual(await controller.read(f.binding(input)), reserved.request);
  const bytes = await readFile(
    path.join(f.store.rootDirectory, 'objects', input.jobId, 'quarantine', 'data.bin'),
  );
  assert.deepEqual(bytes, json(reserved.request));
  assert.deepEqual(controller.consume(reserved.ticket), reserved.request);
  assert.throws(() => controller.consume(reserved.ticket), code('BLOCKED'));
  await assert.rejects(controller.reserve(input), code('BLOCKED'));
});

test('reopened exact request history never reconstructs a ticket, even with a changed claim or generation', async (t) => {
  const f = await fixture(t),
    first = await f.open(),
    input = f.input(),
    reserved = await first.reserve(input);
  await first.close();
  const reopened = await f.open(),
    historical = await reopened.read(f.binding(input));
  assert.deepEqual(historical, reserved.request);
  assert.equal(Object.hasOwn(historical, 'ticket'), false);
  for (const ticket of [
    reserved.ticket,
    { ...reserved.ticket },
    Object.freeze({ ...reserved.ticket }),
    Object.create(reserved.ticket),
    null,
  ])
    assert.throws(() => reopened.consume(ticket), code('INVALID_TICKET'));
  await assert.rejects(reopened.reserve(input), code('BLOCKED'));
  await assert.rejects(
    reopened.reserve({
      ...input,
      claimId: id(99991),
      generationId: id(99992),
      input: { ...input.input, generationId: id(99992) },
    }),
    (error) => ['BLOCKED', 'INTEGRITY'].includes(error?.code),
  );
  assert.deepEqual(await reopened.read(f.binding(input)), reserved.request);
});

test('independent request controllers reserve one permanent job only once and an empty reservation cannot be reused', async (t) => {
  const f = await fixture(t),
    one = await f.open(),
    two = await f.open(),
    input = f.input();
  const results = await Promise.allSettled([
    one.reserve(input),
    two.reserve({ ...input, claimId: id(99993) }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.ok(
    ['BLOCKED', 'INTEGRITY'].includes(
      results.find((result) => result.status === 'rejected').reason?.code,
    ),
  );
  const partial = f.input(),
    directory = path.join(f.store.rootDirectory, 'objects', partial.jobId);
  await mkdir(directory);
  await assert.rejects(one.reserve(partial), code('BLOCKED'));
  assert.deepEqual(await readdir(directory), []);
  await one.close();
  const reopened = await f.open();
  await assert.rejects(reopened.reserve(partial), code('BLOCKED'));
});

test('recorded seal binds the original full lease, output identity and manifest and exact retries preserve immutable facts', async (t) => {
  const f = await fixture(t),
    controller = await f.open(),
    input = f.input(),
    reserved = await controller.reserve(input);
  controller.consume(reserved.ticket);
  assert.equal(await controller.readSeal(f.binding(input)), null);
  const seal = f.seal(input),
    recorded = await controller.recordSeal(reserved.ticket, seal);
  assert.deepEqual(recorded, {
    version: 1,
    requestStoreId: f.store.storeId,
    ...f.binding(input),
    ...seal,
  });
  assert.ok(
    Object.isFrozen(recorded) &&
      Object.isFrozen(recorded.lease) &&
      Object.isFrozen(recorded.lease.input) &&
      Object.isFrozen(recorded.seal.manifest.operations),
  );
  assert.deepEqual(await controller.recordSeal(reserved.ticket, seal), recorded);
  await assert.rejects(
    controller.recordSeal(reserved.ticket, {
      ...seal,
      output: { ...seal.output, sha256: 'e'.repeat(64) },
    }),
    code('INVALID_INPUT'),
  );
  await assert.rejects(
    controller.recordSeal(reserved.ticket, {
      ...seal,
      lease: { ...seal.lease, leaseExpiresAt: '2099-01-02T00:00:00.000000Z' },
    }),
    code('BLOCKED'),
  );
  await controller.close();
  const reopened = await f.open();
  assert.deepEqual(await reopened.readSeal(f.binding(input)), recorded);
  await assert.rejects(reopened.recordSeal(reserved.ticket, seal), code('INVALID_TICKET'));
  assert.deepEqual(
    await readFile(path.join(f.store.rootDirectory, 'objects', input.jobId, 'output', 'data.bin')),
    json(recorded),
  );
});

test('strict request descriptors, exact identity relationships and snapshots reject getters and unknown fields before reservation', async (t) => {
  const f = await fixture(t),
    controller = await f.open(),
    input = f.input();
  let getters = 0;
  const accessor = { ...input };
  Object.defineProperty(accessor, 'claimId', {
    enumerable: true,
    get() {
      getters++;
      return input.claimId;
    },
  });
  for (const value of [
    null,
    [],
    { ...input, extra: true },
    { ...input, [Symbol('hidden')]: true },
    accessor,
    { ...input, jobId: '../outside' },
    { ...input, input: { ...input.input, generationId: id(99994) } },
    { ...input, context: { ...input.context, jobId: id(99995) } },
    { ...input, input: { ...input.input, bytes: 0 } },
    { ...input, input: { ...input.input, bytes: 10485761 } },
    { ...input, input: { ...input.input, sha256: 'x'.repeat(64) } },
  ])
    await assert.rejects(controller.reserve(value), code('INVALID_INPUT'));
  assert.equal(getters, 0);
  assert.deepEqual(await readdir(path.join(f.store.rootDirectory, 'objects')), []);
  const original = structuredClone(input),
    pending = controller.reserve(input);
  input.claimId = id(99996);
  input.input.sha256 = 'f'.repeat(64);
  input.context.outputId = id(99997);
  await assert.rejects(controller.read(f.binding(original)), code('BUSY'));
  const reserved = await pending;
  assert.deepEqual(reserved.request, { version: 1, requestStoreId: f.store.storeId, ...original });
  const closing = controller.close();
  await assert.rejects(controller.reserve(f.input()), code('CLOSED'));
  await closing;
  assert.throws(() => controller.consume(reserved.ticket), code('CLOSED'));
});

test('deliberately lost request persistence acknowledgements never issue replacement authority or rewrite a seal', async (t) => {
  const f = await fixture(t);
  for (const phase of ['quarantine', 'output']) {
    const real = await reopenDurableSyntheticStore(f.store.rootDirectory, f.store.storeId);
    let once = true;
    const wrapped = {
      ...real,
      async install(reference, bytes) {
        const actual = await real.install(reference, bytes);
        if (once && reference.kind === phase) {
          once = false;
          throw new Error('Simulated lost durable request acknowledgement');
        }
        return actual;
      },
    };
    const controller = await f.open(wrapped),
      input = f.input();
    if (phase === 'quarantine') {
      await assert.rejects(controller.reserve(input), code('PERSISTENCE_FAILED'));
      assert.deepEqual(await controller.read(f.binding(input)), {
        version: 1,
        requestStoreId: f.store.storeId,
        ...input,
      });
      await assert.rejects(controller.reserve(input), code('BLOCKED'));
    } else {
      const reserved = await controller.reserve(input);
      controller.consume(reserved.ticket);
      const seal = f.seal(input);
      await assert.rejects(
        controller.recordSeal(reserved.ticket, seal),
        code('PERSISTENCE_FAILED'),
      );
      const historical = await controller.readSeal(f.binding(input));
      assert.deepEqual(historical.seal, seal.seal);
      assert.deepEqual(await controller.recordSeal(reserved.ticket, seal), historical);
      await assert.rejects(
        controller.recordSeal(reserved.ticket, {
          ...seal,
          lease: { ...seal.lease, attempt: 2 },
          seal: { ...seal.seal, attempt: 2 },
        }),
        code('BLOCKED'),
      );
    }
    await controller.close();
    const reopened = await f.open();
    await assert.rejects(reopened.reserve(input), code('BLOCKED'));
    assert.equal(Object.hasOwn(await reopened.read(f.binding(input)), 'ticket'), false);
  }
});

test('an existing incomplete seal remains retained and blocked rather than being reported absent', async (t) => {
  const f = await fixture(t),
    controller = await f.open(),
    input = f.input(),
    reserved = await controller.reserve(input);
  controller.consume(reserved.ticket);
  const partial = path.join(f.store.rootDirectory, 'objects', input.jobId, 'output');
  await mkdir(partial);
  await assert.rejects(controller.readSeal(f.binding(input)), code('BLOCKED'));
  await assert.rejects(controller.recordSeal(reserved.ticket, f.seal(input)), code('BLOCKED'));
  assert.deepEqual(await readdir(partial), []);
  await controller.close();
  const reopened = await f.open();
  await assert.rejects(reopened.readSeal(f.binding(input)), code('BLOCKED'));
  assert.deepEqual(await readdir(partial), []);
});

test('valid generic storage receipts carrying noncanonical request bytes never confer command authority', async (t) => {
  const f = await fixture(t),
    cases = [];
  for (const mutate of [
    (bytes) => Buffer.from(' ' + bytes.toString('utf8')),
    (bytes) => Buffer.from(bytes.toString('utf8').trimEnd()),
    (bytes) =>
      Buffer.from(bytes.toString('utf8').replace('"version":1', '"version":1,"version":1')),
  ]) {
    const input = f.input(),
      request = { version: 1, requestStoreId: f.store.storeId, ...input },
      bytes = mutate(json(request));
    const reference = {
      jobId: input.jobId,
      objectId: input.claimId,
      generationId: input.generationId,
      kind: 'quarantine',
    };
    await f.store.install(reference, bytes);
    cases.push({ input, reference, bytes });
  }
  const controller = await f.open();
  for (const { input, reference, bytes } of cases) {
    assert.deepEqual((await f.store.read(reference)).data, bytes);
    await assert.rejects(controller.read(f.binding(input)), code('INTEGRITY'));
    await assert.rejects(controller.reserve(input), code('INTEGRITY'));
    assert.deepEqual((await f.store.read(reference)).data, bytes);
  }
});
