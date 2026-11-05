import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { setup } from './floor-plan-fixture.mjs';
import {
  DurableStoreError,
  createDurableSyntheticStore,
  reopenDurableSyntheticStore,
} from '../dist/durable-store.js';
import {
  createFloorPlanOutputDelivery,
  FloorPlanSealUncertainError,
} from '../dist/floor-plan-output.js';
import { validateFloorPlanWorkerLease } from '../dist/floor-plan-admission.js';
import { convertSyntheticFloorPlan } from '../dist/index.js';
import { createFloorPlanProcessor } from '../dist/floor-plan-processing.js';
import {
  createWindowsSyntheticSupervisor,
  retireWindowsSyntheticSupervisor,
} from '../dist/windows-supervisor.js';
import * as sql from '../../../database/tests/public-media-fixtures.mjs';
const code = (c) => (e) => e?.code === c;
async function media(db, work) {
  await db.exec('BEGIN; SET LOCAL ROLE media_coordinator');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [sql.T, sql.AGENT],
    );
    const r = await work();
    await db.exec('COMMIT');
    return r;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
async function fixture(t, options = {}) {
  let supervisor;
  const f = await setup(t, {
    allowCleanup: async () =>
      !supervisor || Boolean(await retireWindowsSyntheticSupervisor(supervisor)),
  });
  await f.db.exec(
    await readFile(
      new URL('../../../database/proposals/floor-plan-output.sql', import.meta.url),
      'utf8',
    ),
  );
  const output = await createDurableSyntheticStore(f.parent),
    metadata = await createDurableSyntheticStore(f.parent);
  f.resources.push(output, metadata);
  const calls = { native: 0, seal: 0, readSeal: 0, outputInstall: 0, metadataInstall: 0 };
  let processor;
  if (options.native) {
    supervisor = await createWindowsSyntheticSupervisor({
      powerShellPath:
        process.env.REALTOR_TEST_POWERSHELL ??
        path.join(
          os.homedir(),
          '.cache',
          'codex-runtimes',
          'codex-primary-runtime',
          'dependencies',
          'native',
          'powershell',
          'pwsh.exe',
        ),
      attemptParent: f.journal.attemptParent,
    });
    processor = await createFloorPlanProcessor({ ...f.config, supervisor });
    f.resources.push(processor);
  } else {
    // Explicit simulation of the trusted processor; conversion occurs in this test process.
    const result = await convertSyntheticFloorPlan(f.source),
      lease = validateFloorPlanWorkerLease(f.lease, f.target, f.source);
    processor = { run: async () => ({ state: 'readback_verified', lease, result }) };
  }
  const seal = async (target, outputId, manifest) => {
    calls.seal++;
    assert.deepEqual(target, f.target);
    return media(f.db, () =>
      sql.scalar(f.db, 'SELECT app_media.seal_synthetic_floor_plan($1,$2,$3,$4,$5,$6,$7)', [
        target.listingId,
        target.revision,
        target.requestId,
        target.claimId,
        target.leaseNonce,
        outputId,
        manifest,
      ]),
    );
  };
  const readSeal = async (target) => {
    calls.readSeal++;
    assert.deepEqual(target, f.target);
    return media(f.db, () =>
      sql.scalar(f.db, 'SELECT app_media.read_synthetic_floor_plan_output($1,$2,$3)', [
        target.listingId,
        target.revision,
        target.requestId,
      ]),
    );
  };
  const config = {
    processor: {
      run: async (t) => {
        calls.native++;
        return processor.run(t);
      },
    },
    requests: f.requests,
    outputStore: {
      ...output,
      install: async (...args) => {
        calls.outputInstall++;
        return output.install(...args);
      },
    },
    metadataStore: {
      ...metadata,
      install: async (...args) => {
        calls.metadataInstall++;
        return metadata.install(...args);
      },
    },
    preflight: f.preflight,
    seal,
    readSeal,
  };
  const open = (changes = {}) => {
    const delivery = createFloorPlanOutputDelivery({ ...config, ...changes });
    f.resources.push(delivery);
    return delivery;
  };
  return { ...f, output, metadata, calls, config, open, seal, readSeal };
}
test(
  'actual Windows output persists before SQL seal and reopens for read-only original recovery',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    const f = await fixture(t, { native: true }),
      delivery = f.open(),
      result = await delivery.run(f.target);
    assert.equal(result.state, 'sealed');
    assert.equal(result.receiptPersisted, true);
    assert.equal(result.receipt.policy, 'synthetic-floor-plan-output-v1');
    assert.equal(result.manifest.countsAsPhoto, false);
    assert.deepEqual(await f.readSeal(f.target), result.receipt);
    const stored = await f.output.read(result.outputRef);
    assert.equal(stored.receipt.sha256, result.manifest.sha256);
    assert.equal(f.calls.native, 1);
    assert.equal(f.calls.seal, 1);
    assert.equal(f.calls.outputInstall, 1);
    assert.equal(f.calls.metadataInstall, 2);
    await delivery.close();
    await f.output.close();
    await f.metadata.close();
    const output = await reopenDurableSyntheticStore(f.output.rootDirectory, f.output.storeId),
      metadata = await reopenDurableSyntheticStore(f.metadata.rootDirectory, f.metadata.storeId);
    f.resources.push(output, metadata);
    const recovered = f.open({
      processor: {
        run: async () => {
          throw Error('Recovery must not decode');
        },
      },
      outputStore: output,
      metadataStore: metadata,
    });
    const before = { ...f.calls };
    const replay = await recovered.reconcile(f.target);
    assert.equal(replay.state, 'sealed');
    assert.deepEqual(replay.receipt, result.receipt);
    assert.deepEqual(replay.outputRef, result.outputRef);
    for (const k of ['native', 'seal', 'outputInstall', 'metadataInstall'])
      assert.equal(f.calls[k], before[k]);
    await f.db.exec(
      await readFile(
        new URL('../../../database/proposals/floor-plan-attachment.sql', import.meta.url),
        'utf8',
      ),
    );
    const command = {
      policy: 'synthetic-floor-plan-attachment-command-v1',
      operationId: '00000000-0000-4000-8000-000000001700',
      listingId: sql.LISTING,
      revision: 1,
      expectedVersion: '2',
      requestId: f.target.requestId,
    };
    const attached = await sql.asActor(f.db, sql.T, sql.AGENT, () =>
      sql.scalar(f.db, 'SELECT app_api.save_synthetic_floor_plan_attachment($1)', [command]),
    );
    assert.equal(attached.resultVersion, '3');
    const gallery = await sql.asActor(f.db, sql.T, sql.AGENT, () =>
      sql.scalar(f.db, 'SELECT app_api.read_synthetic_floor_plan_gallery($1,1)', [sql.LISTING]),
    );
    assert.equal(gallery.version, '3');
    assert.equal(gallery.floorPlan.output.lease.outputObjectId, result.outputRef.objectId);
    assert.equal(gallery.floorPlan.output.lease.leaseNonce, result.outputRef.generationId);
    assert.equal(gallery.floorPlan.output.manifest.sha256, stored.receipt.sha256);
    assert.equal(await sql.scalar(f.db, 'SELECT count(*)::int FROM app_private.revision_media'), 0);
    const readGallery = (actor) =>
      sql.asActor(f.db, sql.T, actor, () =>
        sql.scalar(f.db, 'SELECT app_api.read_synthetic_floor_plan_gallery($1,1)', [sql.LISTING]),
      );
    const imageTarget = {
      companyId: sql.T,
      actorId: sql.AGENT,
      listingId: sql.LISTING,
      revision: 1,
    };
    const imageReader = f.open({
      outputStore: output,
      metadataStore: metadata,
      readGallery: () => readGallery(sql.AGENT),
    });
    const image = await imageReader.readAttached(imageTarget);
    assert.equal(image.state, 'ready');
    assert.deepEqual(image.data, stored.data);
    assert.equal(image.manifest.countsAsPhoto, false);
    const adminReader = f.open({
      outputStore: output,
      metadataStore: metadata,
      readGallery: () => readGallery(sql.ADMIN),
    });
    const adminImage = await adminReader.readAttached({ ...imageTarget, actorId: sql.ADMIN });
    assert.equal(adminImage.state, 'ready');
    assert.deepEqual(adminImage.data, stored.data);
    for (const k of ['native', 'seal', 'outputInstall', 'metadataInstall'])
      assert.equal(f.calls[k], before[k]);

    // History after a draft edit is checked by current SQL read authority, not fresh-work admission.
    await f.db.query(
      "UPDATE app_private.listing_revisions SET title='later edit' WHERE listing_id=$1",
      [sql.LISTING],
    );
    assert.equal((await recovered.reconcile(f.target)).state, 'sealed');
  },
);
test('typed uncertain seal acknowledgement reads the exact original once and never repeats the seal', async (t) => {
  const f = await fixture(t),
    delivery = f.open({
      seal: async (...args) => {
        await f.seal(...args);
        throw new FloorPlanSealUncertainError();
      },
    });
  const r = await delivery.run(f.target);
  assert.equal(r.state, 'sealed');
  assert.equal(f.calls.seal, 1);
  assert.equal(f.calls.readSeal, 1);
  assert.equal(f.calls.native, 1);
  assert.deepEqual((await delivery.reconcile(f.target)).receipt, r.receipt);
  assert.equal(f.calls.seal, 1);
  assert.equal(f.calls.native, 1);
});
test('generic SQL failure performs no implicit read and uncertain missing original remains blocked without replay', async (t) => {
  const f = await fixture(t),
    generic = f.open({
      seal: async () => {
        throw Error('Known failure');
      },
    });
  await assert.rejects(() => generic.run(f.target), /Known failure/);
  assert.equal(f.calls.readSeal, 0);
  assert.equal(f.calls.seal, 0);
  const readonly = f.open({
    processor: {
      run: async () => {
        throw Error('No decoder');
      },
    },
  });
  const before = { ...f.calls };
  assert.equal((await readonly.reconcile(f.target)).state, 'blocked');
  assert.equal(f.calls.native, before.native);
  assert.equal(f.calls.metadataInstall, before.metadataInstall);
  assert.equal(f.calls.outputInstall, before.outputInstall);
});
test('lost durable receipt acknowledgement recovers from SQL and byte evidence with no writes', async (t) => {
  const f = await fixture(t);
  let writes = 0;
  const delivery = f.open({
    metadataStore: {
      ...f.metadata,
      install: async (ref, bytes) => {
        writes++;
        const r = await f.metadata.install(ref, bytes);
        if (ref.kind === 'output') throw Error('Receipt acknowledgement lost');
        return r;
      },
    },
  });
  await assert.rejects(() => delivery.run(f.target), /Receipt acknowledgement lost/);
  assert.equal(writes, 2);
  const before = { ...f.calls };
  const recovered = await delivery.reconcile(f.target);
  assert.equal(recovered.state, 'sealed');
  assert.equal(recovered.receiptPersisted, true);
  assert.equal(writes, 2);
  for (const k of ['native', 'seal', 'outputInstall']) assert.equal(f.calls[k], before[k]);
});
test('missing local receipt can be verified read-only while a missing durable output stays blocked', async (t) => {
  const f = await fixture(t);
  let writes = 0;
  const delivery = f.open({
    metadataStore: {
      ...f.metadata,
      install: async (ref, bytes) => {
        writes++;
        if (ref.kind === 'output') throw Error('No local receipt committed');
        return f.metadata.install(ref, bytes);
      },
    },
  });
  await assert.rejects(() => delivery.run(f.target));
  const r = await delivery.reconcile(f.target);
  assert.equal(r.state, 'sealed');
  assert.equal(r.receiptPersisted, false);
  assert.equal(writes, 2);
  const missing = f.open({
    outputStore: {
      ...f.output,
      read: async () => {
        throw new DurableStoreError('INCOMPLETE');
      },
    },
  });
  assert.equal((await missing.reconcile(f.target)).state, 'blocked');
  const empty = await createDurableSyntheticStore(f.parent);
  f.resources.push(empty);
  const different = f.open({ outputStore: empty });
  await assert.rejects(() => different.reconcile(f.target), code('INTEGRITY'));
});
test('receipt identity or manifest mismatch cannot be adopted during uncertain acknowledgement or recovery', async (t) => {
  const f = await fixture(t),
    delivery = f.open({
      seal: async (...args) => {
        await f.seal(...args);
        throw new FloorPlanSealUncertainError();
      },
      readSeal: async (t) => {
        const r = await f.readSeal(t);
        return { ...r, manifest: { ...r.manifest, sha256: 'a'.repeat(64) } };
      },
    });
  await assert.rejects(() => delivery.run(f.target), code('INTEGRITY'));
  assert.equal(f.calls.seal, 1);
  const recovering = f.open({
    readSeal: async (t) => {
      const r = await f.readSeal(t);
      return {
        ...r,
        lease: { ...r.lease, outputObjectId: '00000000-0000-4000-8000-000000000999' },
      };
    },
  });
  await assert.rejects(() => recovering.reconcile(f.target), code('INTEGRITY'));
  assert.equal(f.calls.native, 1);
});
test('output persistence failure preserves intent without SQL or decoder replay, and access loss prevents recovery reads', async (t) => {
  const f = await fixture(t);
  const delivery = f.open({
    outputStore: {
      ...f.output,
      install: async () => {
        throw Error('Output not committed');
      },
    },
  });
  await assert.rejects(() => delivery.run(f.target), /Output not committed/);
  assert.equal(f.calls.seal, 0);
  const before = { ...f.calls };
  assert.equal((await delivery.reconcile(f.target)).state, 'blocked');
  assert.equal(f.calls.native, before.native);
  await f.db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [sql.T]);
  await assert.rejects(() => delivery.reconcile(f.target));
  assert.equal(f.calls.native, before.native);
});

