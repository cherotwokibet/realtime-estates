import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { renameSync } from 'node:fs';
import { lstat, mkdtemp, readFile, readdir, rename, rmdir, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { createLocalSyntheticStore, LocalStoreError } from '../dist/local-store.js';

// Original synthetic bytes only. Paths below are TRUSTED test fault-injection tools;
// the adapter never returns or accepts an object path. No recursive cleanup is used.
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const hasCode = code => error => error instanceof LocalStoreError && error.code === code;
const INPUT_CAP = 10 * 1024 * 1024;

async function exists(location) { try { await lstat(location); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
async function* chunks(...values) { yield* values; }

async function cleanTestRoot(parent, root) {
  assert.equal(path.dirname(root), parent);
  assert.ok(path.basename(root).startsWith('realtor-synthetic-'));
  if (!await exists(root)) return;
  assert.ok((await lstat(root)).isDirectory());
  for (const child of ['quarantine', 'output']) {
    const directory = path.join(root, child);
    if (!await exists(directory)) continue;
    assert.ok((await lstat(directory)).isDirectory());
    assert.equal((await lstat(directory)).isSymbolicLink(), false);
    for (const name of await readdir(directory)) {
      const file = path.join(directory, name);
      assert.ok((await lstat(file)).isFile() || (await lstat(file)).isSymbolicLink());
      await unlink(file);
    }
    await rmdir(directory);
  }
  for (const name of await readdir(root)) {
    assert.equal(name, 'injected-unknown.txt');
    await unlink(path.join(root, name));
  }
  await rmdir(root);
}

async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'realtor-store-test-'));
  const store = await createLocalSyntheticStore(parent);
  const roots = await readdir(parent);
  assert.equal(roots.length, 1);
  const root = path.join(parent, roots[0]);
  t.after(async () => {
    await store.dispose().catch(() => undefined);
    await cleanTestRoot(parent, root);
    await rmdir(parent);
  });
  return { parent, root, quarantine: path.join(root, 'quarantine'), output: path.join(root, 'output'), store };
}

async function timely(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Synthetic cancellation test did not settle')), 3000); })]);
  } finally { clearTimeout(timer); }
}

function blockingProducer() {
  let started;
  let rejectLate;
  let release;
  let calls = 0;
  let returns = 0;
  const waiting = new Promise(resolve => { started = resolve; });
  const nextResult = new Promise((resolve, reject) => { release = resolve; rejectLate = reject; });
  const source = {
    [Symbol.asyncIterator]() { return this; },
    next() {
      if (++calls === 1) return Promise.resolve({ done: false, value: Buffer.from('synthetic input') });
      started();
      return nextResult;
    },
    return() { returns++; return new Promise(() => {}); }, // Deliberately noncooperative.
  };
  return { source, waiting, release: () => release({ done: true }), rejectLate: () => rejectLate(new Error('late producer rejection')), get calls() { return calls; }, get returns() { return returns; } };
}

test('generated owned root, opaque handle and actual stream receipt preserve only the yielded view', async t => {
  const f = await fixture(t);
  const backing = Buffer.from('prefix-original synthetic payload-suffix');
  const view = new Uint8Array(backing.buffer, backing.byteOffset + 7, 26);
  const expected = Buffer.from(view);
  const receipt = await f.store.ingest(chunks(view.subarray(0, 7), view.subarray(7)));
  assert.equal(receipt.kind, 'quarantine');
  assert.equal(receipt.bytes, expected.length);
  assert.equal(receipt.sha256, digest(expected));
  assert.deepEqual(await f.store.read(receipt.handle), expected);
  assert.deepEqual(Object.keys(receipt).sort(), ['bytes', 'handle', 'kind', 'sha256']);
  assert.deepEqual(Object.keys(receipt.handle), []);
  assert.ok(Object.isFrozen(receipt) && Object.isFrozen(receipt.handle));
  assert.deepEqual(await readdir(f.output), []);
  const names = await readdir(f.quarantine);
  assert.equal(names.length, 1);
  assert.match(names[0], /^[0-9a-f-]{36}\.input$/);
  assert.ok(!JSON.stringify(receipt).includes(f.parent));
});

