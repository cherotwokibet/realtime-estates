import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { readReferenceDraftScreen } from '../dist/tests/lib/reference-draft-screen.js';
import { referenceDraftRequest } from '../dist/tests/lib/reference-draft-server.js';
import { createReferenceDraftClient } from '../dist/tests/lib/reference-draft-client.js';
import {
  buildReferenceDraftCommand,
  referenceDraftSession,
  prepareReferenceDraftAttempt,
  restoreReferenceDraftAttempt,
} from '../dist/tests/lib/reference-draft-workspace.js';
import { createApiService } from '../../../apps/api/dist/service.js';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('mounted reference flow through browser adapter, BFF, SDK, API and restricted SQL retains originals', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  for (const f of [
    'listing-reference-draft.sql',
    'listing-reference-catalogue-install.sql',
    'listing-reference-read.sql',
  ])
    await db.exec(
      await readFile(new URL('../../../database/proposals/' + f, import.meta.url), 'utf8'),
    );
  await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$2)', [
    id(1),
    'synthetic-reference-sdk',
  ]);
  for (const [user, role] of [
    [10, 'agent'],
    [11, 'agent'],
    [12, 'customer'],
    [13, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      id(1),
      id(user),
      role,
    ]);
  const cat = {
    policy: 'synthetic-reference-catalogue-v1',
    version: '1',
    country: 'KE',
    locations: [],
    amenities: [],
  };
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(cat),
  ]);
  const content = normalizeStaffDraftContentV2({
    title: 'Synthetic SDK integration draft',
    pricing: { declaration: 'not_declared', charges: [] },
    location: { county: null, town: null, area: null },
  });
  const database = {
    async transaction(context, work) {
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
      try {
        await db.query(
          "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
          [context.tenantId, context.actorId],
        );
        const result = await work(db);
        await db.exec('COMMIT');
        return result;
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  await database.transaction({ tenantId: id(1), actorId: id(10) }, (q) =>
    seedGuardedListingDraft(q, {
      listingId: id(100),
      slug: 'synthetic-reference-sdk-stock',
      actorId: id(10),
      content,
    }),
  );
  const oldFetch = globalThis.fetch,
    oldEnv = { ...process.env };
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const k of Object.keys(process.env)) if (!Object.hasOwn(oldEnv, k)) delete process.env[k];
    Object.assign(process.env, oldEnv);
  });
  const env = {
    NODE_ENV: 'development',
    STAFF_PREVIEW_MODE: 'synthetic',
    STAFF_PREVIEW_REFERENCE: 'synthetic-reference-draft-v1',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_PREVIEW_TOKEN: 'a.b.c',
    STAFF_PREVIEW_INSTANCE: id(9),
  };
  Object.assign(process.env, env);
  let actor = 10,
    lose = false;
  const calls = [];
  const service = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic',
    referenceDraftMode: 'synthetic-reference-draft-v1',
    database,
    verifyAuthorization: async (request) => {
      assert.equal(request.headers.get('authorization'), 'Bearer a.b.c');
      return { actorId: id(actor) };
    },
  });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, method: init.method });
    return service(new Request(url, init));
  };
  const screen = await readReferenceDraftScreen(id(100), '1', env);
  const client = createReferenceDraftClient(screen.scope, async (path, init) => {
    const response = await referenceDraftRequest(
      new Request('http://127.0.0.1:3001' + path, {
        ...init,
        headers: {
          ...init.headers,
          host: '127.0.0.1:3001',
          ...(init.method === 'POST' ? { origin: 'http://127.0.0.1:3001' } : {}),
        },
      }),
    );
    if (lose && init.method === 'POST' && !path.endsWith('/recover'))
      throw Error('Synthetic browser response lost after committed BFF result');
    return response;
  });
  const map = new Map(),
    store = {
      getItem: (k) => map.get(k) ?? null,
      setItem: (k, v) => map.set(k, v),
      removeItem: (k) => map.delete(k),
    },
    session = referenceDraftSession(store, screen.scope);
  const command = buildReferenceDraftCommand(
    {
      operationId: id(300),
      listingId: id(100),
      revision: screen.revision,
      expectedVersion: screen.expectedVersion,
      content: screen.content,
      selection: {
        catalogueVersion: screen.catalogue.version,
        location: { countyId: null, localityId: null, neighbourhoodId: null },
        amenityIds: [],
      },
    },
    screen.catalogue,
  );
  let attempt;
  await t.test(
    'fresh initial mount facts come from exact authorized API workspace and catalogue',
    async () => {
      assert.equal(screen.expectedVersion, '2');
      assert.equal(screen.scope.actorId, id(10));
      assert.equal(screen.scope.tenantId, id(1));
      assert.equal(screen.catalogue.version, '1');
      assert.equal(calls.filter((c) => c.method === 'POST').length, 0);
    },
  );
  await t.test(
    'lost committed response leaves retained uncertain original and exactly one upstream save',
    async () => {
      attempt = prepareReferenceDraftAttempt(client, session, command, screen.catalogue);
      lose = true;
      await assert.rejects(attempt.submit(), (e) => e.submissionUncertain);
      lose = false;
      assert.equal(attempt.status, 'uncertain');
      assert.equal(map.size, 1);
      assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
      assert.equal(
        (await db.query('SELECT version FROM app_private.listing_revisions')).rows[0].version,
        3,
      );
    },
  );
  await t.test(
    'restore after catalogue activation uses original historical version and performs no write',
    async () => {
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
        JSON.stringify({ ...cat, version: '2' }),
      ]);
      const before = calls.filter((c) => c.method === 'POST').length;
      attempt = await restoreReferenceDraftAttempt(client, session);
      assert.equal(attempt.status, 'uncertain');
      const receipt = await attempt.recoverOriginal();
      assert.equal(receipt.revisionVersion, '3');
      assert.equal(receipt.selection.catalogueVersion, '1');
      assert.equal(calls.filter((c) => c.method === 'POST').length, before);
      assert.equal(
        (await db.query('SELECT count(*) AS n FROM app_private.synthetic_reference_draft_receipts'))
          .rows[0].n,
        1,
      );
    },
  );
  await t.test(
    'rotated actor and revoked membership cannot recover or replace an original',
    async () => {
      const original = await restoreReferenceDraftAttempt(client, session);
      actor = 11;
      await assert.rejects(original.recoverOriginal(), (e) => e.status === 409);
      assert.equal(original.status, 'uncertain');
      assert.throws(() => original.discard());
      actor = 10;
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      await assert.rejects(original.recoverOriginal(), (e) => e.status === 403);
      assert.equal(original.status, 'uncertain');
      assert.equal(map.size, 1);
      await db.query(
        'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
    },
  );
  await t.test(
    'restored current access recovers original, explicit clear permits fresh workspace version',
    async () => {
      const restored = await restoreReferenceDraftAttempt(client, session);
      await restored.recoverOriginal();
      restored.discard();
      assert.equal(map.size, 0);
      const fresh = await readReferenceDraftScreen(id(100), '1', env);
      assert.equal(fresh.expectedVersion, '3');
      assert.equal(fresh.catalogue.version, '2');
      assert.equal(calls.filter((c) => c.method === 'POST').length, 1);
    },
  );
});
