import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import {
  fixture,
  publish,
  asActor,
  T,
  OTHER,
  LISTING,
  ADMIN,
  AGENT,
} from '../../../database/tests/public-media-fixtures.mjs';
import { createApiService } from '../dist/service.js';
import { createIdentityVerifier, parseBearerHeader } from '../dist/auth.js';
import { createDevelopmentServer } from '../dist/http.js';
import { CustomerFavouritesClient } from '@realtor/api-client';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
  CUSTOMER = id(13),
  PEER = id(14);
const command = (op = 7000, expectedVersion = '0', saved = true) => ({
  policy: 'customer-favourite-command-v1',
  operationId: id(op),
  listingId: LISTING,
  expectedVersion,
  saved,
});
const listen = (s) =>
  new Promise((resolve, reject) => {
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + s.address().port));
  });
const close = (s) =>
  new Promise((resolve) => {
    s.closeAllConnections();
    s.close(resolve);
  });
async function setup() {
  const db = await fixture();
  const servers = [];
  try {
    await publish(db);
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/customer-favourites.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query(
      "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'customer'),($3,$4,'customer')",
      [T, PEER, OTHER, CUSTOMER],
    );
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    const jwk = {
      ...(await exportJWK(publicKey)),
      alg: 'RS256',
      kid: 'synthetic-customer313',
      use: 'sig',
    };
    const jwks = createServer((req, res) => {
      if (req.url !== '/.well-known/jwks.json') {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ keys: [jwk] }));
    });
    servers.push(jwks);
    const issuer = await listen(jwks);
    const verify = createIdentityVerifier({
      issuer,
      audience: 'synthetic-customer313',
      jwksUrl: issuer + '/.well-known/jwks.json',
      allowLoopbackHttpForTests: true,
    });
    let verifications = 0;
    const database = {
      transaction: ({ tenantId, actorId }, fn) => asActor(db, tenantId, actorId, () => fn(db)),
    };
    const opts = (t) => ({
      tenantId: t,
      privacyNoticeVersion: 'synthetic-customer313',
      database,
      verifyAuthorization: async (r) => {
        verifications++;
        return verify(parseBearerHeader(r.headers.get('authorization') ?? undefined));
      },
    });
    const services = [];
    const origins = [];
    for (const t of [T, OTHER]) {
      const service = createApiService({
        ...opts(t),
        customerFavouritesMode: 'synthetic-customer-favourites-v1',
      });
      services.push(service);
      const server = createDevelopmentServer(service);
      servers.push(server);
      origins.push(await listen(server));
    }
    const token = (subject) =>
      new SignJWT({ synthetic: true, role: 'admin', tenantId: OTHER })
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid, typ: 'JWT' })
        .setIssuer(issuer)
        .setAudience('synthetic-customer313')
        .setSubject(subject)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(privateKey);
    return {
      db,
      origins,
      services,
      opts,
      token,
      get verifications() {
        return verifications;
      },
      close: async () => {
        for (const s of servers.reverse()) await close(s);
        await db.close();
      },
    };
  } catch (e) {
    for (const s of servers.reverse()) await close(s);
    await db.close();
    throw e;
  }
}
const sdk = (origin, tenant = T, customer = CUSTOMER, transport) =>
  new CustomerFavouritesClient({
    baseUrl: origin,
    scope: { tenantId: tenant, customerId: customer },
    allowLoopbackHttp: true,
    ...(transport ? { fetch: transport } : {}),
  });
