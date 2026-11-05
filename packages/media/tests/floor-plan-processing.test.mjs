import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { setup } from './floor-plan-fixture.mjs';
import { createFloorPlanProcessor } from '../dist/floor-plan-processing.js';
import {
  createWindowsSyntheticSupervisor,
  retireWindowsSyntheticSupervisor,
} from '../dist/windows-supervisor.js';
import { convertSyntheticFloorPlan } from '../dist/index.js';
import * as sql from '../../../database/tests/public-media-fixtures.mjs';
const code = (c) => (e) => e?.code === c;
const empty = {
  state: 'exited',
  termination: 'job_empty',
  exitCode: 0,
  activeProcesses: 0,
  safeCode: 'EXITED',
};

test(
  'actual SQL/source/journal admission stages and decodes through the fixed Windows floor-plan child',
  { skip: process.platform !== 'win32', timeout: 90000 },
  async (t) => {
    let supervisor;
    const f = await setup(t, {
      allowCleanup: async () =>
        !supervisor || Boolean(await retireWindowsSyntheticSupervisor(supervisor)),
    });
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
    const processor = await createFloorPlanProcessor({ ...f.config, supervisor });
    try {
      const result = await processor.run(f.target);
      assert.equal(result.state, 'readback_verified');
      assert.equal(result.outcome.termination, 'job_empty');
      assert.equal(result.outcome.exitCode, 0);
      assert.equal(result.result.manifest.role, 'floor_plan');
      assert.equal(result.result.manifest.countsAsPhoto, false);
      assert.equal(result.lease.outputObjectId, f.lease.outputObjectId);
      assert.deepEqual(
        await sharp(result.result.data).ensureAlpha().raw().toBuffer(),
        await sharp(f.source).ensureAlpha().raw().toBuffer(),
      );
      const binding = {
        jobId: f.target.jobId,
        claimId: f.target.claimId,
        attempt: 1,
        leaseNonce: f.target.leaseNonce,
      };
      assert.equal((await f.journal.inspect(binding)).state, 'termination_recorded');
      assert.equal((await f.worker.inspect()).state, 'idle');
      await assert.rejects(() => processor.run(f.target), code('BLOCKED'));
      assert.equal((await f.worker.inspect()).state, 'idle');
    } finally {
      await processor.close();
    }
  },
);

// The remaining tests explicitly simulate supervisor observations. No native process starts.
function simulated(f, action) {
  return {
    async run(request) {
      assert.equal(request.executablePath, process.execPath);
      assert.equal(request.arguments.length, 1);
      assert.equal(path.basename(request.arguments[0]), 'floor-plan-worker.js');
      assert.equal(request.maxProcesses, 1);
      assert.equal(request.timeoutMs, 10000);
      const bytes = await readFile(path.join(request.workingDirectory, 'source.input'));
      assert.deepEqual(bytes, f.source);
      return action(request);
    },
  };
}
async function output(f, request) {
  const result = await convertSyntheticFloorPlan(f.source);
  await writeFile(path.join(request.workingDirectory, 'converted.webp'), result.data, {
    flag: 'wx',
  });
  await writeFile(
    path.join(request.workingDirectory, 'manifest.json'),
    JSON.stringify(result.manifest) + '\n',
    { flag: 'wx' },
  );
}
test('simulated unconfirmed supervisor retains the worker and journal without output inspection or replacement', async (t) => {
  const f = await setup(t);
  let calls = 0;
  const processor = await createFloorPlanProcessor({
    ...f.config,
    supervisor: simulated(f, async () => {
      calls++;
      throw Error('Lost supervisor acknowledgement');
    }),
  });
  const result = await processor.run(f.target);
  assert.equal(result.state, 'native_failed');
  assert.equal(result.outcome.termination, 'unconfirmed');
  assert.equal((await f.worker.inspect()).state, 'blocked');
  await assert.rejects(() => processor.run(f.target), code('BLOCKED'));
  assert.equal(calls, 1);
  await processor.close();
});
test('simulated successful process with malformed bytes cannot become verified readback', async (t) => {
  const f = await setup(t);
  const processor = await createFloorPlanProcessor({
    ...f.config,
    supervisor: simulated(f, async (r) => {
      await writeFile(path.join(r.workingDirectory, 'converted.webp'), 'not lossless', {
        flag: 'wx',
      });
      await writeFile(path.join(r.workingDirectory, 'manifest.json'), '{}\n', { flag: 'wx' });
      return empty;
    }),
  });
  await assert.rejects(
    () => processor.run(f.target),
    (e) => e.name === 'MediaReadbackError',
  );
  assert.equal((await f.worker.inspect()).state, 'idle');
  await assert.rejects(() => processor.run(f.target), code('BLOCKED'));
  await processor.close();
});
test('fresh SQL draft check after simulated decoding refuses private result delivery', async (t) => {
  const f = await setup(t);
  const processor = await createFloorPlanProcessor({
    ...f.config,
    supervisor: simulated(f, async (r) => {
      await output(f, r);
      await f.db.query(
        "UPDATE app_private.listing_revisions SET title='edited during decode' WHERE listing_id=$1",
        [sql.LISTING],
      );
      return empty;
    }),
  });
  await assert.rejects(() => processor.run(f.target), code('40001'));
  assert.equal((await f.worker.inspect()).state, 'idle');
  await processor.close();
});
test('exclusive source staging refuses an existing file and cannot replace its original bytes', async (t) => {
  const f = await setup(t);
  const worker = {
    ...f.worker,
    async reserve(b) {
      const slot = await f.worker.reserve(b);
      return slot;
    },
  };
  const journal = {
    ...f.journal,
    async reserve(b) {
      const r = await f.journal.reserve(b);
      await writeFile(path.join(r.intent.attemptDirectory, 'source.input'), 'original sentinel', {
        flag: 'wx',
      });
      return r;
    },
  };
  let calls = 0;
  const processor = await createFloorPlanProcessor({
    ...f.config,
    worker,
    journal,
    supervisor: {
      run: async () => {
        calls++;
        return empty;
      },
    },
  });
  await assert.rejects(() => processor.run(f.target));
  assert.equal(calls, 0);
  assert.equal((await f.worker.inspect()).state, 'idle');
  assert.equal(
    await readFile(path.join(f.journal.attemptParent, f.target.jobId, 'source.input'), 'utf8'),
    'original sentinel',
  );
  await processor.close();
});

