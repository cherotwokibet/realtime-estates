import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Production HTTP/SSR verification only. No provider, browser, real credentials or database.
const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeRoot = process.env.REALTOR_RUNTIME_PACKAGE_DIR;
const projectId = 'realtor-synthetic-staging';
const config = {
  projectId,
  apiKey: 'AIza' + 'x'.repeat(35),
  authDomain: projectId + '.firebaseapp.com',
  appId: '1:123456:web:abcdef123456',
};
async function port() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const value = socket.address().port;
  await new Promise((done, fail) => socket.close((e) => (e ? fail(e) : done())));
  return value;
}
for (const app of ['web', 'admin']) {
  for (const profile of [
    'unconfigured',
    'identity',
    ...(app === 'web'
      ? ['customer', 'customer-invalid', 'customer-iam', 'customer-run', 'customer-run-invalid']
      : []),
    ...(app === 'admin'
      ? ['staff', 'staff-invalid', 'staff-iam', 'staff-run', 'staff-run-invalid']
      : []),
  ]) {
    const configured = profile !== 'unconfigured';
    const env = { ...process.env, NODE_ENV: 'production' };
    for (const name of Object.keys(env)) {
      if (
        /^(FIREBASE_|BROWSER_IDENTITY_|STAFF_PREVIEW_|WEB_CUSTOMER_PREVIEW_CONFIG|HOSTED_CUSTOMER_|HOSTED_STAFF_|HOSTED_API_INVOCATION_)/.test(
          name,
        )
      )
        delete env[name];
    }
    env.APP_ENV = 'staging';
    if (configured) {
      env.FIREBASE_BROWSER_CONFIG = JSON.stringify({
        projectId,
        applicationOrigin: 'https://synthetic-browser.example',
        tenantId: '00000000-0000-4000-8000-000000000001',
      });
      env.FIREBASE_WEB_CONFIG = JSON.stringify(config);
      env.BROWSER_IDENTITY_DATABASE_URL =
        'postgres://synthetic:synthetic-database-secret@127.0.0.1:1/identity?sslmode=verify-full';
      env.BROWSER_IDENTITY_STORAGE_KEY = 'ec'.repeat(32);
      if (profile.startsWith('customer'))
        env.HOSTED_CUSTOMER_API_ORIGIN = !profile.endsWith('-invalid')
          ? 'https://synthetic-api.example'
          : 'http://127.0.0.1:1';
      if (profile.startsWith('staff')) {
        env.HOSTED_STAFF_API_ORIGIN = !profile.endsWith('-invalid')
          ? 'https://synthetic-api.example'
          : 'http://127.0.0.1:1';
        env.PRIVACY_NOTICE_VERSION = 'synthetic-staff-v1';
      }
      if (profile.endsWith('-iam') || profile.includes('-run')) {
        delete env.BROWSER_IDENTITY_DATABASE_URL;
        delete env.GOOGLE_APPLICATION_CREDENTIALS;
        for (const name of Object.keys(env)) if (name.startsWith('PG')) delete env[name];
        env.K_SERVICE = 'synthetic-' + app;
        env.GOOGLE_CLOUD_PROJECT = projectId;
        env.BROWSER_IDENTITY_CLOUD_SQL_CONFIG = JSON.stringify({
          instanceConnectionName: projectId + ':africa-south1:synthetic-test',
          database: 'realtor',
          serviceAccount: 'synthetic-web@' + projectId + '.iam.gserviceaccount.com',
          ipType: 'PRIVATE',
        });
      }
    }
    if (profile.includes('-run')) {
      const target = 'https://synthetic-api-123456.africa-south1.run.app';
      env[app === 'web' ? 'HOSTED_CUSTOMER_API_ORIGIN' : 'HOSTED_STAFF_API_ORIGIN'] = target;
      if (!profile.endsWith('-invalid'))
        env.HOSTED_API_INVOCATION_CONFIG = JSON.stringify({
          policy: 'cloud-run-invocation-v1',
          audience: target,
        });
    }
    const address = await port();
    env.PORT = String(address);
    env.HOSTNAME = '127.0.0.1';
    const child = spawn(
      process.execPath,
      runtimeRoot
        ? [resolve(runtimeRoot, app, 'apps', app, 'server.js')]
        : [
            resolve(root, 'node_modules/next/dist/bin/next'),
            'start',
            '-p',
            String(address),
            '-H',
            '127.0.0.1',
          ],
      {
        cwd: runtimeRoot ? resolve(runtimeRoot, app) : resolve(root, 'apps', app),
        env,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let logs = '';
    child.stdout.on('data', (b) => {
      logs = (logs + b).slice(-12000);
    });
    child.stderr.on('data', (b) => {
      logs = (logs + b).slice(-12000);
    });
    try {
      let response;
      const deadline = Date.now() + 25000;
      while (Date.now() < deadline) {
        if (child.exitCode !== null) throw Error('Production server exited before readiness.');
        try {
          response = await fetch(`http://127.0.0.1:${address}/sign-in`, {
            signal: AbortSignal.timeout(3000),
          });
          break;
        } catch {
          await new Promise((done) => setTimeout(done, 150));
        }
      }
      assert.ok(response, 'Production server did not become ready.');
      assert.equal(response.status, 200);
      const html = await response.text();
      if (runtimeRoot) {
        const asset = html.match(/(?:src|href)="(\/_next\/static\/[^"]+)"/);
        assert.ok(asset, 'Packaged sign-in must include a static asset.');
        const resource = await fetch('http://127.0.0.1:' + address + asset[1]);
        assert.equal(resource.status, 200);
        assert.ok((await resource.arrayBuffer()).byteLength > 0);
      }
      assert.match(html, /name="robots" content="noindex, nofollow"/);
      if (configured) {
        assert.match(html, /Continue with Google/);
        assert.match(html, /autocomplete="current-password"/i);
        assert.match(html, /aria-busy="true"/);
      } else {
        assert.match(html, /sign-in is unavailable here\./i);
        assert.doesNotMatch(html, /autocomplete="current-password"/i);
      }
      assert.doesNotMatch(
        html,
        /synthetic-database-secret|ecececececececececececececececec|postgres:\/\//,
      );
      const session = await fetch(`http://127.0.0.1:${address}/auth/session`);
      assert.equal(session.headers.get('cache-control'), 'no-store');
      // Deliberately HTTP at loopback, unlike the configured HTTPS origin. Never relax the production guard.
      assert.equal(session.status, configured ? 401 : 503);
      assert.deepEqual(
        await session.json(),
        configured ? { error: 'SIGN_IN_FAILED' } : { error: 'SIGN_IN_UNAVAILABLE' },
      );
      assert.doesNotMatch(logs, /synthetic-database-secret|postgres:\/\//);
      if (profile.startsWith('staff')) {
        for (const path of ['/', '/staff']) {
          const staffPage = await fetch(`http://127.0.0.1:${address}${path}`);
          assert.equal(staffPage.status, 200);
          const view = await staffPage.text();
          assert.match(
            view,
            !profile.endsWith('-invalid')
              ? /Branch administration/
              : /Staff administration is unavailable here/,
          );
          assert.doesNotMatch(view, /Synthetic local preview|synthetic-database-secret/);
        }
        const privateResponse = await fetch(`http://127.0.0.1:${address}/api/hosted-staff/session`);
        assert.equal(privateResponse.status, !profile.endsWith('-invalid') ? 403 : 503);
        assert.equal(privateResponse.headers.get('cache-control'), 'no-store');
      }
      if (profile.startsWith('customer')) {
        const account = await fetch(`http://127.0.0.1:${address}/account`);
        assert.equal(account.status, 200);
        const view = await account.text();
        assert.doesNotMatch(
          view,
          /Synthetic test accounts only|Choose a test account|synthetic-database-secret/,
        );
        assert.match(
          view,
          !profile.endsWith('-invalid')
            ? /Manage sign-in/
            : /Customer accounts are unavailable here/,
        );
        const privateResponse = await fetch(`http://127.0.0.1:${address}/api/customer/session`);
        assert.equal(privateResponse.status, !profile.endsWith('-invalid') ? 403 : 503);
        assert.equal(privateResponse.headers.get('cache-control'), 'no-store');
      }
      console.log(
        `${app} ${profile}: HTTP sign-in/account, robots, session and secret-isolation checks passed`,
      );
    } finally {
      if (child.exitCode === null) {
        const stopped = once(child, 'exit');
        child.kill();
        await stopped;
      }
    }
  }
}
console.log(
  '14 production HTTP/SSR profiles passed; no browser/provider/hosted SQL verification claimed.',
);
