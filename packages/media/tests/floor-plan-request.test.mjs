import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, lstat, unlink, rmdir, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createDurableSyntheticStore, reopenDurableSyntheticStore } from '../dist/durable-store.js';
import {
  createFloorPlanRequests,
  createFloorPlanSourceAdmission,
  FloorPlanRequestError,
} from '../dist/floor-plan-request.js';
import { syntheticPng } from './fixtures.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const binding = (n) => ({
  jobId: id(n),
  requestId: id(n + 100),
  generationId: id(n + 200),
  inputObjectId: id(n + 300),
  companyId: id(401),
  actorId: id(402),
  listingId: id(403),
  revision: 2,
  expectedVersion: 7,
});
const code = (expected) => (e) => e instanceof FloorPlanRequestError && e.code === expected;
const hash = (b) => createHash('sha256').update(b).digest('hex');

async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'realtor-floor-request-'));
  const requestStore = await createDurableSyntheticStore(parent),
    inputStore = await createDurableSyntheticStore(parent);
  const stores = new Set([requestStore, inputStore]),
    facades = new Set();
  const open = (r = requestStore, i = inputStore) => {
    const f = createFloorPlanRequests({ requestStore: r, inputStore: i });
    facades.add(f);
    return f;
  };
  t.after(async () => {
    for (const f of facades) await f.close();
    for (const s of stores) await s.close();
    // Only the two freshly created roots and their known regular object files are removed.
    for (const s of [requestStore, inputStore]) {
      assert.equal(path.dirname(s.rootDirectory), parent);
      assert.ok(!(await lstat(s.rootDirectory)).isSymbolicLink());
      assert.deepEqual((await readdir(s.rootDirectory)).sort(), ['objects', 'store.json']);
      const objects = path.join(s.rootDirectory, 'objects');
      assert.ok(!(await lstat(objects)).isSymbolicLink());
      for (const job of await readdir(objects)) {
        assert.match(job, /^[0-9a-f-]{36}$/);
        const folder = path.join(objects, job);
        assert.ok(!(await lstat(folder)).isSymbolicLink());
        for (const kind of await readdir(folder)) {
          assert.equal(kind, 'quarantine');
          const obj = path.join(folder, kind);
          assert.ok(!(await lstat(obj)).isSymbolicLink());
          for (const name of await readdir(obj)) {
            assert.ok(['data.bin', 'receipt.json'].includes(name));
            const file = path.join(obj, name),
              stat = await lstat(file);
            assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1);
            await unlink(file);
          }
          await rmdir(obj);
        }
        await rmdir(folder);
      }
      await rmdir(objects);
      const marker = path.join(s.rootDirectory, 'store.json');
      assert.ok((await lstat(marker)).isFile());
      await unlink(marker);
      await rmdir(s.rootDirectory);
    }
    assert.deepEqual(await readdir(parent), []);
    await rmdir(parent);
  });
  return {
    requestStore,
    inputStore,
    open,
    async reopen() {
      const r = await reopenDurableSyntheticStore(requestStore.rootDirectory, requestStore.storeId),
        i = await reopenDurableSyntheticStore(inputStore.rootDirectory, inputStore.storeId);
      stores.add(r);
      stores.add(i);
      return open(r, i);
    },
  };
}

test('floor-plan intent and source survive reopen with exact scope, version, store identities and immutable bytes', async (t) => {
  const f = await fixture(t),
    api = f.open(),
    b = binding(1),
    original = syntheticPng(),
    source = Buffer.from(original);
  const running = api.record({ binding: b, source });
  source.fill(0);
  b.companyId = id(999);
  const request = await running;
  assert.equal(request.binding.companyId, id(401));
  assert.equal(request.source.sha256, hash(original));
  assert.equal(request.role, 'floor_plan');
  assert.ok(Object.isFrozen(request.binding));
  assert.notEqual(request.requestStoreId, request.inputStoreId);
  await assert.rejects(
    () => api.record({ binding: { ...binding(1), expectedVersion: 8 }, source: original }),
    code('PERSISTENCE_FAILED'),
  );
  await api.close();
  await f.requestStore.close();
  await f.inputStore.close();
  const reopened = await f.reopen(),
    read = await reopened.read(binding(1));
  assert.deepEqual(read.request, request);
  assert.deepEqual(read.source, original);
  read.source.fill(0);
  assert.deepEqual((await reopened.read(binding(1))).source, original);
  await assert.rejects(
    () => reopened.read({ ...binding(1), companyId: id(999) }),
    code('INTEGRITY'),
  );
});

test('a lost source commit acknowledgement recovers by read without another install or inferred processing authority', async (t) => {
  const f = await fixture(t);
  let installs = 0;
  const wrapped = {
    ...f.inputStore,
    async install(...args) {
      installs++;
      await f.inputStore.install(...args);
      throw Error('ack lost');
    },
  };
  const api = f.open(f.requestStore, wrapped),
    source = syntheticPng();
  await assert.rejects(
    () => api.record({ binding: binding(2), source }),
    code('PERSISTENCE_FAILED'),
  );
  assert.equal(installs, 1);
  const read = await api.read(binding(2));
  assert.deepEqual(read.source, source);
  assert.equal(installs, 1);
  assert.equal(Object.hasOwn(read, 'ticket'), false);
  assert.equal(Object.hasOwn(read, 'lease'), false);
  assert.deepEqual((await (await f.reopen()).read(binding(2))).request, read.request);
});

