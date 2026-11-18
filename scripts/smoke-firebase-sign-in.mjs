import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Production HTTP/SSR verification only. No provider, browser, real credentials or database.
const root = fileURLToPath(new URL('../', import.meta.url));
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
  for (const configured of [false, true]) {
    const env = { ...process.env, NODE_ENV: 'production' };
    for (const name of Object.keys(env)) {
      if (/^(FIREBASE_|BROWSER_IDENTITY_|STAFF_PREVIEW_|WEB_CUSTOMER_PREVIEW_CONFIG)/.test(name))
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
    }
    const address = await port();
    const child = spawn(
      process.execPath,
      [
        resolve(root, 'node_modules/next/dist/bin/next'),
        'start',
        '-p',
        String(address),
        '-H',
        '127.0.0.1',
      ],
      {
        cwd: resolve(root, 'apps', app),
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
      console.log(
        `${app} ${configured ? 'synthetic configured' : 'unconfigured'}: HTTP sign-in, robots, session and secret-isolation checks passed`,
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
  '4 production HTTP/SSR profiles passed; no browser/provider/hosted SQL verification claimed.',
);
