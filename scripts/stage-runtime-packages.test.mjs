import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, symlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join, parse } from 'node:path';
import {
  inside,
  allowedRuntimePath,
  copyRuntimeTree,
  verifyRuntimeInventory,
} from './stage-runtime-packages.mjs';
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'realtor-runtime-safety-'));
  const source = join(root, 'source'),
    output = join(root, 'output');
  await mkdir(source);
  await mkdir(output);
  return { root, source, output };
}
test('runtime path policy refuses private configuration, source data, traversal and signing material', () => {
  for (const p of [
    '.env',
    'node_modules/pkg/.envSecrets',
    'node_modules/pkg/.npmrc',
    'node_modules/pkg/.env.local',
    'node_modules/pkg/credentials.json',
    'node_modules/pkg/key.p12',
    'apps/web/public/server.key',
    '../apps/api/dist/x.js',
    'apps/api/../../x',
    'apps/api/src/index.ts',
    'docs/evidence/client.json',
    'uploads/photo.jpg',
    'node_modules/.cache/temp',
    'node_modules/pkg/service-account.json',
  ])
    assert.equal(allowedRuntimePath(p), false, p);
  for (const p of [
    'node_modules/pkg/index.js',
    'apps/api/dist/hosted-index.js',
    'apps/web/server.js',
    'apps/admin/.next/server/app.js',
    'packages/domain/dist/index.js',
  ])
    assert.equal(allowedRuntimePath(p), true, p);
  assert.throws(() => inside(resolve('parent/source'), resolve('parent/other')));
  if (process.platform === 'win32') assert.throws(() => inside('C:\\source', 'D:\\other'));
});
test('runtime tree materializes internal junctions without links and verifies exact copied bytes', async () => {
  const f = await fixture();
  await mkdir(join(f.source, 'node_modules/pkg'), { recursive: true });
  await writeFile(join(f.source, 'node_modules/pkg/index.js'), 'export const value=1;');
  await symlink(
    join(f.source, 'node_modules/pkg'),
    join(f.source, 'node_modules/alias'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  const inventory = new Map();
  await copyRuntimeTree(f.source, f.source, f.output, '', inventory);
  assert.equal((await lstat(join(f.output, 'node_modules/alias'))).isSymbolicLink(), false);
  assert.equal(
    await readFile(join(f.output, 'node_modules/alias/index.js'), 'utf8'),
    'export const value=1;',
  );
  await verifyRuntimeInventory(f.output, { files: [...inventory.values()] });
});
test('external directory links and cycles cannot enter a runtime package', async () => {
  for (const kind of ['external', 'cycle']) {
    const f = await fixture();
    await mkdir(join(f.source, 'node_modules'));
    await symlink(
      kind === 'cycle' ? f.source : f.output,
      join(f.source, 'node_modules/unsafe'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    await assert.rejects(
      copyRuntimeTree(f.source, f.source, f.output, '', new Map()),
      /escaped|Cyclic/,
    );
  }
});
test('environment files and complete private keys refuse rather than being silently copied', async () => {
  for (const kind of ['env', 'pem', 'escaped-pem']) {
    const f = await fixture();
    await mkdir(join(f.source, 'node_modules/pkg'), { recursive: true });
    const pem = '-----BEGIN PRIVATE KEY-----\n' + 'A'.repeat(96) + '\n-----END PRIVATE KEY-----';
    await writeFile(
      join(f.source, 'node_modules/pkg', kind === 'env' ? '.env.local' : 'index.js'),
      kind === 'env'
        ? 'SYNTHETIC_SECRET=not-real'
        : kind === 'escaped-pem'
          ? JSON.stringify(pem)
          : pem,
    );
    await assert.rejects(
      copyRuntimeTree(f.source, f.source, f.output, '', new Map()),
      /sensitive|Private key/,
    );
  }
});
test('verification rejects changed bytes, extra files, missing entries and runtime links', async () => {
  const f = await fixture();
  await mkdir(join(f.source, 'node_modules/pkg'), { recursive: true });
  await writeFile(join(f.source, 'node_modules/pkg/index.js'), 'original');
  const inventory = new Map();
  await copyRuntimeTree(f.source, f.source, f.output, '', inventory);
  const manifest = { files: [...inventory.values()] };
  await writeFile(join(f.output, 'node_modules/pkg/index.js'), 'changed');
  await assert.rejects(verifyRuntimeInventory(f.output, manifest), /digest/);
  await writeFile(join(f.output, 'node_modules/pkg/index.js'), 'original');
  await writeFile(join(f.output, 'node_modules/pkg/extra.js'), 'extra');
  await assert.rejects(verifyRuntimeInventory(f.output, manifest), /Unrecorded/);
  await assert.rejects(
    verifyRuntimeInventory(f.source, {
      files: [
        ...manifest.files,
        { path: 'node_modules/pkg/missing.js', sha256: '0'.repeat(64), bytes: 1 },
      ],
    }),
    /Missing/,
  );
  const linked = await fixture();
  await mkdir(join(linked.output, 'node_modules'));
  await symlink(
    join(f.source, 'node_modules/pkg'),
    join(linked.output, 'node_modules/pkg'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(verifyRuntimeInventory(linked.output, manifest), /link/);
});
