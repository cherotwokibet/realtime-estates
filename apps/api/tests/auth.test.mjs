import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import {
  AuthenticationError,
  AuthConfigurationError,
  TenantResolutionError,
  createIdentityVerifier,
  createTenantResolver,
  parseBearerHeader,
} from '../dist/auth.js';

let server;
let issuer;
let privateKey;
let wrongPrivateKey;
let keySet;
let fetchPaths = [];
const audience = 'realtor-api-test';

before(async () => {
  const trusted = await generateKeyPair('RS256', { extractable: true });
  const untrusted = await generateKeyPair('RS256');
  privateKey = trusted.privateKey;
  wrongPrivateKey = untrusted.privateKey;
  keySet = {
    keys: [{ ...(await exportJWK(trusted.publicKey)), kid: 'test-key', alg: 'RS256', use: 'sig' }],
  };
  server = createServer((request, response) => {
    fetchPaths.push(request.url);
    if (request.url === '/redirect') {
      response.writeHead(307, { location: `${issuer}/jwks` });
      response.end();
    } else if (request.url === '/broken') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('not-json');
    } else if (request.url === '/unavailable') {
      response.writeHead(503);
      response.end();
    } else if (request.url === '/jwks') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(keySet));
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  issuer = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

function configuration(overrides = {}) {
  return {
    issuer,
    audience,
    jwksUrl: `${issuer}/jwks`,
    allowLoopbackHttpForTests: true,
    ...overrides,
  };
}

function signed(overrides = {}, headerOverrides = {}, signingKey = privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const claims = {
    iss: issuer,
    aud: audience,
    sub: 'actor-fixture',
    iat: now - 1,
    exp: now + 300,
    ...overrides,
  };
  for (const key of Object.keys(claims)) if (claims[key] === undefined) delete claims[key];
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key', typ: 'JWT', ...headerOverrides })
    .sign(signingKey);
}

test('real RS256 signature yields only immutable verified subject identity, ignoring role/company claims', async () => {
  const verify = createIdentityVerifier(configuration());
  const result = await verify(
    await signed({ role: 'admin', tenantId: 'other-company', memberships: [{ role: 'admin' }] }),
  );
  assert.deepEqual(result, { actorId: 'actor-fixture' });
  assert.equal(Object.isFrozen(result), true);
});

test('bearer header parser rejects missing, duplicate and malformed credentials', async () => {
  const token = await signed();
  assert.equal(parseBearerHeader(`Bearer ${token}`), token);
  assert.equal(parseBearerHeader(`bearer ${token}`), token);
  for (const header of [
    undefined,
    [],
    [`Bearer ${token}`],
    '',
    token,
    `Basic ${token}`,
    `Bearer  ${token}`,
    `Bearer\t${token}`,
    `Bearer ${token}, Bearer ${token}`,
    `Bearer ${token}\r\n`,
    'Bearer a.b.',
    `Bearer ${'a'.repeat(8193)}.b.c`,
  ]) {
    assert.throws(() => parseBearerHeader(header), AuthenticationError);
  }
});

test('expired, future and overlong-lifetime claims fail closed', async () => {
  const now = Math.floor(Date.now() / 1000);
  const verify = createIdentityVerifier(configuration());
  for (const claims of [
    { iat: now - 100, exp: now - 1 },
    { nbf: now + 120 },
    { iat: now + 120, exp: now + 300 },
    { iat: now - 3602, exp: now + 20 },
    { iat: now - 1, exp: now + 3601 },
    { iat: now - 0.5 },
    { exp: now + 300.5 },
  ])
    await assert.rejects(verify(await signed(claims)), AuthenticationError);
});

test('wrong issuer, audience and malformed subject are denied despite valid signature', async () => {
  const verify = createIdentityVerifier(configuration());
  for (const claims of [
    { iss: `${issuer}/untrusted` },
    { aud: 'untrusted-api' },
    { sub: '' },
    { sub: ' actor-fixture' },
    { sub: 'actor\nfixture' },
    { sub: 'x'.repeat(256) },
  ])
    await assert.rejects(verify(await signed(claims)), AuthenticationError);
});

test('issuer, audience, subject, expiry and issued-at are required', async () => {
  const verify = createIdentityVerifier(configuration());
  for (const claim of ['iss', 'aud', 'sub', 'exp', 'iat']) {
    await assert.rejects(verify(await signed({ [claim]: undefined })), AuthenticationError);
  }
});

test('counterfeit signature, unknown key and absent key ID are denied', async () => {
  const verify = createIdentityVerifier(configuration());
  await assert.rejects(verify(await signed({}, {}, wrongPrivateKey)), AuthenticationError);
  await assert.rejects(verify(await signed({}, { kid: 'unknown-key' })), AuthenticationError);
  await assert.rejects(verify(await signed({}, { kid: undefined })), AuthenticationError);
});

test('HS256 algorithm confusion and unsigned/malformed tokens are denied', async () => {
  const verify = createIdentityVerifier(configuration());
  const forged = await signed({}, { alg: 'HS256' }, new Uint8Array(32));
  await assert.rejects(verify(forged), AuthenticationError);
  for (const token of ['', 'a.b.c', 'a.b.', 'a.b.c.d', `a.b.${'c'.repeat(8192)}`]) {
    await assert.rejects(verify(token), AuthenticationError);
  }
});

test('token-supplied key URL does not change the trusted JWKS endpoint', async () => {
  const verify = createIdentityVerifier(configuration());
  fetchPaths = [];
  const result = await verify(await signed({}, { jku: `${issuer}/untrusted-keys` }));
  assert.equal(result.actorId, 'actor-fixture');
  assert.deepEqual(fetchPaths, ['/jwks']);
});

test('unavailable/malformed/redirecting JWKS endpoints deny without following redirects', async () => {
  const token = await signed();
  for (const path of ['/unavailable', '/broken', '/redirect']) {
    fetchPaths = [];
    const verify = createIdentityVerifier(configuration({ jwksUrl: `${issuer}${path}` }));
    await assert.rejects(verify(token), AuthenticationError);
    assert.deepEqual(fetchPaths, [path]);
  }
});

test('trusted configuration is captured, not mutable through caller object', async () => {
  const config = configuration();
  const verify = createIdentityVerifier(config);
  config.issuer = `${issuer}/attacker`;
  config.audience = 'attacker-api';
  config.jwksUrl = `${issuer}/attacker-keys`;
  assert.deepEqual(await verify(await signed()), { actorId: 'actor-fixture' });
});

test('missing/untrusted identity configuration is rejected before any key fetch', () => {
  const production = {
    issuer: 'https://identity.example.test',
    audience: 'realtor-api',
    jwksUrl: 'https://identity.example.test/jwks',
  };
  for (const config of [
    undefined,
    null,
    {},
    { ...production, issuer: '' },
    { ...production, audience: '' },
    { ...production, audience: '*' },
    { ...production, audience: ' two audiences' },
    { ...production, jwksUrl: '' },
    { ...production, issuer: 'http://identity.example.test' },
    { ...production, jwksUrl: 'http://identity.example.test/jwks' },
    { ...production, jwksUrl: 'https://attacker.example.test/jwks' },
    { ...production, jwksUrl: 'https://user:secret@identity.example.test/jwks' },
    { ...production, jwksUrl: 'https://identity.example.test/jwks?key=untrusted' },
    { ...production, issuer: 'https://identity.example.test/#fragment' },
    { ...production, issuer: 'https://*.example.test' },
    { ...production, allowLoopbackHttpForTests: 'true' },
    {
      ...production,
      issuer: 'http://identity.example.test',
      jwksUrl: 'http://identity.example.test/jwks',
      allowLoopbackHttpForTests: true,
    },
    { issuer, audience, jwksUrl: `${issuer}/jwks` },
  ])
    assert.throws(() => createIdentityVerifier(config), AuthConfigurationError);
});

test('explicit loopback HTTP exception is rejected in production mode', () => {
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'production';
    assert.throws(() => createIdentityVerifier(configuration()), AuthConfigurationError);
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previous;
  }
});

test('hostname resolves only configured company and does not grant membership', () => {
  const configurations = [
    {
      tenantId: 'company-a',
      slug: 'company-a',
      hostnames: ['a.example.test', 'www.a.example.test', 'localhost'],
    },
    { tenantId: 'company-b', slug: 'company-b', hostnames: ['b.example.test'] },
  ];
  const resolve = createTenantResolver(configurations);
  assert.deepEqual(resolve('A.EXAMPLE.TEST:443'), {
    tenantId: 'company-a',
    slug: 'company-a',
    hostnames: ['a.example.test', 'www.a.example.test', 'localhost'],
  });
  assert.equal(resolve('b.example.test').tenantId, 'company-b');
  assert.equal(resolve('localhost:3000').tenantId, 'company-a');
  assert.equal(Object.isFrozen(resolve('a.example.test')), true);
  assert.equal(Object.isFrozen(resolve('a.example.test').hostnames), true);
  configurations[0].tenantId = 'company-b';
  configurations[0].hostnames.push('attacker.example.test');
  assert.equal(resolve('a.example.test').tenantId, 'company-a');
  assert.throws(() => resolve('attacker.example.test'), TenantResolutionError);
  for (const host of [
    undefined,
    '',
    'unknown.example.test',
    'a.example.test.attacker.test',
    'https://a.example.test',
    'a.example.test@attacker.test',
    'a.example.test, b.example.test',
    ' a.example.test',
    'a.example.test.',
    'a.example.test:0',
    'a.example.test:65536',
    'a.example.test/path',
    'a.example.test\r\nX-Tenant:company-b',
  ]) {
    assert.throws(() => resolve(host), TenantResolutionError);
  }
});

test('tenant configuration rejects host collisions, wildcards, duplicate IDs and invalid input', () => {
  for (const configs of [
    [],
    undefined,
    [{ tenantId: 'a', slug: 'a', hostnames: ['*.example.test'] }],
    [{ tenantId: 'a', slug: 'a', hostnames: ['a.example.test:443'] }],
    [{ tenantId: 'a', slug: 'a', hostnames: ['a.example.test', 'A.EXAMPLE.TEST'] }],
    [{ tenantId: 'a', slug: 'a', hostnames: [] }],
    [{ tenantId: 'a', slug: 'Invalid Slug', hostnames: ['a.example.test'] }],
    [{ tenantId: ' a', slug: 'a', hostnames: ['a.example.test'] }],
    [
      { tenantId: 'a', slug: 'a', hostnames: ['a.example.test'] },
      { tenantId: 'a', slug: 'b', hostnames: ['b.example.test'] },
    ],
    [
      { tenantId: 'a', slug: 'a', hostnames: ['a.example.test'] },
      { tenantId: 'b', slug: 'b', hostnames: ['A.EXAMPLE.TEST'] },
    ],
  ])
    assert.throws(() => createTenantResolver(configs), AuthConfigurationError);
});