test('confirmed originals stay recoverable under simulated local lease expiry without fresh processing', async (t) => {
  const f = await fixture(t),
    delivery = f.open(),
    r = await delivery.run(f.target),
    clock = Date.now,
    before = { ...f.calls };
  // Local test-process clock only. The OS/account clock is unchanged, and no work admission is bypassed.
  Date.now = () => clock() + 360000;
  try {
    assert.throws(() => validateFloorPlanWorkerLease(f.lease, f.target, f.source), code('BLOCKED'));
    const recovered = await delivery.reconcile(f.target);
    assert.equal(recovered.state, 'sealed');
    assert.deepEqual(recovered.receipt, r.receipt);
  } finally {
    Date.now = clock;
  }
  for (const k of ['native', 'seal', 'outputInstall', 'metadataInstall'])
    assert.equal(f.calls[k], before[k]);
});
test('altered stored byte receipt fails reconciliation and cannot be replaced or promoted', async (t) => {
  const f = await fixture(t),
    delivery = f.open();
  await delivery.run(f.target);
  const before = { ...f.calls };
  const damaged = f.open({
    outputStore: {
      ...f.output,
      read: async (ref) => {
        const r = await f.output.read(ref),
          data = Buffer.from(r.data);
        data[0] ^= 1;
        return { ...r, data };
      },
    },
  });
  await assert.rejects(() => damaged.reconcile(f.target), code('INTEGRITY'));
  for (const k of ['native', 'seal', 'outputInstall', 'metadataInstall'])
    assert.equal(f.calls[k], before[k]);
});
test('busy fencing and close drain an admitted seal while rejecting later run and recovery calls', async (t) => {
  const f = await fixture(t);
  let release, started;
  const held = new Promise((r) => (release = r)),
    entered = new Promise((r) => (started = r));
  const delivery = f.open({
      seal: async (...args) => {
        started();
        await held;
        return f.seal(...args);
      },
    }),
    pending = delivery.run(f.target);
  await entered;
  await assert.rejects(() => delivery.reconcile(f.target), code('BUSY'));
  let done = false;
  const closing = delivery.close().then(() => {
    done = true;
  });
  await Promise.resolve();
  assert.equal(done, false);
  await assert.rejects(() => delivery.run(f.target), code('CLOSED'));
  release();
  assert.equal((await pending).state, 'sealed');
  await closing;
  assert.equal(done, true);
  assert.equal(f.calls.seal, 1);
});

