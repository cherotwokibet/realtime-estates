import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { referenceModerationRequest } from '../dist/tests/lib/reference-moderation-server.js';
import { referenceDraftRequest } from '../dist/tests/lib/reference-draft-server.js';
import { createReferenceModerationClient } from '../dist/tests/lib/reference-moderation-client.js';
import {
  referenceModerationSession,
  prepareReferenceModerationAttempt,
  restoreReferenceModerationAttempt,
} from '../dist/tests/lib/reference-moderation-workspace.js';
import { createApiService } from '../../../apps/api/dist/service.js';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { id, scope, catalogue, env } from '../test-helpers/reference-moderation-fixture.mjs';
test('unmounted moderation browser adapter through BFF/SDK/API/restricted SQL preserves original decisions', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  for (const f of [
    'listing-reference-draft.sql',
    'listing-reference-catalogue-install.sql',
    'listing-reference-read.sql',
    'listing-reference-moderation.sql',
  ])
    await db.exec(
      await readFile(new URL('../../../database/proposals/' + f, import.meta.url), 'utf8'),
    );
  await db.query('INSERT INTO app_private.tenants(id,slug,display_name)VALUES($1,$2,$2)', [
    id(1),
    'synthetic-moderation-bff',
  ]);
  for (const [user, role] of [
    [10, 'agent'],
    [11, 'agent'],
    [12, 'customer'],
    [13, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role)VALUES($1,$2,$3)', [
      id(1),
      id(user),
      role,
    ]);
  const cat = catalogue();
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(cat),
  ]);
  const content = normalizeStaffDraftContentV2({
    title: 'Synthetic BFF moderation',
    description: 'Independent synthetic connected fixture.',
    purpose: 'rent',
    propertyType: 'apartment',
    currency: 'KES',
    amountMinor: 2000000,
    rentPeriod: 'month',
    bedrooms: 2,
    locality: 'Synthetic original county',
    location: { county: 'Synthetic original county', town: null, area: null },
    pricing: { declaration: 'complete', charges: [] },
    privateAddress: 'PRIVATE CONNECTED REVIEW',
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
    },
    as = (actor, work) => database.transaction({ tenantId: id(1), actorId: id(actor) }, work);
  await as(10, (q) =>
    seedGuardedListingDraft(q, {
      listingId: id(100),
      slug: 'synthetic-moderation-bff-stock',
      actorId: id(10),
      content,
    }),
  );
  for (let position = 0; position < 4; position++)
    await seedSyntheticSealedMedia(db, { tenantId: id(1), listingId: id(100), position });
  await as(10, (q) =>
    q.query('SELECT app_api.save_synthetic_reference_draft($1,1,2,$2,$3::jsonb,$4::jsonb)', [
      id(100),
      id(2000),
      JSON.stringify(content),
      JSON.stringify({
        catalogueVersion: '1',
        location: { countyId: id(200), localityId: null, neighbourhoodId: null },
        amenityIds: [],
      }),
    ]),
  );
  await as(10, (q) => q.query("SELECT app_api.confirm_availability($1,1,'available')", [id(100)]));
  const oldEnv = { ...process.env },
    oldFetch = globalThis.fetch;
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const k of Object.keys(process.env)) if (!Object.hasOwn(oldEnv, k)) delete process.env[k];
    Object.assign(process.env, oldEnv);
  });
  Object.assign(process.env, env);
  let actor = 10,
    loseBrowser = false,
    corruptReply = false;
  const upstream = [],
    browser = [];
  const service = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic',
    referenceDraftMode: 'synthetic-reference-draft-v1',
    referenceModerationMode: 'synthetic-reference-transition-v1',
    database,
    verifyAuthorization: async (request) => {
      assert.equal(request.headers.get('authorization'), 'Bearer a.b.c');
      return { actorId: id(actor) };
    },
  });
  globalThis.fetch = async (url, init) => {
    upstream.push({ url, method: init.method });
    const r = await service(new Request(url, init));
    if (corruptReply && r.ok && init.method === 'POST') {
      const value = await r.json();
      value.actorId = id(99);
      return Response.json(value);
    }
    return r;
  };
  const transport = async (path, init) => {
    browser.push({ path, method: init.method });
    assert.equal(new Headers(init.headers).has('authorization'), false);
    const headers = new Headers(init.headers);
    headers.set('host', '127.0.0.1:3001');
    if (init.method === 'POST') headers.set('origin', 'http://127.0.0.1:3001');
    const req = new Request('http://127.0.0.1:3001' + path, { ...init, headers });
    const r = await (path.includes('reference-catalogues')
      ? referenceDraftRequest(req)
      : referenceModerationRequest(req));
    if (loseBrowser && r.ok && init.method === 'POST' && !path.endsWith('/recover')) {
      await r.body.cancel();
      throw Error('Synthetic browser reply lost after BFF completed');
    }
    return r;
  };
  const agent = createReferenceModerationClient(scope(), transport),
    admin = createReferenceModerationClient({ ...scope(), actorId: id(13) }, transport);
  const data = new Map(),
    storage = {
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => data.set(k, v),
      removeItem: (k) => data.delete(k),
    };
  const agentSession = referenceModerationSession(storage, scope()),
    adminSession = referenceModerationSession(storage, { ...scope(), actorId: id(13) });
  const command = (review, action, op) => ({
    policy: 'synthetic-reference-transition-v1',
    operationId: id(op),
    listingId: id(100),
    revision: 1,
    action,
    review,
    reason: null,
  });
  let original, pending, approval, submissionAttempt, approvalAttempt;
  await t.test(
    'exact private read and one committed submission with lost browser acknowledgement remain uncertain',
    async () => {
      const draft = await agent.read('revision', '3', cat);
      assert.deepEqual(draft.content, content);
      assert.equal(draft.photos.length, 4);
      original = command(draft, 'submit', 400);
      submissionAttempt = prepareReferenceModerationAttempt(agent, agentSession, original, cat);
      loseBrowser = true;
      await assert.rejects(
        () => submissionAttempt.submit(),
        (e) => e.submissionUncertain,
      );
      loseBrowser = false;
      assert.equal(submissionAttempt.status, 'uncertain');
      assert.equal(submissionAttempt.canDiscard, false);
      assert.ok(agentSession.load());
      assert.equal(upstream.filter((c) => c.method === 'POST').length, 1);
      assert.equal(
        (await db.query('SELECT version FROM app_private.listing_revisions')).rows[0].version,
        4,
      );
    },
  );
  await t.test(
    'browser recovery posts the original body only to BFF while every upstream recovery request is GET',
    async () => {
      const start = upstream.length,
        first = await submissionAttempt.recoverOriginal();
      assert.equal(first.state, 'pending');
      assert.equal(first.revisionVersion, '4');
      assert.ok(upstream.slice(start).every((c) => c.method === 'GET'));
      assert.ok(browser.at(-1).path.endsWith('/recover'));
      const changed = structuredClone(original);
      changed.review.content.privateAddress = 'Changed original';
      await assert.rejects(
        () => agent.recover(changed, cat),
        (e) => e.kind === 'HTTP' && e.status === 502 && !e.submissionUncertain,
      );
    },
  );
  await t.test(
    'historical catalogue refetch and admin review preserve original facts after catalogue activation',
    async () => {
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
        JSON.stringify({
          ...cat,
          version: '2',
          locations: cat.locations.map((r) => ({ ...r, label: 'Synthetic renamed county' })),
        }),
      ]);
      assert.deepEqual(await agent.catalogue('1'), cat);
      const before = upstream.filter((c) => c.method === 'POST').length;
      const restored = await restoreReferenceModerationAttempt(
        agent,
        referenceModerationSession(storage, scope()),
      );
      assert.equal(restored.status, 'uncertain');
      assert.deepEqual(restored.original, original);
      assert.equal((await restored.recoverOriginal()).state, 'pending');
      assert.equal(upstream.filter((c) => c.method === 'POST').length, before);
      restored.discard();
      assert.equal(agentSession.load(), null);
      assert.equal(
        (await agent.recover(original, cat)).review.attributes.location.county.label,
        'Synthetic original county',
      );
      actor = 13;
      await assert.rejects(
        () => agent.read('revision', '4', cat),
        (e) => e.kind === 'HTTP' && e.status === 409,
      );
      pending = await admin.read('review', '4', cat);
      assert.deepEqual(pending.content, content);
      assert.equal(pending.attributes.location.county.label, 'Synthetic original county');
      await assert.rejects(
        () =>
          admin.read('review', '4', {
            ...cat,
            version: '2',
            locations: cat.locations.map((r) => ({ ...r, label: 'Synthetic renamed county' })),
          }),
        (e) => e.kind === 'HTTP' && e.status === 502,
      );
    },
  );
  await t.test(
    'operational change makes displayed review stale and exact refreshed approval preserves pause',
    async () => {
      await as(13, (q) => q.query("SELECT app_api.set_publication($1,2,'paused')", [id(100)]));
      const stale = prepareReferenceModerationAttempt(
        admin,
        adminSession,
        command(pending, 'approve', 401),
        cat,
      );
      await assert.rejects(
        () => stale.submit(),
        (e) => e.kind === 'HTTP' && e.status === 409 && !e.submissionUncertain,
      );
      assert.equal(stale.status, 'rejected');
      stale.discard();
      approval = command(await admin.read('review', '4', cat), 'approve', 401);
      approvalAttempt = prepareReferenceModerationAttempt(admin, adminSession, approval, cat);
      corruptReply = true;
      await assert.rejects(
        () => approvalAttempt.submit(),
        (e) => e.kind === 'HTTP' && e.status === 502 && e.submissionUncertain,
      );
      corruptReply = false;
      assert.equal(approvalAttempt.status, 'uncertain');
      assert.throws(() => approvalAttempt.discard());
      assert.equal(
        (await db.query('SELECT version FROM app_private.listing_revisions')).rows[0].version,
        5,
      );
      assert.equal(
        (await db.query('SELECT publication_status FROM app_private.listings')).rows[0]
          .publication_status,
        'paused',
      );
    },
  );
  await t.test(
    'original approval GET settles only exact verified result and preserves approved historical snapshot',
    async () => {
      const before = upstream.filter((c) => c.method === 'POST').length;
      const restored = await restoreReferenceModerationAttempt(
        admin,
        referenceModerationSession(storage, { ...scope(), actorId: id(13) }),
      );
      const r = await restored.recoverOriginal();
      assert.equal(restored.status, 'received');
      assert.equal(r.state, 'approved');
      assert.equal(r.actorId, id(13));
      assert.equal(r.revisionVersion, '5');
      assert.equal(upstream.filter((c) => c.method === 'POST').length, before);
      assert.deepEqual(
        (await db.query('SELECT attributes FROM app_private.synthetic_reference_approved')).rows[0]
          .attributes,
        approval.review.attributes,
      );
      assert.equal(
        (await as(12, (q) => q.query('SELECT * FROM app_api.public_listings_reference_v3'))).rows
          .length,
        0,
      );
    },
  );
  await t.test(
    'revoked current membership and actor rotation deny original recovery without sending another transition',
    async () => {
      const before = upstream.filter((c) => c.method === 'POST').length;
      const unsettled = await restoreReferenceModerationAttempt(admin, adminSession);
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(13)],
      );
      await assert.rejects(
        () => unsettled.recoverOriginal(),
        (e) => e.kind === 'HTTP' && e.status === 403 && !e.submissionUncertain,
      );
      assert.equal(unsettled.status, 'uncertain');
      assert.equal(unsettled.canDiscard, false);
      assert.throws(() => unsettled.discard());
      actor = 10;
      await assert.rejects(
        () => unsettled.recoverOriginal(),
        (e) => e.kind === 'HTTP' && e.status === 409,
      );
      assert.equal(unsettled.status, 'uncertain');
      assert.ok(adminSession.load());
      assert.equal(upstream.filter((c) => c.method === 'POST').length, before);
    },
  );
});
