import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { spawn, execFileSync } from 'node:child_process';
const root = fileURLToPath(new URL('../', import.meta.url));
const profiles = ['selected', 'malformed', 'missing-iam', 'wrong-company', 'preview'];
const profile = process.argv[2];
if (!profile) {
  for (const name of profiles)
    process.stdout.write(
      execFileSync(process.execPath, [fileURLToPath(import.meta.url), name], {
        cwd: root,
        env: process.env,
        encoding: 'utf8',
        windowsHide: true,
        timeout: 45000,
      }),
    );
  console.log(
    'Five production Next native gateway profiles passed; synthetic authority/loopback only.',
  );
  process.exit(0);
}
assert.ok(profiles.includes(profile));
const publicOrigin = 'https://native.synthetic.invalid';
const privateOrigin = 'https://synthetic-api-123456.us-central1.run.app';
const projectId = 'realtor-synthetic-staging';
const tenantId = '00000000-0000-4000-8000-000000000001';
const customerId = '00000000-0000-4000-8000-000000000013';
const directory = await mkdtemp(resolve(tmpdir(), 'realtor-native-next-'));
const telemetry = resolve(directory, 'events.jsonl');
let privateCalls = 0;
const operationId = '00000000-0000-4000-8000-000000009001';
const listingId = '00000000-0000-4000-8000-000000000200';
let receipt = null;

const backend = createServer(async (req, res) => {
  privateCalls++;
  assert.equal(req.headers.authorization, 'Bearer valid.user.signature');
  assert.equal(req.headers['x-serverless-authorization'], 'Bearer synthetic.service.signature');
  res.writeHead(200, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'X-Private-Diagnostic': 'never-copy',
  });
  let value = { policy: 'customer-account-v1', tenantId, customerId };
  if (req.url === '/v2/customer/favourite-operations/' + operationId) {
    if (req.method === 'POST') {
      const chunks = [];
      for await (const b of req) chunks.push(b);
      const command = JSON.parse(Buffer.concat(chunks).toString());
      assert.deepEqual(command, {
        policy: 'customer-favourite-command-v1',
        operationId,
        listingId,
        expectedVersion: '1',
        saved: false,
      });
      receipt = {
        policy: 'customer-favourite-receipt-v1',
        tenantId,
        customerId,
        operationId,
        listingId,
        expectedVersion: '1',
        version: '2',
        requestedSaved: false,
        saved: false,
        outcome: 'applied',
        recordedAt: '2026-11-19T19:15:00.000Z',
      };
    }
    assert.ok(receipt);
    value = receipt;
  }
  res.end(JSON.stringify(value));
});
backend.listen(0, '127.0.0.1');
await once(backend, 'listening');
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise((r) => reservation.close(r));
const env = {
  ...process.env,
  NODE_ENV: 'production',
  NEXT_TELEMETRY_DISABLED: '1',
  APP_ENV: 'staging',
  K_SERVICE: 'synthetic-next-gateway',
  GOOGLE_CLOUD_PROJECT: projectId,
};
for (const key of Object.keys(env))
  if (
    /^(FIREBASE_|BROWSER_IDENTITY_|STAFF_PREVIEW_|WEB_CUSTOMER_PREVIEW_|HOSTED_|NATIVE_CUSTOMER_|PG|GOOGLE_APPLICATION_CREDENTIALS|NODE_OPTIONS|NODE_TLS_REJECT_UNAUTHORIZED)/.test(
      key,
    )
  )
    delete env[key];
env.NATIVE_CUSTOMER_GATEWAY_CONFIG = JSON.stringify({
  policy: 'native-customer-gateway-v1',
  projectId,
  tenantId,
  applicationOrigin: publicOrigin,
  apiOrigin: privateOrigin,
});
env.HOSTED_API_INVOCATION_CONFIG = JSON.stringify({
  policy: 'cloud-run-invocation-v1',
  audience: privateOrigin,
});
if (profile === 'malformed') env.NATIVE_CUSTOMER_GATEWAY_CONFIG = 'invalid-synthetic-config';
if (profile === 'missing-iam') delete env.HOSTED_API_INVOCATION_CONFIG;
if (profile === 'wrong-company')
  env.NATIVE_CUSTOMER_GATEWAY_CONFIG = JSON.stringify({
    ...JSON.parse(env.NATIVE_CUSTOMER_GATEWAY_CONFIG),
    tenantId: '00000000-0000-4000-8000-000000000099',
  });
if (profile === 'preview') env.WEB_CUSTOMER_PREVIEW_CONFIG = '{}';
env.REALTOR_NATIVE_SMOKE_POLICY = 'owned-loopback-synthetic-v1';
env.REALTOR_NATIVE_SMOKE_PRIVATE_URL = 'http://127.0.0.1:' + backend.address().port;
env.REALTOR_NATIVE_SMOKE_TELEMETRY = telemetry;
const runtime = process.env.REALTOR_RUNTIME_PACKAGE_DIR;
const child = spawn(
  process.execPath,
  [
    '--import',
    pathToFileURL(resolve(root, 'scripts/test-fixtures/native-gateway-preload.mjs')).href,
    ...(runtime
      ? [resolve(runtime, 'web/apps/web/server.js')]
      : [
          resolve(root, 'node_modules/next/dist/bin/next'),
          'start',
          '-p',
          String(port),
          '-H',
          '127.0.0.1',
        ]),
  ],
  {
    cwd: runtime ? resolve(runtime, 'web') : resolve(root, 'apps/web'),
    env: { ...env, PORT: String(port), HOSTNAME: '127.0.0.1' },
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  },
);
let logs = '';
for (const stream of [child.stdout, child.stderr])
  stream.on('data', (b) => (logs = (logs + b).slice(-12000)));
