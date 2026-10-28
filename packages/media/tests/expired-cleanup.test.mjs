import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  mkdir,
  lstat,
  unlink,
  rmdir,
  link,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createDurableSyntheticStore,
  reopenDurableSyntheticStore,
  retireExpiredDurableJob,
} from '../dist/durable-store.js';
import { expiredMediaCleanupAuthorization } from '../dist/expired-cleanup.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const approval = (n = 1) => ({
  kind: 'expire_unverified_media',
  tenantId: id(90),
  jobId: id(n),
  operationId: id(n + 100),
  quarantineId: id(n + 200),
  outputId: id(n + 300),
  expiredAt: '2026-01-01T00:00:00.000000Z',
  authorizedAt: '2026-01-02T00:00:00.000000Z',
  outcome: 'authorized',
});
const ref = (a, kind) => ({
  jobId: a.jobId,
  objectId: kind === 'quarantine' ? a.quarantineId : a.outputId,
  generationId: id(900),
  kind,
});
const yes = async () => true;
async function setup(t) {
  const parent = await mkdtemp(path.join(tmpdir(), 'realtor expiry test '));
  const store = await createDurableSyntheticStore(parent);
  const roots = new Set([store]);
  t.after(async () => {
    for (const s of roots) await s.close();
    // Explicit, nonrecursive owned-fixture cleanup. Never follow unexpected paths.
    const objects = path.join(store.rootDirectory, 'objects');
    for (const job of await readdir(objects)) {
      assert.match(job, /^[0-9a-f-]{36}$/);
      const jobPath = path.join(objects, job);
      assert.ok((await lstat(jobPath)).isDirectory());
      for (const name of await readdir(jobPath)) {
        assert.ok(['quarantine', 'output', 'expiry.json'].includes(name));
        const target = path.join(jobPath, name),
          stat = await lstat(target);
        assert.ok(!stat.isSymbolicLink());
        if (name === 'expiry.json') await unlink(target);
        else {
          assert.ok(stat.isDirectory());
          for (const file of await readdir(target)) {
            assert.ok(['data.bin', 'receipt.json'].includes(file));
            const location = path.join(target, file),
              s = await lstat(location);
            assert.ok(s.isFile() && !s.isSymbolicLink() && s.nlink === 1);
            await unlink(location);
          }
          await rmdir(target);
        }
      }
      await rmdir(jobPath);
    }
    await rmdir(objects);
    await unlink(path.join(store.rootDirectory, 'store.json'));
    await rmdir(store.rootDirectory);
    await rmdir(parent);
  });
  return { store, roots };
}
test('expired authorization rejects private/getter/proxy fields, invalid dates and microsecond-short grace without executing accessors', () => {
  const a = approval();
  assert.ok(Object.isFrozen(expiredMediaCleanupAuthorization(a)));
  let reads = 0;
  const getter = { ...a };
  Object.defineProperty(getter, 'jobId', {
    enumerable: true,
    get() {
      reads++;
      return a.jobId;
    },
  });
  for (const bad of [
    getter,
    new Proxy(a, {}),
    { ...a, token: 'private' },
    { ...a, authorizedAt: '2026-02-30T00:00:00.000000Z' },
    { ...a, expiredAt: '2026-01-01T00:00:00.000900Z', authorizedAt: '2026-01-01T01:00:00.000100Z' },
    { ...a, outputId: a.jobId },
  ])
    assert.throws(() => expiredMediaCleanupAuthorization(bad), { code: 'INVALID_AUTHORIZATION' });
  assert.equal(reads, 0);
});
test('approved offline expiry deletes only both byte payloads, retains exact receipts and fences reinstall across reopen/replay', async (t) => {
  const { store, roots } = await setup(t),
    a = approval();
  const before = [];
  for (const kind of ['quarantine', 'output']) {
    await store.install(ref(a, kind), Buffer.from(kind));
    before.push(
      await readFile(path.join(store.rootDirectory, 'objects', a.jobId, kind, 'receipt.json')),
    );
  }
  const live = approval(2);
  await store.install(ref(live, 'output'), Buffer.from('retain live sibling'));
  assert.deepEqual(await retireExpiredDurableJob(store, a, yes), {
    removedFiles: 2,
    removedBytes: 16,
  });
  for (const [index, kind] of ['quarantine', 'output'].entries()) {
    const object = path.join(store.rootDirectory, 'objects', a.jobId, kind);
    assert.deepEqual(await readdir(object), ['receipt.json']);
    assert.deepEqual(await readFile(path.join(object, 'receipt.json')), before[index]);
    await assert.rejects(store.read(ref(a, kind)), { code: 'RETIRED' });
    await assert.rejects(store.install(ref(a, kind), Buffer.from(kind)), { code: 'RETIRED' });
  }
  assert.equal((await store.read(ref(live, 'output'))).data.toString(), 'retain live sibling');
  await store.close();
  const reopened = await reopenDurableSyntheticStore(store.rootDirectory, store.storeId);
  roots.add(reopened);
  await assert.rejects(reopened.read(ref(a, 'output')), { code: 'RETIRED' });
  assert.deepEqual(await retireExpiredDurableJob(reopened, a, yes), {
    removedFiles: 0,
    removedBytes: 0,
  });
  await assert.rejects(retireExpiredDurableJob(reopened, { ...a, operationId: id(999) }, yes), {
    code: 'CONFLICT',
  });
});
test('incomplete payload with no receipt is fenced and removed; missing job is fenced without a directory sweep', async (t) => {
  const { store } = await setup(t),
    a = approval();
  const object = path.join(store.rootDirectory, 'objects', a.jobId, 'quarantine');
  await mkdir(object, { recursive: true });
  await writeFile(path.join(object, 'data.bin'), Buffer.from('unfinished'));
  assert.deepEqual(await retireExpiredDurableJob(store, a, yes), {
    removedFiles: 1,
    removedBytes: 10,
  });
  assert.deepEqual(await readdir(object), []);
  const empty = approval(3);
  assert.deepEqual(await retireExpiredDurableJob(store, empty, yes), {
    removedFiles: 0,
    removedBytes: 0,
  });
  await assert.rejects(store.install(ref(empty, 'output'), Buffer.from('late writer')), {
    code: 'RETIRED',
  });
});
test('preflight rejects unknown siblings and hardlinks before deleting any payload or writing the fence', async (t) => {
  const { store } = await setup(t),
    a = approval();
  for (const kind of ['quarantine', 'output']) await store.install(ref(a, kind), Buffer.from(kind));
  const job = path.join(store.rootDirectory, 'objects', a.jobId),
    unexpected = path.join(job, 'unknown');
  await writeFile(unexpected, 'retain');
  await assert.rejects(retireExpiredDurableJob(store, a, yes), { code: 'INTEGRITY' });
  assert.equal((await readFile(path.join(job, 'quarantine', 'data.bin'))).toString(), 'quarantine');
  await assert.rejects(store.read(ref(a, 'quarantine')), { code: 'INTEGRITY' });
  await unlink(unexpected);
  const output = path.join(job, 'output', 'data.bin'),
    hardlink = path.join(path.dirname(store.rootDirectory), 'held-output');
  await link(output, hardlink);
  try {
    await assert.rejects(retireExpiredDurableJob(store, a, yes), { code: 'INTEGRITY' });
    assert.equal((await store.read(ref(a, 'quarantine'))).data.toString(), 'quarantine');
    assert.ok(!(await readdir(job)).includes('expiry.json'));
  } finally {
    await unlink(hardlink);
  }
});
test('nonquiescent, invalid authority and copied store capability never mutate filesystem', async (t) => {
  const { store } = await setup(t),
    a = approval();
  await store.install(ref(a, 'output'), Buffer.from('keep'));
  await assert.rejects(
    retireExpiredDurableJob(store, a, async () => false),
    { code: 'NOT_QUIESCENT' },
  );
  await assert.rejects(retireExpiredDurableJob(store, { ...a, tenantId: 'bad' }, yes), {
    code: 'INVALID_REFERENCE',
  });
  await assert.rejects(retireExpiredDurableJob({ ...store }, a, yes), {
    code: 'INVALID_REFERENCE',
  });
  assert.equal((await store.read(ref(a, 'output'))).data.toString(), 'keep');
});
test('retained fence resumes a crash-state fixture after one payload was removed and preserves remaining receipt', async (t) => {
  const { store } = await setup(t),
    a = approval();
  for (const kind of ['quarantine', 'output']) await store.install(ref(a, kind), Buffer.from(kind));
  const job = path.join(store.rootDirectory, 'objects', a.jobId);
  await writeFile(
    path.join(job, 'expiry.json'),
    JSON.stringify({
      version: 1,
      storeId: store.storeId,
      authorization: expiredMediaCleanupAuthorization(a),
    }) + '\n',
  );
  await unlink(path.join(job, 'quarantine', 'data.bin'));
  assert.deepEqual(await retireExpiredDurableJob(store, a, yes), {
    removedFiles: 1,
    removedBytes: 6,
  });
  assert.deepEqual(await readdir(path.join(job, 'output')), ['receipt.json']);
});
