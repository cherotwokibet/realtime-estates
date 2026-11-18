import assert from 'node:assert/strict';
import { test, before, after } from 'node:test';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createBrowserIdentity } from '../dist/browser-identity.js';
import { createPostgresBrowserIdentityStore } from '../dist/browser-identity-store.js';

let server, issuer, privateKey, badKey, jwks;
const requests = [],
  grants = new Map();
const app = 'http://127.0.0.1:3098';
const tenant = '00000000-0000-4000-8000-000000000001';
before(async () => {
  const pair = await generateKeyPair('RS256', { extractable: true });
  privateKey = pair.privateKey;
  badKey = (await generateKeyPair('RS256')).privateKey;
  jwks = { keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'identity-test', alg: 'RS256' }] };
  server = createServer(async (req, res) => {
    try {
      requests.push(req.url);
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/jwks') return res.end(JSON.stringify(jwks));
      if (req.url !== '/token') {
        res.statusCode = 404;
        return res.end('{}');
      }
      let raw = '';
      for await (const part of req) raw += part;
      const p = new URLSearchParams(raw),
        grant = grants.get(p.get('code'));
      grants.delete(p.get('code'));
      if (
        !grant ||
        p.get('grant_type') !== 'authorization_code' ||
        p.get('client_id') !== 'test-browser' ||
        p.get('client_secret') !== 'test-secret' ||
        p.get('redirect_uri') !== app + '/auth/callback' ||
        createHash('sha256').update(p.get('code_verifier')).digest('base64url') !== grant.challenge
      ) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ error: 'invalid_grant' }));
      }
      if (grant.mode === 'redirect') {
        res.writeHead(307, { Location: issuer + '/unexpected' });
        return res.end();
      }
      const seconds = Math.floor(Date.now() / 1000);
      const sign = (payload, audience, key = privateKey) =>
        new SignJWT(payload)
          .setProtectedHeader({ alg: 'RS256', kid: 'identity-test' })
          .setIssuer(issuer)
          .setAudience(audience)
          .setSubject('customer-identity-test')
          .setIssuedAt(seconds)
          .setExpirationTime(seconds + 600)
          .sign(key);
      const idToken = await sign(
        { nonce: grant.mode === 'nonce' ? 'wrong' : grant.nonce },
        grant.mode === 'audience' ? 'wrong' : 'test-browser',
        grant.mode === 'signature' ? badKey : privateKey,
      );
      const access = await sign({}, grant.mode === 'api-audience' ? 'wrong' : 'realtor-api');
      res.end(
        JSON.stringify({
          access_token: access,
          token_type: 'Bearer',
          expires_in: 600,
          ...(grant.mode === 'missing-id' ? {} : { id_token: idToken }),
        }),
      );
    } catch {
      res.statusCode = 500;
      res.end('{}');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  issuer = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
});
function setup(overrides = {}, shared) {
  const login = shared?.login ?? new Map(),
    sessions = shared?.sessions ?? new Map();
  const store = {
    async putLogin(k, v) {
      login.set(k, v);
    },
    async takeLogin(k, now) {
      const v = login.get(k);
      login.delete(k);
      return v?.expiresAt > now ? v : null;
    },
    async putSession(k, v) {
      sessions.set(k, v);
    },
    async getSession(k, now) {
      const v = sessions.get(k);
      return v?.expiresAt > now ? v : null;
    },
    async deleteSession(k) {
      sessions.delete(k);
    },
  };
  let clock = Date.now();
  const config = {
    issuer,
    authorizationEndpoint: issuer + '/authorize',
    tokenEndpoint: issuer + '/token',
    jwksUrl: issuer + '/jwks',
    applicationOrigin: app,
    clientId: 'test-browser',
    clientSecret: 'test-secret',
    apiAudience: 'realtor-api',
    tenantId: tenant,
    allowLoopbackHttpForTests: true,
    ...overrides,
  };
  return {
    bridge: createBrowserIdentity(config, shared?.store ?? store, { now: () => clock }),
    login,
    sessions,
    expire() {
      clock += 700_000;
    },
  };
}
const request = (path, method = 'GET', headers = {}) =>
  new Request(app + path, { method, headers });
