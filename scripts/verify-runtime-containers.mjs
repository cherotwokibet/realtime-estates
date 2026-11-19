import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { inside, verifyRuntimeInventory } from './stage-runtime-packages.mjs';
import { verifyApiContainerBootstrap } from './verify-api-container-bootstrap.mjs';
if (process.env.GITHUB_ACTIONS !== 'true' || process.platform !== 'linux')
  throw Error('Owned Linux CI container verification required.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  bundle = await realpath(resolve(process.argv[2] ?? ''));
inside(resolve(root, '.staging-artifacts'), bundle);
const report = JSON.parse(await readFile(resolve(bundle, 'runtime-packages.json'), 'utf8'));
assert.equal(report.platform, 'linux');
assert.match(report.sourceCommit, /^[0-9a-f]{40}$/);
assert.equal(report.sourceDirty, false);
const docker = (args) =>
  execFileSync('docker', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    timeout: 240000,
  });
const images = {};
for (const service of ['api', 'web', 'admin']) {
  const directory = resolve(bundle, service),
    manifest = JSON.parse(await readFile(resolve(bundle, service + '-inventory.json'), 'utf8'));
  await verifyRuntimeInventory(directory, manifest);
  const tag = 'realtor-ci-' + service + ':' + report.sourceCommit.slice(0, 12);
  docker([
    'build',
    '--file',
    resolve(root, 'deploy/runtime', service + '.Dockerfile'),
    '--tag',
    tag,
    directory,
  ]);
  images[service] = { tag, id: docker(['image', 'inspect', '--format', '{{.Id}}', tag]).trim() };
  const probe =
    "if(process.getuid()===0)throw Error('Non-root runtime required.');for(const name of ['pg','firebase-admin/app','google-auth-library','@google-cloud/cloud-sql-connector'])await import(name);console.log('Non-root Linux container SDK imports passed.');";
  process.stdout.write(
    docker([
      'run',
      '--rm',
      '--pull=never',
      '--memory=512m',
      '--cpus=1',
      tag,
      'node',
      '--input-type=module',
      '-e',
      probe,
    ]),
  );
}
try {
  docker([
    'run',
    '--rm',
    '--pull=never',
    '--env',
    'APP_ENV=staging',
    '--env',
    'HOSTED_API_CONFIG=invalid-synthetic-value',
    images.api.tag,
  ]);
  throw Error('Invalid API container startup succeeded.');
} catch (e) {
  assert.equal(e.status, 1);
  assert.match(e.stderr, /Staging API startup failed/);
  assert.doesNotMatch(e.stderr, /invalid-synthetic-value/);
}
async function port() {
  const s = createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const n = s.address().port;
  await new Promise((r) => s.close(r));
  return n;
}
const projectId = 'realtor-synthetic-staging',
  apiOrigin = 'https://synthetic-api-123456.africa-south1.run.app';
for (const service of ['web', 'admin']) {
  const address = await port(),
    name = 'realtor-ci-' + service + '-' + randomUUID();
  const fake = {
    NODE_ENV: 'production',
    APP_ENV: 'staging',
    K_SERVICE: 'synthetic-' + service,
    GOOGLE_CLOUD_PROJECT: projectId,
    FIREBASE_BROWSER_CONFIG: JSON.stringify({
      projectId,
      applicationOrigin: 'https://synthetic-browser.example',
      tenantId: '00000000-0000-4000-8000-000000000001',
    }),
    FIREBASE_WEB_CONFIG: JSON.stringify({
      projectId,
      apiKey: 'AIza' + 'x'.repeat(35),
      authDomain: projectId + '.firebaseapp.com',
      appId: '1:123456:web:abcdef123456',
    }),
    BROWSER_IDENTITY_STORAGE_KEY: 'ec'.repeat(32),
    BROWSER_IDENTITY_CLOUD_SQL_CONFIG: JSON.stringify({
      instanceConnectionName: projectId + ':us-central1:synthetic-test',
      database: 'realtor',
      serviceAccount: 'synthetic-web@' + projectId + '.iam.gserviceaccount.com',
      ipType: 'PUBLIC',
    }),
    HOSTED_API_INVOCATION_CONFIG: JSON.stringify({
      policy: 'cloud-run-invocation-v1',
      audience: apiOrigin,
    }),
    [service === 'web' ? 'HOSTED_CUSTOMER_API_ORIGIN' : 'HOSTED_STAFF_API_ORIGIN']: apiOrigin,
    PRIVACY_NOTICE_VERSION: 'synthetic-ci-v1',
  };
  // Only these synthetic variables are forwarded; never copy runner/provider credentials into a container.
  const args = [
    'run',
    '--rm',
    '--init',
    '--pull=never',
    '--memory=512m',
    '--cpus=1',
    '--name',
    name,
    '--publish',
    '127.0.0.1:' + address + ':8080',
    ...Object.keys(fake).flatMap((k) => ['--env', k]),
    images[service].tag,
  ];
  const child = spawn('docker', args, {
    cwd: root,
    env: { ...process.env, ...fake },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (b) => {
    logs = (logs + b).slice(-12000);
  });
  child.stderr.on('data', (b) => {
    logs = (logs + b).slice(-12000);
  });
  try {
    let response;
    for (let i = 0; i < 100; i++) {
      if (child.exitCode !== null) throw Error('Owned runtime container exited: ' + logs);
      try {
        response = await fetch('http://127.0.0.1:' + address + '/sign-in', {
          signal: AbortSignal.timeout(2000),
        });
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 150));
      }
    }
    assert.ok(response, 'Container did not become ready.');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /Continue with Google/);
    assert.doesNotMatch(
      html,
      /ecececececececececececececececec|cloud-sql-connector|synthetic-web@/,
    );
    const asset = html.match(/(?:src|href)="(\/_next\/static\/[^\"]+)"/);
    assert.ok(asset);
    assert.equal((await fetch('http://127.0.0.1:' + address + asset[1])).status, 200);
    assert.equal(
      (
        await fetch(
          'http://127.0.0.1:' +
            address +
            (service === 'web' ? '/api/customer/session' : '/api/hosted-staff/session'),
        )
      ).status,
      403,
    );
    console.log(
      service +
        ': 512 MiB non-root container serves configured SSR/static and refuses loopback private origin.',
    );
  } finally {
    try {
      docker(['stop', '--time', '2', name]);
    } catch {} // Exact test-owned UUID name only; never enumerate/stop other containers.
    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  }
}
const apiBootstrap = await verifyApiContainerBootstrap(images.api, report.sourceCommit);
const receipt = {
  sourceCommit: report.sourceCommit,
  platform: 'linux',
  images,
  nonRootSdkImportsPassed: ['api', 'web', 'admin'],
  configuredContainerHttpProfilesPassed: 2,
  apiMissingConfigRefused: true,
  apiPositiveDatabaseStartupVerified: apiBootstrap.apiPositiveDatabaseStartupVerified,
  apiBootstrap,
  linuxContainerVerified: true,
  liveDeploymentVerified: false,
};
await writeFile(
  resolve(bundle, 'container-verification.json'),
  JSON.stringify(receipt, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify(receipt, null, 2));