test('actual streamed10MiB limit stops at the first excess chunk and removes the partial file', async t => {
  const f = await fixture(t);
  const block = Buffer.alloc(1024 * 1024, 37);
  let yielded = 0, finalized = false;
  async function* oversized() {
    try { for (let count = 0; count < 20; count++) { yielded++; yield block; } }
    finally { finalized = true; }
  }
  await assert.rejects(f.store.ingest(oversized()), hasCode('INPUT_TOO_LARGE'));
  assert.equal(yielded, 11);
  assert.equal(finalized, true);
  assert.deepEqual(await readdir(f.quarantine), []);
  const exact = await f.store.ingest(chunks(...Array(10).fill(block)));
  assert.equal(exact.bytes, INPUT_CAP);
  assert.equal(exact.sha256, digest(Buffer.alloc(INPUT_CAP, 37)));
});

test('invalid, empty and SharedArrayBuffer chunks never become stored objects', async t => {
  const f = await fixture(t);
  for (const bad of ['not bytes', new Uint16Array([1, 2]), new Uint8Array(0), new Uint8Array(new SharedArrayBuffer(4))]) {
    let returned = false;
    async function* input() { try { yield bad; } finally { returned = true; } }
    await assert.rejects(f.store.ingest(input()), hasCode('INVALID_CHUNK'));
    assert.equal(returned, true);
    assert.deepEqual(await readdir(f.quarantine), []);
  }
  await assert.rejects(f.store.ingest(chunks()), hasCode('EMPTY_INPUT'));
  const foreign = vm.runInNewContext('new Uint8Array([8, 9, 10])');
  const receipt = await f.store.ingest(chunks(foreign));
  assert.deepEqual(await f.store.read(receipt.handle), Buffer.from([8, 9, 10]));
});

test('per-chunk snapshots keep written bytes and digest paired when the producer reuses its view', async t => {
  const f = await fixture(t);
  const view = Buffer.alloc(128 * 1024, 31);
  const expected = Buffer.from(view);
  let mutation;
  async function* input() {
    mutation = new Promise(resolve => { setImmediate(() => { view.fill(222); resolve(); }); });
    yield view;
  }
  const receipt = await f.store.ingest(input());
  await mutation;
  assert.equal(view[0], 222);
  assert.equal(receipt.sha256, digest(expected));
  assert.deepEqual(await f.store.read(receipt.handle), expected);
});

test('abort races a pending next(), asks cancellation once and consumes late producer rejection', async t => {
  const f = await fixture(t);
  const producer = blockingProducer();
  const controller = new AbortController();
  const ingestion = f.store.ingest(producer.source, { signal: controller.signal });
  await producer.waiting;
  controller.abort();
  await timely(assert.rejects(ingestion, hasCode('ABORTED')));
  assert.equal(producer.returns, 1);
  assert.equal(producer.calls, 2);
  producer.rejectLate();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await readdir(f.quarantine), []);
  const next = await f.store.ingest(chunks(Buffer.from('usable after cancellation')));
  assert.equal(next.bytes, 25);
});

test('producer failure and pre-aborted input close/delete partial work and release admission', async t => {
  const f = await fixture(t);
  async function* broken() { yield Buffer.from('partial'); throw new Error('independent synthetic source failure'); }
  await assert.rejects(f.store.ingest(broken()), hasCode('IO_FAILURE'));
  assert.deepEqual(await readdir(f.quarantine), []);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.store.ingest(chunks(Buffer.from('never read')), { signal: controller.signal }), hasCode('ABORTED'));
  assert.deepEqual(await readdir(f.quarantine), []);
  const receipt = await f.store.publish(Buffer.from('next operation'));
  assert.deepEqual(await f.store.read(receipt.handle), Buffer.from('next operation'));
});