async function attachedGallery(t) {
  const f = await fixture(t),
    delivery = f.open();
  await delivery.run(f.target);
  await f.db.exec(
    await readFile(
      new URL('../../../database/proposals/floor-plan-attachment.sql', import.meta.url),
      'utf8',
    ),
  );
  const command = {
    policy: 'synthetic-floor-plan-attachment-command-v1',
    operationId: '00000000-0000-4000-8000-000000001710',
    listingId: sql.LISTING,
    revision: 1,
    expectedVersion: '2',
    requestId: f.target.requestId,
  };
  const save = (cmd) =>
    sql.asActor(f.db, sql.T, sql.AGENT, () =>
      sql.scalar(f.db, 'SELECT app_api.save_synthetic_floor_plan_attachment($1)', [cmd]),
    );
  await save(command);
  const readGallery = () =>
    sql.asActor(f.db, sql.T, sql.AGENT, () =>
      sql.scalar(f.db, 'SELECT app_api.read_synthetic_floor_plan_gallery($1,1)', [sql.LISTING]),
    );
  const target = { companyId: sql.T, actorId: sql.AGENT, listingId: sql.LISTING, revision: 1 };
  return { ...f, command, save, readGallery, galleryTarget: target };
}
test('attached gallery removal during byte IO refuses delivery and the next read reports missing', async (t) => {
  const f = await attachedGallery(t);
  let changed = false;
  const before = { ...f.calls };
  const reader = f.open({
    readGallery: f.readGallery,
    outputStore: {
      ...f.output,
      read: async (ref) => {
        const value = await f.output.read(ref);
        if (!changed) {
          changed = true;
          await f.save({
            ...f.command,
            operationId: '00000000-0000-4000-8000-000000001711',
            expectedVersion: '3',
            requestId: null,
          });
        }
        return value;
      },
    },
  });
  await assert.rejects(() => reader.readAttached(f.galleryTarget), code('BLOCKED'));
  assert.equal((await reader.readAttached(f.galleryTarget)).state, 'missing');
  for (const k of ['native', 'seal', 'outputInstall', 'metadataInstall'])
    assert.equal(f.calls[k], before[k]);
});
test('a replacement attachment identity during gallery IO blocks even when the same bytes were selected', async (t) => {
  const f = await attachedGallery(t);
  const reader = f.open({
    readGallery: f.readGallery,
    outputStore: {
      ...f.output,
      read: async (ref) => {
        const r = await f.output.read(ref);
        await f.save({
          ...f.command,
          operationId: '00000000-0000-4000-8000-000000001712',
          expectedVersion: '3',
        });
        return r;
      },
    },
  });
  await assert.rejects(() => reader.readAttached(f.galleryTarget), code('BLOCKED'));
  assert.equal(f.calls.native, 1);
  assert.equal(f.calls.seal, 1);
});
test('membership access lost during attached gallery IO prevents private byte return', async (t) => {
  const f = await attachedGallery(t);
  let checks = 0;
  const reader = f.open({
    readGallery: () => {
      checks++;
      return f.readGallery();
    },
    outputStore: {
      ...f.output,
      read: async (ref) => {
        const r = await f.output.read(ref);
        await f.db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',
          [sql.T, sql.AGENT],
        );
        return r;
      },
    },
  });
  await assert.rejects(() => reader.readAttached(f.galleryTarget), code('42501'));
  assert.equal(checks, 2);
  assert.equal(f.calls.native, 1);
  assert.equal(f.calls.seal, 1);
});
test('wrong gallery scope or origin binding is refused before any output byte read', async (t) => {
  const f = await attachedGallery(t);
  let reads = 0;
  const outputStore = {
    ...f.output,
    read: async (ref) => {
      reads++;
      return f.output.read(ref);
    },
  };
  for (const alter of [
    (g) => ({ ...g, companyId: sql.OTHER }),
    (g) => ({ ...g, actorId: sql.ADMIN }),
    (g) => ({
      ...g,
      floorPlan: {
        ...g.floorPlan,
        output: {
          ...g.floorPlan.output,
          lease: {
            ...g.floorPlan.output.lease,
            registration: {
              ...g.floorPlan.output.lease.registration,
              binding: { ...g.floorPlan.output.lease.registration.binding, companyId: sql.OTHER },
            },
          },
        },
      },
    }),
  ]) {
    const reader = f.open({ outputStore, readGallery: async () => alter(await f.readGallery()) });
    await assert.rejects(() => reader.readAttached(f.galleryTarget), code('INTEGRITY'));
  }
  assert.equal(reads, 0);
  assert.equal(f.calls.native, 1);
});
test('attached gallery independently refuses corrupted stored output without decode or write repair', async (t) => {
  const f = await attachedGallery(t),
    before = { ...f.calls };
  const reader = f.open({
    readGallery: f.readGallery,
    outputStore: {
      ...f.output,
      read: async (ref) => {
        const r = await f.output.read(ref),
          data = Buffer.from(r.data);
        data[0] ^= 1;
        return { ...r, data };
      },
    },
  });
  await assert.rejects(() => reader.readAttached(f.galleryTarget), code('INTEGRITY'));
  for (const k of ['native', 'seal', 'outputInstall', 'metadataInstall'])
    assert.equal(f.calls[k], before[k]);
});

