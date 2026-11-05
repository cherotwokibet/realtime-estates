import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, lstat, unlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import { createDurableSyntheticStore, reopenDurableSyntheticStore } from '../dist/durable-store.js';
import {
  createFloorPlanRequests,
  createFloorPlanSourceAdmission,
} from '../dist/floor-plan-request.js';
import { createSyntheticAttemptJournal } from '../dist/attempt-journal.js';
import { createSyntheticWorkerAdmission } from '../dist/worker-admission.js';
import { syntheticPng } from './fixtures.mjs';
import * as sql from '../../../database/tests/public-media-fixtures.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const code = (c) => (e) => e?.code === c;
async function media(db, query, args) {
  await db.exec('BEGIN; SET LOCAL ROLE media_coordinator');
  try {
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [sql.T, sql.AGENT],
    );
    const value = await sql.scalar(db, query, args);
    await db.exec('COMMIT');
    return value;
  } catch (e) {
    await db.exec('ROLLBACK');
    throw e;
  }
}
export async function setup(t, options = {}) {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'realtor-floor-admission-'));
  const resources = [];
  // Cleanup only this exact root, and only after an optional native containment barrier.
  t.after(async () => {
    if (options.allowCleanup && !(await options.allowCleanup())) {
      t.diagnostic(`Unconfirmed native fixture retained at ${parent}`);
      return;
    }
    for (const r of resources.reverse()) await r.close();
    async function clean(dir) {
      assert.ok(path.resolve(dir) === parent || path.resolve(dir).startsWith(parent + path.sep));
      assert.ok(!(await lstat(dir)).isSymbolicLink());
      for (const e of await readdir(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name),
          s = await lstat(p);
        assert.ok(!s.isSymbolicLink());
        if (s.isDirectory()) await clean(p);
        else {
          assert.ok(s.isFile() && s.nlink === 1);
          await unlink(p);
        }
      }
      await rmdir(dir);
    }
    await clean(parent);
  });
  const db = await sql.fixture();
  resources.push(db);
  for (const name of ['registration', 'processing'])
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/floor-plan-' + name + '.sql', import.meta.url),
        'utf8',
      ),
    );
  await sql.createDraft(db);
  const source = syntheticPng(),
    hash = createHash('sha256').update(source).digest('hex');
  const registration = await sql.asActor(db, sql.T, sql.AGENT, () =>
    sql.scalar(db, 'SELECT app_api.register_synthetic_floor_plan($1,1,2,$2,$3,$4,$5)', [
      sql.LISTING,
      id(900),
      hash,
      source.length,
      'png',
    ]),
  );
  const inputStore = await createDurableSyntheticStore(parent),
    requestStore = await createDurableSyntheticStore(parent),
    journalStore = await createDurableSyntheticStore(parent);
  resources.push(inputStore, requestStore, journalStore);
  const requests = createFloorPlanRequests({ inputStore, requestStore });
  resources.push(requests);
  const b = registration.binding,
    sourceTarget = {
      companyId: b.companyId,
      actorId: b.actorId,
      listingId: b.listingId,
      revision: b.revision,
      requestId: b.requestId,
    };
  await createFloorPlanSourceAdmission({
    requests,
    preflight: () =>
      sql.asActor(db, sql.T, sql.AGENT, () =>
        sql.scalar(db, 'SELECT app_api.preflight_synthetic_floor_plan($1,1,$2)', [
          sql.LISTING,
          b.requestId,
        ]),
      ),
  }).record(sourceTarget, source);
  const lease = await media(db, 'SELECT app_media.claim_synthetic_floor_plan($1,1,$2,$3)', [
    sql.LISTING,
    b.requestId,
    id(901),
  ]);
  const attemptParent = path.join(parent, 'attempts'),
    workerParent = path.join(parent, 'workers');
  await mkdir(attemptParent);
  await mkdir(workerParent);
  const journal = await createSyntheticAttemptJournal({ store: journalStore, attemptParent });
  resources.push(journal);
  const worker = await createSyntheticWorkerAdmission({ parentDirectory: workerParent, journal });
  resources.push(worker);
  const target = { ...b, claimId: lease.claimId, leaseNonce: lease.leaseNonce };
  const preflight = () =>
    media(db, 'SELECT app_media.preflight_synthetic_floor_plan_worker($1,1,$2,$3,$4)', [
      sql.LISTING,
      b.requestId,
      lease.claimId,
      lease.leaseNonce,
    ]);
  const config = { requests, journal, worker, preflight };
  return { db, source, requests, journalStore, journal, worker, target, lease, preflight, config };
}
