import { fileURLToPath } from 'node:url';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { mkdtemp, readFile, writeFile, copyFile, unlink, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import {
  createSyntheticRecoveryCustody,
  loadSyntheticRecoveryCustody,
  windowsRecoveryProtection,
} from '../../../scripts/private-recovery-custody.mjs';
import {
  syntheticRecoveryLaunchEnvironment,
  publicPreviewRecoveryEnvironment,
} from '../../../scripts/synthetic-recovery-launch.mjs';
const mode = {
    NODE_ENV: 'development',
    PRIVATE_RECOVERY_CUSTODY_MODE: 'synthetic-windows-owner-v1',
  },
  id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
async function area(t) {
  const dir = await mkdtemp(join(tmpdir(), 'realtor-custody-test-')),
    files = [];
  t.after(async () => {
    for (const file of files) await unlink(file).catch(() => {});
    await rmdir(dir);
  });
  return (name) => {
    const p = join(dir, name);
    files.push(p);
    return p;
  };
}
function fixtureProtection() {
  const key = randomBytes(32);
  return {
    name: 'owned-disposable-test-v1',
    async protect(bytes) {
      const iv = randomBytes(12),
        c = createCipheriv('aes-256-gcm', key, iv),
        body = Buffer.concat([c.update(bytes), c.final()]);
      return Buffer.concat([iv, c.getAuthTag(), body]);
    },
    async open(bytes) {
      const c = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      c.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([c.update(bytes.subarray(28)), c.final()]);
    },
  };
}
const options = () => ({
  testProtection: fixtureProtection(),
  testPolicy: 'owned-disposable-fixture-v1',
});
test('protected custody files preserve one key and distinct pinned profile instances without exposing secrets in metadata', async (t) => {
  const file = (await area(t))('bundle'),
    opt = options(),
    info = await createSyntheticRecoveryCustody(file, 'realtime-estates', mode, opt),
    a = await loadSyntheticRecoveryCustody(file, 'realtime-estates', info.custodyId, mode, opt),
    b = await loadSyntheticRecoveryCustody(file, 'realtime-estates', info.custodyId, mode, opt);
  assert.equal(a.storageKey, b.storageKey);
  assert.deepEqual(a.instances, b.instances);
  assert.equal(new Set(Object.values(a.instances)).size, 3);
  for (const text of [JSON.stringify(a), JSON.stringify(info), await readFile(file, 'utf8')])
    assert.ok(!text.includes(a.storageKey));
  const old = await readFile(file);
  await assert.rejects(() => createSyntheticRecoveryCustody(file, 'realtime-estates', mode, opt));
  assert.deepEqual(await readFile(file), old);
});
test('wrong custody, tenant, missing and corrupt files never generate a replacement', async (t) => {
  const path = await area(t),
    file = path('bundle'),
    opt = options(),
    info = await createSyntheticRecoveryCustody(file, 'realtime-estates', mode, opt),
    old = await readFile(file);
  for (const [slug, custody] of [
    ['other-agency', info.custodyId],
    ['realtime-estates', id(99)],
  ])
    await assert.rejects(() => loadSyntheticRecoveryCustody(file, slug, custody, mode, opt));
  assert.deepEqual(await readFile(file), old);
  const missing = path('missing');
  await assert.rejects(() =>
    loadSyntheticRecoveryCustody(missing, 'realtime-estates', info.custodyId, mode, opt),
  );
  await assert.rejects(() => readFile(missing));
  const parsed = JSON.parse(old);
  parsed.protected = (parsed.protected[0] === 'A' ? 'B' : 'A') + parsed.protected.slice(1);
  await writeFile(file, JSON.stringify(parsed));
  await assert.rejects(() =>
    loadSyntheticRecoveryCustody(file, 'realtime-estates', info.custodyId, mode, opt),
  );
  assert.equal(await readFile(file, 'utf8'), JSON.stringify(parsed));
});
test('noncanonical, oversized, wrong-provider and directory inputs fail closed', async (t) => {
  const path = await area(t),
    file = path('bundle'),
    opt = options(),
    info = await createSyntheticRecoveryCustody(file, 'realtime-estates', mode, opt),
    old = await readFile(file, 'utf8');
  for (const text of [
    ' ' + old,
    old.replace('"policy":', '"policy":"ignored","policy":'),
    'x'.repeat(32769),
    old.replace('owned-disposable-test-v1', 'other-provider'),
  ]) {
    await writeFile(file, text);
    await assert.rejects(() =>
      loadSyntheticRecoveryCustody(file, 'realtime-estates', info.custodyId, mode, opt),
    );
  }
  await assert.rejects(() =>
    loadSyntheticRecoveryCustody(join(file, '..'), 'realtime-estates', info.custodyId, mode, opt),
  );
});
test('owner-wrapped backup copies reopen only under the same explicit fixture protection and pinned context', async (t) => {
  const path = await area(t),
    file = path('bundle'),
    backup = path('backup'),
    opt = options(),
    info = await createSyntheticRecoveryCustody(file, 'realtime-estates', mode, opt);
  await copyFile(file, backup);
  const a = await loadSyntheticRecoveryCustody(file, 'realtime-estates', info.custodyId, mode, opt),
    b = await loadSyntheticRecoveryCustody(backup, 'realtime-estates', info.custodyId, mode, opt);
  assert.equal(a.storageKey, b.storageKey);
  await assert.rejects(() =>
    loadSyntheticRecoveryCustody(backup, 'realtime-estates', info.custodyId, mode, options()),
  );
});
test('explicit launch configuration is complete, fail-closed, stable and cannot fall back to a random namespace', async (t) => {
  const file = (await area(t))('bundle'),
    opt = options(),
    info = await createSyntheticRecoveryCustody(file, 'realtime-estates', mode, opt),
    env = {
      ...mode,
      PRIVATE_RECOVERY_CUSTODY_FILE: file,
      PRIVATE_RECOVERY_CUSTODY_ID: info.custodyId,
    },
    a = await syntheticRecoveryLaunchEnvironment(env, 'realtime-estates', opt),
    b = await syntheticRecoveryLaunchEnvironment(env, 'realtime-estates', opt);
  assert.equal(a.mode, 'protected-owner-custody');
  assert.equal(
    a.environment.PRIVATE_RECOVERY_STORAGE_KEY,
    b.environment.PRIVATE_RECOVERY_STORAGE_KEY,
  );
  assert.deepEqual(a.instances, b.instances);
  assert.ok(!JSON.stringify(a).includes(a.environment.PRIVATE_RECOVERY_STORAGE_KEY));
  for (const patch of [
    { PRIVATE_RECOVERY_CUSTODY_ID: undefined },
    { PRIVATE_RECOVERY_CUSTODY_FILE: undefined },
    { PRIVATE_RECOVERY_CUSTODY_MODE: 'other' },
    { PRIVATE_RECOVERY_MODE: 'synthetic-sealed-original-v1' },
    { PRIVATE_RECOVERY_STORAGE_KEY: '00'.repeat(32) },
    { NODE_ENV: 'production' },
  ])
    await assert.rejects(() =>
      syntheticRecoveryLaunchEnvironment({ ...env, ...patch }, 'realtime-estates', opt),
    );
});
test('ephemeral default remains disposable and public child processes receive no recovery keys or custody configuration', async () => {
  const a = await syntheticRecoveryLaunchEnvironment({}),
    b = await syntheticRecoveryLaunchEnvironment({});
  assert.notEqual(
    a.environment.PRIVATE_RECOVERY_STORAGE_KEY,
    b.environment.PRIVATE_RECOVERY_STORAGE_KEY,
  );
  assert.notEqual(a.instances.staff, b.instances.staff);
  const env = publicPreviewRecoveryEnvironment({
    ...process.env,
    ...a.environment,
    PRIVATE_RECOVERY_CUSTODY_ID: id(8),
    PRIVATE_RECOVERY_CUSTODY_FILE: 'private-file',
    private_recovery_extra: 'private',
    ORDINARY_PREVIEW_LABEL: 'safe',
  });
  const output = await new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [
        '-e',
        `console.log(JSON.stringify({names:Object.keys(process.env).filter(n=>/^PRIVATE_RECOVERY_/i.test(n)),label:process.env.ORDINARY_PREVIEW_LABEL}))`,
      ],
      { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let text = '';
    child.stdout.on('data', (b) => (text += b));
    child.on('error', reject);
    child.on('close', (code) =>
      code === 0 ? resolve(JSON.parse(text)) : reject(Error('Child failed')),
    );
  });
  assert.deepEqual(output, { names: [], label: 'safe' });
});
test(
  'real Windows CurrentUser protection reopens a protected file and refuses corruption without printing key material',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const file = (await area(t))('owner-bundle'),
      info = await createSyntheticRecoveryCustody(file, 'realtime-estates', mode),
      a = await loadSyntheticRecoveryCustody(file, 'realtime-estates', info.custodyId, mode),
      b = await loadSyntheticRecoveryCustody(file, 'realtime-estates', info.custodyId, mode);
    assert.equal(a.storageKey, b.storageKey);
    assert.ok(!(await readFile(file, 'utf8')).includes(a.storageKey));
    const original = JSON.parse(await readFile(file, 'utf8'));
    const bytes = Buffer.from(original.protected, 'base64url');
    bytes[bytes.length - 1] ^= 1;
    original.protected = bytes.toString('base64url');
    await writeFile(file, JSON.stringify(original));
    await assert.rejects(() =>
      loadSyntheticRecoveryCustody(file, 'realtime-estates', info.custodyId, mode),
    );
    await assert.rejects(() => windowsRecoveryProtection().protect(Buffer.alloc(16385)));
  },
);