async function publishedGallery(t, remove = false) {
  const f = await attachedGallery(t);
  for (const n of ['publication', 'publication-output'])
    await f.db.exec(
      await readFile(
        new URL('../../../database/proposals/floor-plan-' + n + '.sql', import.meta.url),
        'utf8',
      ),
    );
  let version = '3';
  if (remove)
    version = (
      await f.save({
        ...f.command,
        operationId: '00000000-0000-4000-8000-000000001713',
        expectedVersion: '3',
        requestId: null,
      })
    ).resultVersion;
  await sql.seedMedia(f.db);
  const pending = await sql.asActor(f.db, sql.T, sql.AGENT, async () => {
    await sql.scalar(f.db, "SELECT app_api.confirm_availability($1,1,'available')", [sql.LISTING]);
    return sql.scalar(f.db, 'SELECT app_api.submit_revision($1,1,$2)', [sql.LISTING, version]);
  });
  await sql.asActor(f.db, sql.T, sql.ADMIN, () =>
    sql.scalar(f.db, 'SELECT app_api.decide_revision($1,1,$2,true)', [sql.LISTING, pending]),
  );
  const approvedVersion = await sql.scalar(
    f.db,
    'SELECT version::text FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=1',
    [sql.LISTING],
  );
  const publicTarget = { companyId: sql.T, listingId: sql.LISTING, revision: 1, approvedVersion };
  const readPublishedGallery = (t) =>
    sql.asActor(f.db, t.companyId, null, () =>
      sql.scalar(f.db, 'SELECT app_api.read_synthetic_published_floor_plan_output($1,$2,$3)', [
        t.listingId,
        t.revision,
        t.approvedVersion,
      ]),
    );
  return { ...f, publicTarget, readPublishedGallery };
}