test('signed customer SDK/HTTP uses current SQL scope, original receipt and safe unavailable/removal state', async () => {
  const f = await setup();
  try {
    const auth = { bearerToken: await f.token(CUSTOMER) },
      a = sdk(f.origins[0]),
      b = sdk(f.origins[1], OTHER);
    assert.deepEqual(await a.getAccount(auth), {
      policy: 'customer-account-v1',
      tenantId: T,
      customerId: CUSTOMER,
    });
    assert.equal((await a.getFavourite(LISTING, auth)).version, '0');
    const r = await a.setFavourite(command(), auth);
    assert.equal(r.saved, true);
    assert.deepEqual(await a.getFavouriteOriginal(command(), auth), r);
    assert.deepEqual(await a.setFavourite(command(), auth), r);
    assert.equal((await b.listFavourites(auth)).items.length, 0);
    await assert.rejects(
      () => b.getFavouriteOriginal(command(), auth),
      (e) => e.status === 404,
    );
    await assert.rejects(
      () => b.setFavourite(command(), auth),
      (e) => e.status === 404,
    );
    assert.equal((await a.listFavourites(auth)).items.length, 1);
    await f.db.query(
      "UPDATE app_private.listings SET publication_status='paused' WHERE tenant_id=$1 AND id=$2",
      [T, LISTING],
    );
    assert.equal((await a.listFavourites(auth)).items[0].available, false);
    const remove = command(7001, '1', false);
    assert.equal((await a.setFavourite(remove, auth)).version, '2');
    assert.equal((await a.listFavourites(auth)).items.length, 0);
    for (const who of [PEER, AGENT, ADMIN, id(999)]) {
      const authOther = { bearerToken: await f.token(who) };
      if (who === PEER)
        assert.equal((await sdk(f.origins[0], T, PEER).listFavourites(authOther)).items.length, 0);
      else
        await assert.rejects(
          () => a.getAccount(authOther),
          (e) => e.status === 403,
        );
      await assert.rejects(
        () => a.getFavouriteOriginal(command(), authOther),
        (e) => [403, 404].includes(e.status),
      );
    }
    await f.db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, CUSTOMER],
    );
    await assert.rejects(
      () => a.getAccount(auth),
      (e) => e.status === 403,
    );
    await assert.rejects(
      () => a.getFavouriteOriginal(command(), auth),
      (e) => e.status === 403,
    );
  } finally {
    await f.close();
  }
});
test('lost and malformed committed write replies stay uncertain; recovery is explicit GET without another POST', async () => {
  const f = await setup();
  try {
    const auth = { bearerToken: await f.token(CUSTOMER) };
    for (const [index, fault] of ['lost', 'malformed'].entries()) {
      const trace = [];
      let pending = true;
      const transport = async (url, init) => {
        trace.push({ path: new URL(url).pathname, method: init.method });
        const r = await fetch(url, init);
        if (init.method === 'POST' && r.ok && pending) {
          pending = false;
          await r.arrayBuffer();
          if (fault === 'lost') throw Error('Synthetic lost committed reply');
          return new Response('{"secret":"synthetic corrupt reply"}', {
            status: 200,
            headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
          });
        }
        return r;
      };
      const a = sdk(f.origins[0], T, CUSTOMER, transport),
        c = command(7100 + index, String(index), index === 0);
      await assert.rejects(
        () => a.setFavourite(c, auth),
        (e) => e.submissionUncertain === true && !e.message.includes('secret'),
      );
      assert.equal(trace.length, 1);
      const r = await a.getFavouriteOriginal(c, auth);
      assert.equal(r.version, String(index + 1));
      assert.deepEqual(
        trace.map((x) => x.method),
        ['POST', 'GET'],
      );
      assert.equal((await a.getFavourite(LISTING, auth)).saved, index === 0);
    }
  } finally {
    await f.close();
  }
});
test('default-off, production, signature, authority/query/body limits fail closed without publishing secrets', async () => {
  const f = await setup();
  try {
    const token = await f.token(CUSTOMER),
      base = f.origins[0],
      headers = { authorization: 'Bearer ' + token };
    const defaultService = createApiService(f.opts(T));
    const before = f.verifications;
    assert.equal(
      (await defaultService(new Request(base + '/v2/customer/account', { headers }))).status,
      404,
    );
    assert.equal(f.verifications, before);
    assert.throws(() => createApiService({ ...f.opts(T), customerFavouritesMode: 'unknown' }));
    const old = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';
      assert.throws(() =>
        createApiService({
          ...f.opts(T),
          customerFavouritesMode: 'synthetic-customer-favourites-v1',
        }),
      );
    } finally {
      if (old === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = old;
    }
    const parts = token.split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    assert.equal(
      (
        await fetch(base + '/v2/customer/account', {
          headers: { authorization: 'Bearer ' + parts.join('.') },
        })
      ).status,
      401,
    );
    for (const suffix of [
      '?tenantId=' + OTHER,
      '?',
      '?limit=1&limit=2',
      '?limit=1e1',
      '?after=bad',
    ])
      assert.equal(
        (await fetch(base + '/v2/customer/favourites' + suffix, { headers })).status,
        400,
      );
    for (const key of ['cookie', 'x-actor-id', 'x-tenant-id', 'x-role', 'if-none-match', 'range'])
      assert.equal(
        (
          await fetch(base + '/v2/customer/account', {
            headers: { ...headers, [key]: 'synthetic' },
          })
        ).status,
        400,
      );
    const op = base + '/v2/customer/favourite-operations/' + id(7200);
    for (const body of [
      JSON.stringify({ ...command(7200), customerId: PEER }),
      JSON.stringify({ ...command(7201) }),
      JSON.stringify(command(7200)).replace('"saved":true', '"saved":true,"saved":false'),
    ])
      assert.equal(
        (
          await fetch(op, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body,
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await fetch(op, {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: ' '.repeat(2049),
        })
      ).status,
      413,
    );
    assert.equal((await fetch(op, { headers })).status, 404);
    const safe = await fetch(base + '/v2/customer/account', { headers });
    assert.equal(safe.headers.get('cache-control'), 'no-store');
    assert.equal(safe.headers.get('x-content-type-options'), 'nosniff');
  } finally {
    await f.close();
  }
});