test('a lost intent acknowledgement leaves input unavailable and read never repairs or overwrites it', async (t) => {
  const f = await fixture(t);
  let writes = 0;
  const r = {
    ...f.requestStore,
    async install(...args) {
      await f.requestStore.install(...args);
      throw Error('ack lost');
    },
  };
  const i = {
    ...f.inputStore,
    async install(...args) {
      writes++;
      return f.inputStore.install(...args);
    },
  };
  const api = f.open(r, i);
  await assert.rejects(
    () => api.record({ binding: binding(3), source: syntheticPng() }),
    code('PERSISTENCE_FAILED'),
  );
  await assert.rejects(() => api.read(binding(3)), code('PERSISTENCE_FAILED'));
  assert.equal(writes, 0);
});

test('canonical floor-plan intent rejects forged role, scope, stores and receipt facts before returning source bytes', async (t) => {
  const f = await fixture(t),
    source = syntheticPng(),
    b = binding(4);
  await f.open().record({ binding: b, source });
  for (const change of [
    (r) => ({ ...r, role: 'photo' }),
    (r) => ({ ...r, pipeline: 'synthetic-codec-v1' }),
    (r) => ({ ...r, inputStoreId: id(999) }),
    (r) => ({ ...r, binding: { ...r.binding, actorId: id(999) } }),
    (r) => ({ ...r, accepted: true }),
  ]) {
    const store = {
      ...f.requestStore,
      async read(ref) {
        const r = await f.requestStore.read(ref);
        const bytes = Buffer.from(JSON.stringify(change(JSON.parse(r.data))) + '\n');
        return { data: bytes, receipt: { ...r.receipt, bytes: bytes.length, sha256: hash(bytes) } };
      },
    };
    await assert.rejects(() => f.open(store).read(b), code('INTEGRITY'));
  }
  const store = {
    ...f.inputStore,
    async read(ref) {
      const r = await f.inputStore.read(ref);
      return { ...r, receipt: { ...r.receipt, objectId: id(999) } };
    },
  };
  await assert.rejects(() => f.open(f.requestStore, store).read(b), code('INTEGRITY'));
});

test('strict descriptors, source bounds and local singleflight/close keep supplied stores caller-owned', async (t) => {
  const f = await fixture(t);
  let getters = 0;
  assert.throws(
    () =>
      createFloorPlanRequests({
        get requestStore() {
          getters++;
          return f.requestStore;
        },
        inputStore: f.inputStore,
      }),
    code('INVALID_CONFIGURATION'),
  );
  assert.equal(getters, 0);
  assert.throws(
    () => createFloorPlanRequests({ requestStore: f.requestStore, inputStore: f.requestStore }),
    code('INVALID_CONFIGURATION'),
  );
  const api = f.open();
  await assert.rejects(
    () =>
      api.record({
        binding: binding(5),
        get source() {
          getters++;
          return syntheticPng();
        },
      }),
    code('INVALID_INPUT'),
  );
  assert.equal(getters, 0);
  for (const source of [
    Buffer.from('%PDF-1.7'),
    Buffer.alloc(0),
    Buffer.alloc(10485761),
    Buffer.from(new SharedArrayBuffer(100)),
  ])
    await assert.rejects(() => api.record({ binding: binding(5), source }), code('INVALID_INPUT'));
  let unblock;
  const gate = new Promise((r) => {
    unblock = r;
  });
  let entered;
  const admission = new Promise((r) => {
    entered = r;
  });
  const wrapped = {
    ...f.requestStore,
    async install(...args) {
      entered();
      await gate;
      return f.requestStore.install(...args);
    },
  };
  const locked = f.open(wrapped);
  const run = locked.record({ binding: binding(5), source: syntheticPng() });
  await admission;
  try {
    await assert.rejects(() => locked.read(binding(5)), code('BUSY'));
    const drained = locked.close();
    await assert.rejects(() => locked.read(binding(5)), code('CLOSED'));
    unblock();
    await run;
    await drained;
    // Closing the facade never closes the supplied durable stores.
    assert.ok(
      (
        await f.inputStore.read({
          jobId: id(5),
          objectId: id(305),
          generationId: id(205),
          kind: 'quarantine',
        })
      ).data.length > 0,
    );
  } finally {
    unblock();
    await run.catch(() => {});
  }
});

