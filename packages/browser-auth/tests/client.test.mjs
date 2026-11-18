import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createBrowserSignInClient, SignInError } from '../dist/client.js';
import { readFirebaseWebConfig } from '../dist/config.js';
import SignInPanel from '../dist/SignInPanel.js';
const account = {
  actorId: '00000000-0000-4000-8000-000000000003',
  tenantId: '00000000-0000-4000-8000-000000000001',
  expiresAt: new Date(Date.now() + 600000).toISOString(),
};
const token = 'synthetic.payload.signature',
  state = 's'.repeat(43),
  csrf = 'c'.repeat(43);
const config = {
  projectId: 'realtor-synthetic-staging',
  authDomain: 'realtor-synthetic-staging.firebaseapp.com',
  apiKey: 'AIza' + 'x'.repeat(35),
  appId: '1:123456:web:abcdef123456',
};
function fixture({ lost = false, badReply = false, disposeFailure = false } = {}) {
  const calls = [],
    events = [];
  let signedIn = false,
    disposed = 0;
  const adapter = {
    async google() {
      events.push('google-open');
      return {
        async idToken() {
          return token;
        },
      };
    },
    async password(email, password) {
      assert.equal(email, 'synthetic@example.test');
      assert.equal(password, 'synthetic-password');
      return {
        async idToken() {
          return token;
        },
      };
    },
    async dispose() {
      disposed++;
      if (disposeFailure) throw Error('private SDK diagnostic');
    },
  };
  const transport = async (path, options) => {
    calls.push({ path, options });
    events.push(path);
    assert.equal(options.credentials, 'same-origin');
    assert.equal(options.cache, 'no-store');
    assert.equal(options.redirect, 'error');
    if (path === '/auth/login')
      return Response.json({ policy: 'firebase-browser-login-v1', state });
    if (path === '/auth/firebase') {
      const body = JSON.parse(options.body);
      assert.deepEqual(body, { state, idToken: token });
      signedIn = true;
      if (lost) throw Error('reply lost');
      return Response.json(badReply ? { signedIn: 'yes' } : { signedIn: true });
    }
    if (path === '/auth/logout') {
      assert.equal(options.headers['X-CSRF-Token'], csrf);
      signedIn = false;
      return Response.json({ account: null });
    }
    return Response.json({ account: signedIn ? account : null, csrf: signedIn ? csrf : null });
  };
  return {
    client: createBrowserSignInClient(() => adapter, transport),
    calls,
    events,
    disposed: () => disposed,
  };
}
test('Google and password exchange only ID token/state, clear SDK state and confirm the server session', async () => {
  for (const kind of ['google', 'password']) {
    const f = fixture(),
      session = await f.client.signIn(kind, 'synthetic@example.test', 'synthetic-password');
    assert.deepEqual(session, { account, csrf });
    assert.equal(f.disposed(), 1);
    assert.deepEqual(
      f.calls.map((c) => c.path),
      ['/auth/login', '/auth/firebase', '/auth/session'],
    );
    assert.equal(
      f.calls.some((c) => JSON.stringify(c.options).includes('synthetic-password')),
      false,
    );
    if (kind === 'google') assert.equal(f.events[0], 'google-open');
    await f.client.logout(session);
    assert.deepEqual(await f.client.getSession(), { account: null, csrf: null });
  }
});
test('lost/malformed exchange acknowledgement recovers only by GET, without a second send', async () => {
  for (const options of [{ lost: true }, { badReply: true }, { disposeFailure: true }]) {
    const f = fixture(options);
    await assert.rejects(
      f.client.signIn('google'),
      (e) => e instanceof SignInError && e.kind === 'uncertain',
    );
    assert.equal(f.disposed(), 1);
    assert.deepEqual(await f.client.getSession(), { account, csrf });
    assert.equal(f.calls.filter((c) => c.path === '/auth/firebase').length, 1);
  }
});
test('cancellation before provider completion prevents the exchange and disposes the late SDK result', async () => {
  let release;
  const hold = new Promise((r) => (release = r));
  let disposed = 0,
    calls = 0;
  const client = createBrowserSignInClient(
    () => ({
      async google() {
        await hold;
        return {
          async idToken() {
            return token;
          },
        };
      },
      async password() {
        throw Error('unused');
      },
      async dispose() {
        disposed++;
      },
    }),
    async () => {
      calls++;
      throw Error('must not fetch');
    },
  );
  const controller = new AbortController(),
    pending = client.signIn('google', '', '', controller.signal);
  controller.abort();
  release();
  await assert.rejects(pending, (e) => e.kind === 'cancelled');
  assert.equal(calls, 0);
  assert.equal(disposed, 1);
});
test('simultaneous sign-in does not create another SDK instance or bootstrap', async () => {
  let release;
  const hold = new Promise((r) => (release = r));
  let instances = 0;
  const f = fixture(),
    client = createBrowserSignInClient(
      () => {
        instances++;
        return {
          async google() {
            await hold;
            return {
              async idToken() {
                return token;
              },
            };
          },
          async password() {
            throw Error('unused');
          },
          async dispose() {},
        };
      },
      async (path) => {
        if (path === '/auth/login')
          return Response.json({ policy: 'firebase-browser-login-v1', state });
        return Response.json(path === '/auth/firebase' ? { signedIn: true } : { account, csrf });
      },
    );
  const pending = client.signIn('google');
  await assert.rejects(client.signIn('google'), (e) => e.kind === 'busy');
  release();
  await pending;
  assert.equal(instances, 1);
});
test('malformed/expired/oversized server metadata never becomes a signed-in view', async () => {
  for (const value of [
    { account, csrf, accessToken: token },
    { account: { ...account, actorId: 'posted-actor' }, csrf },
    { account: { ...account, expiresAt: '2020-01-01T00:00:00.000Z' }, csrf },
    { account: null, csrf },
  ]) {
    const client = createBrowserSignInClient(
      () => {
        throw Error('not needed');
      },
      async () => Response.json(value),
    );
    await assert.rejects(client.getSession());
  }
  const client = createBrowserSignInClient(
    () => {
      throw Error('not needed');
    },
    async () => new Response('x'.repeat(8193)),
  );
  await assert.rejects(client.getSession());
});
test('public Firebase config pins project/default auth domain and refuses server fields', () => {
  assert.equal(readFirebaseWebConfig(undefined, config.projectId), null);
  assert.deepEqual(readFirebaseWebConfig(JSON.stringify(config), config.projectId), config);
  for (const changed of [
    { ...config, projectId: 'other-project' },
    { ...config, authDomain: 'attacker.example' },
    { ...config, apiKey: 'bad' },
    { ...config, databaseUrl: 'private' },
    { ...config, privateKey: 'private' },
  ])
    assert.throws(() => readFirebaseWebConfig(JSON.stringify(changed), config.projectId));
});
test('shared sign-in screen renders labelled controls with no token, ID or configuration in its markup', () => {
  const html = renderToStaticMarkup(
    createElement(SignInPanel, { config, title: 'Staff sign in', continueHref: '/' }),
  );
  for (const text of [
    'Staff sign in',
    'Continue with Google',
    'Email address',
    'Password',
    'Check sign-in',
  ])
    assert.ok(html.includes(text));
  assert.ok(html.includes('type="password"'));
  assert.ok(html.includes('autoComplete="current-password"'));
  assert.equal(html.includes(config.apiKey), false);
  assert.equal(html.includes(token), false);
  assert.equal(html.includes(account.actorId), false);
});
