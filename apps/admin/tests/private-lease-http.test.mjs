import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { createApiService } from '../../api/dist/service.js';
import { PostgresTransactionDatabase } from '../../api/dist/database.js';
import { createIdentityVerifier, parseBearerHeader } from '../../api/dist/auth.js';
import { privateWorkspaceLeaseRequest } from '../dist/tests/lib/private-workspace-lease-server.js';
import { readPrivateWorkspaceLease } from '../dist/tests/lib/private-workspace-lease-client.js';
import { createPrivateWorkspaceLease } from '../dist/tests/lib/private-workspace-lease.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const listen = (server) => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const stop = (server) =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(resolve);
  });
function wire(handler) {
  return async (req, res) => {
    try {
      const result = await handler(
        new Request('http://' + req.headers.host + req.url, {
          method: req.method,
          headers: req.headers,
        }),
      );
      res.writeHead(result.status, Object.fromEntries(result.headers));
      res.end(Buffer.from(await result.arrayBuffer()));
    } catch {
      res.writeHead(500);
      res.end();
    }
  };
}

test('verified RS256 expiry reaches the private controller through two owned HTTP envelopes, current SQL role and revocation', async () => {
  const db = new PGlite();
  let apiServer, bffServer, controller;
  try {
    await applyTestMigrations(db);
    await db.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'lease-wire','Lease wire')",
      [id(1)],
    );
    for (const [actor, role] of [
      [10, 'admin'],
      [11, 'agent'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [id(1), id(actor), role],
      );
    await db.exec(
      'CREATE ROLE lease_wire_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO lease_wire_login; SET SESSION AUTHORIZATION lease_wire_login',
    );
    const database = new PostgresTransactionDatabase({
      connect: async () => ({
        query: (sql, args) => db.query(sql, args ? [...args] : []),
        release() {},
      }),
    });
    await database.checkConnection();
    const pair = await generateKeyPair('RS256', { extractable: true });
    const key = {
      ...(await exportJWK(pair.publicKey)),
      kid: 'owned-lease-key',
      alg: 'RS256',
      use: 'sig',
    };
    let service,
      apiCalls = 0,
      frontCalls = 0;
    apiServer = createServer(
      wire(async (request) => {
        if (new URL(request.url).pathname === '/jwks') return Response.json({ keys: [key] });
        apiCalls++;
        return service(request);
      }),
    );
    await listen(apiServer);
    const origin = 'http://127.0.0.1:' + apiServer.address().port;
    const verify = createIdentityVerifier({
      issuer: origin,
      audience: 'owned-lease-test',
      jwksUrl: origin + '/jwks',
      allowLoopbackHttpForTests: true,
    });
    service = createApiService({
      database,
      tenantId: id(1),
      privacyNoticeVersion: 'owned-lease-v1',
      verifyAuthorization: (request) =>
        verify(parseBearerHeader(request.headers.get('authorization'))),
    });
    const token = async (actor, seconds) =>
      new SignJWT({ role: 'admin', tenantId: id(2) })
        .setProtectedHeader({ alg: 'RS256', kid: 'owned-lease-key' })
        .setSubject(id(actor))
        .setIssuer(origin)
        .setAudience('owned-lease-test')
        .setIssuedAt(Math.floor(Date.now() / 1000) - 1)
        .setExpirationTime(Math.floor(Date.now() / 1000) + seconds)
        .sign(pair.privateKey);
    const env = {
      NODE_ENV: 'development',
      STAFF_PREVIEW_MODE: 'synthetic',
      STAFF_PREVIEW_API_ORIGIN: origin,
      STAFF_PREVIEW_INSTANCE: id(90),
      STAFF_PREVIEW_TOKEN: await token(10, 60),
    };
    bffServer = createServer(
      wire((request) => {
        frontCalls++;
        return privateWorkspaceLeaseRequest(request, 'staff', env);
      }),
    );
    await listen(bffServer);
    const front = 'http://127.0.0.1:' + bffServer.address().port;
    const access = {
      profile: 'staff',
      instanceId: id(90),
      actorId: id(10),
      tenantId: id(1),
      role: 'admin',
    };
    const read = (signal) =>
      readPrivateWorkspaceLease(access, signal, (path, init) => fetch(front + path, init));
    let ready = 0;
    const closed = [];
    controller = createPrivateWorkspaceLease({
      scope: access,
      read,
      onReady: () => ready++,
      onClose: (r) => closed.push(r),
      foreground: () => false,
    });
    await controller.refresh();
    assert.equal(ready, 1);
    assert.equal(controller.active, true);
    assert.equal(apiCalls, 1);
    assert.equal(frontCalls, 1);
    // A privileged fixture operator changes the stored role; the API login itself has no write grant.
    await db.exec('SET SESSION AUTHORIZATION postgres; RESET ROLE');
    await db.query(
      "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
      [id(1), id(10)],
    );
    await db.exec('SET SESSION AUTHORIZATION lease_wire_login');
    await controller.refresh();
    assert.deepEqual(closed, ['access-changed']);
    const next = await read(new AbortController().signal);
    assert.equal(next.role, 'agent', 'signed role/company claims never replace current SQL facts');
    assert.equal(next.tenantId, id(1));
    await db.exec('SET SESSION AUTHORIZATION postgres; RESET ROLE');
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',
      [id(1), id(10)],
    );
    await db.exec('SET SESSION AUTHORIZATION lease_wire_login');
    await assert.rejects(read(new AbortController().signal));
    // A separate short-lived, genuinely signed credential demonstrates idle expiry without a read.
    env.STAFF_PREVIEW_TOKEN = await token(11, 3);
    let closeExpiry;
    const expired = new Promise((resolve) => (closeExpiry = resolve));
    controller = createPrivateWorkspaceLease({
      scope: { tenantId: id(1), actorId: id(11), role: 'agent' },
      read,
      onReady: () => {},
      onClose: closeExpiry,
      foreground: () => false,
    });
    await controller.refresh();
    assert.equal(controller.active, true);
    let timeout;
    try {
      const result = await Promise.race([
        expired,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(Error('Idle expiry did not close')), 10000);
        }),
      ]);
      assert.equal(result, 'expired');
    } finally {
      clearTimeout(timeout);
    }
    const count = frontCalls;
    await controller.refresh();
    assert.equal(frontCalls, count, 'an expired controller cannot reauthorize itself');
  } finally {
    controller?.dispose();
    if (bffServer) await stop(bffServer);
    if (apiServer) await stop(apiServer);
    await db.close();
  }
});
