import test from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  seedGuardedListingDraft,
  seedGuardedListingSuccessor,
} from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { PGlite } from '@electric-sql/pglite';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { createApiService } from '../../../apps/api/dist/service.js';
import { createDevelopmentServer } from '../../../apps/api/dist/http.js';
import { createIdentityVerifier, parseBearerHeader } from '../../../apps/api/dist/auth.js';
import { PostgresTransactionDatabase } from '../../../apps/api/dist/database.js';
import { RealtorApiClient, validateListingSuccessorCommand } from '../dist/index.js';
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
test('signed successor HTTP recovers a discarded committed reply, preserves originals and rolls back mismatched adapters', async () => {
  const db = new PGlite();
  let database, apiServer, keyServer;
  try {
    await applyTestMigrations(db);
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/0024_guarded_draft_allocation.sql', import.meta.url),
        'utf8',
      ),
    );
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
    const full = {
      title: 'Synthetic predecessor apartment',
      description: 'Synthetic predecessor description only.',
      purpose: 'rent',
      propertyType: 'apartment',
      currency: 'KES',
      amountMinor: 2000000,
      rentPeriod: 'month',
      bedrooms: 1,
      privateBathrooms: 1,
      sharedBathrooms: null,
      country: 'KE',
      locality: 'Synthetic area',
      publicPrecision: 'area',
      latitude: null,
      longitude: null,
      privateAddress: 'PRIVATE FICTIONAL',
    };
    const setupActor = async (user, work) => {
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
      try {
        await db.query(
          "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
          [T, user],
        );
        await work();
        await db.exec('COMMIT');
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    };
    for (const listing of [L, id(101)]) {
      await setupActor(U, async () => {
        await seedGuardedListingDraft(db, {
          listingId: listing,
          slug: 'synthetic-' + listing.slice(-3),
          content: {
            ...full,
            pricing: { declaration: 'not_declared', charges: [] },
            location: { county: null, town: null, area: null },
          },
          actorId: U,
        });
      });
      for (let position = 0; position < 4; position++)
        await seedSyntheticSealedMedia(db, {
          tenantId: T,
          listingId: listing,
          revision: 1,
          position,
          mediaId: id(Number(listing.slice(-3)) * 10 + position),
        });
      await setupActor(U, () => db.query('SELECT app_api.submit_revision($1,1,2)', [listing]));
      await setupActor(A, () =>
        db.query("SELECT app_api.decide_revision($1,1,3,false,'Synthetic changes required')", [
          listing,
        ]),
      );
    }
    const owner = (await db.query('SELECT session_user name')).rows[0].name,
      quoted = '"' + owner.replaceAll('"', '""') + '"';
    await db.exec(
      'CREATE ROLE successor_sdk_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT api_runtime TO successor_sdk_login;SET SESSION AUTHORIZATION successor_sdk_login;',
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
            if (corrupt && sql.includes('app_api.start_listing_revision_v2')) {
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
        await db.exec('SET SESSION AUTHORIZATION successor_sdk_login;RESET ROLE;');
        await database.checkConnection();
      }
    };
    const keys = await generateKeyPair('RS256'),
      jwk = {
        ...(await exportJWK(keys.publicKey)),
        kid: 'synthetic-successor',
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
        audience: 'synthetic-successor',
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
        .setAudience('synthetic-successor')
        .setSubject(user)
        .setIssuedAt()
        .setExpirationTime('10m')
        .sign(keys.privateKey);
    const agent = { bearerToken: await token(U) },
      admin = { bearerToken: await token(A) },
      peer = { bearerToken: await token(P) },
      customer = { bearerToken: await token(C) };
    const command = validateListingSuccessorCommand({
      listingId: L,
      operationId: O,
      expectedListingVersion: '1',
      predecessor: { revision: 1, version: '4', state: 'rejected' },
      content: {
        title: 'Synthetic successor draft',
        privateAddress: ' FICTIONAL PRIVATE ',
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
    });
    let posts = 0,
      gets = 0;
    const before = await api.getStaffListingV2(L, agent);
    assert.equal(before.version, '1');
    assert.deepEqual(
      {
        revision: before.latest.revision,
        version: before.latest.version,
        state: before.latest.state,
      },
      command.predecessor,
    );
    await assert.rejects(
      () => api.getStaffListingV2(L, peer),
      (e) => e.status === 404,
    );
    assert.equal((await api.getStaffListingV2(L, admin)).listingId, L);
    const lost = make(async (url, init) => {
      const response = await fetch(url, init);
      if (init.method === 'POST' && url.includes('/revision-operations/')) {
        posts++;
        assert.equal(response.status, 200);
        assert.equal((await response.clone().json()).decision.outcome, 'applied');
        await response.arrayBuffer();
        throw Error('Discarded committed successor reply');
      }
      return response;
    });
    await assert.rejects(
      () => lost.startListingRevisionV2(command, agent),
      (e) => e.kind === 'NETWORK' && e.submissionUncertain,
    );
    assert.equal(posts, 1);
    const reader = make(async (url, init) => {
        assert.equal(init.method, 'GET');
        gets++;
        return fetch(url, init);
      }),
      saved = await reader.getListingSuccessorReceiptV2(command, agent);
    assert.equal(gets, 1);
    assert.equal(saved.decision.result.revision, 2);
    assert.deepEqual(await api.getListingSuccessorSnapshotV2(L, O, agent), saved);
    await api.saveStaffDraftV2(
      L,
      2,
      { expectedVersion: '2', content: { ...command.content, title: 'Deliberate later edit' } },
      agent,
    );
    const current = await api.getStaffListingV2(L, agent);
    assert.equal(current.version, '2');
    assert.equal(current.latest.revision, 2);
    assert.equal(current.latest.version, '3');
    assert.deepEqual(await api.startListingRevisionV2(command, agent), saved);
    assert.deepEqual(await api.getListingSuccessorReceiptV2(command, agent), saved);
    const stale = await api.startListingRevisionV2({ ...command, operationId: id(201) }, agent);
    assert.equal(stale.decision.outcome, 'conflict');
    for (const options of [admin, peer])
      await assert.rejects(
        () => api.getListingSuccessorReceiptV2(command, options),
        (e) => e.status === 404,
      );
    await assert.rejects(
      () => api.startListingRevisionV2(command, customer),
      (e) => e.status === 403,
    );
    await assert.rejects(
      () =>
        api.startListingRevisionV2(
          { ...command, content: { ...command.content, title: 'Changed original' } },
          agent,
        ),
      (e) => e.status === 409,
    );
    await asOwner(() =>
      db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [P, L]),
    );
    await assert.rejects(
      () => api.getListingSuccessorReceiptV2(command, agent),
      (e) => e.status === 404,
    );
    await assert.rejects(
      () => api.getStaffListingV2(L, agent),
      (e) => e.status === 404,
    );
    await asOwner(() =>
      db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [U, L]),
    );
    assert.deepEqual(await api.getListingSuccessorReceiptV2(command, agent), saved);
    const rolled = { ...command, listingId: id(101), operationId: id(202) };
    corrupt = true;
    await assert.rejects(
      () => api.startListingRevisionV2(rolled, agent),
      (e) => e.status === 503,
    );
    await assert.rejects(
      () => api.getListingSuccessorReceiptV2(rolled, agent),
      (e) => e.status === 404,
    );
    assert.deepEqual(
      await asOwner(
        async () =>
          (
            await db.query(
              'SELECT (SELECT count(*)::int FROM app_private.listing_revisions WHERE listing_id=$1) revisions,(SELECT count(*)::int FROM app_private.listing_successor_requests WHERE operation_id=$2) requests',
              [rolled.listingId, rolled.operationId],
            )
          ).rows[0],
      ),
      { revisions: 1, requests: 0 },
    );
    assert.equal((await api.startListingRevisionV2(rolled, agent)).decision.outcome, 'applied');
    assert.deepEqual(
      await asOwner(
        async () =>
          (
            await db.query(
              'SELECT (SELECT count(*)::int FROM app_private.listing_revisions) revisions,(SELECT count(*)::int FROM app_private.listing_successor_requests) requests,(SELECT count(*)::int FROM app_private.listing_successor_results) results',
            )
          ).rows[0],
      ),
      { revisions: 4, requests: 3, results: 3 },
    );
  } finally {
    await stop(apiServer);
    await stop(keyServer);
    if (database) await database.close();
    await db.close();
  }
});
