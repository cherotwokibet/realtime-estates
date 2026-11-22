import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import {
  createStaffInvitationRecipientVerifier,
  isVerifiedStaffInvitationRecipient,
} from '../dist/staff-invitation-recipient.js';
import { AuthenticationError } from '../dist/auth.js';
let server, issuer, key, wrongKey, verify;
const actor = '00000000-0000-4000-8000-000000000010';
const config = () => ({
  issuer,
  audience: 'synthetic-invitation-recipient',
  jwksUrl: issuer + '/jwks',
  allowLoopbackHttpForTests: true,
});
before(async () => {
  const pair = await generateKeyPair('RS256');
  key = pair.privateKey;
  wrongKey = (await generateKeyPair('RS256')).privateKey;
  const jwks = JSON.stringify({
    keys: [{ ...(await exportJWK(pair.publicKey)), kid: 'recipient-test', alg: 'RS256' }],
  });
  server = createServer((req, res) => {
    res.writeHead(req.url === '/jwks' ? 200 : 404, { 'content-type': 'application/json' });
    res.end(req.url === '/jwks' ? jwks : '{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = 'http://127.0.0.1:' + server.address().port;
  verify = createStaffInvitationRecipientVerifier(config(), 'synthetic-verified-recipient-v1');
});
after(async () => {
  server?.closeAllConnections();
  if (server) await new Promise((resolve) => server.close(resolve));
});
const signed = (patch = {}, signing = key) => {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss: issuer,
    aud: 'synthetic-invitation-recipient',
    sub: actor,
    iat: now - 1,
    exp: now + 120,
    email: 'synthetic@example.invalid',
    email_verified: true,
    ...patch,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'recipient-test' })
    .sign(signing);
};
test('verified signed recipient binds fixed issuer, UUID subject and canonical verified email, not role or company claims', async () => {
  const expiry = Math.floor(Date.now() / 1000) + 120;
  const p = await verify(await signed({ role: 'admin', tenant_id: 'ignored', exp: expiry }));
  assert.deepEqual(p, {
    policy: 'verified-staff-invitation-recipient-v1',
    actorId: actor,
    expiresAt: expiry * 1000,
    issuer,
    recipientEmail: 'synthetic@example.invalid',
  });
  assert.ok(Object.isFrozen(p));
  assert.equal(isVerifiedStaffInvitationRecipient(p), true);
  assert.equal(isVerifiedStaffInvitationRecipient({ ...p }), false);
  assert.equal(isVerifiedStaffInvitationRecipient(JSON.parse(JSON.stringify(p))), false);
});
test('missing, false, string and numeric verification claims and noncanonical addresses are refused', async () => {
  for (const email_verified of [undefined, false, 'true', 1, null])
    await assert.rejects(() => signed({ email_verified }).then(verify), AuthenticationError);
  for (const email of [
    undefined,
    'Synthetic@example.invalid',
    ' synthetic@example.invalid',
    'name <synthetic@example.invalid>',
    'synthetic@localhost',
    {},
    null,
  ])
    await assert.rejects(() => signed({ email }).then(verify), AuthenticationError);
});
test('wrong signatures, issuer, audience, subject, future or expired tokens cannot produce a recipient', async () => {
  await assert.rejects(() => signed({}, wrongKey).then(verify), AuthenticationError);
  const now = Math.floor(Date.now() / 1000);
  for (const patch of [
    { iss: issuer + '/foreign' },
    { aud: 'foreign' },
    { sub: 'not-a-member-uuid' },
    { iat: now + 60, exp: now + 120 },
    { iat: now - 120, exp: now - 1 },
  ])
    await assert.rejects(() => signed(patch).then(verify), AuthenticationError);
});
test('caller objects and decoded unsigned payloads never become verified recipients', async () => {
  const plain = {
    policy: 'verified-staff-invitation-recipient-v1',
    actorId: actor,
    expiresAt: Date.now() + 120000,
    issuer,
    recipientEmail: 'synthetic@example.invalid',
  };
  assert.equal(isVerifiedStaffInvitationRecipient(plain), false);
  let getters = 0;
  const hostile = Object.defineProperty({}, 'actorId', {
    get() {
      getters++;
      throw Error('private');
    },
  });
  assert.equal(isVerifiedStaffInvitationRecipient(hostile), false);
  assert.equal(getters, 0);
  for (const input of [plain, null, 'unsigned.private.token', JSON.stringify(plain)])
    await assert.rejects(
      () => verify(input),
      (e) => e.message === 'A valid bearer token is required.',
    );
});
test('trusted configuration is captured and explicit synthetic mode cannot activate in production', async () => {
  const c = config(),
    v = createStaffInvitationRecipientVerifier(c, 'synthetic-verified-recipient-v1');
  c.issuer = 'https://foreign.invalid';
  c.audience = 'foreign';
  c.jwksUrl = 'https://foreign.invalid/jwks';
  assert.equal((await v(await signed())).issuer, issuer);
  for (const mode of [undefined, 'enabled', true])
    assert.throws(() => createStaffInvitationRecipientVerifier(config(), mode));
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    assert.throws(() =>
      createStaffInvitationRecipientVerifier(config(), 'synthetic-verified-recipient-v1'),
    );
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});
