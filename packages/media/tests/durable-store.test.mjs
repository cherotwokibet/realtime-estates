import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  lstat,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rmdir,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createDurableSyntheticStore,
  reopenDurableSyntheticStore,
  DurableStoreError,
} from '../dist/durable-store.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hasCode = (code) => (error) => error instanceof DurableStoreError && error.code === code;
const CAP = 10 * 1024 * 1024;
const writer = fileURLToPath(new URL('./fixtures/durable-store-writer.mjs', import.meta.url));
let sequence = 1;
async function exists(location) {
  try {
    return await lstat(location);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
const canonicalReceipt = (receipt) =>
  JSON.stringify({
    version: 1,
    storeId: receipt.storeId,
    jobId: receipt.jobId,
    objectId: receipt.objectId,
    generationId: receipt.generationId,
    kind: receipt.kind,
    bytes: receipt.bytes,
    sha256: receipt.sha256,
  }) + '\n';

// Cleanup is strictly test-owned, targeted and nonrecursive. It refuses any entry
// not explicitly anticipated below instead of traversing an unexpected tree.
async function cleanOwnedRoot(parent, root, jobs, rootFiles) {
  assert.equal(path.dirname(root), parent);
  assert.ok(path.basename(root).startsWith('realtor-durable-synthetic-'));
  const rootStat = await exists(root);
  if (!rootStat) return;
  assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink());
  const objects = path.join(root, 'objects');
  const objectStat = await exists(objects);
  if (objectStat) {
    assert.ok(objectStat.isDirectory() && !objectStat.isSymbolicLink());
    for (const actual of await readdir(objects))
      assert.ok(jobs.has(actual), `Unexpected owned-test job entry ${actual}`);
    for (const job of jobs) {
      const jobDirectory = path.join(objects, job);
      const jobStat = await exists(jobDirectory);
      if (!jobStat) continue;
      assert.ok(jobStat.isDirectory() && !jobStat.isSymbolicLink());
      for (const actual of await readdir(jobDirectory))
        assert.ok(['quarantine', 'output'].includes(actual));
      for (const kind of ['quarantine', 'output']) {
        const directory = path.join(jobDirectory, kind),
          stat = await exists(directory);
        if (!stat) continue;
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
        for (const actual of await readdir(directory))
          assert.ok(
            ['data.bin', 'receipt.json', 'injected-extra.txt', 'injected-empty'].includes(actual),
          );
        for (const name of ['data.bin', 'receipt.json', 'injected-extra.txt']) {
          const location = path.join(directory, name),
            entry = await exists(location);
          if (!entry) continue;
          assert.ok(entry.isFile() || entry.isSymbolicLink());
          await unlink(location);
        }
        const empty = path.join(directory, 'injected-empty');
        if (await exists(empty)) {
          assert.ok((await lstat(empty)).isDirectory() && !(await lstat(empty)).isSymbolicLink());
          assert.deepEqual(await readdir(empty), []);
          await rmdir(empty);
        }
        await rmdir(directory);
      }
      await rmdir(jobDirectory);
    }
    await rmdir(objects);
  }
  for (const actual of await readdir(root)) assert.ok(rootFiles.has(actual));
  for (const name of rootFiles) {
    const location = path.join(root, name),
      stat = await exists(location);
    if (!stat) continue;
    assert.ok(stat.isFile() || stat.isSymbolicLink());
    await unlink(location);
  }
  await rmdir(root);
}
async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'realtor-durable-test-'));
  const store = await createDurableSyntheticStore(parent);
  const root = store.rootDirectory;
  const stores = new Set([store]),
    jobs = new Set(),
    rootFiles = new Set(['store.json']);
  let retain = false;
  t.after(async () => {
    if (retain) return; // Never remove a root while an owned writer has unknown lifetime.
    for (const opened of stores) await opened.close();
    await cleanOwnedRoot(parent, root, jobs, rootFiles);
    assert.deepEqual(await readdir(parent), []);
    await rmdir(parent);
  });
  return {
    parent,
    root,
    store,
    jobs,
    rootFiles,
    ref(kind = 'quarantine') {
      const n = sequence++;
      const reference = {
        jobId: id(n),
        objectId: id(10000 + n),
        generationId: id(20000 + n),
        kind,
      };
      jobs.add(reference.jobId);
      return reference;
    },
    paths(reference) {
      const directory = path.join(root, 'objects', reference.jobId.toLowerCase(), reference.kind);
      return {
        directory,
        data: path.join(directory, 'data.bin'),
        receipt: path.join(directory, 'receipt.json'),
      };
    },
    async reopen() {
      const opened = await reopenDurableSyntheticStore(root, store.storeId);
      stores.add(opened);
      return opened;
    },
    retain() {
      retain = true;
    },
  };
}
async function seedDirectory(f, reference) {
  const paths = f.paths(reference);
  await mkdir(path.dirname(paths.directory), { recursive: false });
  await mkdir(paths.directory);
  return paths;
}

