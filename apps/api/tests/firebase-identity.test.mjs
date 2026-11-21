import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { initializeApp, deleteApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import {
  createFirebaseIdentityVerifier,
  createPostgresFirebaseActorResolver,
} from '../dist/firebase-identity.js';

// These injected SDK responses test our policy/mapping only, not Firebase cryptographic verification.
const projectId = 'realtor-synthetic-staging',
  actor = '00000000-0000-4000-8000-000000000001';
const token = 'synthetic.payload.signature';
const now = 1_800_000_000;
const claims = () => ({
  iss: 'https://securetoken.google.com/' + projectId,
  aud: projectId,
  uid: 'firebase-user-1',
  sub: 'firebase-user-1',
  iat: now - 10,
  exp: now + 3590,
  auth_time: now - 10,
  email: 'synthetic@example.test',
  email_verified: true,
  firebase: { sign_in_provider: 'password' },
  admin: true,
  tenantId: 'attacker-company',
});
function setup(overrides = {}, sdkError = false, config = { projectId }) {
  const calls = [],
    lookups = [];
  const verify = createFirebaseIdentityVerifier(
    config,
    async (subject) => {
      lookups.push(subject);
      return actor;
    },
    {
      now: () => now * 1000,
      verifier: {
        async verifyIdToken(value, revoked) {
          calls.push({ value, revoked });
          if (sdkError) throw Error('private SDK credential detail');
          return { ...claims(), ...overrides };
        },
      },
    },
  );
  return { verify, calls, lookups };
}
test('Firebase policy requires revocation checking and explicit actor mapping, ignoring company and role claims', async () => {
  const f = setup();
  assert.deepEqual(await f.verify(token, true), { actorId: actor, expiresAt: (now + 3590) * 1000 });
  assert.deepEqual(f.calls, [{ value: token, revoked: true }]);
  assert.deepEqual(f.lookups, [{ projectId, authTenantId: null, uid: 'firebase-user-1' }]);
});
test('wrong project, unverified email, anonymous, tenant mismatch and invalid times refuse before mapping', async () => {
  for (const overrides of [
    { aud: 'wrong-project' },
    { iss: 'https://attacker.example' },
    { uid: 'different-user' },
    { email_verified: false },
    { email_verified: 'true' },
    { email: undefined },
    { firebase: { sign_in_provider: 'anonymous' } },
    { firebase: { sign_in_provider: 'password', tenant: 'other' } },
    { exp: now },
    { iat: now + 1 },
    { auth_time: now + 1 },
    { auth_time: -1 },
    { exp: now + 7200 },
  ]) {
    const f = setup(overrides);
    await assert.rejects(f.verify(token), (e) => e.code === 'UNAUTHENTICATED');
    assert.equal(f.lookups.length, 0);
  }
  const old = setup({ auth_time: now - 301 });
  await assert.rejects(old.verify(token, true));
  assert.deepEqual(await old.verify(token), { actorId: actor, expiresAt: (now + 3590) * 1000 });
});
test('disabled/revoked SDK failures and unmapped actors deny with no SDK diagnostics', async () => {
  const f = setup({}, true);
  await assert.rejects(f.verify(token), (e) => !e.message.includes('private'));
  assert.equal(f.lookups.length, 0);
  for (const mapping of [null, 'firebase-user-1', 'not-a-uuid']) {
    const v = createFirebaseIdentityVerifier({ projectId }, async () => mapping, {
      now: () => now * 1000,
      verifier: {
        async verifyIdToken() {
          return claims();
        },
      },
    });
    await assert.rejects(v(token));
  }
  const malformed = setup();
  await assert.rejects(malformed.verify('unsigned-token'));
  assert.equal(malformed.calls.length, 0);
});
test('Firebase Identity Platform tenant is explicitly pinned and emulator activation cannot bypass verification', async () => {
  const f = setup({ firebase: { sign_in_provider: 'password', tenant: 'company-auth' } }, false, {
    projectId,
    authTenantId: 'company-auth',
  });
  assert.deepEqual(await f.verify(token), { actorId: actor, expiresAt: (now + 3590) * 1000 });
  const prior = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  try {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = '';
    assert.throws(() => setup());
    await assert.rejects(f.verify(token));
  } finally {
    if (prior === undefined) delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
    else process.env.FIREBASE_AUTH_EMULATOR_HOST = prior;
  }
});
test('actual Firebase Admin SDK refuses an HS256 token before credential lookup or actor mapping', async () => {
  let credentialCalls = 0,
    mappings = 0;
  const app = initializeApp(
    {
      projectId,
      credential: {
        async getAccessToken() {
          credentialCalls++;
          throw Error('No credentials in test.');
        },
      },
    },
    'synthetic-verifier-test',
  );
  try {
    const header = Buffer.from(
      JSON.stringify({ alg: 'HS256', typ: 'JWT', kid: 'synthetic' }),
    ).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims())).toString('base64url');
    const verify = createFirebaseIdentityVerifier(
      { projectId },
      async () => {
        mappings++;
        return actor;
      },
      { now: () => now * 1000, verifier: getAuth(app) },
    );
    await assert.rejects(verify(header + '.' + payload + '.c3ludGhldGlj'));
    assert.equal(credentialCalls, 0);
    assert.equal(mappings, 0);
  } finally {
    await deleteApp(app);
  }
});
test('actual SQL bindings isolate project/auth-tenant/UID and immediately reflect revocation', async () => {
  const db = new PGlite();
  try {
    await db.exec('CREATE SCHEMA identity');
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/firebase-actor-bindings.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query(
      'INSERT INTO identity.firebase_actor_bindings(project_id,firebase_uid,actor_id) VALUES($1,$2,$3)',
      [projectId, 'firebase-user-1', actor],
    );
    const resolve = createPostgresFirebaseActorResolver(db),
      subject = { projectId, authTenantId: null, uid: 'firebase-user-1' };
    assert.equal(await resolve(subject), actor);
    for (const changed of [
      { ...subject, projectId: 'other-project' },
      { ...subject, authTenantId: 'other' },
      { ...subject, uid: "firebase-user-1' OR true --" },
    ])
      assert.equal(await resolve(changed), null);
    await db.query('UPDATE identity.firebase_actor_bindings SET active=false');
    assert.equal(await resolve(subject), null);
  } finally {
    await db.close();
  }
});