test('bounded admission rejects extra operations and queued publication snapshots immediately', async t => {
  const f = await fixture(t);
  const producer = blockingProducer();
  const ingestion = f.store.ingest(producer.source);
  await producer.waiting;
  const output = Buffer.from('original synthetic output');
  const expected = Buffer.from(output);
  const publication = f.store.publish(output);
  output.fill(0);
  await assert.rejects(f.store.publish(Buffer.from('third queued write')), hasCode('BUSY'));
  await assert.rejects(f.store.read(Object.freeze({})), hasCode('BUSY'));
  assert.deepEqual(await readdir(f.output), []);
  producer.release();
  const [inputReceipt, outputReceipt] = await Promise.all([ingestion, publication]);
  assert.equal(inputReceipt.kind, 'quarantine');
  assert.equal(outputReceipt.sha256, digest(expected));
  assert.deepEqual(await f.store.read(outputReceipt.handle), expected);
  const next = await f.store.publish(Buffer.from('admission released'));
  assert.equal(next.kind, 'output');
});

test('outputs are generated exclusive objects rather than overwriteable keys', async t => {
  const f = await fixture(t);
  const original = Buffer.from('original synthetic output');
  const first = await f.store.publish(original);
  original.fill(0);
  const second = await f.store.publish(Buffer.from('original synthetic output'));
  assert.notEqual(first.handle, second.handle);
  assert.equal(first.sha256, second.sha256);
  const names = await readdir(f.output);
  assert.equal(names.length, 2);
  assert.notEqual(names[0], names[1]);
  for (const name of names) assert.match(name, /^[0-9a-f-]{36}\.output$/);
  assert.deepEqual(await f.store.read(first.handle), Buffer.from('original synthetic output'));
  await assert.rejects(f.store.publish(Buffer.alloc(INPUT_CAP + 1)), hasCode('OUTPUT_TOO_LARGE'));
  await assert.rejects(f.store.publish(Buffer.from(new SharedArrayBuffer(4))), hasCode('INVALID_CHUNK'));
  assert.equal((await readdir(f.output)).length, 2);
});

test('forged, serialized, cross-store and disposed handles are not object capabilities', async t => {
  const a = await fixture(t), b = await fixture(t);
  const receipt = await a.store.ingest(chunks(Buffer.from('owned by A')));
  await assert.rejects(a.store.read(Object.freeze({})), hasCode('INVALID_HANDLE'));
  await assert.rejects(a.store.read(JSON.parse(JSON.stringify(receipt.handle))), hasCode('INVALID_HANDLE'));
  await assert.rejects(b.store.read(receipt.handle), hasCode('INVALID_HANDLE'));
  await a.store.dispose();
  await assert.rejects(a.store.read(receipt.handle), hasCode('DISPOSED'));
  await assert.rejects(a.store.publish(Buffer.from('closed')), hasCode('DISPOSED'));
  await assert.rejects(a.store.ingest(chunks(Buffer.from('closed'))), hasCode('DISPOSED'));
});

test('same-length altered and truncated stored bytes fail actual SHA/length revalidation', async t => {
  const f = await fixture(t);
  const one = await f.store.ingest(chunks(Buffer.from('original payload')));
  const [firstName] = await readdir(f.quarantine);
  await writeFile(path.join(f.quarantine, firstName), Buffer.from('changed! payload'));
  await assert.rejects(f.store.read(one.handle), hasCode('INTEGRITY'));
  const two = await f.store.publish(Buffer.from('synthetic output bytes'));
  const [secondName] = await readdir(f.output);
  await writeFile(path.join(f.output, secondName), Buffer.from('short'));
  await assert.rejects(f.store.read(two.handle), hasCode('INTEGRITY'));
});