test('fresh instance reopening validates canonical marker/receipt and returns caller-owned byte copies', async (t) => {
  const f = await fixture(t),
    reference = f.ref(),
    source = Buffer.from('original synthetic retained bytes');
  assert.equal(
    await readFile(path.join(f.root, 'store.json'), 'utf8'),
    JSON.stringify({ version: 1, storeId: f.store.storeId }) + '\n',
  );
  const receipt = await f.store.install(reference, source);
  assert.deepEqual(receipt, {
    version: 1,
    storeId: f.store.storeId,
    ...reference,
    bytes: source.length,
    sha256: digest(source),
  });
  assert.ok(Object.isFrozen(receipt));
  assert.equal(await readFile(f.paths(reference).receipt, 'utf8'), canonicalReceipt(receipt));
  await f.store.close();
  const reopened = await f.reopen();
  const result = await reopened.read(reference);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.receipt));
  assert.deepEqual(result.receipt, receipt);
  assert.deepEqual(result.data, source);
  result.data.fill(0);
  assert.deepEqual((await reopened.read(reference)).data, source);
  assert.equal(reopened.rootDirectory, f.root);
  assert.equal(reopened.storeId, f.store.storeId);
});

test('same committed reference and bytes replay across instances while changed binding or bytes conflict', async (t) => {
  const f = await fixture(t),
    reference = f.ref('output'),
    source = Buffer.from('synthetic encoded substitute; no decoder involved');
  const original = await f.store.install(reference, source);
  const second = await f.reopen();
  assert.deepEqual(await second.install({ ...reference }, Buffer.from(source)), original);
  for (const changed of [
    { ...reference, objectId: id(80001) },
    { ...reference, generationId: id(80002) },
  ]) {
    await assert.rejects(second.install(changed, source), hasCode('CONFLICT'));
    await assert.rejects(second.read(changed), hasCode('CONFLICT'));
  }
  const altered = Buffer.from(source);
  altered[0] ^= 1;
  await assert.rejects(second.install(reference, altered), hasCode('CONFLICT'));
  assert.deepEqual((await second.read(reference)).data, source);
  assert.equal(await readFile(f.paths(reference).receipt, 'utf8'), canonicalReceipt(original));
});

test('actual new-process committed writer exits on controlled stop and a later instance recovers its receipt', async (t) => {
  const f = await fixture(t),
    reference = f.ref(),
    source = Buffer.from('synthetic bytes committed by a separate Node process');
  await f.store.close();
  const child = spawn(process.execPath, [writer], {
    cwd: path.dirname(writer),
    shell: false,
    windowsHide: true,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      ...(process.env.WINDIR ? { WINDIR: process.env.WINDIR } : {}),
      PATH: path.dirname(process.execPath),
      TEMP: os.tmpdir(),
      TMP: os.tmpdir(),
    },
  });
  child.stdin.on('error', () => undefined); // A premature child exit is reported by the bounded protocol/close promise.
  let ended = false,
    stdout = '',
    stderr = '',
    timer;
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      ended = true;
      resolve({ code, signal });
    });
  });
  const reported = new Promise((resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error('Trusted writer did not report committed receipt')),
      10000,
    );
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 4096) return reject(new Error('Writer protocol exceeded bound'));
      if (stdout.includes('\n')) {
        try {
          resolve(JSON.parse(stdout.trim()));
        } catch (error) {
          reject(error);
        }
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 4096) reject(new Error('Writer diagnostics exceeded bound'));
    });
    child.once('error', reject);
    closed.then((result) => {
      if (!stdout.includes('\n'))
        reject(new Error(`Writer stopped before receipt (${result.code})`));
    }, reject);
  });
  try {
    child.stdin.write(
      JSON.stringify({
        rootDirectory: f.root,
        storeId: f.store.storeId,
        reference,
        base64: source.toString('base64'),
      }) + '\n',
    );
    const message = await reported;
    clearTimeout(timer);
    assert.equal(message.state, 'committed');
    assert.equal(message.receipt.sha256, digest(source));
    assert.equal(message.receipt.jobId, reference.jobId);
    child.stdin.end('stop\n');
    const result = await Promise.race([
      closed,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Controlled writer stop timed out')), 5000);
      }),
    ]);
    clearTimeout(timer);
    assert.deepEqual(result, { code: 0, signal: null });
    assert.equal(stderr, '');
    const reopened = await f.reopen();
    assert.deepEqual((await reopened.read(reference)).receipt, message.receipt);
    assert.deepEqual((await reopened.read(reference)).data, source);
  } finally {
    clearTimeout(timer);
    if (!ended) {
      child.kill();
      const confirmed = await Promise.race([
        closed.then(
          () => true,
          () => false,
        ),
        new Promise((resolve) => setTimeout(() => resolve(false), 2000)),
      ]);
      if (!confirmed) f.retain();
    }
  }
});