test('approved anonymous delivery checks current SQL eligibility around durable bytes without decoder/write replay', async (t) => {
  const f = await publishedGallery(t),
    before = { ...f.calls };
  let checks = 0;
  const reader = f.open({
    readGallery() {
      throw Error('Private reader must not authorize publication');
    },
    readPublishedGallery: async (target) => {
      checks++;
      return f.readPublishedGallery(target);
    },
  });
  const result = await reader.readPublished(f.publicTarget);
  assert.equal(result.state, 'ready');
  assert.equal(result.target.actorId, null);
  assert.equal(result.version, f.publicTarget.approvedVersion);
  assert.equal(checks, 2);
  assert.ok(Buffer.isBuffer(result.data));
  for (const k of ['native', 'seal', 'outputInstall', 'metadataInstall'])
    assert.equal(f.calls[k], before[k]);
  await assert.rejects(
    () =>
      sql.asActor(f.db, sql.T, sql.ADMIN, () =>
        sql.scalar(f.db, 'SELECT app_api.read_synthetic_published_floor_plan_output($1,1,$2)', [
          sql.LISTING,
          f.publicTarget.approvedVersion,
        ]),
      ),
    code('42501'),
  );
  await assert.rejects(
    () => f.readPublishedGallery({ ...f.publicTarget, approvedVersion: '1' }),
    code('40001'),
  );
  await assert.rejects(
    () => f.readPublishedGallery({ ...f.publicTarget, companyId: sql.OTHER }),
    code('P0002'),
  );
  await assert.rejects(
    () =>
      media(f.db, () =>
        sql.scalar(f.db, 'SELECT app_api.read_synthetic_published_floor_plan_output($1,1,$2)', [
          sql.LISTING,
          f.publicTarget.approvedVersion,
        ]),
      ),
    code('42501'),
  );
});

