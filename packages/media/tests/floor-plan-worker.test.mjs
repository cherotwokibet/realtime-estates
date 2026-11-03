import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, readdir, lstat, unlink, rmdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { convertSyntheticFloorPlan, convertSyntheticImage } from '../dist/index.js';
import {
  verifySyntheticFloorPlanReadback,
  verifySyntheticProcessReadback,
  MediaReadbackError,
} from '../dist/process-readback.js';
import { processingManifest } from '../dist/processing-request.js';
import {
  createWindowsSyntheticSupervisor,
  retireWindowsSyntheticSupervisor,
} from '../dist/windows-supervisor.js';
import { syntheticPng } from './fixtures.mjs';

const json = (m) => Buffer.from(JSON.stringify(m) + '\n');
const source = () =>
  syntheticPng(96, 64, (x, y) =>
    x === 20 || y === 20 || x === 75 || y === 48 ? [0, 0, 0, 255] : [255, 255, 255, 255],
  );

test('floor-plan readback binds actual bytes and refuses the existing photo manifest boundary in both directions', async () => {
  const input = source();
  const floor = await convertSyntheticFloorPlan(input);
  const result = verifySyntheticFloorPlanReadback(input, floor.data, json(floor.manifest));
  assert.deepEqual(result.manifest, floor.manifest);
  assert.ok(Object.isFrozen(result.manifest) && Object.isFrozen(result.manifest.operations));
  assert.throws(
    () => verifySyntheticProcessReadback(input, floor.data, json(floor.manifest)),
    MediaReadbackError,
  );
  assert.throws(() => processingManifest(floor.manifest));
  const photo = await convertSyntheticImage(input);
  assert.throws(
    () => verifySyntheticFloorPlanReadback(input, photo.data, json(photo.manifest)),
    MediaReadbackError,
  );
  const expected = Buffer.from(result.data);
  floor.data.fill(0);
  input.fill(0);
  assert.deepEqual(result.data, expected);
});

test('floor-plan readback refuses role relabelling, lossy output and forged or noncanonical sidecars', async () => {
  const input = source();
  const r = await convertSyntheticFloorPlan(input);
  for (const changes of [
    { role: 'photo' },
    { countsAsPhoto: true },
    { pipeline: 'synthetic-codec-v1' },
    { inputSha256: '0'.repeat(64) },
    { sha256: '0'.repeat(64) },
    { inputBytes: input.length + 1 },
    { width: r.manifest.width + 1 },
    { accepted: true },
    { encoder: { ...r.manifest.encoder, vips: 'unknown' } },
    { operations: [...r.manifest.operations.slice(0, 3), 'webp-quality-82-effort-4'] },
  ])
    assert.throws(
      () => verifySyntheticFloorPlanReadback(input, r.data, json({ ...r.manifest, ...changes })),
      MediaReadbackError,
    );
  const text = JSON.stringify(r.manifest);
  for (const bad of [
    text.replace('"width":96', '"width":96,"width":96'),
    text.replace('"width":96', '"width":9.6e1'),
    text.replace('"role"', '"\\u0072ole"'),
  ])
    assert.throws(
      () => verifySyntheticFloorPlanReadback(input, r.data, Buffer.from(bad)),
      MediaReadbackError,
    );
  const photo = await convertSyntheticImage(input);
  assert.ok(
    photo.data.includes(Buffer.from('VP8 ')),
    'The relabelled fixture must actually use lossy coding.',
  );
  assert.throws(
    () =>
      verifySyntheticFloorPlanReadback(
        input,
        photo.data,
        json({
          ...photo.manifest,
          pipeline: r.manifest.pipeline,
          role: 'floor_plan',
          countsAsPhoto: false,
          operations: r.manifest.operations,
        }),
      ),
    MediaReadbackError,
  );
});

test(
  'fixed floor-plan worker runs in the owned Windows job and rejects caller-supplied role arguments',
  { skip: process.platform !== 'win32', timeout: 90_000 },
  async (t) => {
    const parent = await mkdtemp(path.join(os.tmpdir(), 'realtor floor-plan job '));
    const supervisor = await createWindowsSyntheticSupervisor({
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
      attemptParent: parent,
    });
    const attempts = [];
    let allEmpty = true;
    t.after(async () => {
      const retired = await retireWindowsSyntheticSupervisor(supervisor);
      if (!retired || !allEmpty) {
        t.diagnostic(`Unconfirmed floor-plan attempt retained: ${parent}`);
        return;
      }
      for (const directory of attempts) {
        assert.equal(path.dirname(directory), parent);
        assert.ok(!(await lstat(directory)).isSymbolicLink());
        for (const name of await readdir(directory)) {
          const file = path.join(directory, name);
          const stat = await lstat(file);
          assert.ok(stat.isFile() && !stat.isSymbolicLink());
          await unlink(file);
        }
        await rmdir(directory);
      }
      await rmdir(parent);
    });
    const input = source();
    const worker = fileURLToPath(new URL('../dist/floor-plan-worker.js', import.meta.url));
    for (const extra of [[], ['photo']]) {
      const directory = await mkdtemp(path.join(parent, 'attempt '));
      attempts.push(directory);
      await writeFile(path.join(directory, 'source.input'), input, { flag: 'wx', mode: 0o600 });
      allEmpty = false;
      const outcome = await supervisor.run({
        executablePath: process.execPath,
        arguments: [worker, ...extra],
        workingDirectory: directory,
        timeoutMs: 10_000,
      });
      allEmpty = outcome.termination === 'job_empty';
      assert.ok(allEmpty, 'Readback and cleanup require an actual empty-job barrier.');
      assert.equal(outcome.activeProcesses, 0);
      if (extra.length) {
        assert.equal(outcome.state, 'exited'); // A nonzero worker exit is still a confirmed process exit.
        assert.equal(outcome.exitCode, 1);
        assert.deepEqual(await readdir(directory), ['source.input']);
      } else {
        assert.equal(outcome.state, 'exited');
        assert.equal(outcome.exitCode, 0);
        const result = verifySyntheticFloorPlanReadback(
          input,
          await readFile(path.join(directory, 'converted.webp')),
          await readFile(path.join(directory, 'manifest.json')),
        );
        assert.equal(result.manifest.role, 'floor_plan');
        assert.equal(result.manifest.countsAsPhoto, false);
        assert.deepEqual(
          await sharp(result.data).ensureAlpha().raw().toBuffer(),
          await sharp(input).ensureAlpha().raw().toBuffer(),
        );
      }
    }
  },
);
