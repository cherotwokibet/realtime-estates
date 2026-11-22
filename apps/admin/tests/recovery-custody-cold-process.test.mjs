import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, copyFile, readFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createSyntheticRecoveryCustody } from '../../../scripts/private-recovery-custody.mjs';
const worker = fileURLToPath(new URL('./helpers/recovery-custody-worker.mjs', import.meta.url)),
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const original = {
  policy: 'company-settings-command-v1',
  operationId: id(100),
  expectedVersion: '0',
  approval: 'approved-for-publication',
  content: {
    companyName: 'Synthetic custody agency',
    summary: 'COLD_CUSTODY_ORIGINAL_CANARY',
    about: 'Fictional independent fixture.',
    officeAddress: null,
    openingHours: null,
    colors: { primary: '#5e0202', secondary: '#194d3e', accent: '#b77b27', background: '#ffffff' },
  },
};
function run(input) {
  return new Promise((resolve, reject) => {
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !/^PRIVATE_RECOVERY_/i.test(name)),
    );
    env.NODE_ENV = 'development';
    const child = spawn(process.execPath, ['--conditions=react-server', worker], {
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '',
      failed = false;
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
      reject(Error('Cold fixture deadline'));
    }, 45000);
    child.stdout.on('data', (b) => {
      output += b;
      if (output.length > 262144) {
        failed = true;
        child.kill();
        reject(Error('Fixture output too large'));
      }
    });
    child.stderr.on('data', () => {});
    child.stdin.on('error', () => {});
    child.on('error', () => {
      clearTimeout(timer);
      reject(Error('Cold fixture failed'));
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed) return;
      try {
        if (code !== 0) throw Error();
        resolve(JSON.parse(output));
      } catch {
        reject(Error('Cold fixture failed'));
      }
    });
    child.stdin.end(JSON.stringify(input));
  });
}
test(
  'real Windows owner custody reopens an original in a new signed-authority process; valid keys do not bypass current role',
  { skip: process.platform !== 'win32', timeout: 120000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'realtor-custody-cold-')),
      file = join(directory, 'protected-bundle.json'),
      backup = join(directory, 'protected-backup.json');
    t.after(async () => {
      await unlink(file).catch(() => {});
      await unlink(backup).catch(() => {});
      await rmdir(directory);
    });
    const info = await createSyntheticRecoveryCustody(file, 'realtime-estates', {
      NODE_ENV: 'development',
      PRIVATE_RECOVERY_CUSTODY_MODE: 'synthetic-windows-owner-v1',
    });
    const sealed = await run({
      file,
      custodyId: info.custodyId,
      action: 'seal',
      command: original,
    });
    assert.equal(sealed.status, 200);
    assert.ok(sealed.leaseReads >= 2);
    assert.equal(sealed.instanceId, info.instances.staff);
    assert.ok(!JSON.stringify(sealed).includes(original.content.summary));
    await copyFile(file, backup);
    assert.deepEqual(await readFile(file), await readFile(backup));
    const opened = await run({
      file: backup,
      custodyId: info.custodyId,
      action: 'open',
      envelope: sealed.value,
    });
    assert.equal(opened.status, 200);
    assert.notEqual(opened.workerPid, sealed.workerPid);
    assert.ok(opened.leaseReads >= 2);
    assert.equal(opened.instanceId, sealed.instanceId);
    assert.deepEqual(opened.value, original);
    const denied = await run({
      file: backup,
      custodyId: info.custodyId,
      role: 'agent',
      action: 'open',
      envelope: sealed.value,
    });
    assert.equal(denied.status, 403);
    assert.ok(!JSON.stringify(denied).includes(original.content.summary));
    const wrong = await run({
      file: backup,
      custodyId: id(99),
      action: 'open',
      envelope: sealed.value,
    });
    assert.equal(wrong.status, 503);
    assert.equal(wrong.startedAuthority, false);
    assert.ok(!JSON.stringify(wrong).includes(original.content.summary));
  },
);
