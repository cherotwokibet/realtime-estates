import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { createApiService } from '../../../apps/api/dist/service.js';
import { createDevelopmentServer } from '../../../apps/api/dist/http.js';
import { createIdentityVerifier, parseBearerHeader } from '../../../apps/api/dist/auth.js';
import { PostgresTransactionDatabase } from '../../../apps/api/dist/database.js';
import { RealtorApiClient } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  U = id(11),
  A = id(10),
  P = id(12),
  C = id(13),
  L = id(100),
  O = id(200);
const listen = async (server) => {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
};
const stop = async (server) => {
  if (server) {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
};
test('signed listing controls recover a discarded committed reply, preserve original history and deny current access loss', async () => {
  const db = new PGlite();
  let database, apiServer, keyServer;
  try {
    await applyTestMigrations(db);
    // Allocation restriction is part of the normal reviewed migration order.
    await db.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'signed-successor','Synthetic successor')",
      [T],
    );
    for (const [user, role] of [
      [U, 'agent'],
      [P, 'agent'],
      [A, 'admin'],
      [C, 'customer'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [T, user, role],
      );
    // Explicit privileged synthetic stock; no draft allocation is under test here.
    await db.query(
      "INSERT INTO app_private.listings(tenant_id,id,slug,created_by_id,assigned_agent_id) VALUES($1,$2,'synthetic-control-stock',$3,$3)",
      [T, L, U],
    );
    const owner = (await db.query('SELECT session_user name')).rows[0].name,
      quoted = '"' + owner.replaceAll('"', '""') + '"';
    await db.exec(
      'CREATE ROLE controls_sdk_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT api_runtime TO controls_sdk_login;SET SESSION AUTHORIZATION controls_sdk_login;',
    );
    let tail = Promise.resolve(),
      corrupt = false;
    const pool = {
      async connect() {
        let unlock;
        const prior = tail;
        tail = new Promise((r) => (unlock = r));
        await prior;
        return {
          async query(sql, args) {
            const result = await db.query(sql, args ? [...args] : []);
            if (corrupt && sql.includes('app_api.control_listing')) {
              corrupt = false;
              return { rows: [{ receipt: { ...result.rows[0].receipt, actorId: P } }] };
            }
            return result;
          },
          release() {
            unlock();
          },
        };
      },
    };
    database = new PostgresTransactionDatabase(pool);
    await database.checkConnection();
    const asOwner = async (work) => {
      await tail;
      await db.exec(`SET SESSION AUTHORIZATION ${quoted};RESET ROLE;`);
      try {
        return await work();
      } finally {
        await db.exec('SET SESSION AUTHORIZATION controls_sdk_login;RESET ROLE;');
        await database.checkConnection();
      }
    };
    const keys = await generateKeyPair('RS256'),
      jwk = {
        ...(await exportJWK(keys.publicKey)),
        kid: 'synthetic-controls',
        alg: 'RS256',
        use: 'sig',
      };
    keyServer = createServer((_, r) => {
      r.writeHead(200, { 'content-type': 'application/json' });
      r.end(JSON.stringify({ keys: [jwk] }));
    });
    const issuer = await listen(keyServer),
      verify = createIdentityVerifier({
        issuer,
        audience: 'synthetic-controls',
        jwksUrl: issuer + '/jwks',
        allowLoopbackHttpForTests: true,
      });
    apiServer = createDevelopmentServer(
      createApiService({
        database,
        tenantId: T,
        privacyNoticeVersion: 'synthetic-v1',
        verifyAuthorization: (r) =>
          verify(parseBearerHeader(r.headers.get('authorization') ?? undefined)),
      }),
    );
    const origin = await listen(apiServer),
      make = (fetch) =>
        new RealtorApiClient({
          baseUrl: origin,
          allowLoopbackHttp: true,
          privacyNoticeVersion: 'synthetic-v1',
          ...(fetch ? { fetch } : {}),
        }),
      api = make();
    const token = (user) =>
      new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
        .setIssuer(issuer)
        .setAudience('synthetic-controls')
        .setSubject(user)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(keys.privateKey);
    const agent = { bearerToken: await token(U) },
      admin = { bearerToken: await token(A) },
      peer = { bearerToken: await token(P) },
      customer = { bearerToken: await token(C) };
    const command = {
      listingId: L,
      operationId: O,
      kind: 'confirm_availability',
      expectedListingVersion: '1',
      availability: 'sold',
    };
    let posts = 0;
    const lost = make(async (url, init) => {
      const response = await fetch(url, init);
      if (init.method === 'POST' && url.includes('/availability-operations/')) {
        posts++;
        assert.equal(response.status, 200);
        await response.arrayBuffer();
        throw Error('Discarded committed listing control reply');
      }
      return response;
    });
    await assert.rejects(
      lost.controlListingV2(command, agent),
      (e) => e.kind === 'NETWORK' && e.submissionUncertain,
    );
    assert.equal(posts, 1);
    const original = await api.getListingControlReceiptV2(command, agent);
    assert.equal(original.decision.result.listingVersion, '2');
    assert.deepEqual(
      await api.getListingControlSnapshotV2(L, O, 'confirm_availability', agent),
      original,
    );
    await api.controlListingV2(
      {
        listingId: L,
        operationId: id(201),
        kind: 'set_publication',
        expectedListingVersion: '2',
        publicationStatus: 'archived',
      },
      admin,
    );
    assert.deepEqual(await api.controlListingV2(command, agent), original);
    assert.deepEqual(await api.getListingControlReceiptV2(command, agent), original);
    await assert.rejects(
      api.controlListingV2({ ...command, availability: 'available' }, agent),
      (e) => e.status === 409,
    );
    await assert.rejects(api.getListingControlReceiptV2(command, peer), (e) => e.status === 404);
    await assert.rejects(
      api.getListingControlReceiptV2(command, customer),
      (e) => e.status === 403,
    );
    await assert.rejects(
      api.getListingControlSnapshotV2(L, O, 'set_publication', agent),
      (e) => e.status === 404,
    );
    await assert.rejects(
      api.controlListingV2(
        {
          listingId: L,
          operationId: id(202),
          kind: 'set_publication',
          expectedListingVersion: '3',
          publicationStatus: 'paused',
        },
        agent,
      ),
      (e) => e.status === 403,
    );
    corrupt = true;
    await assert.rejects(
      api.controlListingV2(
        {
          listingId: L,
          operationId: id(203),
          kind: 'set_publication',
          expectedListingVersion: '3',
          publicationStatus: 'paused',
        },
        admin,
      ),
      (e) => e.status === 503 && e.submissionUncertain,
    );
    await asOwner(async () => {
      assert.deepEqual(
        (
          await db.query(
            'SELECT (SELECT count(*)::int FROM app_private.listing_control_requests) requests,(SELECT count(*)::int FROM app_private.audit_events) audits',
          )
        ).rows[0],
        { requests: 2, audits: 2 },
      );
      assert.equal(
        (await db.query('SELECT version::text FROM app_private.listings WHERE id=$1', [L])).rows[0]
          .version,
        '3',
      );
      await db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [P, L]);
    });
    await assert.rejects(api.getListingControlReceiptV2(command, agent), (e) => e.status === 404);
    await assert.rejects(api.controlListingV2(command, agent), (e) => e.status === 404);
  } finally {
    await stop(apiServer);
    await stop(keyServer);
    if (database) await database.close();
    await db.close();
  }
});
