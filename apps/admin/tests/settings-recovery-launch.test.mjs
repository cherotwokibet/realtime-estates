import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rmdir, realpath, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { startSettingsRecoveryPreview } from '../../../scripts/settings-recovery-preview.mjs';
import { marker } from '../../api/dev/recovery-ledger-preview.mjs';
const launcher = fileURLToPath(
  new URL('../../../scripts/settings-recovery-preview.mjs', import.meta.url),
);
test('owned settings CLI refuses production, missing mode and ambiguous initialization before creating custody or SQL state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'realtor-launch-guards-'));
  t.after(() => rmdir(directory));
  for (const [environment, args] of [
    ['production', ['--mode', 'owned-settings-rehearsal-v1', '--initialize', 'new-disposable-v1']],
    ['development', ['--initialize', 'new-disposable-v1']],
    [
      'development',
      [
        '--mode',
        'owned-settings-rehearsal-v1',
        '--initialize',
        'new-disposable-v1',
        '--root',
        directory,
      ],
    ],
    [
      'development',
      [
        '--mode',
        'owned-settings-rehearsal-v1',
        '--mode',
        'owned-settings-rehearsal-v1',
        '--initialize',
        'new-disposable-v1',
      ],
    ],
  ]) {
    const result = spawnSync(process.execPath, [launcher, ...args], {
      env: {
        ...process.env,
        NODE_ENV: environment,
        TEMP: directory,
        TMP: directory,
        TMPDIR: directory,
      },
      encoding: 'utf8',
      windowsHide: true,
      timeout: 15000,
    });
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.match(result.stderr, /Owned settings recovery preview unavailable/);
    assert.deepEqual(await readdir(directory), []);
  }
});

test('an occupied loopback port is refused before custody or SQL startup and leaves its listener untouched', async (t) => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'realtor-ledger490-')));
  await writeFile(join(directory, 'owner.txt'), marker, { flag: 'wx' });
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((r) => server.close(r));
    await unlink(join(directory, 'owner.txt'));
    await rmdir(directory);
  });
  const port = server.address().port;
  await assert.rejects(
    startSettingsRecoveryPreview({
      policy: 'owned-settings-rehearsal-v1',
      root: directory,
      file: join(directory, 'must-not-be-created.json'),
      custodyId: '00000000-0000-4000-8000-000000000001',
      port,
      initialize: true,
    }),
    /port unavailable/,
  );
  assert.equal(server.listening, true);
  assert.deepEqual(await readdir(directory), ['owner.txt']);
});