const call = (headers = {}, method = 'GET', path = '/v2/customer/account', body) =>
  new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: '127.0.0.1',
        port,
        path,
        method,
        headers: {
          Host: new URL(publicOrigin).host,
          'X-Forwarded-Proto': 'https',
          Authorization: 'Bearer valid.user.signature',
          ...(body
            ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
            : {}),
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (b) => chunks.push(b));
        res.on('error', reject);
        res.on('end', () =>
          resolve(
            new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers }),
          ),
        );
      },
    );
    req.setTimeout(5000, () => req.destroy(Error('Owned Next request timeout')));
    req.on('error', reject);
    req.end(body);
  });
try {
  let ready = false;
  for (let i = 0; i < 160; i++) {
    if (child.exitCode !== null) throw Error('Next exited: ' + logs);
    try {
      await fetch('http://127.0.0.1:' + port + '/sign-in', { signal: AbortSignal.timeout(1000) });
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  assert.ok(ready, 'Next readiness timeout');
  if (profile !== 'selected') {
    const response = await call();
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { error: { code: 'CUSTOMER_REQUEST_UNAVAILABLE' } });
    assert.equal(privateCalls, 0);
    const events = (await readFile(telemetry, 'utf8'))
      .trim()
      .split('\n')
      .map((x) => JSON.parse(x));
    assert.deepEqual(
      events,
      [{ kind: 'preload' }],
      'Bad settings cannot verify user or invoke backend',
    );
    assert.doesNotMatch(
      logs,
      /invalid-synthetic-config|valid\.user\.signature|synthetic\.service\.signature/,
    );
    console.log(
      JSON.stringify({
        profile,
        configRefused: true,
        privateRequests: 0,
        injectedFirebaseChecks: 0,
        injectedIamChecks: 0,
      }),
    );
  } else {
    const positive = await call();
    if (positive.status !== 200) {
      const evidence = await readFile(telemetry, 'utf8');
      console.error('Synthetic child telemetry: ' + evidence.replace(/,"token":"[^"]+"/g, ''));
      console.error('Synthetic child logs: ' + logs);
    }
    assert.equal(
      positive.status,
      200,
      'Configured native account through actual production Next: ' +
        (await positive.clone().text()),
    );
    assert.deepEqual(await positive.json(), {
      policy: 'customer-account-v1',
      tenantId,
      customerId,
    });
    assert.equal(positive.headers.get('cache-control'), 'no-store');
    assert.equal(positive.headers.get('set-cookie'), null);
    assert.equal(positive.headers.get('x-private-diagnostic'), null);
    for (const [headers, status] of [
      [{ Host: 'foreign.invalid' }, 403],
      [{ 'X-Forwarded-Proto': 'http' }, 403],
      [{ 'X-Forwarded-Proto': 'https,http' }, 403],
      [{ 'X-Forwarded-Host': 'foreign.invalid' }, 403],
      [{ Cookie: 'session=synthetic' }, 400],
      [{ 'X-Actor-Id': customerId }, 400],
      [{ 'X-Serverless-Authorization': 'Bearer forged.service.signature' }, 400],
      [{ Authorization: 'Bearer unverified.user.signature' }, 401],
      [{ Authorization: 'Bearer revoked.user.signature' }, 401],
    ]) {
      const r = await call(headers);
      assert.equal(r.status, status);
      assert.equal(r.headers.get('cache-control'), 'no-store');
    }
    assert.equal(privateCalls, 1, 'Rejected ingress never invokes private API');
    const operationPath = '/v2/customer/favourite-operations/' + operationId;
    const body = JSON.stringify({
      policy: 'customer-favourite-command-v1',
      operationId,
      listingId,
      expectedVersion: '1',
      saved: false,
    });
    const written = await call({}, 'POST', operationPath, body);
    assert.equal(written.status, 200);
    assert.deepEqual(await written.json(), receipt);
    const original = await call({}, 'GET', operationPath);
    assert.equal(original.status, 200);
    assert.deepEqual(await original.json(), receipt);
    assert.equal(privateCalls, 3, 'One explicit command and one original lookup; no write replay');
    const events = (await readFile(telemetry, 'utf8'))
      .trim()
      .split('\n')
      .map((x) => JSON.parse(x));
    assert.equal(events.filter((x) => x.kind === 'firebase').length, 5);
    assert.equal(events.filter((x) => x.kind === 'iam').length, 3);
    assert.equal(events.filter((x) => x.kind === 'private').length, 3);
    assert.doesNotMatch(logs, /valid\.user\.signature|synthetic\.service\.signature/);
    console.log(
      JSON.stringify({
        productionNextGatewayVerified: true,
        selectedProfile: true,
        profile,
        ingressCasesPassed: 12,
        privateRequests: privateCalls,
        injectedFirebaseChecks: 5,
        injectedIamChecks: 3,
        actualGoogleVerified: false,
        actualTlsVerified: false,
        managedSqlVerified: false,
        deviceVerified: false,
      }),
    );
  }
} finally {
  child.kill();
  if (child.exitCode === null) await once(child, 'exit');
  backend.closeAllConnections();
  await new Promise((r) => backend.close(r));
}
