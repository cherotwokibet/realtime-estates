import { createHash } from 'node:crypto';
import { mkdtemp, readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { inside, copyRuntimeTree, verifyRuntimeInventory } from './stage-runtime-packages.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = await realpath(resolve(process.argv[2] ?? ''));
inside(resolve(root, '.staging-artifacts'), source);
const report = JSON.parse(await readFile(resolve(source, 'runtime-packages.json'), 'utf8'));
assert.equal(report.policy, 'realtor-staging-runtime-packages-v1');
assert.equal(report.platform, process.platform);
assert.equal(report.arch, process.arch);
const detached = await mkdtemp(join(tmpdir(), 'realtor-detached-runtime-'));
for (const service of ['api', 'web', 'admin']) {
  const bytes = await readFile(resolve(source, service + '-inventory.json'));
  assert.equal(
    createHash('sha256').update(bytes).digest('hex'),
    report.services[service].inventorySha256,
  );
  const manifest = JSON.parse(bytes);
  assert.equal(
    manifest.entry,
    service === 'api' ? 'apps/api/dist/hosted-index.js' : 'apps/' + service + '/server.js',
  );
  await verifyRuntimeInventory(resolve(source, service), manifest);
  await copyRuntimeTree(
    resolve(source, service),
    resolve(source, service),
    resolve(detached, service),
    '',
    new Map(),
  );
  await verifyRuntimeInventory(resolve(detached, service), manifest);
  const env = { ...process.env };
  delete env.NODE_PATH;
  const moduleCheck = `(async()=>{const assert=require('node:assert/strict'),{createRequire}=require('node:module'),{relative,isAbsolute,resolve}=require('node:path'),{readFileSync}=require('node:fs'),{pathToFileURL}=require('node:url');const r=createRequire(process.argv[1]);function bounded(target){const part=relative(process.argv[2],target);assert.ok(!isAbsolute(part)&&!part.startsWith('..'));return target;}for(const name of ['pg','firebase-admin/app','google-auth-library']){bounded(r.resolve(name));r(name);}const pkg=resolve(process.argv[2],'node_modules/@google-cloud/cloud-sql-connector'),metadata=JSON.parse(readFileSync(resolve(pkg,'package.json'),'utf8'));const target=bounded(resolve(pkg,metadata.exports['.'].import.default));await import(pathToFileURL(target).href);console.log(process.argv[3]+': CJS and Cloud SQL ESM server modules load from detached package.');})().catch(e=>{console.error(e);process.exitCode=1;});`;
  process.stdout.write(
    execFileSync(
      process.execPath,
      [
        '-e',
        moduleCheck,
        resolve(detached, service, manifest.entry),
        resolve(detached, service),
        service,
      ],
      { cwd: root, env, encoding: 'utf8', windowsHide: true },
    ),
  );
  if (service === 'api') {
    const invalid = {
      ...env,
      NODE_ENV: 'production',
      APP_ENV: 'staging',
      HOSTED_API_CONFIG: 'invalid-synthetic-value',
    };
    try {
      execFileSync(process.execPath, [resolve(detached, service, manifest.entry)], {
        cwd: root,
        env: invalid,
        encoding: 'utf8',
        windowsHide: true,
        stdio: 'pipe',
      });
      throw Error('Invalid API startup succeeded.');
    } catch (e) {
      assert.equal(e.status, 1);
      assert.match(e.stderr, /Staging API startup failed/);
      assert.doesNotMatch(e.stderr, /invalid-synthetic-value/);
    }
  }
}
const env = { ...process.env, REALTOR_RUNTIME_PACKAGE_DIR: detached };
delete env.NODE_PATH;
process.stdout.write(
  execFileSync(process.execPath, [resolve(root, 'scripts/smoke-firebase-sign-in.mjs')], {
    cwd: root,
    env,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 240000,
    maxBuffer: 4 * 1024 * 1024,
  }),
);
const receipt = {
  source,
  detached,
  sourceCommit: report.sourceCommit,
  sourceDirty: report.sourceDirty,
  platform: report.platform,
  arch: report.arch,
  inventoryVerified: true,
  materializedLinks: true,
  serverModuleImportsPassed: ['api', 'web', 'admin'],
  localHttpProfilesPassed: 14,
  apiPositiveDatabaseStartupVerified: false,
  linuxContainerVerified: false,
  liveDeploymentVerified: false,
};
await writeFile(resolve(source, 'verification.json'), JSON.stringify(receipt, null, 2) + '\n', {
  flag: 'wx',
});
console.log(JSON.stringify(receipt, null, 2));
