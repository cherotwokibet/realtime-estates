import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, lstat, open, readdir, rmdir, unlink, writeFile } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLocalSyntheticStore } from '@realtor/media/local-store';
import { verifySyntheticProcessReadback } from '@realtor/media/process-readback';
import { createWindowsSyntheticSupervisor } from '@realtor/media/windows-supervisor';
import { syntheticPng } from './fixtures.mjs';

// This coordinator test imports no Sharp/native decoder. Actual decoding happens
// only in the fixed child entry, under the reviewed Windows Job Object helper.
const WINDOWS_ONLY = { skip: process.platform !== 'win32', timeout: 90_000 };
const POWER_SHELL =
  process.env.REALTOR_TEST_POWERSHELL ??
  path.join(
    homedir(),
    '.cache',
    'codex-runtimes',
    'codex-primary-runtime',
    'dependencies',
    'native',
    'powershell',
    'pwsh.exe',
  );
const ENTRY = fileURLToPath(new URL('../dist/codec-worker.js', import.meta.url));
async function* chunks(bytes) {
  for (let n = 0; n < bytes.length; n += 11) yield bytes.subarray(n, n + 11);
}

async function boundedRead(directory, name, maximum) {
  const location = path.join(directory, name);
  const stat = await lstat(location, { bigint: true });
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1n);
  assert.ok(stat.size > 0n && stat.size <= BigInt(maximum));
  const file = await open(location, 'r');
  try {
    const before = await file.stat({ bigint: true });
    assert.equal(before.ino, stat.ino);
    assert.equal(before.dev, stat.dev);
    assert.ok(
      before.isFile() && before.nlink === 1n && before.size > 0n && before.size <= BigInt(maximum),
    );
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const result = await file.read(buffer, offset, buffer.length - offset, null);
      if (!result.bytesRead) break;
      offset += result.bytesRead;
    }
    const after = await file.stat({ bigint: true });
    assert.equal(offset, Number(before.size));
    assert.equal(after.size, before.size);
    assert.equal(after.mtimeNs, before.mtimeNs);
    return buffer.subarray(0, offset);
  } finally {
    await file.close();
  }
}

async function environment(t) {
  const parent = await mkdtemp(path.join(tmpdir(), 'realtor codec process '));
  const attemptParent = await mkdtemp(path.join(parent, 'attempts '));
  const attempt = await mkdtemp(path.join(attemptParent, 'owned '));
  const store = await createLocalSyntheticStore(parent);
  const supervisor = await createWindowsSyntheticSupervisor({
    powerShellPath: POWER_SHELL,
    attemptParent,
  });
  let cleanupAllowed = true; // The attempt has not launched yet.
  t.after(async () => {
    if (!cleanupAllowed) {
      t.diagnostic(`Unconfirmed synthetic codec attempt retained, including store: ${parent}`);
      return;
    }
    // Cleanup is owned/nonrecursive and happens only before launch or after
    // a confirmed empty job. An unknown outcome retains the entire attempt.
    await store.dispose();
    for (const name of await readdir(attempt)) {
      assert.ok(['source.input', 'converted.webp', 'manifest.json'].includes(name));
      const location = path.join(attempt, name);
      const stat = await lstat(location);
      assert.ok(stat.isFile() && !stat.isSymbolicLink());
      await unlink(location);
    }
    await rmdir(attempt);
    await rmdir(attemptParent);
    await rmdir(parent);
  });
  async function run() {
    cleanupAllowed = false;
    const result = await supervisor.run({
      executablePath: process.execPath,
      arguments: [ENTRY],
      workingDirectory: attempt,
      timeoutMs: 10_000,
    });
    cleanupAllowed = result.termination === 'job_empty';
    assert.equal(result.termination, 'job_empty');
    assert.equal(result.activeProcesses, 0);
    assert.equal(result.state, 'exited', JSON.stringify(result));
    return result;
  }
  return { store, attempt, run };
}

test(
  'actual child codec produces hash-matched WebP and a sidecar before local storage publication',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t);
    const input = syntheticPng(31, 23, (x, y) => [x * 7, y * 10, 90, (x + y) % 2 ? 120 : 255]);
    const capturedObject = await e.store.ingest(chunks(input));
    const captured = await e.store.read(capturedObject.handle);
    await writeFile(path.join(e.attempt, 'source.input'), captured, { flag: 'wx', mode: 0o600 });
    const outcome = await e.run();
    assert.equal(outcome.exitCode, 0);
    const output = await boundedRead(e.attempt, 'converted.webp', 10 * 1024 * 1024);
    const sidecar = await boundedRead(e.attempt, 'manifest.json', 4096);
    const verified = verifySyntheticProcessReadback(captured, output, sidecar);
    assert.equal(verified.manifest.inputSha256, capturedObject.sha256);
    assert.equal(verified.manifest.inputBytes, capturedObject.bytes);
    assert.equal(verified.manifest.width, 31);
    assert.equal(verified.manifest.height, 23);
    const saved = await e.store.publish(verified.data);
    assert.equal(saved.sha256, verified.manifest.sha256);
    assert.equal(saved.bytes, verified.manifest.bytes);
    assert.deepEqual(await e.store.read(saved.handle), output);
    assert.deepEqual(await e.store.read(capturedObject.handle), input);
    assert.equal(Object.hasOwn(saved, 'accepted'), false);
  },
);

test(
  'actual child rejects corrupt bytes and leaves only private source after a confirmed barrier',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t);
    const source = Buffer.from('synthetic invalid image');
    const captured = await e.store.ingest(chunks(source));
    await writeFile(path.join(e.attempt, 'source.input'), await e.store.read(captured.handle), {
      flag: 'wx',
    });
    assert.equal((await e.run()).exitCode, 1);
    assert.deepEqual(await readdir(e.attempt), ['source.input']);
    assert.deepEqual(await e.store.read(captured.handle), source);
  },
);

test(
  'exclusive sidecar collision cannot be accepted and partial output waits for confirmed termination cleanup',
  WINDOWS_ONLY,
  async (t) => {
    const e = await environment(t);
    const input = syntheticPng();
    const sentinel = Buffer.from('synthetic existing sidecar; never overwrite');
    await writeFile(path.join(e.attempt, 'source.input'), input, { flag: 'wx' });
    await writeFile(path.join(e.attempt, 'manifest.json'), sentinel, { flag: 'wx' });
    assert.equal((await e.run()).exitCode, 1);
    assert.deepEqual(await boundedRead(e.attempt, 'manifest.json', 4096), sentinel);
    const output = await boundedRead(e.attempt, 'converted.webp', 10 * 1024 * 1024);
    assert.throws(() => verifySyntheticProcessReadback(input, output, sentinel));
    // No publication occurs on failed exit/readback; t.after cleans known partial
    // files only because run() already observed the native empty-job receipt.
  },
);
