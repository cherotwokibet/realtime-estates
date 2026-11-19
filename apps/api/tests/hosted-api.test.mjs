import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  fixture,
  publish,
  asActor,
  T,
  OTHER,
  ADMIN,
  AGENT,
  LISTING,
} from '../../../database/tests/public-media-fixtures.mjs';
import {
  createHostedApiHandler,
  readHostedApiEnvironment,
  createFirebaseApiActorResolver,
} from '../dist/hosted-api.js';
import { createHostedApiServer } from '../dist/hosted-http.js';
import {
  createHostedCustomerFavourites,
  createCustomerFavouritesHttpCandidate,
} from '../dist/customer-favourites-http.js';
import { createFirebaseIdentityVerifier } from '../dist/firebase-identity.js';
import { createPostgresBrowserIdentityStore } from '../dist/browser-identity-store.js';
import { createFirebaseBrowserIdentity } from '../dist/firebase-browser-identity.js';
import { createHostedCustomerBrowser } from '../dist/hosted-customer-browser.js';
import { createHostedStaffBrowser } from '../dist/hosted-staff-browser.js';
import { createCustomerOriginals } from '../dist/customer-browser-originals.js';
import { createStaffOriginals } from '../dist/staff-browser-originals.js';
import { PostgresTransactionDatabase, assertSafeRuntimeConnection } from '../dist/database.js';
import { AuthenticationError } from '../dist/auth.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
  CUSTOMER = id(13);
