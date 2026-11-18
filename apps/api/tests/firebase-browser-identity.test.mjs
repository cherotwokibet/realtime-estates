import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createFirebaseBrowserIdentity } from '../dist/firebase-browser-identity.js';
import { createPostgresBrowserIdentityStore } from '../dist/browser-identity-store.js';
import {
  createFirebaseTokenVerifier,
  createPostgresFirebaseActorResolver,
} from '../dist/firebase-identity.js';
const origin = 'https://synthetic-web.example',
  projectId = 'realtor-synthetic-staging';
const tenantId = '00000000-0000-4000-8000-000000000001',
  actorId = '00000000-0000-4000-8000-000000000003';
const token = 'synthetic.payload.signature';
async function fixture(overrides = {}) {
  const db = new PGlite();
  for (const name of ['browser-identity-state.sql', 'firebase-actor-bindings.sql'])
    await db.exec(
      await readFile(new URL('../../../database/proposals/' + name, import.meta.url), 'utf8'),
    );
  await db.query(
    'INSERT INTO identity.firebase_actor_bindings(project_id,firebase_uid,actor_id) VALUES($1,$2,$3)',
    [projectId, 'synthetic-firebase-user', actorId],
  );
  const now = Date.now(),
    seconds = Math.floor(now / 1000),
    checks = [];
  const verify = createFirebaseTokenVerifier(
    { projectId },
    createPostgresFirebaseActorResolver(db),
    {
      now: () => now,
      verifier: {
        async verifyIdToken(value, revoked) {
          checks.push({ value, revoked });
          return {
            iss: 'https://securetoken.google.com/' + projectId,
            aud: projectId,
            uid: 'synthetic-firebase-user',
            sub: 'synthetic-firebase-user',
            iat: seconds,
            exp: seconds + 3600,
            auth_time: seconds,
            email: 'synthetic@example.test',
            email_verified: true,
            firebase: { sign_in_provider: 'password' },
            ...overrides,
          };
        },
      },
    },
  );
  const store = createPostgresBrowserIdentityStore(db, '01'.repeat(32));
  const make = (config = {}, wrapped = store, check = verify) =>
    createFirebaseBrowserIdentity(
      { projectId, applicationOrigin: origin, tenantId, ...config },
      wrapped,
      check,
      () => now,
    );
  return { db, store, make, bridge: make(), checks, now, verify };
}
const request = (path, method = 'GET', cookie = '', body, extra = {}) =>
  new Request(origin + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === 'POST' ? { origin } : {}),
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...extra,
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
async function begin(bridge) {
  const r = await bridge.handle(request('/auth/login', 'POST'));
  assert.equal(r.status, 200);
  const value = await r.json();
  assert.equal(value.policy, 'firebase-browser-login-v1');
  const cookie = r.headers.getSetCookie()[0];
  assert.match(cookie, /__Host-/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  return { cookie: cookie.split(';')[0], state: value.state };
}
async function exchange(bridge, start, body = { state: start.state, idToken: token }) {
  return bridge.handle(request('/auth/firebase', 'POST', start.cookie, body));
}
test('Firebase SDK policy and SQL binding exchange into an opaque session, recheck revocation and shared logout', async () => {
  const f = await fixture();
  try {
    const start = await begin(f.bridge),
      reply = await exchange(f.bridge, start);
    assert.equal(reply.status, 200);
    const cookies = reply.headers.getSetCookie();
    const cookie = cookies.find((c) => c.includes('firebase_session_')).split(';')[0];
    assert.equal(
      cookies.some((c) => c.includes(token)),
      false,
    );
    const next = f.make(),
      session = await next.handle(request('/auth/session', 'GET', cookie));
    const value = await session.json();
    assert.equal(value.account.actorId, actorId);
    assert.equal(value.account.tenantId, tenantId);
    assert.equal(JSON.stringify(value).includes(token), false);
    assert.equal(session.headers.get('cache-control'), 'no-store');
    const auth = await next.authenticate(
      request('/api/customer/favourites?limit=20', 'GET', cookie),
    );
    assert.deepEqual(auth, { actorId, tenantId, accessToken: token });
    assert.ok(f.checks.every((c) => c.revoked === true));
    await f.db.query('UPDATE identity.firebase_actor_bindings SET active=false');
    assert.equal((await next.handle(request('/auth/session', 'GET', cookie))).status, 401);
    await assert.rejects(
      next.authenticate(request('/api/customer/favourites?limit=20', 'GET', cookie)),
    );
    await f.db.query('UPDATE identity.firebase_actor_bindings SET active=true');
    assert.equal(
      (
        await next.handle(
          request('/auth/logout', 'POST', cookie, undefined, { 'x-csrf-token': 'wrong' }),
        )
      ).status,
      401,
    );
    assert.equal(
      (
        await next.handle(
          request('/auth/logout', 'POST', cookie, undefined, { 'x-csrf-token': value.csrf }),
        )
      ).status,
      200,
    );
    await assert.rejects(f.bridge.authenticate(request('/api/customer/state', 'GET', cookie)));
  } finally {
    await f.db.close();
  }
});
test('Firebase exchange denies unverified/revoked bindings, old authentication and wrong project, without a session', async () => {
  for (const claims of [{ email_verified: false }, { auth_time: 1 }, { aud: 'wrong-project' }]) {
    const f = await fixture(claims);
    try {
      assert.equal((await exchange(f.bridge, await begin(f.bridge))).status, 401);
      assert.equal(
        (await f.db.query("SELECT * FROM identity.browser_state WHERE kind='session'")).rows.length,
        0,
      );
    } finally {
      await f.db.close();
    }
  }
  const f = await fixture();
  try {
    const start = await begin(f.bridge);
    await f.db.query('UPDATE identity.firebase_actor_bindings SET active=false');
    assert.equal((await exchange(f.bridge, start)).status, 401);
  } finally {
    await f.db.close();
  }
});
test('Firebase exchange guards forged state, duplicate JSON, oversized body, company scope and cross-origin requests', async () => {
  const f = await fixture();
  try {
    const start = await begin(f.bridge);
    assert.equal(
      (await exchange(f.bridge, start, { state: 'x'.repeat(43), idToken: token })).status,
      401,
    );
    assert.equal(
      (
        await exchange(
          f.bridge,
          start,
          `{"state":"${start.state}","state":"${start.state}","idToken":"${token}"}`,
        )
      ).status,
      401,
    );
    assert.equal(
      (await exchange(f.bridge, start, { state: start.state, idToken: 'x'.repeat(17000) })).status,
      401,
    );
    const other = f.make({ tenantId: '00000000-0000-4000-8000-000000000002' });
    assert.equal((await exchange(other, start)).status, 401);
    assert.equal(
      (
        await f.bridge.handle(
          request(
            '/auth/firebase',
            'POST',
            start.cookie,
            { state: start.state, idToken: token },
            { origin: 'https://attacker.example' },
          ),
        )
      ).status,
      401,
    );
    assert.equal(f.checks.length, 0);
    assert.equal((await exchange(f.bridge, start)).status, 200);
    assert.equal((await exchange(f.bridge, start)).status, 401);
  } finally {
    await f.db.close();
  }
});
for (const position of ['before-issue', 'after-issue'])
  test('Firebase logout blocks pending exchange ' + position, async () => {
    const f = await fixture();
    let release, arrived;
    const hold = new Promise((r) => (release = r)),
      reached = new Promise((r) => (arrived = r));
    try {
      const wrapped = {
        ...f.store,
        async completeLogin(...args) {
          const done = await f.store.completeLogin(...args);
          if (position === 'after-issue') {
            arrived();
            await hold;
          }
          return done;
        },
      };
      const check = async (...args) => {
        const identity = await f.verify(...args);
        if (position === 'before-issue') {
          arrived();
          await hold;
        }
        return identity;
      };
      const bridge = f.make({}, wrapped, check),
        start = await begin(bridge),
        pending = exchange(bridge, start);
      await reached;
      assert.equal(
        (await bridge.handle(request('/auth/logout', 'POST', start.cookie))).status,
        200,
      );
      release();
      assert.equal((await pending).status, 401);
      assert.equal(
        (await f.db.query("SELECT * FROM identity.browser_state WHERE kind='session'")).rows.length,
        0,
      );
    } finally {
      release();
      await f.db.close();
    }
  });