test('manually seeded pre-data and pre-receipt crash points remain incomplete and are never repaired', async (t) => {
  const f = await fixture(t);
  for (const hasData of [false, true]) {
    const reference = f.ref(),
      paths = await seedDirectory(f, reference);
    if (hasData)
      await writeFile(paths.data, Buffer.from('manually seeded partial bytes'), { flag: 'wx' });
    const before = await readdir(paths.directory);
    await assert.rejects(f.store.read(reference), hasCode('INCOMPLETE'));
    await assert.rejects(
      f.store.install(reference, Buffer.from('replacement must not be written')),
      hasCode('INCOMPLETE'),
    );
    const reopened = await f.reopen();
    await assert.rejects(reopened.read(reference), hasCode('INCOMPLETE'));
    assert.deepEqual(await readdir(paths.directory), before);
    if (hasData) assert.equal(await readFile(paths.data, 'utf8'), 'manually seeded partial bytes');
    assert.equal(await exists(paths.receipt), null);
  }
});

test('malformed, noncanonical, duplicated or oversized receipts expose no bytes and stay unchanged', async (t) => {
  const f = await fixture(t),
    source = Buffer.from('synthetic receipt integrity payload');
  const mutations = [
    (text) => text.slice(0, -5),
    (text) => text.trimEnd(),
    (text) => ` ${text}`,
    (text) => text.replace('"version":1', '"version":1.0'),
    (text) => text.replace('"version":1', '"version":1,"version":1'),
    (text) => text.replace('"version":1', '"ver\\u0073ion":1'),
    (text) => JSON.stringify({ ...JSON.parse(text), extra: true }) + '\n',
    (text) => text.replace(/"bytes":([0-9]+)/, '"bytes":$1e0'),
    (text) => JSON.stringify({ ...JSON.parse(text), jobId: id(99998) }) + '\n',
    (text) => JSON.stringify({ ...JSON.parse(text), kind: 'output' }) + '\n',
    (text) => JSON.stringify({ ...JSON.parse(text), storeId: id(99997) }) + '\n',
    () => Buffer.from([0xff, 0xfe]),
    () => Buffer.alloc(1025, 32),
  ];
  for (const mutate of mutations) {
    const reference = f.ref(),
      receipt = await f.store.install(reference, source),
      paths = f.paths(reference),
      changed = mutate(canonicalReceipt(receipt));
    await writeFile(paths.receipt, changed);
    await assert.rejects(f.store.read(reference), hasCode('INTEGRITY'));
    await assert.rejects(f.store.install(reference, source), hasCode('INTEGRITY'));
    assert.deepEqual(
      await readFile(paths.receipt),
      Buffer.isBuffer(changed) ? changed : Buffer.from(changed),
    );
  }
});

test('missing data, actual payload tamper and unexpected object entries fail closed without cleanup', async (t) => {
  const f = await fixture(t),
    source = Buffer.from('synthetic byte identity');
  for (const mode of ['missing', 'same-length', 'truncated', 'extra-file', 'extra-directory']) {
    const reference = f.ref(),
      receipt = await f.store.install(reference, source),
      paths = f.paths(reference);
    if (mode === 'missing') await unlink(paths.data);
    if (mode === 'same-length') {
      const changed = Buffer.from(source);
      changed[0] ^= 1;
      await writeFile(paths.data, changed);
    }
    if (mode === 'truncated') await writeFile(paths.data, Buffer.from('short'));
    if (mode === 'extra-file')
      await writeFile(path.join(paths.directory, 'injected-extra.txt'), 'retain this sentinel', {
        flag: 'wx',
      });
    if (mode === 'extra-directory') await mkdir(path.join(paths.directory, 'injected-empty'));
    const before = (await readdir(paths.directory)).sort();
    await assert.rejects(f.store.read(reference), hasCode('INTEGRITY'));
    await assert.rejects(f.store.install(reference, source), hasCode('INTEGRITY'));
    assert.deepEqual((await readdir(paths.directory)).sort(), before);
    assert.equal(await readFile(paths.receipt, 'utf8'), canonicalReceipt(receipt));
  }
});

