import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
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