async function begin(f) {
  const response = await f.bridge.handle(request('/auth/login', 'POST', { origin: app }));
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get('location'));
  assert.equal(location.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(location.searchParams.get('scope'), 'openid');
  assert.equal(location.searchParams.get('redirect_uri'), app + '/auth/callback');
  assert.equal(location.searchParams.has('client_secret'), false);
  return { location, cookie: response.headers.getSetCookie()[0].split(';')[0] };
}
async function callback(f, start, mode = 'ok', headers = {}) {
  const code = crypto.randomUUID();
  grants.set(code, {
    mode,
    nonce: start.location.searchParams.get('nonce'),
    challenge: start.location.searchParams.get('code_challenge'),
  });
  return f.bridge.handle(
    request(
      '/auth/callback?code=' + code + '&state=' + start.location.searchParams.get('state'),
      'GET',
      { cookie: start.cookie, ...headers },
    ),
  );
}
test('signed provider login, opaque session, re-verification and logout revoke across instances', async () => {
  const f = setup(),
    start = await begin(f),
    reply = await callback(f, start);
  assert.equal(reply.status, 303);
  assert.equal(reply.headers.get('location'), app + '/');
  const cookie = reply.headers
    .getSetCookie()
    .find((x) => x.includes('realtor_session_'))
    .split(';')[0];
  assert.match(reply.headers.getSetCookie().join(';'), /HttpOnly/);
  const second = setup({}, f);
  const session = await second.bridge.handle(request('/auth/session', 'GET', { cookie }));
  assert.equal(session.headers.get('cache-control'), 'no-store');
  const value = await session.json();
  assert.equal(value.account.actorId, 'customer-identity-test');
  assert.equal(value.account.tenantId, tenant);
  assert.ok(value.csrf);
  assert.equal(JSON.stringify(value).includes('access_token'), false);
  assert.equal(
    (await second.bridge.authenticate(request('/private', 'GET', { cookie }))).actorId,
    'customer-identity-test',
  );
  assert.equal(
    (await second.bridge.handle(request('/auth/logout', 'POST', { cookie, origin: app }))).status,
    401,
  );
  assert.equal(
    (
      await second.bridge.handle(
        request('/auth/logout', 'POST', {
          cookie,
          origin: app,
          'x-csrf-token': value.csrf,
        }),
      )
    ).status,
    200,
  );
  await assert.rejects(f.bridge.authenticate(request('/private', 'GET', { cookie })));
  assert.equal(f.sessions.size, 0);
});
for (const mode of ['nonce', 'audience', 'api-audience', 'signature', 'missing-id', 'redirect']) {
  test('provider response refuses ' + mode + ' and consumes transaction', async () => {
    const f = setup(),
      start = await begin(f),
      reply = await callback(f, start, mode);
    assert.equal(reply.status, 401);
    assert.deepEqual(await reply.json(), { error: 'SIGN_IN_FAILED' });
    assert.equal(f.sessions.size, 0);
    assert.equal(f.login.size, 0);
    assert.equal((await callback(f, start)).status, 401);
  });
}
test('missing browser binding, duplicate state, wrong company, expiry and concurrent callback replay are denied', async () => {
  const f = setup(),
    start = await begin(f);
  assert.equal((await callback(f, start, 'ok', { cookie: '' })).status, 401);
  const state = start.location.searchParams.get('state');
  assert.equal(
    (
      await f.bridge.handle(
        request(`/auth/callback?state=${state}&state=${state}`, 'GET', { cookie: start.cookie }),
      )
    ).status,
    401,
  );
  const other = setup({ tenantId: '00000000-0000-4000-8000-000000000002' }, f);
  assert.equal((await callback(other, start)).status, 401);
  const results = await Promise.all([callback(f, start), callback(f, start)]);
  assert.deepEqual(results.map((x) => x.status).sort(), [303, 401]);
  const fresh = setup(),
    pending = await begin(fresh);
  fresh.expire();
  assert.equal((await callback(fresh, pending)).status, 401);
});
test('cross-origin mutations and wrong Host cannot begin login or read sessions', async () => {
  const f = setup();
  for (const headers of [
    {},
    { origin: 'https://attacker.example' },
    { origin: app, 'sec-fetch-site': 'cross-site' },
  ])
    assert.equal((await f.bridge.handle(request('/auth/login', 'POST', headers))).status, 401);
  assert.equal(
    (await f.bridge.handle(new Request('https://other.example/auth/session'))).status,
    404,
  );
  assert.equal(f.login.size, 0);
});
test('complete signed login persists through independent SQL-backed instances and logout revokes the old cookie', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/browser-identity-state.sql', import.meta.url),
        'utf8',
      ),
    );
    const make = () =>
      setup({}, { store: createPostgresBrowserIdentityStore(db, '01'.repeat(32)) });
    const first = make(),
      start = await begin(first),
      second = make();
    const reply = await callback(second, start);
    assert.equal(reply.status, 303);
    const cookie = reply.headers
      .getSetCookie()
      .find((x) => x.includes('realtor_session_'))
      .split(';')[0];
    const third = make(),
      session = await third.bridge.handle(request('/auth/session', 'GET', { cookie }));
    const value = await session.json();
    assert.equal(value.account.actorId, 'customer-identity-test');
    const raw = JSON.stringify((await db.query('SELECT * FROM identity.browser_state')).rows);
    assert.equal(raw.includes('customer-identity-test'), false);
    assert.equal(raw.includes('private-verifier'), false);
    assert.equal(
      (await third.bridge.authenticate(request('/private', 'GET', { cookie }))).actorId,
      value.account.actorId,
    );
    assert.equal(
      (
        await first.bridge.handle(
          request('/auth/logout', 'POST', {
            cookie,
            origin: app,
            'x-csrf-token': value.csrf,
          }),
        )
      ).status,
      200,
    );
    await assert.rejects(second.bridge.authenticate(request('/private', 'GET', { cookie })));
    assert.equal((await db.query('SELECT * FROM identity.browser_state')).rows.length, 0);
  } finally {
    await db.close();
  }
});
test('unsafe endpoint configuration and production loopback exception are rejected before network', () => {
  for (const overrides of [
    { tokenEndpoint: 'https://attacker.example/token' },
    { applicationOrigin: app + '/path' },
    { jwksUrl: issuer + '/jwks?key=x' },
    { clientId: '' },
    { tenantId: 'posted-company' },
  ])
    assert.throws(() => setup(overrides));
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => setup());
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
  assert.equal(requests.includes('/unexpected'), false);
});