test('hard-linked payload or receipt is refused and the other owned link remains untouched', async (t) => {
  const f = await fixture(t),
    source = Buffer.from('synthetic hardlink sentinel');
  for (const field of ['data', 'receipt']) {
    const reference = f.ref();
    await f.store.install(reference, source);
    const paths = f.paths(reference);
    const outside = path.join(f.parent, `owned-${field}-link`);
    await link(paths[field], outside);
    try {
      assert.equal((await lstat(paths[field])).nlink, 2);
      const original = await readFile(outside);
      await assert.rejects(f.store.read(reference), hasCode('INTEGRITY'));
      await assert.rejects(f.store.install(reference, source), hasCode('INTEGRITY'));
      assert.deepEqual(await readFile(outside), original);
    } finally {
      await unlink(outside);
    }
  }
});

test('substituted objects directory symlink or Windows junction refuses traversal and preserves outside sentinel', async (t) => {
  const f = await fixture(t),
    reference = f.ref();
  await f.store.install(reference, Buffer.from('owned synthetic object'));
  const outside = await mkdtemp(path.join(os.tmpdir(), 'realtor-durable-outside-'));
  const sentinel = path.join(outside, 'outside-sentinel.txt'),
    objects = path.join(f.root, 'objects'),
    held = path.join(f.root, 'objects-held');
  await writeFile(sentinel, 'outside must remain untouched');
  await rename(objects, held);
  let linked = false;
  try {
    await symlink(outside, objects, process.platform === 'win32' ? 'junction' : 'dir');
    linked = true;
    await assert.rejects(f.store.read(reference), hasCode('INTEGRITY'));
    await assert.rejects(
      f.store.install(reference, Buffer.from('must not traverse')),
      hasCode('INTEGRITY'),
    );
    await assert.rejects(
      reopenDurableSyntheticStore(f.root, f.store.storeId),
      hasCode('INTEGRITY'),
    );
    assert.equal(await readFile(sentinel, 'utf8'), 'outside must remain untouched');
    assert.deepEqual(await readdir(outside), ['outside-sentinel.txt']);
  } finally {
    if (linked) await unlink(objects);
    await rename(held, objects);
    await unlink(sentinel);
    await rmdir(outside);
  }
});

test('wrong configured store identity, malformed marker and unexpected root entry refuse reopening', async (t) => {
  const f = await fixture(t),
    other = await fixture(t);
  await f.store.close();
  await assert.rejects(reopenDurableSyntheticStore(f.root, id(99999)), hasCode('INTEGRITY'));
  await assert.rejects(
    reopenDurableSyntheticStore(other.root, f.store.storeId),
    hasCode('INTEGRITY'),
  );
  await assert.rejects(
    reopenDurableSyntheticStore(f.root, 'not-a-uuid'),
    hasCode('INVALID_PARENT'),
  );
  const marker = path.join(f.root, 'store.json'),
    original = await readFile(marker);
  for (const changed of [
    Buffer.from('{'),
    Buffer.from(JSON.stringify({ storeId: f.store.storeId, version: 1 }) + '\n'),
    Buffer.alloc(257, 32),
  ]) {
    await writeFile(marker, changed);
    await assert.rejects(
      reopenDurableSyntheticStore(f.root, f.store.storeId),
      hasCode('INTEGRITY'),
    );
    assert.deepEqual(await readFile(marker), changed);
    await writeFile(marker, original);
  }
  f.rootFiles.add('injected-root.txt');
  await writeFile(path.join(f.root, 'injected-root.txt'), 'retain root sentinel');
  await assert.rejects(reopenDurableSyntheticStore(f.root, f.store.storeId), hasCode('INTEGRITY'));
  assert.equal(
    await readFile(path.join(f.root, 'injected-root.txt'), 'utf8'),
    'retain root sentinel',
  );
});

