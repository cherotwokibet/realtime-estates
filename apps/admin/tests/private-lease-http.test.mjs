import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { privateRecoveryRequest } from '../dist/tests/lib/private-recovery-server.js';
import { createPrivateRecoveryClient } from '../dist/tests/lib/private-recovery-client.js';
import { createSealedRecoveryStore } from '../dist/tests/lib/private-recovery-store.js';
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
          ...(!['GET', 'HEAD'].includes(req.method)
            ? { body: Readable.toWeb(req), duplex: 'half' }
            : {}),
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

test('verified RS256 leases and sealed originals cross two owned HTTP envelopes with current SQL role, revocation and expiry', async () => {
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
      PRIVATE_RECOVERY_MODE: 'synthetic-sealed-original-v1',
      PRIVATE_RECOVERY_STORAGE_KEY: '0c'.repeat(32),
    };
    bffServer = createServer(
      wire((request) => {
        frontCalls++;
        const match =
          /^\/api\/private-workspace\/recovery\/(settings|report)\/(seal|open|check)$/.exec(
            new URL(request.url).pathname,
          );
        return match
          ? privateRecoveryRequest(request, match[1], match[2], env)
          : privateWorkspaceLeaseRequest(request, 'staff', env);
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
    const recoveryScope = { instanceId: id(90), tenantId: id(1), actorId: id(10) };
    const http = (path, init) =>
      fetch(front + path, { ...init, headers: { ...init.headers, origin: front } });
    const commands = {
      settings: {
        policy: 'company-settings-command-v1',
        operationId: id(100),
        expectedVersion: '0',
        approval: 'approved-for-publication',
        content: {
          companyName: 'Synthetic agency',
          summary: 'PRIVATE_WIRE_RECOVERY_CANARY',
          about: 'Fictional content',
          officeAddress: null,
          openingHours: null,
          colors: {
            primary: '#5e0202',
            secondary: '#194d3e',
            accent: '#b77b27',
            background: '#ffffff',
          },
        },
      },
      report: {
        policy: 'listing-report-decision-command-v1',
        operationId: id(101),
        reportId: id(200),
        expectedVersion: '1',
        decision: 'reviewed',
        reason: 'PRIVATE_WIRE_RECOVERY_CANARY',
      },
    };
    const protectedOriginals = [];
    for (const kind of ['settings', 'report']) {
      const codec = createPrivateRecoveryClient(recoveryScope, kind, http),
        map = new Map(),
        storage = { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v) };
      await codec.check(new AbortController().signal);
      const originalStore = createSealedRecoveryStore(storage, recoveryScope, kind, codec);
      const envelope = await originalStore.retain(commands[kind]);
      assert.ok(!JSON.stringify([...map]).includes('PRIVATE_WIRE_RECOVERY_CANARY'));
      assert.deepEqual(await originalStore.load(), commands[kind]);
      originalStore.dispose();
      const reopened = createSealedRecoveryStore(storage, recoveryScope, kind, codec);
      assert.deepEqual(await reopened.load(), commands[kind]);
      protectedOriginals.push({ codec, envelope, reopened, map, saved: [...map] });
      const wrongScope = createPrivateRecoveryClient(
        { ...recoveryScope, actorId: id(11) },
        kind,
        http,
      );
      await assert.rejects(
        wrongScope.seal(commands[kind], new AbortController().signal),
        (e) => e.status === 403,
      );
    }
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
    for (const item of protectedOriginals) {
      await assert.rejects(item.reopened.load());
      assert.deepEqual([...item.map], item.saved);
      item.reopened.dispose();
    }
    await db.exec('SET SESSION AUTHORIZATION postgres; RESET ROLE');
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',
      [id(1), id(10)],
    );
    await db.exec('SET SESSION AUTHORIZATION lease_wire_login');
    await assert.rejects(read(new AbortController().signal));
    for (const item of protectedOriginals)
      await assert.rejects(
        item.codec.open(item.envelope, new AbortController().signal),
        (e) => e.status === 403,
      );
    env.STAFF_PREVIEW_TOKEN = await token(10, -60);
    await assert.rejects(
      protectedOriginals[0].codec.open(
        protectedOriginals[0].envelope,
        new AbortController().signal,
      ),
      (e) => e.status === 401,
    );
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