test('publication paused during durable IO blocks bytes and later disabled-company reads touch no output', async (t) => {
  const f = await publishedGallery(t);
  let reads = 0;
  const reader = f.open({
    readPublishedGallery: f.readPublishedGallery,
    outputStore: {
      ...f.output,
      read: async (ref) => {
        reads++;
        const r = await f.output.read(ref);
        await f.db.query(
          "UPDATE app_private.listings SET publication_status='paused' WHERE id=$1",
          [sql.LISTING],
        );
        return r;
      },
    },
  });
  await assert.rejects(() => reader.readPublished(f.publicTarget), code('P0002'));
  assert.equal(reads, 1);
  await f.db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [sql.T]);
  await assert.rejects(() => reader.readPublished(f.publicTarget));
  assert.equal(reads, 1);
  assert.equal(f.calls.native, 1);
  assert.equal(f.calls.seal, 1);
});

test('approved absence returns missing without searching a historical private attachment or output', async (t) => {
  const f = await publishedGallery(t, true);
  let reads = 0;
  const reader = f.open({
    readPublishedGallery: f.readPublishedGallery,
    outputStore: {
      ...f.output,
      read: async (ref) => {
        reads++;
        return f.output.read(ref);
      },
    },
  });
  assert.equal((await reader.readPublished(f.publicTarget)).state, 'missing');
  assert.equal(reads, 0);
  assert.equal(f.calls.native, 1);
});