test('parent and reference bounds reject paths, unknown fields, accessors, symbols and shared memory', async (t) => {
  const f = await fixture(t),
    reference = f.ref(),
    source = Buffer.from('small synthetic payload');
  let getterCalls = 0;
  const accessor = { ...reference };
  Object.defineProperty(accessor, 'jobId', {
    enumerable: true,
    get() {
      getterCalls++;
      return reference.jobId;
    },
  });
  const symbol = { ...reference, [Symbol('hidden')]: true };
  for (const value of [
    null,
    [],
    reference.jobId,
    { ...reference, jobId: '../escape' },
    { ...reference, objectId: 'bad' },
    { ...reference, generationId: null },
    { ...reference, kind: 'public' },
    { ...reference, extra: true },
    accessor,
    symbol,
  ]) {
    await assert.rejects(f.store.install(value, source), hasCode('INVALID_REFERENCE'));
    await assert.rejects(f.store.read(value), hasCode('INVALID_REFERENCE'));
  }
  assert.equal(getterCalls, 0);
  for (const value of [
    'bytes',
    new Uint8Array([1, 2]),
    Buffer.from(new SharedArrayBuffer(4)),
    null,
  ])
    await assert.rejects(f.store.install(reference, value), hasCode('INVALID_BYTES'));
  await assert.rejects(f.store.install(reference, Buffer.alloc(0)), hasCode('EMPTY_INPUT'));
  await assert.rejects(
    f.store.install(reference, Buffer.allocUnsafe(CAP + 1)),
    hasCode('TOO_LARGE'),
  );
  assert.deepEqual(await readdir(path.join(f.root, 'objects')), []);
  await assert.rejects(createDurableSyntheticStore('relative-parent'), hasCode('INVALID_PARENT'));
  await assert.rejects(
    reopenDurableSyntheticStore('relative-root', f.store.storeId),
    hasCode('INVALID_PARENT'),
  );
  const file = path.join(f.parent, 'owned-parent-file');
  await writeFile(file, 'not a directory');
  try {
    await assert.rejects(createDurableSyntheticStore(file), hasCode('INVALID_PARENT'));
  } finally {
    await unlink(file);
  }
});

test('reference and input snapshots precede awaits; two admitted operations drain on close and new work is refused', async (t) => {
  const f = await fixture(t),
    first = f.ref(),
    second = f.ref('output'),
    third = f.ref(),
    source = Buffer.from('original snapshotted bytes');
  const expected = Buffer.from(source),
    originalFirst = { ...first };
  const one = f.store.install(first, source);
  source.fill(0);
  first.objectId = id(88888);
  first.generationId = id(88889);
  const two = f.store.install(second, Buffer.from('second already admitted'));
  await assert.rejects(
    f.store.install(third, Buffer.from('third must not be admitted')),
    hasCode('BUSY'),
  );
  const closing = f.store.close();
  await assert.rejects(f.store.install(third, Buffer.from('closed admission')), hasCode('CLOSED'));
  await assert.rejects(f.store.read(originalFirst), hasCode('CLOSED'));
  const [a, b] = await Promise.all([one, two]);
  await closing;
  await f.store.close();
  assert.equal(a.objectId, originalFirst.objectId);
  assert.equal(a.generationId, originalFirst.generationId);
  assert.equal(a.sha256, digest(expected));
  assert.equal(b.jobId, second.jobId);
  assert.equal(await exists(f.paths(third).directory), null);
  const reopened = await f.reopen();
  assert.deepEqual((await reopened.read(originalFirst)).data, expected);
  assert.equal((await reopened.read(second)).data.toString(), 'second already admitted');
});

test('UUID case canonicalization and independent instances contend without replacing an existing directory', async (t) => {
  const f = await fixture(t),
    reference = f.ref(),
    source = Buffer.from('synthetic same-reference contention');
  reference.objectId = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF';
  reference.generationId = 'BCDEFABC-DEFA-4BCD-8EFA-BCDEFABCDEF0';
  const second = await f.reopen();
  const attempts = await Promise.allSettled([
    f.store.install(reference, source),
    second.install(reference, source),
  ]);
  assert.ok(attempts.some((result) => result.status === 'fulfilled'));
  // A contender may observe no receipt or the tiny exclusive receipt while it is
  // still being written. Both outcomes retain the object and confer no bytes.
  for (const result of attempts)
    if (result.status === 'rejected')
      assert.ok(hasCode('INCOMPLETE')(result.reason) || hasCode('INTEGRITY')(result.reason));
  const read = await second.read({
    ...reference,
    objectId: reference.objectId.toLowerCase(),
    generationId: reference.generationId.toLowerCase(),
  });
  assert.equal(read.receipt.objectId, reference.objectId.toLowerCase());
  assert.equal(read.receipt.generationId, reference.generationId.toLowerCase());
  assert.deepEqual(read.data, source);
  assert.deepEqual(await second.install(reference, source), read.receipt);
});