test(
  'standalone custody CLI reports only metadata, refuses overwrite and refuses production',
  { skip: process.platform !== 'win32' },
  async (t) => {
    const file = (await area(t))('cli-bundle'),
      info = await createSyntheticRecoveryCustody(file, 'realtime-estates', mode),
      loaded = await loadSyntheticRecoveryCustody(file, 'realtime-estates', info.custodyId, mode),
      original = await readFile(file),
      modulePath = new URL('../../../scripts/private-recovery-custody.mjs', import.meta.url);
    const invoke = (action, production = false) =>
      new Promise((resolve, reject) => {
        const env = Object.fromEntries(
          Object.entries(process.env).filter(([key]) => !/^PRIVATE_RECOVERY_/i.test(key)),
        );
        Object.assign(env, mode, { NODE_ENV: production ? 'production' : 'development' });
        const args = [
          action,
          '--file',
          file,
          '--tenant',
          'realtime-estates',
          ...(action === 'check' ? ['--custody-id', info.custodyId] : []),
        ];
        const child = spawn(process.execPath, [fileURLToPath(modulePath), ...args], {
          env,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        let out = '',
          err = '';
        const timer = setTimeout(() => {
          child.kill();
          reject(Error('CLI deadline'));
        }, 20000);
        child.stdout.on('data', (b) => (out += b));
        child.stderr.on('data', (b) => (err += b));
        child.on('error', reject);
        child.on('close', (code) => {
          clearTimeout(timer);
          resolve({ code, out, err });
        });
      });
    const checked = await invoke('check');
    assert.equal(checked.code, 0);
    assert.equal(JSON.parse(checked.out).custodyId, info.custodyId);
    assert.ok(!checked.out.includes(loaded.storageKey));
    assert.ok(!checked.err.includes(loaded.storageKey));
    const duplicate = await invoke('init');
    assert.equal(duplicate.code, 1);
    assert.deepEqual(await readFile(file), original);
    assert.ok(!duplicate.out.includes(loaded.storageKey));
    const production = await invoke('check', true);
    assert.equal(production.code, 1);
    assert.equal(production.out, '');
    assert.deepEqual(await readFile(file), original);
  },
);

test('custody refuses the relocated source workspace before creating any bundle', async () => {
  const file = fileURLToPath(
    new URL('../../../.refused-custody-' + Date.now() + '.json', import.meta.url),
  );
  await assert.rejects(() =>
    createSyntheticRecoveryCustody(file, 'realtime-estates', mode, options()),
  );
  await assert.rejects(() => readFile(file));
});