test('dispose cancels blocked ingestion, rejects queued writes, and preserves the supplied parent', async t => {
  const f = await fixture(t);
  const producer = blockingProducer();
  const ingestion = f.store.ingest(producer.source);
  await producer.waiting;
  const queued = f.store.publish(Buffer.from('must not be written'));
  const disposed = f.store.dispose();
  assert.equal(f.store.dispose(), disposed);
  await timely(Promise.all([assert.rejects(ingestion, hasCode('ABORTED')), assert.rejects(queued, hasCode('DISPOSED')), disposed]));
  assert.equal(producer.returns, 1);
  producer.rejectLate();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(await exists(f.root), false);
  assert.equal((await lstat(f.parent)).isDirectory(), true);
  assert.deepEqual(await readdir(f.parent), []);
});

test('file creation failure still requests producer cancellation', async t => {
  const f = await fixture(t);
  const held = path.join(f.root, 'quarantine-held');
  let returns = 0;
  const source = {
    [Symbol.asyncIterator]() { renameSync(f.quarantine, held); return this; },
    next() { return Promise.resolve({ done: false, value: Buffer.from('not written') }); },
    return() { returns++; return Promise.resolve({ done: true }); },
  };
  try { await assert.rejects(f.store.ingest(source), hasCode('IO_FAILURE')); }
  finally { renameSync(held, f.quarantine); }
  assert.equal(returns, 1);
  assert.deepEqual(await readdir(f.quarantine), []);
});

test('unknown entries prevent cleanup rather than deleting an unexpected tree', async t => {
  const f = await fixture(t);
  const receipt = await f.store.publish(Buffer.from('known owned bytes'));
  const unknown = path.join(f.root, 'injected-unknown.txt');
  await writeFile(unknown, 'synthetic unknown sentinel');
  await assert.rejects(f.store.dispose(), hasCode('INTEGRITY'));
  assert.equal(await readFile(unknown, 'utf8'), 'synthetic unknown sentinel');
  assert.equal((await readdir(f.output)).length, 1);
  assert.equal(receipt.bytes, 17);
});

test('substituted symlink or Windows junction fails closed and leaves outside bytes untouched', async t => {
  const f = await fixture(t);
  const outside = await mkdtemp(path.join(os.tmpdir(), 'realtor-outside-test-'));
  const sentinel = path.join(outside, 'outside-sentinel.txt');
  const held = path.join(f.root, 'quarantine-held');
  await writeFile(sentinel, 'outside must survive');
  await rename(f.quarantine, held);
  let linked = false;
  try {
    try { await symlink(outside, f.quarantine, process.platform === 'win32' ? 'junction' : 'dir'); linked = true; }
    catch (error) { if (error.code === 'EPERM' || error.code === 'EACCES') { t.skip('Host cannot create a test directory link; no link proof claimed'); return; } throw error; }
    await assert.rejects(f.store.publish(Buffer.from('must not traverse')), hasCode('INTEGRITY'));
    await assert.rejects(f.store.dispose(), hasCode('INTEGRITY'));
    assert.equal(await readFile(sentinel, 'utf8'), 'outside must survive');
    assert.deepEqual(await readdir(outside), ['outside-sentinel.txt']);
  } finally {
    if (linked) await unlink(f.quarantine);
    await rename(held, f.quarantine);
    await unlink(sentinel);
    await rmdir(outside);
  }
});

test('relative and non-directory parents are refused without creating a root', async () => {
  await assert.rejects(createLocalSyntheticStore('relative/path'), hasCode('INVALID_PARENT'));
  const parent = await mkdtemp(path.join(os.tmpdir(), 'realtor-parent-test-'));
  const file = path.join(parent, 'file.txt');
  try {
    await writeFile(file, 'not a directory');
    await assert.rejects(createLocalSyntheticStore(file), hasCode('INVALID_PARENT'));
    assert.deepEqual(await readdir(parent), ['file.txt']);
  } finally { await unlink(file); await rmdir(parent); }
});
