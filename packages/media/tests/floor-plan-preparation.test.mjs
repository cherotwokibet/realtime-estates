import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './floor-plan-preparation-fixture.mjs';
import { FloorPlanPreparationUncertainError } from '../dist/floor-plan-preparation.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const code = (c) => (e) => e?.code === c;
test(
  'actual native preparation joins registration/source/claim/seal once and recovery performs no new writes or decoder run',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    const f = await fixture(t, true),
      p = f.open(),
      result = await p.prepare(f.target, f.source);
    assert.equal(result.state, 'prepared');
    assert.equal(result.prepared.expectedVersion, '2');
    assert.equal(result.prepared.requestId, f.target.requestId);
    for (const key of ['storeId', 'leaseNonce', 'claimId', 'generationId', 'actorId', 'companyId'])
      assert.ok(!JSON.stringify(result).includes(key));
    assert.deepEqual(f.calls, {
      register: 1,
      readRegistration: 0,
      claim: 1,
      readLease: 0,
      source: 1,
      native: 1,
      seal: 1,
    });
    const before = { ...f.calls };
    assert.deepEqual(await p.recover(f.target), result);
    for (const key of ['register', 'claim', 'source', 'native', 'seal'])
      assert.equal(f.calls[key], before[key]);
  },
);
// Remaining cases simulate the trusted processor using actual lossless conversion and isolated SQL.
test('known uncertain register and claim acknowledgements read the exact originals without reissuing commands', async (t) => {
  const f = await fixture(t),
    p = f.open({
      register: async (...args) => {
        await f.config.register(...args);
        throw new FloorPlanPreparationUncertainError();
      },
      claim: async (...args) => {
        await f.config.claim(...args);
        throw new FloorPlanPreparationUncertainError();
      },
    });
  assert.equal((await p.prepare(f.target, f.source)).state, 'prepared');
  assert.equal(f.calls.register, 1);
  assert.equal(f.calls.claim, 1);
  assert.equal(f.calls.readRegistration, 1);
  assert.equal(f.calls.readLease, 1);
  assert.equal(f.calls.native, 1);
});
test('generic register failure and mismatched registration scope never persist source or start processing', async (t) => {
  const f = await fixture(t);
  const failed = f.open({
    register: async () => {
      throw Error('Known unavailable');
    },
  });
  await assert.rejects(() => failed.prepare(f.target, f.source), /Known unavailable/);
  assert.equal(f.calls.readRegistration, 0);
  const different = f.open({
    register: async (...args) => {
      const r = await f.config.register(...args);
      return { ...r, binding: { ...r.binding, actorId: id(2999) } };
    },
  });
  await assert.rejects(() => different.prepare(f.target, f.source), code('INTEGRITY'));
  assert.equal(f.calls.source, 0);
  assert.equal(f.calls.claim, 0);
  assert.equal(f.calls.native, 0);
});
test('source persistence failure retains registration and read-only recovery cannot recreate a missing lease', async (t) => {
  const f = await fixture(t),
    p = f.open({
      sourceAdmission: {
        record: async () => {
          throw Error('Source write uncertain');
        },
      },
    });
  await assert.rejects(() => p.prepare(f.target, f.source), /Source write uncertain/);
  const before = { ...f.calls };
  assert.equal((await p.recover(f.target)).state, 'blocked');
  for (const key of ['register', 'claim', 'source', 'native', 'seal'])
    assert.equal(f.calls[key], before[key]);
});
test('preparation snapshots source/target, rejects concurrent work and drains on close', async (t) => {
  const f = await fixture(t);
  let release, started;
  const held = new Promise((r) => (release = r)),
    entered = new Promise((r) => (started = r));
  const p = f.open({
      register: async (...args) => {
        started();
        await held;
        return f.config.register(...args);
      },
    }),
    input = Buffer.from(f.source),
    target = { ...f.target },
    pending = p.prepare(target, input);
  await entered;
  input.fill(0);
  target.requestId = id(2999);
  await assert.rejects(() => p.prepare(f.target, f.source), code('BUSY'));
  let done = false;
  const closing = p.close().then(() => (done = true));
  await Promise.resolve();
  assert.equal(done, false);
  await assert.rejects(() => p.prepare(f.target, f.source), code('CLOSED'));
  release();
  assert.equal((await pending).prepared.requestId, f.target.requestId);
  await closing;
  assert.equal(done, true);
});
test('a changed claimed original and unavailable recovery never become fresh native authority', async (t) => {
  const f = await fixture(t),
    p = f.open({
      claim: async (...args) => {
        const r = await f.config.claim(...args);
        return { ...r, claimId: id(2999) };
      },
    });
  await assert.rejects(() => p.prepare(f.target, f.source));
  assert.equal(f.calls.native, 0);
  const before = { ...f.calls };
  assert.equal((await p.recover(f.target)).state, 'blocked');
  for (const key of ['register', 'claim', 'source', 'native', 'seal'])
    assert.equal(f.calls[key], before[key]);
});
