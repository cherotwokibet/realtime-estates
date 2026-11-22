import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, readFile, realpath, rm, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { marker, ownedLedgerRoot } from './helpers/recovery-ledger-fixture.mjs';
import { ledgerTestProtection } from './helpers/recovery-ledger-protection.mjs';
import { createSyntheticRecoveryCustody } from '../../../scripts/private-recovery-custody.mjs';
const worker = fileURLToPath(new URL('./helpers/recovery-ledger-worker.mjs', import.meta.url));
function run(data) {
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
    let text = '',
      failed = false;
    const stop = () => {
      if (failed) return;
      failed = true;
      clearTimeout(timer);
      child.kill();
      reject(Error('Owned ledger worker failed.'));
    };
    const timer = setTimeout(stop, 60000);
    child.on('error', stop);
    child.stdin.on('error', stop);
    child.stderr.on('data', () => {});
    child.stdout.on('data', (b) => {
      text += b;
      if (Buffer.byteLength(text) > 262144) stop();
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (failed) return;
      try {
        assert.equal(code, 0);
        resolve(JSON.parse(text));
      } catch {
        stop();
      }
    });
    child.stdin.end(JSON.stringify(data));
  });
}
async function root(t) {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'realtor-ledger490-')));
  await writeFile(join(directory, 'owner.txt'), marker, { flag: 'wx' });
  t.after(async () => {
    await ownedLedgerRoot(directory);
    await rm(directory, { recursive: true, force: false });
  });
  return directory;
}
const command = {
  policy: 'company-settings-command-v1',
  operationId: '00000000-0000-4000-8000-000000049001',
  expectedVersion: '0',
  approval: 'approved-for-publication',
  content: {
    companyName: 'Synthetic persistent ledger agency',
    summary: 'OWNED_LEDGER490_ORIGINAL_CANARY',
    about: 'Independent synthetic fixture.',
    officeAddress: null,
    openingHours: null,
    colors: { primary: '#194d3e', secondary: '#5e0202', accent: '#b77b27', background: '#ffffff' },
  },
};
test(
  'protected original survives graceful SQL/API process restart with fresh authority; negative recovery never replaces the ledger',
  { timeout: 240000 },
  async (t) => {
    const directory = await root(t),
      file = join(directory, 'custody.json'),
      copy = join(directory, 'custody-backup.json'),
      testWrappingKey = process.platform === 'win32' ? undefined : randomBytes(32).toString('hex');
    const info = await createSyntheticRecoveryCustody(
      file,
      'realtime-estates',
      { NODE_ENV: 'development', PRIVATE_RECOVERY_CUSTODY_MODE: 'synthetic-windows-owner-v1' },
      ledgerTestProtection(testWrappingKey),
    );
    const first = await run({
      root: directory,
      initialize: true,
      file,
      custodyId: info.custodyId,
      testWrappingKey,
      action: 'seal-and-commit',
      corruptFirstReply: true,
      command,
    });
    assert.equal(first.status, 502, JSON.stringify(first));
    assert.equal(first.count, 1);
    assert.equal(first.writeRequests, 1);
    assert.ok(first.receiptDigest);
    assert.equal(first.envelope.scope.instanceId, info.instances.staff);
    assert.ok(!JSON.stringify(first).includes(command.content.summary));
    await copyFile(file, copy);
    assert.deepEqual(await readFile(file), await readFile(copy));
    const args = {
      root: directory,
      file: copy,
      custodyId: info.custodyId,
      testWrappingKey,
      action: 'open-and-recover',
      envelope: first.envelope,
    };
    await t.test(
      'same persistent ledger and copied protected bundle recover the immutable receipt and exact replay once',
      async () => {
        const second = await run(args);
        assert.equal(second.status, 200, JSON.stringify(second));
        assert.equal(second.replayStatus, 200);
        assert.deepEqual(second.receipt, second.replayReceipt);
        assert.deepEqual(second.receipt.request, command);
        assert.equal(second.receipt.version, '1');
        assert.equal(second.count, 1);
        assert.equal(second.receiptDigest, first.receiptDigest);
        assert.equal(second.writeRequests, 1);
        assert.notEqual(second.workerPid, first.workerPid);
        assert.notEqual(second.signingFingerprint, first.signingFingerprint);
        assert.equal(
          second.protection,
          process.platform === 'win32'
            ? 'windows-current-user-dpapi-v1'
            : 'owned-disposable-test-v1',
        );
      },
    );
    await t.test(
      'a changed SQL role denies reopening despite valid key and original identity',
      async () => {
        const denied = await run({ ...args, membershipRole: 'agent' });
        assert.equal(denied.status, 403);
        assert.equal(denied.count, 1);
        assert.equal(denied.writeRequests, 0);
        assert.ok(!JSON.stringify(denied).includes(command.content.summary));
      },
    );
    await t.test('a wrong preview instance refuses the original and sends no write', async () => {
      const denied = await run({
        ...args,
        membershipRole: 'admin',
        instanceOverride: randomUUID(),
      });
      assert.equal(denied.status, 403);
      assert.equal(denied.count, 1);
      assert.equal(denied.writeRequests, 0);
    });
    await t.test(
      'wrong pinned custody and corrupt bundle refuse before authority startup',
      async () => {
        const wrong = await run({ ...args, custodyId: randomUUID() });
        assert.equal(wrong.status, 503);
        assert.equal(wrong.startedAuthority, false);
        const corrupt = join(directory, 'corrupt.json');
        await writeFile(corrupt, '{"invalid":"synthetic"}');
        const denied = await run({ ...args, file: corrupt });
        assert.equal(denied.status, 503);
        assert.equal(denied.startedAuthority, false);
      },
    );
    await t.test('missing original ledger never initializes a replacement', async () => {
      const missing = await root(t),
        before = await readFile(join(missing, 'owner.txt'));
      const denied = await run({ ...args, root: missing });
      assert.equal(denied.status, 503);
      assert.equal(denied.startedAuthority, false);
      assert.deepEqual(await readFile(join(missing, 'owner.txt')), before);
      const { readdir } = await import('node:fs/promises');
      assert.deepEqual(await readdir(missing), ['owner.txt']);
    });
    await t.test(
      'a valid empty ledger has no original receipt and sends no replay or cancellation',
      async () => {
        const empty = await root(t),
          unknown = await run({ ...args, root: empty, initialize: true });
        assert.equal(unknown.status, 404, JSON.stringify(unknown));
        assert.equal(unknown.opened, true);
        assert.equal(unknown.count, 0);
        assert.equal(unknown.writeRequests, 0);
        assert.equal(unknown.receiptDigest, null);
        assert.ok(!JSON.stringify(unknown).includes(command.content.summary));
      },
    );
    await t.test(
      'all refused attempts leave the original ledger recoverable at version one',
      async () => {
        const recovered = await run(args);
        assert.equal(recovered.status, 200);
        assert.equal(recovered.count, 1);
        assert.equal(recovered.receipt.version, '1');
        assert.equal(recovered.receiptDigest, first.receiptDigest);
        assert.deepEqual(recovered.receipt.request, command);
      },
    );
    await t.test('explicit reinitialization cannot overwrite an existing ledger', async () => {
      const refused = await run({ ...args, initialize: true });
      assert.equal(refused.status, 503);
      assert.equal(refused.startedAuthority, false);
      const recovered = await run(args);
      assert.equal(recovered.count, 1);
      assert.equal(recovered.receiptDigest, first.receiptDigest);
    });
  },
);
