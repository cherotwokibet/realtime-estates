import test from 'node:test';
import assert from 'node:assert/strict';
import { getConfig } from '@expo/config';
import { fileURLToPath } from 'node:url';
import { createFirebaseMobileSignIn } from '../dist/tests/src/firebase-customer-sign-in.js';
import { readNativeFirebaseConfig } from '../dist/tests/src/native-firebase-config.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const config = () => ({
  mode: 'firebase-native-customer-v1',
  tenantId: id(1),
  apiOrigin: 'https://synthetic.invalid',
  firebase: {
    apiKey: 'AIza' + 'a'.repeat(35),
    projectId: 'synthetic-native',
    authDomain: 'synthetic-native.firebaseapp.com',
    appId: '1:123:web:abcdef123456',
  },
});
const token = 'synthetic.private.signature';
const account = (overrides = {}) => ({
  policy: 'customer-account-v1',
  tenantId: id(1),
  customerId: id(13),
  ...overrides,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setImmediate(done));
function response(body = account(), options = {}) {
  const r = Response.json(body, {
    status: options.status ?? 200,
    headers: { 'Cache-Control': 'no-store', ...options.headers },
  });
  Object.defineProperty(r, 'url', {
    value: options.url ?? config().apiOrigin + '/v2/customer/account',
  });
  if (options.redirected) Object.defineProperty(r, 'redirected', { value: true });
  return r;
}
function fixture(overrides = {}) {
  const calls = [],
    providers = [];
  const factory = () => {
    const p = {
      disposed: 0,
      password: async (email, password) => {
        assert.equal(email, 'synthetic@example.invalid');
        assert.equal(password, 'memory-password');
        if (overrides.credential) return overrides.credential();
        return {
          idToken: token,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          emailVerified: true,
        };
      },
      dispose: async () => {
        p.disposed++;
        if (overrides.cleanupFailure) throw Error(token);
      },
    };
    providers.push(p);
    return p;
  };
  const transport = async (url, init) => {
    calls.push({ url, init });
    assert.equal(providers.at(-1).disposed, 1, 'SDK session is cleaned before private calls');
    assert.equal(init.headers.Authorization, 'Bearer ' + token);
    assert.equal(init.credentials, 'omit');
    assert.equal(init.redirect, 'error');
    assert.equal(init.cache, 'no-store');
    assert.ok(!Object.keys(init.headers).some((k) => /actor|tenant|company|preview/i.test(k)));
    return overrides.fetch ? overrides.fetch(url, init, calls.length) : response();
  };
  const client = createFirebaseMobileSignIn(config(), {
    provider: factory,
    uuid: () => id(99),
    fetch: transport,
    timeoutMs: overrides.timeoutMs ?? 1000,
  });
  return {
    client,
    calls,
    providers,
    async login() {
      return client.signIn('synthetic@example.invalid', 'memory-password');
    },
  };
}
test('public native config is default-off and rejects credentials, getters, foreign keys and insecure origins', () => {
  assert.equal(readNativeFirebaseConfig(undefined), null);
  assert.ok(Object.isFrozen(readNativeFirebaseConfig(config()).firebase));
  let evaluated = false;
  const accessor = config();
  Object.defineProperty(accessor, 'tenantId', {
    enumerable: true,
    get() {
      evaluated = true;
      return id(1);
    },
  });
  for (const candidate of [
    accessor,
    { ...config(), bearerToken: token },
    { ...config(), role: 'owner' },
    { ...config(), apiOrigin: 'http://synthetic.invalid' },
    { ...config(), apiOrigin: 'https://synthetic.invalid/path' },
    { ...config(), apiOrigin: 'https://user:pass@synthetic.invalid' },
    { ...config(), apiOrigin: 'https://synthetic.invalid?next=x' },
    { ...config(), firebase: { ...config().firebase, private_key: token } },
    { ...config(), firebase: { ...config().firebase, authDomain: 'foreign.firebaseapp.com' } },
  ])
    assert.throws(() => readNativeFirebaseConfig(candidate), /configuration unavailable/);
  assert.equal(evaluated, false);
});
test('actual Expo opt-in exposes only public config and refuses mixing synthetic catalogue or credential extras', () => {
  const keys = Object.keys(process.env).filter((k) => k.startsWith('MOBILE_'));
  const original = {
    ...Object.fromEntries(keys.map((k) => [k, process.env[k]])),
    NODE_ENV: process.env.NODE_ENV,
  };
  const root = fileURLToPath(new URL('../', import.meta.url));
  const read = (patch) => {
    for (const k of [...keys, 'MOBILE_FIREBASE_CUSTOMER_CONFIG', 'MOBILE_CATALOGUE_MODE'])
      delete process.env[k];
    Object.assign(process.env, { NODE_ENV: 'production', ...patch });
    return getConfig(root, { skipSDKVersionRequirement: true }).exp;
  };
  try {
    assert.equal(read({}).extra.nativeFirebase, undefined);
    assert.deepEqual(
      read({ MOBILE_FIREBASE_CUSTOMER_CONFIG: JSON.stringify(config()) }).extra.nativeFirebase,
      config(),
    );
    assert.throws(() =>
      read({
        MOBILE_FIREBASE_CUSTOMER_CONFIG: JSON.stringify(config()),
        MOBILE_CATALOGUE_MODE: 'synthetic-reference-public-v1',
      }),
    );
    assert.throws(() =>
      read({ MOBILE_FIREBASE_CUSTOMER_CONFIG: JSON.stringify({ ...config(), password: token }) }),
    );
    assert.throws(
      () => read({ MOBILE_FIREBASE_CUSTOMER_CONFIG: '{"password":"memory-password"' }),
      (error) =>
        !error.message.includes('memory-password') &&
        error.message.includes('Invalid native account configuration'),
    );
  } finally {
    for (const k of Object.keys(process.env).filter((k) => k.startsWith('MOBILE_')))
      delete process.env[k];
    for (const [k, v] of Object.entries(original)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});
test('protected account binding is rechecked before activation; snapshots never expose token/password and logout clears', async (t) => {
  const f = fixture();
  t.after(() => f.client.dispose());
  assert.equal(await f.login(), true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.client.snapshot().phase, 'ready');
  assert.equal(f.client.session.snapshot().account.customerId, id(13));
  assert.equal(f.providers[0].disposed, 1);
  const safe = JSON.stringify([f.client.snapshot(), f.client.session.snapshot()]);
  assert.ok(!safe.includes(token));
  assert.ok(!safe.includes('memory-password'));
  f.client.signOut();
  assert.equal(f.client.session.snapshot().status, 'signed_out');
  assert.equal(f.client.snapshot().phase, 'signed_out');
});
test('unverified, expired or malformed credentials and cleanup errors refuse before private requests', async () => {
  for (const credential of [
    () => ({
      idToken: token,
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      emailVerified: false,
    }),
    () => ({ idToken: token, expiresAt: '2000-01-01', emailVerified: true }),
    () => ({
      idToken: 'not-jwt',
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      emailVerified: true,
    }),
    () => ({
      idToken: token,
      expiresAt: new Date(Date.now() + 7200000).toISOString(),
      emailVerified: true,
    }),
  ]) {
    const f = fixture({ credential });
    assert.equal(await f.login(), false);
    assert.equal(f.calls.length, 0);
    assert.equal(f.providers[0].disposed, 1);
    f.client.dispose();
  }
  const f = fixture({ cleanupFailure: true });
  assert.equal(await f.login(), false);
  assert.equal(f.calls.length, 0);
  f.client.dispose();
});
test('foreign company, redirected/malformed/cached responses, missing membership and changing actor refuse activation', async () => {
  for (const fetcher of [
    () => response(account({ tenantId: id(2) })),
    () => response(account(), { redirected: true }),
    () => response(account(), { url: 'https://foreign.invalid/v2/customer/account' }),
    () => response(account(), { status: 403 }),
    () => response(account(), { headers: { 'Cache-Control': 'public' } }),
    () => response({ ...account(), role: 'owner' }),
    (_, __, n) => response(account({ customerId: n === 1 ? id(13) : id(14) })),
  ]) {
    const f = fixture({ fetch: fetcher });
    assert.equal(await f.login(), false);
    assert.notEqual(f.client.session.snapshot().status, 'ready');
    f.client.dispose();
  }
});
test('cancelled provider completion cannot reactivate after a subsequent login', async (t) => {
  const late = deferred();
  let attempts = 0;
  const f = fixture({
    credential: () =>
      ++attempts === 1
        ? late.promise
        : {
            idToken: token,
            expiresAt: new Date(Date.now() + 60000).toISOString(),
            emailVerified: true,
          },
  });
  t.after(() => f.client.dispose());
  const first = f.login();
  assert.equal(await f.login(), false, 'no duplicate concurrent login');
  f.client.signOut();
  assert.equal(await first, false);
  assert.equal(f.providers[0].disposed, 1);
  assert.equal(await f.login(), true);
  late.resolve({
    idToken: token,
    expiresAt: new Date(Date.now() + 60000).toISOString(),
    emailVerified: true,
  });
  await tick();
  assert.equal(f.client.snapshot().phase, 'ready');
  assert.equal(f.calls.length, 2);
  assert.equal(f.providers[1].disposed, 1);
});
test('cancelled native transport ignoring AbortSignal settles and discards late body without reactivation', async (t) => {
  const late = deferred();
  const f = fixture({ fetch: () => late.promise });
  t.after(() => f.client.dispose());
  const pending = f.login();
  await tick();
  assert.equal(f.calls.length, 1);
  f.client.signOut();
  assert.equal(await pending, false);
  let cancelled = false;
  const r = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
  );
  late.resolve(r);
  await tick();
  assert.equal(cancelled, true);
  assert.equal(f.client.session.snapshot().status, 'signed_out');
});
test('timeout or caller abort settles even a hung provider; disposable client cannot sign in again', async (t) => {
  const f = fixture({ credential: () => new Promise(() => {}), timeoutMs: 30 });
  t.after(() => f.client.dispose());
  assert.equal(await f.login(), false);
  assert.equal(f.providers[0].disposed, 1);
  assert.equal(f.calls.length, 0);
  const controller = new AbortController();
  const pending = f.client.signIn(
    'synthetic@example.invalid',
    'memory-password',
    controller.signal,
  );
  controller.abort();
  assert.equal(await pending, false);
  assert.equal(f.providers[1].disposed, 1);
  f.client.dispose();
  assert.equal(await f.login(), false);
});
test('oversized or stalled account bodies settle without keeping private session state', async () => {
  for (const stall of [false, true]) {
    let cancelled = false;
    const f = fixture({
      timeoutMs: 40,
      fetch: () => {
        const r = new Response(
          new ReadableStream({
            start(c) {
              if (!stall) c.enqueue(new Uint8Array(4097));
            },
            cancel() {
              cancelled = true;
            },
          }),
          { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } },
        );
        Object.defineProperty(r, 'url', { value: config().apiOrigin + '/v2/customer/account' });
        return r;
      },
    });
    assert.equal(await f.login(), false);
    assert.notEqual(f.client.session.snapshot().status, 'ready');
    assert.equal(cancelled, true);
    f.client.dispose();
  }
});
test('token expiry clears the activated account rather than silently refreshing in the background', async (t) => {
  const f = fixture({
    credential: () => ({
      idToken: token,
      expiresAt: new Date(Date.now() + 250).toISOString(),
      emailVerified: true,
    }),
  });
  t.after(() => f.client.dispose());
  assert.equal(await f.login(), true);
  await new Promise((done) => setTimeout(done, 350));
  assert.equal(f.client.session.snapshot().status, 'signed_out');
  assert.equal(f.client.snapshot().phase, 'signed_out');
  assert.equal(f.calls.length, 2);
});