const config = {
  policy: 'realtor-staging-api-v1',
  projectId: 'realtor-synthetic-staging',
  tenantId: T,
  applicationOrigin: 'https://synthetic-api.example',
  privacyNoticeVersion: 'synthetic-staging-v1',
};
// This file is an isolated Node test process. Fixtures remain disposable and authority is injected.
process.env.NODE_ENV = 'production';
async function setup() {
  const db = await fixture();
  await publish(db);
  for (const name of [
    'customer-favourites.sql',
    'staff-branches.sql',
    'staff-directory-reads.sql',
    'browser-identity-state.sql',
    'firebase-actor-bindings.sql',
    'firebase-api-binding-lookup.sql',
    'customer-browser-originals.sql',
    'staff-browser-originals.sql',
  ])
    await db.exec(
      await readFile(new URL('../../../database/proposals/' + name, import.meta.url), 'utf8'),
    );
  for (const [actor, uid] of [
    [CUSTOMER, 'synthetic-customer'],
    [ADMIN, 'synthetic-admin'],
    [AGENT, 'synthetic-agent'],
  ])
    await db.query(
      'INSERT INTO identity.firebase_actor_bindings(project_id,firebase_uid,actor_id) VALUES($1,$2,$3)',
      [config.projectId, uid, actor],
    );
  const database = { transaction: (ctx, fn) => asActor(db, ctx.tenantId, ctx.actorId, fn) };
  const tokenActors = new Map([
    ['customer.payload.signature', 'synthetic-customer'],
    ['admin.payload.signature', 'synthetic-admin'],
    ['agent.payload.signature', 'synthetic-agent'],
  ]);
  let checked = 0;
  const verify = createFirebaseIdentityVerifier(
    config,
    createFirebaseApiActorResolver(database, T),
    {
      verifier: {
        async verifyIdToken(token, revoked) {
          checked++;
          assert.equal(revoked, true);
          const uid = tokenActors.get(token);
          if (!uid) throw Error('synthetic invalid token');
          const now = Math.floor(Date.now() / 1000);
          return {
            uid,
            sub: uid,
            aud: config.projectId,
            iss: 'https://securetoken.google.com/' + config.projectId,
            iat: now,
            exp: now + 3600,
            auth_time: now,
            email_verified: true,
            email: 'synthetic@example.test',
            firebase: { sign_in_provider: 'password' },
          };
        },
      },
    },
  );
  const handler = createHostedApiHandler(config, database, verify);
  return {
    db,
    database,
    verify,
    handler,
    get checked() {
      return checked;
    },
  };
}
const call = (f, path, token = 'customer.payload.signature', body, extra = {}) =>
  f.handler(
    new Request(config.applicationOrigin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
test('explicit staging config refuses development/production cutover, mixed previews, credential files and unsafe TLS', () => {
  const env = {
    NODE_ENV: 'production',
    APP_ENV: 'staging',
    GOOGLE_CLOUD_PROJECT: config.projectId,
    HOSTED_API_CONFIG: JSON.stringify(config),
    HOSTED_API_DATABASE_URL:
      'postgres://api_login:synthetic-secret@db.example/app?sslmode=verify-full',
  };
  assert.equal(readHostedApiEnvironment(env).config.tenantId, T);
  for (const bad of [
    { APP_ENV: 'production' },
    { NODE_ENV: 'development' },
    { API_MODE: 'database' },
    { STAFF_PREVIEW_TOKEN: 'secret' },
    { FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099' },
    { GOOGLE_APPLICATION_CREDENTIALS: 'service-account.json' },
    { GOOGLE_CLOUD_PROJECT: 'other-project' },
    { HOSTED_API_DATABASE_URL: 'postgres://api_login:secret@db.example/app?sslmode=disable' },
    { HOSTED_API_CONFIG: JSON.stringify({ ...config, role: 'admin' }) },
  ])
    assert.throws(() => readHostedApiEnvironment({ ...env, ...bad }));
});
test('legacy candidates and development startup still refuse production, with no secret diagnostics from hosted startup', () => {
  const opts = {
    tenantId: T,
    database: {},
    verifyAuthorization: async () => ({ actorId: CUSTOMER }),
  };
  assert.throws(() =>
    createCustomerFavouritesHttpCandidate({ ...opts, mode: 'synthetic-customer-favourites-v1' }),
  );
  assert.throws(() =>
    createHostedCustomerFavourites({ ...opts, pushMode: 'synthetic-customer-push-v1' }),
  );
  for (const file of ['index.js', 'hosted-index.js']) {
    const r = spawnSync(
      process.execPath,
      [fileURLToPath(new URL('../dist/' + file, import.meta.url))],
      {
        env: { ...process.env, HOSTED_API_CONFIG: 'invalid-synthetic-secret' },
        encoding: 'utf8',
        timeout: 10000,
        windowsHide: true,
      },
    );
    assert.notEqual(r.status, 0);
    if (file === 'hosted-index.js') {
      assert.ok(r.stderr.includes('Staging API startup failed.'));
      assert.ok(!r.stderr.includes('invalid-synthetic-secret'));
    }
  }
});
test('production-mode customer/staff protocols use verified UID binding and current SQL policy without exposing unrelated routes', async () => {
  const f = await setup();
  try {
    assert.equal((await call(f, '/v2/customer/account')).status, 200);
    assert.equal(
      (await call(f, '/v2/staff/branches?limit=10', 'admin.payload.signature')).status,
      200,
    );
    assert.equal(
      (await call(f, '/v2/staff/branches?limit=10', 'agent.payload.signature')).status,
      403,
    );
    assert.equal((await call(f, '/v2/staff/session', 'customer.payload.signature')).status, 403);
    const before = f.checked;
    for (const path of [
      '/v2/customer/push-preferences',
      '/v2/customer/deletion-request',
      '/v2/staff/invitation-requests?limit=10',
      '/v2/staff/listings',
      '/v3/staff/reference-session',
      '/v1/enquiries',
    ])
      assert.equal((await call(f, path)).status, 404);
    assert.equal(f.checked, before);
    assert.equal(
      (
        await call(f, '/v2/customer/account', 'customer.payload.signature', undefined, {
          'x-role': 'admin',
        })
      ).status,
      400,
    );
    await f.db.query(
      'UPDATE identity.firebase_actor_bindings SET active=false WHERE firebase_uid=$1',
      ['synthetic-customer'],
    );
    assert.equal((await call(f, '/v2/customer/account')).status, 401);
  } finally {
    await f.db.close();
  }
});
test('API identity lookup runs through restricted SQL function; raw identity tables remain inaccessible', async () => {
  const f = await setup();
  try {
    const resolver = createFirebaseApiActorResolver(f.database, T),
      subject = { projectId: config.projectId, authTenantId: null, uid: 'synthetic-customer' };
    assert.equal(await resolver(subject), CUSTOMER);
    assert.equal(await createFirebaseApiActorResolver(f.database, OTHER)(subject), null);
    await f.db.exec('BEGIN;SET LOCAL ROLE api_runtime');
    try {
      await assert.rejects(f.db.query('SELECT * FROM identity.firebase_actor_bindings'));
    } finally {
      await f.db.exec('ROLLBACK');
    }
    await f.db.exec('BEGIN;SET LOCAL ROLE api_runtime');
    try {
      await assert.rejects(f.db.query('SELECT * FROM identity.browser_state'));
    } finally {
      await f.db.exec('ROLLBACK');
    }
    await f.db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, CUSTOMER],
    );
    assert.equal(await resolver(subject), null);
  } finally {
    await f.db.close();
  }
});
test('actual SQL login attestation accepts only the isolated runtime login and refuses the migration owner', async () => {
  const f = await setup();
  try {
    await assert.rejects(assertSafeRuntimeConnection(f.db));
    let destroyed = false;
    const database = new PostgresTransactionDatabase({
      async connect() {
        return {
          query: (...args) => f.db.query(...args),
          release: (bad) => {
            destroyed = bad;
          },
        };
      },
    });
    const resolver = createFirebaseApiActorResolver(database, T);
    await assert.rejects(
      resolver({ projectId: config.projectId, authTenantId: null, uid: 'synthetic-admin' }),
    );
    assert.equal(destroyed, true);
    await f.db.exec(
      'CREATE ROLE staging_api_login LOGIN NOINHERIT;GRANT api_runtime TO staging_api_login;SET SESSION AUTHORIZATION staging_api_login;',
    );
    await assertSafeRuntimeConnection(f.db);
    assert.equal(
      await resolver({ projectId: config.projectId, authTenantId: null, uid: 'synthetic-admin' }),
      ADMIN,
    );
    assert.notEqual(destroyed, true);
  } finally {
    await f.db.close();
  }
});
async function wire(server, path, options = {}, host = 'synthetic-api.example') {
  return new Promise((resolve, reject) => {
    const r = httpRequest(
      {
        hostname: '127.0.0.1',
        port: server.address().port,
        path,
        method: options.method ?? 'GET',
        headers: {
          Host: host,
          ...(options.body ? { 'Content-Length': Buffer.byteLength(options.body) } : {}),
          ...options.headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (v) => chunks.push(v));
        res.on('end', () =>
          resolve(
            new Response(new Uint8Array(Buffer.concat(chunks)), {
              status: res.statusCode,
              headers: res.headers,
            }),
          ),
        );
      },
    );
    r.on('error', reject);
    if (options.body) r.write(options.body);
    r.end();
  });
}
test('listening production adapter bounds envelopes, ignores forged proxy routing and preserves private SDK/BFF recovery', async () => {
  const f = await setup(),
    server = createHostedApiServer(config.applicationOrigin, f.handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    assert.equal((await wire(server, '/healthz')).status, 200);
    assert.equal((await wire(server, '/healthz', {}, 'attacker.example')).status, 400);
    assert.equal(
      (
        await wire(server, '/v2/customer/account', {
          headers: {
            authorization: 'Bearer customer.payload.signature',
            'x-forwarded-host': 'attacker.example',
            'x-forwarded-proto': 'http',
          },
        })
      ).status,
      200,
    );
    for (const [path, opts, status] of [
      ['/v2/customer/account', { headers: { 'x-actor-id': ADMIN } }, 400],
      ['/v2/staff/../staff/session', {}, 400],
      ['/v2/customer/%61ccount', {}, 400],
      ['/v2/staff/invitation-requests', {}, 404],
      ['/v2/customer/account', { headers: { origin: 'https://attacker.example' } }, 403],
      [
        '/v2/customer/account',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'content-length': '9000' },
        },
        413,
      ],
    ])
      assert.equal((await wire(server, path, opts)).status, status);
    let posts = 0,
      lost = true;
    const transport = async (url, options) => {
      const r = await wire(server, new URL(url).pathname + new URL(url).search, options);
      if (options.method === 'POST') {
        posts++;
        if (lost) {
          lost = false;
          assert.equal(r.status, 200);
          throw Error('Synthetic lost real-HTTP acknowledgement');
        }
      }
      return r;
    };
    const origin = 'https://synthetic-web.example',
      cookies = new Map();
    const identity = createFirebaseBrowserIdentity(
      { projectId: config.projectId, applicationOrigin: origin, tenantId: T },
      createPostgresBrowserIdentityStore(f.db, '09'.repeat(32)),
      async (token) => ({ ...(await f.verify(token)), expiresAt: Date.now() + 600000 }),
    );
    const auth = {
      handle: (r) => identity.handle(r),
      authenticateSession: async (r) => {
        try {
          return await identity.authenticateSession(r);
        } catch {
          throw new AuthenticationError();
        }
      },
    };
    const req = (path, body, headers = {}) =>
      new Request(origin + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          origin,
          cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    function remember(r) {
      for (const c of r.headers.getSetCookie()) {
        const p = c.split(';')[0],
          at = p.indexOf('=');
        if (p.slice(at + 1)) cookies.set(p.slice(0, at), p.slice(at + 1));
        else cookies.delete(p.slice(0, at));
      }
      return r;
    }
    async function login(token) {
      const start = remember(await identity.handle(req('/auth/login', {})));
      const { state } = await start.json();
      assert.equal(
        remember(await identity.handle(req('/auth/firebase', { state, idToken: token }))).status,
        200,
      );
      return identity.authenticateSession(req('/api/customer/session'));
    }
    let session = await login('customer.payload.signature');
    const c = {
      policy: 'customer-favourite-command-v1',
      operationId: id(9101),
      listingId: LISTING,
      expectedVersion: '0',
      saved: true,
    };
    let customer = createHostedCustomerBrowser(
      { applicationOrigin: origin, apiOrigin: config.applicationOrigin, tenantId: T },
      auth,
      createCustomerOriginals(f.db, '04'.repeat(32)),
      transport,
    );
    const customerReq = (path, body) =>
      req('/api/customer/' + path, body, {
        'x-customer-intent': 'session-v1',
        'x-customer-csrf': session.csrf,
      });
    assert.equal((await customer.handle(customerReq('favourite', c))).status, 503);
    assert.equal(posts, 1);
    customer = createHostedCustomerBrowser(
      { applicationOrigin: origin, apiOrigin: config.applicationOrigin, tenantId: T },
      auth,
      createCustomerOriginals(f.db, '04'.repeat(32)),
      transport,
    );
    assert.equal((await customer.handle(customerReq('original'))).status, 200);
    assert.equal(posts, 1);
    session = await login('admin.payload.signature');
    lost = true;
    const branch = {
      policy: 'staff-branch-command-v1',
      operationId: id(9102),
      branchId: id(9103),
      expectedVersion: '0',
      name: 'Synthetic hosted branch',
      active: true,
      reason: 'Synthetic hosted pilot verification.',
    };
    const staff = createHostedStaffBrowser(
      { ...config, applicationOrigin: origin, apiOrigin: config.applicationOrigin },
      auth,
      createStaffOriginals(f.db, '05'.repeat(32)),
      transport,
    );
    const staffReq = (path, body) =>
      req('/api/hosted-staff/' + path, body, {
        'x-staff-intent': 'hosted-staff-v1',
        'x-staff-csrf': session.csrf,
      });
    assert.equal((await staff.handle(staffReq('command', branch))).status, 503);
    assert.equal(posts, 2);
    assert.equal((await staff.handle(staffReq('original'))).status, 200);
    assert.equal(posts, 2);
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await f.db.close();
  }
});
