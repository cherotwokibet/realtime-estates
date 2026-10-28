import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, link, unlink } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import {
  createNativeMediaPreview,
  prepareNativeMediaMaintenance,
  retireNativeMediaJob,
} from './media-preview.mjs';
import { reopenDurableSyntheticStore } from '@realtor/media/durable-store';
import {
  T,
  OTHER,
  B,
  LB,
  fixture,
  historicalJob,
  authorize,
  scalar,
} from '../../../database/test-helpers/expired-media-fixture.mjs';
const WINDOWS = { skip: process.platform !== 'win32', timeout: 90000 };
async function environment(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'realtor live cleanup '));
  t.diagnostic(`Owned synthetic maintenance fixtures retained: ${root}`);
  let io = 0;
  const native = await createNativeMediaPreview({
    nativeUploads: {
      mode: 'synthetic-native-v1',
      rootDirectory: root,
      powerShellPath: path.join(
        homedir(),
        '.cache',
        'codex-runtimes',
        'codex-primary-runtime',
        'dependencies',
        'native',
        'powershell',
        'pwsh.exe',
      ),
    },
    tenant: { tenantId: T, slug: 'expiry-a', hostnames: ['127.0.0.1'] },
    database: {
      transaction: async () => {
        io++;
        throw Error('Unexpected business IO');
      },
    },
    coordinator: {
      finalizeMedia: async () => {
        io++;
        throw Error('Unexpected finalization');
      },
    },
    verifyBearer: async () => {
      io++;
      throw Error('Unexpected identity IO');
    },
  });
  t.after(() => native.close());
  const resources = JSON.parse(await readFile(path.join(root, 'preview-resources.json'), 'utf8'));
  const photosRoot = path.join(root, resources.stores.photos.root),
    attemptParent = path.join(root, 'attempts');
  return {
    root,
    native,
    resources,
    photosRoot,
    attemptParent,
    get io() {
      return io;
    },
  };
}
async function install(e, job, kind, text) {
  const store = await reopenDurableSyntheticStore(e.photosRoot, e.resources.stores.photos.id);
  try {
    return await store.install(
      {
        jobId: job.job,
        objectId: kind === 'quarantine' ? job.quarantineId : job.outputId,
        generationId: randomUUID(),
        kind,
      },
      Buffer.from(text),
    );
  } finally {
    await store.close();
  }
}
const bytes = (e, j, kind) => path.join(e.photosRoot, 'objects', j.job, kind, 'data.bin');
test(
  'live factory drains/fences all byte endpoints and removes only committed-expired job payload/workspace files while preserving histories and other jobs',
  WINDOWS,
  async (t) => {
    const db = await fixture(t),
      expired = await historicalJob(db),
      live = await historicalJob(db, { age: 0 }),
      foreign = await historicalJob(db, { tenant: OTHER, actor: B, listing: LB });
    const e = await environment(t);
    await install(e, expired, 'quarantine', 'expired input');
    await install(e, expired, 'output', 'failed output');
    await install(e, live, 'output', 'current job retained');
    await install(e, foreign, 'output', 'other company retained');
    const attempt = path.join(e.attemptParent, expired.job);
    await mkdir(attempt);
    const workspace = {
      'source.input': 'unfinished input',
      'converted.webp': 'unsealed output',
      'manifest.json': '{}',
    };
    for (const [name, value] of Object.entries(workspace))
      await writeFile(path.join(attempt, name), value);
    const receiptPath = path.join(
        e.photosRoot,
        'objects',
        expired.job,
        'quarantine',
        'receipt.json',
      ),
      before = await readFile(receiptPath);
    const operation = randomUUID(),
      sql = await authorize(db, expired, operation);
    await assert.rejects(retireNativeMediaJob(e.native, {}, sql), { code: 'INVALID_CAPABILITY' });
    const permit = await prepareNativeMediaMaintenance(e.native);
    assert.ok(permit);
    assert.ok(Object.isFrozen(permit));
    assert.strictEqual(await prepareNativeMediaMaintenance(e.native), permit);
    await assert.rejects(prepareNativeMediaMaintenance({ ...e.native }), {
      code: 'INVALID_CAPABILITY',
    });
    await assert.rejects(retireNativeMediaJob(e.native, { ...permit }, sql), {
      code: 'INVALID_CAPABILITY',
    });
    for (const method of ['handlePreview', 'handleFinalize'])
      assert.equal((await e.native[method](new Request('http://127.0.0.1/unused'))).status, 503);
    assert.equal(
      (
        await e.native.handleUpload(
          new Request('http://127.0.0.1/unused', { method: 'PUT' }),
          (async function* () {
            throw Error('must not read closed input');
          })(),
        )
      ).status,
      503,
    );
    assert.equal(e.io, 0);
    await assert.rejects(authorize(db, live), { code: '23514' });
    const otherPlan = await authorize(db, foreign);
    await assert.rejects(retireNativeMediaJob(e.native, permit, otherPlan), {
      code: 'INVALID_AUTHORIZATION',
    });
    const result = await retireNativeMediaJob(e.native, permit, sql);
    assert.deepEqual(result.store, { removedFiles: 2, removedBytes: 26 });
    assert.deepEqual(result.attempt, {
      removedFiles: 3,
      removedBytes: Object.values(workspace).reduce((n, s) => n + Buffer.byteLength(s), 0),
    });
    assert.deepEqual(await readdir(attempt), []);
    assert.deepEqual(await readFile(receiptPath), before);
    assert.equal((await readFile(bytes(e, live, 'output'))).toString(), 'current job retained');
    assert.equal(
      (await readFile(bytes(e, foreign, 'output'))).toString(),
      'other company retained',
    );
    const replay = await retireNativeMediaJob(
      e.native,
      permit,
      await authorize(db, expired, operation),
    );
    assert.deepEqual(replay.store, { removedFiles: 0, removedBytes: 0 });
    assert.deepEqual(replay.attempt, { removedFiles: 0, removedBytes: 0 });
    assert.equal(await scalar(db, 'SELECT count(*) FROM app_private.media_jobs'), 3);
    assert.equal(await scalar(db, 'SELECT count(*) FROM app_private.media_operations'), 3);
  },
);
test(
  'unknown workspace entries and hardlinks retain both store and attempt bytes before any fence or unlink',
  WINDOWS,
  async (t) => {
    const db = await fixture(t),
      job = await historicalJob(db),
      plan = await authorize(db, job),
      e = await environment(t);
    await install(e, job, 'quarantine', 'retain staged input');
    const attempt = path.join(e.attemptParent, job.job);
    await mkdir(attempt);
    const source = path.join(attempt, 'source.input'),
      unknown = path.join(attempt, 'unexpected');
    await writeFile(source, 'incomplete');
    await writeFile(unknown, 'retain');
    const permit = await prepareNativeMediaMaintenance(e.native);
    assert.ok(permit);
    await assert.rejects(retireNativeMediaJob(e.native, permit, plan), { code: 'INTEGRITY' });
    assert.equal((await readFile(bytes(e, job, 'quarantine'))).toString(), 'retain staged input');
    assert.ok(
      !(await readdir(path.dirname(path.dirname(bytes(e, job, 'quarantine'))))).includes(
        'expiry.json',
      ),
    );
    await unlink(unknown);
    const hardlink = path.join(tmpdir(), 'realtor-maintenance-owned-link-' + randomUUID());
    await link(source, hardlink);
    try {
      await assert.rejects(retireNativeMediaJob(e.native, permit, plan), { code: 'INTEGRITY' });
      assert.equal((await readFile(source)).toString(), 'incomplete');
      assert.equal((await readFile(bytes(e, job, 'quarantine'))).toString(), 'retain staged input');
    } finally {
      await unlink(hardlink);
    }
    const result = await retireNativeMediaJob(e.native, permit, plan);
    assert.equal(result.store.removedFiles, 1);
    assert.equal(result.attempt.removedFiles, 1);
  },
);
test(
  'interrupted empty worker slot never becomes a maintenance permit and production mode refuses preparation',
  WINDOWS,
  async (t) => {
    const e = await environment(t),
      slot = path.join(e.root, e.resources.worker.root, 'active');
    await mkdir(slot);
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await assert.rejects(prepareNativeMediaMaintenance(e.native), {
        code: 'PRODUCTION_DISABLED',
      });
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
    assert.equal(await prepareNativeMediaMaintenance(e.native), null);
    assert.equal(await prepareNativeMediaMaintenance(e.native), null);
    assert.deepEqual(await readdir(slot), []);
  },
);
test(
  'concurrent normal close waits for preparation and permanently refuses later cleanup',
  WINDOWS,
  async (t) => {
    const e = await environment(t),
      preparing = prepareNativeMediaMaintenance(e.native),
      closing = e.native.close();
    await preparing;
    await closing;
    await assert.rejects(prepareNativeMediaMaintenance(e.native), { code: 'CLOSED' });
  },
);
