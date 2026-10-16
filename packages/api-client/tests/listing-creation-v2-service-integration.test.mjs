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
import { RealtorApiClient, validateListingCreationCommand } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  T = id(1),
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
    await new Promise((resolve) => server.close(resolve));
  }
};
test('signed creation HTTP recovers discarded committed reply and refuses changed facts under restricted SQL authority', async () => {
  const db = new PGlite();
  let database, apiServer, keyServer;
  try {
    await applyTestMigrations(db);
    await db.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'signed-creation','Synthetic signed creation')",
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
    const owner = (await db.query('SELECT session_user name')).rows[0].name,
      quoted = '"' + owner.replaceAll('"', '""') + '"';
    await db.exec(
      'CREATE ROLE creation_sdk_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT api_runtime TO creation_sdk_login;SET SESSION AUTHORIZATION creation_sdk_login;',
    );
    let tail = Promise.resolve(),
      corrupt = false;
    const pool = {
      async connect() {
        let unlock;
        const prior = tail;
        tail = new Promise((resolve) => (unlock = resolve));
        await prior;
        return {
          async query(sql, args) {
            const r = await db.query(sql, args ? [...args] : []);
            if (corrupt && sql.includes('app_api.create_listing_draft_v2')) {
              corrupt = false;
              return { rows: [{ receipt: { ...r.rows[0].receipt, actorId: P } }] };
            }
            return r;
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
        await db.exec('SET SESSION AUTHORIZATION creation_sdk_login;RESET ROLE;');
        await database.checkConnection();
      }
    };
    const keys = await generateKeyPair('RS256'),
      jwk = {
        ...(await exportJWK(keys.publicKey)),
        kid: 'synthetic-creation',
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
        audience: 'synthetic-creation',
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
          .setAudience('synthetic-creation')
          .setSubject(user)
          .setIssuedAt()
          .setExpirationTime('10m')
          .sign(keys.privateKey),
      agent = { bearerToken: await token(U) },
      admin = { bearerToken: await token(A) },
      peer = { bearerToken: await token(P) },
      customer = { bearerToken: await token(C) };
    const command = validateListingCreationCommand({
      listingId: L,
      operationId: O,
      slug: 'signed-synthetic-creation',
      content: {
        title: 'Synthetic signed draft',
        privateAddress: ' FICTIONAL PRIVATE ',
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
    });
    let posts = 0,
      gets = 0;
    const lost = make(async (url, init) => {
      const response = await fetch(url, init);
      if (init.method === 'POST' && url.includes('/creation-operations/')) {
        posts++;
        assert.equal(response.status, 200);
        assert.equal((await response.clone().json()).outcome, 'created');
        await response.arrayBuffer();
        throw new Error('Discarded committed creation reply');
      }
      return response;
    });
    await assert.rejects(
      () => lost.createListingV2(command, agent),
      (e) => e.kind === 'NETWORK' && e.submissionUncertain,
    );
    assert.equal(posts, 1);
    const reader = make(async (url, init) => {
        assert.equal(init.method, 'GET');
        gets++;
        return fetch(url, init);
      }),
      saved = await reader.getListingCreationReceiptV2(command, agent);
    assert.equal(saved.outcome, 'created');
    assert.equal(gets, 1);
    assert.deepEqual(await api.getListingCreationSnapshotV2(L, O, agent), saved);
    assert.deepEqual(await api.createListingV2(command, agent), saved);
    assert.deepEqual(
      await api.saveStaffDraftV2(
        L,
        1,
        { expectedVersion: '2', content: { ...command.content, title: 'Deliberate later draft' } },
        agent,
      ),
      { version: '3' },
    );
    assert.deepEqual(await api.createListingV2(command, agent), saved);
    assert.deepEqual(await api.getListingCreationReceiptV2(command, agent), saved);
    await assert.rejects(
      () => api.createListingV2({ ...command, slug: 'changed-facts' }, agent),
      (e) => e.status === 409,
    );
    for (const options of [admin, peer])
      await assert.rejects(
        () => api.getListingCreationReceiptV2(command, options),
        (e) => e.status === 404,
      );
    await assert.rejects(
      () => api.createListingV2({ ...command, listingId: id(101), operationId: id(201) }, customer),
      (e) => e.status === 403,
    );
    await asOwner(() =>
      db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [P, L]),
    );
    await assert.rejects(
      () => api.getListingCreationReceiptV2(command, agent),
      (e) => e.status === 404,
    );
    await assert.rejects(
      () => api.createListingV2(command, agent),
      (e) => e.status === 404,
    );
    await asOwner(() =>
      db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [U, L]),
    );
    assert.deepEqual(await api.getListingCreationReceiptV2(command, agent), saved);
    const collision = { ...command, listingId: id(102), operationId: id(202) },
      refused = await api.createListingV2(collision, peer);
    assert.equal(refused.reason, 'TARGET_UNAVAILABLE');
    assert.equal(refused.result, null);
    assert.deepEqual(await api.getListingCreationReceiptV2(collision, peer), refused);
    const rolled = {
      ...command,
      listingId: id(103),
      operationId: id(203),
      slug: 'synthetic-rollback',
    };
    corrupt = true;
    await assert.rejects(
      () => api.createListingV2(rolled, agent),
      (e) => e.status === 503,
    );
    await assert.rejects(
      () => api.getListingCreationReceiptV2(rolled, agent),
      (e) => e.status === 404,
    );
    const absent = await asOwner(
      async () =>
        (
          await db.query(
            'SELECT (SELECT count(*)::int FROM app_private.listings WHERE id=$1) listings,(SELECT count(*)::int FROM app_private.listing_creation_requests WHERE operation_id=$2) requests',
            [rolled.listingId, rolled.operationId],
          )
        ).rows[0],
    );
    assert.deepEqual(absent, { listings: 0, requests: 0 });
    assert.equal((await api.createListingV2(rolled, agent)).outcome, 'created');
    const totals = await asOwner(
      async () =>
        (
          await db.query(
            'SELECT (SELECT count(*)::int FROM app_private.listings) listings,(SELECT count(*)::int FROM app_private.listing_creation_requests) requests,(SELECT count(*)::int FROM app_private.listing_creation_results) results,(SELECT count(*)::int FROM app_private.audit_events) audits',
          )
        ).rows[0],
    );
    assert.deepEqual(totals, { listings: 2, requests: 3, results: 3, audits: 5 });
  } finally {
    await stop(apiServer);
    await stop(keyServer);
    if (database) await database.close();
    await db.close();
  }
});