test('fresh SQL floor-plan preflight binds real durable source bytes and survives source-store reopening', async (t) => {
  const sql = await import('../../../database/tests/public-media-fixtures.mjs');
  const db = await sql.fixture();
  t.after(() => db.close());
  await db.exec(
    await readFile(
      new URL('../../../database/proposals/floor-plan-registration.sql', import.meta.url),
      'utf8',
    ),
  );
  await sql.createDraft(db);
  const source = syntheticPng();
  const requestId = id(850);
  const saved = await sql.asActor(db, sql.T, sql.AGENT, () =>
    sql.scalar(db, 'SELECT app_api.register_synthetic_floor_plan($1,1,2,$2,$3,$4,$5)', [
      sql.LISTING,
      requestId,
      hash(source),
      source.length,
      'png',
    ]),
  );
  const target = {
    companyId: sql.T,
    actorId: sql.AGENT,
    listingId: sql.LISTING,
    revision: 1,
    requestId,
  };
  const f = await fixture(t),
    requests = f.open();
  let calls = 0;
  const admission = createFloorPlanSourceAdmission({
    requests,
    async preflight(selected) {
      calls++;
      assert.deepEqual(selected, { ...target, listingId: sql.LISTING });
      return sql.asActor(db, selected.companyId, selected.actorId, () =>
        sql.scalar(db, 'SELECT app_api.preflight_synthetic_floor_plan($1,$2,$3)', [
          selected.listingId,
          selected.revision,
          selected.requestId,
        ]),
      );
    },
  });
  const input = Buffer.from(source);
  const pending = admission.record(target, input);
  input.fill(0);
  const recorded = await pending;
  assert.deepEqual(recorded.binding, saved.binding);
  assert.deepEqual(recorded.source, saved.source);
  assert.equal(calls, 1);
  await requests.close();
  await f.requestStore.close();
  await f.inputStore.close();
  const recovered = await f.reopen();
  assert.deepEqual((await recovered.read(saved.binding)).source, source);
  // Disposable edit fixture advances the draft token before the next admission.
  await db.query(
    "UPDATE app_private.listing_revisions SET title='Synthetic later draft edit' WHERE listing_id=$1 AND revision_no=1",
    [sql.LISTING],
  );
  let writes = 0;
  const blocked = createFloorPlanSourceAdmission({
    requests: {
      ...recovered,
      record: (...args) => {
        writes++;
        return recovered.record(...args);
      },
    },
    preflight: (selected) =>
      sql.asActor(db, selected.companyId, selected.actorId, () =>
        sql.scalar(db, 'SELECT app_api.preflight_synthetic_floor_plan($1,$2,$3)', [
          selected.listingId,
          selected.revision,
          selected.requestId,
        ]),
      ),
  });
  await assert.rejects(
    () => blocked.record(target, source),
    (error) => error.code === '40001',
  );
  assert.equal(writes, 0);
  assert.deepEqual((await recovered.read(saved.binding)).request, recorded);
});

test('floor-plan source admission refuses mismatched scope, role and bytes before persistence and never retries preflight', async () => {
  const source = syntheticPng(),
    b = binding(900);
  const target = {
    companyId: b.companyId,
    actorId: b.actorId,
    listingId: b.listingId,
    revision: b.revision,
    requestId: b.requestId,
  };
  const registration = () => ({
    policy: 'synthetic-floor-plan-registration-v1',
    role: 'floor_plan',
    pipeline: 'synthetic-floor-plan-codec-v1',
    countsAsPhoto: false,
    binding: { ...b },
    source: { sha256: hash(source), bytes: source.length, format: 'png' },
    registeredAt: '2026-11-05T00:00:00.000000Z',
    expiresAt: '2026-11-06T00:00:00.000000Z',
  });
  let writes = 0,
    reads = 0,
    getters = 0;
  const requests = {
    record: async () => {
      writes++;
      throw Error('Unexpected persistence');
    },
  };
  const accessor = registration();
  Object.defineProperty(accessor, 'binding', {
    enumerable: true,
    get() {
      getters++;
      return b;
    },
  });
  for (const value of [
    { ...registration(), role: 'photo' },
    { ...registration(), countsAsPhoto: true },
    { ...registration(), binding: { ...b, companyId: id(999) } },
    { ...registration(), source: { ...registration().source, sha256: 'a'.repeat(64) } },
    { ...registration(), source: { ...registration().source, bytes: source.length + 1 } },
    { ...registration(), source: { ...registration().source, format: 'jpeg' } },
    { ...registration(), unexpected: 'private' },
    accessor,
  ]) {
    const admission = createFloorPlanSourceAdmission({
      requests,
      preflight: async () => {
        reads++;
        return value;
      },
    });
    await assert.rejects(() => admission.record(target, source), code('INTEGRITY'));
  }
  assert.equal(reads, 8);
  assert.equal(writes, 0);
  assert.equal(getters, 0);
  let failedCalls = 0;
  const unavailable = createFloorPlanSourceAdmission({
    requests,
    preflight: async () => {
      failedCalls++;
      throw Error('Unavailable');
    },
  });
  await assert.rejects(() => unavailable.record(target, source), /Unavailable/);
  assert.equal(failedCalls, 1);
  assert.equal(writes, 0);
});