test('public capability cannot fall back to private gallery or accept altered scope/provenance before IO', async (t) => {
  const f = await publishedGallery(t);
  let reads = 0;
  const outputStore = {
    ...f.output,
    read: async (ref) => {
      reads++;
      return f.output.read(ref);
    },
  };
  await assert.rejects(
    () => f.open({ readGallery: f.readGallery, outputStore }).readPublished(f.publicTarget),
    code('INVALID_CONFIGURATION'),
  );
  for (const alter of [
    (r) => ({ ...r, companyId: sql.OTHER }),
    (r) => ({ ...r, approvedVersion: '1' }),
    (r) => ({ ...r, actorId: sql.AGENT }),
    (r) => ({
      ...r,
      floorPlan: {
        ...r.floorPlan,
        output: {
          ...r.floorPlan.output,
          lease: {
            ...r.floorPlan.output.lease,
            registration: {
              ...r.floorPlan.output.lease.registration,
              binding: { ...r.floorPlan.output.lease.registration.binding, companyId: sql.OTHER },
            },
          },
        },
      },
    }),
  ]) {
    const reader = f.open({
      outputStore,
      readPublishedGallery: async (target) => alter(await f.readPublishedGallery(target)),
    });
    await assert.rejects(() => reader.readPublished(f.publicTarget), code('INTEGRITY'));
  }
  assert.equal(reads, 0);
  for (const bad of [
    { ...f.publicTarget, approvedVersion: '01' },
    { ...f.publicTarget, actorId: sql.AGENT },
    { ...f.publicTarget, revision: 0 },
  ])
    assert.throws(
      () => f.open({ readPublishedGallery: f.readPublishedGallery }).readPublished(bad),
      code('INTEGRITY'),
    );
});

test('approved durable output corruption fails closed without repair and readPublished joins close/busy fencing', async (t) => {
  const f = await publishedGallery(t),
    before = { ...f.calls };
  const corrupted = f.open({
    readPublishedGallery: f.readPublishedGallery,
    outputStore: {
      ...f.output,
      read: async (ref) => {
        const r = await f.output.read(ref),
          data = Buffer.from(r.data);
        data[0] ^= 1;
        return { ...r, data };
      },
    },
  });
  await assert.rejects(() => corrupted.readPublished(f.publicTarget), code('INTEGRITY'));
  let enter, release;
  const entered = new Promise((r) => (enter = r)),
    held = new Promise((r) => (release = r));
  const reader = f.open({
    readPublishedGallery: async (target) => {
      enter();
      await held;
      return f.readPublishedGallery(target);
    },
  });
  const active = reader.readPublished(f.publicTarget);
  await entered;
  await assert.rejects(() => reader.readPublished(f.publicTarget), code('BUSY'));
  let drained = false;
  const closing = reader.close().then(() => (drained = true));
  assert.equal(drained, false);
  await assert.rejects(() => reader.readPublished(f.publicTarget), code('CLOSED'));
  release();
  assert.equal((await active).state, 'ready');
  await closing;
  assert.equal(drained, true);
  for (const k of ['native', 'seal', 'outputInstall', 'metadataInstall'])
    assert.equal(f.calls[k], before[k]);
});
