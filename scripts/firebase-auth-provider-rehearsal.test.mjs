import test from 'node:test';
import assert from 'node:assert/strict';
import { runFirebaseAuthProviderRehearsal as run } from './firebase-auth-provider-rehearsal.mjs';

const input = () => ({
  policy: 'owned-staging-auth-public-rest-v1',
  billingEnabled: false,
  billingCheckedAt: new Date().toISOString(),
  sdkConfig: {
    projectId: 'boniface-realtor-staging',
    appId: '1:144079064698:web:89f61d2a4a0fb52d8675c3',
    authDomain: 'boniface-realtor-staging.firebaseapp.com',
    projectNumber: '144079064698',
    apiKey: 'AIza' + 'a'.repeat(35),
  },
});
function fixture(options = {}) {
  const calls = [];
  let email,
    password,
    deleted = false;
  const uid = 'synthetic-owned-account-123456';
  const token = 'private-id-token-sentinel';
  const refresh = 'private-refresh-token-sentinel';
  const reply = (body, status = 200) => new Response(JSON.stringify(body), { status });
  const dependencies = {
    fetch: async (url, init) => {
      const u = new URL(url);
      assert.equal(u.protocol, 'https:');
      assert.ok(
        ['identitytoolkit.googleapis.com', 'securetoken.googleapis.com'].includes(u.hostname),
      );
      assert.equal(init.redirect, 'error');
      const method = u.pathname.endsWith('/token') ? 'refresh' : u.pathname.split(':')[1];
      const data =
        method === 'refresh'
          ? Object.fromEntries(new URLSearchParams(init.body))
          : JSON.parse(init.body);
      calls.push(method);
      if (method === 'signUp') {
        email = data.email;
        password = data.password;
        assert.match(email, /^realtor-rebuild-ci-[0-9a-f]{24}@example\.invalid$/);
        assert.ok(password.length >= 40);
        if (options.quota)
          return reply({ error: { message: 'TOO_MANY_ATTEMPTS_TRY_LATER : ' + password } }, 400);
        if (options.lostSignupResponse) throw new Error('network ' + password);
      }
      if (method === 'signUp' || method === 'signInWithPassword') {
        assert.equal(data.email, email);
        assert.equal(data.password, password);
        return reply({ email, localId: uid, idToken: token, refreshToken: refresh });
      }
      if (method === 'lookup') {
        assert.equal(data.idToken, token);
        return deleted
          ? reply({ error: { message: 'USER_NOT_FOUND' } }, 400)
          : reply({ users: [{ localId: options.foreign ? 'foreign-account' : uid, email }] });
      }
      if (method === 'delete') {
        deleted = true;
        return reply({});
      }
      if (method === 'refresh')
        return deleted
          ? reply({ error: { message: 'TOKEN_EXPIRED' } }, 400)
          : reply({
              user_id: uid,
              project_id: '144079064698',
              id_token: token,
              refresh_token: refresh,
            });
      throw new Error('Unexpected endpoint');
    },
    verifyToken: async () => {
      if (options.badSignature) throw new Error(token);
      const now = Math.floor(Date.now() / 1000);
      return {
        aud: input().sdkConfig.projectId,
        iss: 'https://securetoken.google.com/boniface-realtor-staging',
        uid,
        sub: uid,
        email,
        email_verified: false,
        firebase: { sign_in_provider: 'password' },
        iat: now,
        exp: now + 3600,
      };
    },
  };
  return {
    calls,
    dependencies,
    assertSafe(report) {
      const serialized = JSON.stringify(report);
      for (const secret of [password, token, refresh, uid])
        if (secret) assert.ok(!serialized.includes(secret));
      assert.equal(report.livePublicProviderLifecycleVerified, false);
      assert.equal(report.backendVerifiedEmailAccepted, false);
      assert.equal(report.backendRevocationChecked, false);
    },
  };
}
test('refuses billing, foreign projects and stale evidence before any request', async () => {
  for (const change of [
    (x) => (x.billingEnabled = true),
    (x) => (x.sdkConfig.projectId = 'foreign'),
    (x) => (x.billingCheckedAt = '2000-01-01'),
  ]) {
    const f = fixture(),
      config = input();
    change(config);
    await assert.rejects(run(config, f.dependencies));
    assert.equal(f.calls.length, 0);
  }
});
test('one bounded lifecycle, exact ownership cleanup, no persisted credentials or false live proof', async () => {
  const f = fixture();
  const report = await run(input(), f.dependencies);
  assert.equal(report.status, 'passed');
  assert.equal(report.cleanupCompleted, true);
  assert.equal(report.cleanupRequired, false);
  assert.deepEqual(f.calls, [
    'signUp',
    'signInWithPassword',
    'lookup',
    'refresh',
    'lookup',
    'delete',
    'lookup',
    'refresh',
  ]);
  f.assertSafe(report);
});
test('quota refusal stops after one request without retrying signup or leaking response detail', async () => {
  const f = fixture({ quota: true });
  const report = await run(input(), f.dependencies);
  assert.equal(report.status, 'failed');
  assert.equal(report.error.code, 'TOO_MANY_ATTEMPTS_TRY_LATER');
  assert.deepEqual(f.calls, ['signUp']);
  assert.equal(report.cleanupRequired, false);
  f.assertSafe(report);
});
test('signature failure still deletes only the account created by this invocation', async () => {
  const f = fixture({ badSignature: true });
  const report = await run(input(), f.dependencies);
  assert.equal(report.status, 'failed');
  assert.equal(report.error.code, 'SIGNATURE_VERIFICATION_FAILED');
  assert.equal(report.cleanupCompleted, true);
  assert.deepEqual(f.calls, ['signUp', 'lookup', 'delete', 'lookup']);
  f.assertSafe(report);
});
test('ambiguous signup response recovers the same account once without another creation', async () => {
  const f = fixture({ lostSignupResponse: true });
  const report = await run(input(), f.dependencies);
  assert.equal(report.status, 'failed');
  assert.equal(report.cleanupCompleted, true);
  assert.deepEqual(f.calls, ['signUp', 'signInWithPassword', 'lookup', 'delete', 'lookup']);
  f.assertSafe(report);
});
test('foreign lookup never deletes and reports required cleanup without credentials', async () => {
  const f = fixture({ foreign: true });
  const report = await run(input(), f.dependencies);
  assert.equal(report.status, 'failed');
  assert.equal(report.cleanupRequired, true);
  assert.equal(report.cleanupCompleted, false);
  assert.ok(!f.calls.includes('delete'));
  assert.match(report.syntheticEmailForManualCleanup, /@example\.invalid$/);
  f.assertSafe(report);
});