test('simulated deadline failure requires no output files and remains non-verified', async (t) => {
  const f = await setup(t);
  let calls = 0;
  const processor = await createFloorPlanProcessor({
    ...f.config,
    supervisor: simulated(f, async () => {
      calls++;
      return {
        state: 'timed_out',
        termination: 'job_empty',
        exitCode: null,
        activeProcesses: 0,
        safeCode: 'DEADLINE',
      };
    }),
  });
  const result = await processor.run(f.target);
  assert.equal(result.state, 'native_failed');
  assert.equal(result.outcome.state, 'timed_out');
  assert.equal((await f.worker.inspect()).state, 'idle');
  await assert.rejects(() => processor.run(f.target), code('BLOCKED'));
  assert.equal(calls, 1);
  await processor.close();
});
test('a simulated successful child with an unexpected file is not admitted as output', async (t) => {
  const f = await setup(t),
    processor = await createFloorPlanProcessor({
      ...f.config,
      supervisor: simulated(f, async (r) => {
        await output(f, r);
        await writeFile(path.join(r.workingDirectory, 'unexpected.txt'), 'synthetic', {
          flag: 'wx',
        });
        return empty;
      }),
    });
  await assert.rejects(() => processor.run(f.target), code('INTEGRITY'));
  assert.equal((await f.worker.inspect()).state, 'idle');
  await processor.close();
});
test('input snapshot, busy fence and close drain preserve an admitted supervised attempt', async (t) => {
  const f = await setup(t);
  let release, started;
  const held = new Promise((r) => (release = r)),
    entered = new Promise((r) => (started = r));
  const processor = await createFloorPlanProcessor({
    ...f.config,
    supervisor: simulated(f, async (r) => {
      started();
      await held;
      await output(f, r);
      return empty;
    }),
  });
  const mutable = { ...f.target },
    pending = processor.run(mutable);
  mutable.jobId = '00000000-0000-4000-8000-000000000999';
  await entered;
  await assert.rejects(() => processor.run(f.target), code('BUSY'));
  let drained = false;
  const closing = processor.close().then(() => {
    drained = true;
  });
  await Promise.resolve();
  assert.equal(drained, false);
  await assert.rejects(() => processor.run(f.target), code('CLOSED'));
  release();
  const result = await pending;
  assert.equal(result.state, 'readback_verified');
  assert.equal(result.lease.target.jobId, f.target.jobId);
  await closing;
  assert.equal(drained, true);
});
