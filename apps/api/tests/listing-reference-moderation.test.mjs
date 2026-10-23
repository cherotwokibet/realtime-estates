import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createApiService } from '../dist/service.js';
import {
  normalizeStaffDraftContentV2,
  validateSyntheticReferenceTransitionReceipt,
} from '@realtor/domain';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cat = {
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [
    { id: id(200), kind: 'county', parentId: null, label: 'Synthetic original county' },
    { id: id(201), kind: 'county', parentId: null, label: 'Synthetic unselected county' },
  ],
  amenities: [
    {
      id: id(202),
      code: 'synthetic-unused',
      label: 'Synthetic unselected amenity',
      propertyTypes: ['land'],
    },
  ],
};
const content = normalizeStaffDraftContentV2({
  title: 'Synthetic moderation API',
  description: 'Independent synthetic test facts.',
  purpose: 'rent',
  propertyType: 'apartment',
  currency: 'KES',
  amountMinor: 2000000,
  rentPeriod: 'month',
  bedrooms: 2,
  locality: 'Synthetic original county',
  location: { county: 'Synthetic original county', town: null, area: null },
  pricing: { declaration: 'complete', charges: [] },
  privateAddress: 'PRIVATE-MODERATION-API',
});
const operation = (n, listing = 100) =>
  `/v3/staff/listings/${id(listing)}/reference-transition-operations/${id(n)}`;
const revision = (version = '3', kind = 'listings', listing = 100) =>
  `/v3/staff/${kind}/${id(listing)}/reference-revisions/1/${version}`;
const facts = (review, action, op, reason = null) => ({
  policy: 'synthetic-reference-transition-v1',
  operationId: id(op),
  listingId: review.listingId,
  revision: review.revision,
  action,
  review,
  reason,
});
function request(method, path, body, headers = {}, signal) {
  return new Request('https://synthetic.invalid' + path, {
    method,
    headers: {
      authorization: 'Bearer synthetic',
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(method === 'POST'
      ? {
          body:
            typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
        }
      : {}),
    ...(signal ? { signal } : {}),
  });
}
test('opt-in reference moderation validates actual restricted SQL before commit and recovers original operations', async (t) => {
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
  for (const tenant of [1, 2]) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name)VALUES($1,$2,$2)', [
      id(tenant),
      'synthetic-moderation-api-' + tenant,
    ]);
    for (const [user, role] of [
      [10, 'agent'],
      [11, 'agent'],
      [12, 'customer'],
      [13, 'admin'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role)VALUES($1,$2,$3)',
        [id(tenant), id(user), role],
      );
  }
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(cat),
  ]);
  let actor = 10,
    tenant = 1,
    corrupt = false,
    badRead = false,
    badOriginal = false,
    badPublic = '',
    lastPublicCatalogue = null,
    reads = 0,
    writes = 0,
    commits = 0,
    abortAfterWrite = null;
  const database = {
    async transaction(context, work) {
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
      try {
        await db.query(
          "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
          [context.tenantId, context.actorId],
        );
        const result = await work({
          async query(sql, args) {
            if (sql.includes('execute_synthetic_reference_transition')) writes++;
            const value = await db.query(sql, args);
            if (sql.includes('FROM app_api.public_listings_reference_v3') && value.rows[0])
              lastPublicCatalogue = value.rows[0].referenceCatalogue;
            if (
              badPublic &&
              sql.includes('FROM app_api.public_listings_reference_v3') &&
              value.rows[0]
            ) {
              if (badPublic === 'rename')
                value.rows[0].referenceAttributes.location.county.label =
                  'Synthetic renamed projection';
              if (badPublic === 'extra') value.rows[0].privateAddress = 'PRIVATE-MODERATION-API';
              if (badPublic === 'version') value.rows[0].referenceRevisionVersion = null;
              if (badPublic === 'photoextra')
                value.rows[0].photos[0].privateAddress = 'PRIVATE-MODERATION-API';
              if (badPublic === 'titleobject')
                value.rows[0].title = { privateAddress: 'PRIVATE-MODERATION-API' };
              if (badPublic === 'coordinate') {
                value.rows[0].latitude = '1';
                value.rows[0].longitude = '2';
              }
              if (badPublic === 'overpage') value.rows.push(...Array(10).fill(value.rows[0]));
              if (badPublic === 'catalogueGetter')
                Object.defineProperty(value.rows[0].referenceCatalogue.locations[0], 'label', {
                  enumerable: true,
                  get() {
                    reads++;
                    return 'Changed';
                  },
                });
              if (badPublic === 'photoGetter')
                Object.defineProperty(value.rows[0].photos[0], 'alt', {
                  enumerable: true,
                  get() {
                    reads++;
                    return 'Changed';
                  },
                });
              if (badPublic === 'getter')
                Object.defineProperty(value.rows[0], 'referenceCatalogue', {
                  enumerable: true,
                  get() {
                    reads++;
                    return {};
                  },
                });
            }
            if (corrupt && sql.includes('execute_synthetic_reference_transition'))
              value.rows[0].receipt.actorId = id(99);
            if (badRead && sql.includes('read_synthetic_reference_revision'))
              value.rows[0].review.listingId = id(99);
            if (badOriginal && sql.includes('read_synthetic_reference_transition'))
              Object.defineProperty(value.rows[0].receipt, 'review', {
                enumerable: true,
                get() {
                  reads++;
                  return {};
                },
              });
            if (abortAfterWrite && sql.includes('execute_synthetic_reference_transition'))
              abortAfterWrite.abort();
            return value;
          },
        });
        await db.exec('COMMIT');
        commits++;
        return result;
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  for (const listing of [100, 101]) {
    await database.transaction({ tenantId: id(1), actorId: id(10) }, (q) =>
      seedGuardedListingDraft(q, {
        listingId: id(listing),
        slug: 'synthetic-moderation-api-stock-' + listing,
        actorId: id(10),
        content,
      }),
    );
    for (let position = 0; position < 4; position++)
      await seedSyntheticSealedMedia(db, { tenantId: id(1), listingId: id(listing), position });
    await database.transaction({ tenantId: id(1), actorId: id(10) }, (q) =>
      q.query('SELECT app_api.save_synthetic_reference_draft($1,1,2,$2,$3::jsonb,$4::jsonb)', [
        id(listing),
        id(listing + 1000),
        JSON.stringify(content),
        JSON.stringify({
          catalogueVersion: '1',
          location: { countyId: id(200), localityId: null, neighbourhoodId: null },
          amenityIds: [],
        }),
      ]),
    );
    await database.transaction({ tenantId: id(1), actorId: id(10) }, (q) =>
      q.query("SELECT app_api.confirm_availability($1,1,'available')", [id(listing)]),
    );
  }
  const base = () => ({
    tenantId: id(tenant),
    privacyNoticeVersion: 'synthetic',
    database,
    verifyAuthorization: async (r) => {
      if (r.headers.get('authorization') !== 'Bearer synthetic') throw Error('invalid');
      return { actorId: id(actor) };
    },
  });
  const service = (enabled = true) =>
    createApiService({
      ...base(),
      referenceDraftMode: 'synthetic-reference-draft-v1',
      ...(enabled ? { referenceModerationMode: 'synthetic-reference-transition-v1' } : {}),
    });
  const call = (method, path, body, headers, signal) =>
    service()(request(method, path, body, headers, signal));
  const read = async (version = '3', kind = 'listings', listing = 100) => {
    const r = await call('GET', revision(version, kind, listing));
    assert.equal(r.status, 200);
    return r.json();
  };
  const post = (c, signal) =>
    call(
      'POST',
      operation(Number(c.operationId.slice(-12)), Number(c.listingId.slice(-12))),
      c,
      {},
      signal,
    );
  const state = async (listing = 100) =>
    (
      await db.query(
        'SELECT state,version FROM app_private.listing_revisions WHERE tenant_id=$1 AND listing_id=$2',
        [id(1), id(listing)],
      )
    ).rows[0];
  let draft, pending, original, submitted;
  await t.test(
    'default routes do not query SQL and invalid/incompatible policy refuses startup',
    async () => {
      const before = commits;
      for (const path of [
        '/v3/properties',
        revision(),
        revision('3', 'reviews'),
        revision() + '/context',
        revision('3', 'reviews') + '/context',
        operation(300),
      ])
        assert.equal((await service(false)(request('GET', path))).status, 404);
      assert.equal(commits, before);
      for (const options of [
        { referenceModerationMode: 'live' },
        { referenceModerationMode: 'synthetic-reference-transition-v1' },
        { referenceDraftMode: 'synthetic-reference-draft-v1', referenceModerationMode: 'live' },
      ])
        assert.throws(() => createApiService({ ...base(), ...options }));
    },
  );
  await t.test(
    'private projection and pending admin review enforce current role/company/assignment',
    async () => {
      draft = await read();
      assert.equal(draft.content.privateAddress, 'PRIVATE-MODERATION-API');
      assert.equal(draft.photos.length, 4);
      assert.equal((await call('GET', revision('3', 'reviews'))).status, 403);
      for (const [user, expected] of [
        [11, 404],
        [12, 403],
      ]) {
        actor = user;
        assert.equal((await call('GET', revision())).status, expected);
      }
      actor = 13;
      assert.equal((await call('GET', revision('3', 'reviews'))).status, 404);
      actor = 10;
      tenant = 2;
      assert.equal((await call('GET', revision())).status, 404);
      tenant = 1;
    },
  );
  await t.test(
    'initial context discovers the original saved catalogue under the same current authorization',
    async () => {
      const path = revision() + '/context';
      const r = await call('GET', path);
      assert.equal(r.status, 200);
      assert.deepEqual(await r.json(), {
        policy: 'synthetic-reference-context-v1',
        review: draft,
        catalogue: cat,
      });
      assert.equal((await call('GET', revision('4') + '/context')).status, 409);
      assert.equal((await call('POST', path, {})).status, 405);
      assert.equal((await call('GET', path + '?catalogue=2')).status, 400);
      actor = 11;
      assert.equal((await call('GET', path)).status, 404);
      actor = 12;
      assert.equal((await call('GET', path)).status, 403);
      actor = 10;
      tenant = 2;
      assert.equal((await call('GET', path)).status, 404);
      tenant = 1;
      const before = commits;
      badRead = true;
      assert.equal((await call('GET', path)).status, 503);
      badRead = false;
      assert.equal(commits, before);
    },
  );
  await t.test(
    'route, framing, UTF-8, duplicate keys, integer literals and complete reviewed facts fail before writes',
    async () => {
      const c = facts(draft, 'submit', 300),
        json = JSON.stringify(c),
        before = writes;
      for (const body of [
        json.replace('"revision":1', '"revision":1.0'),
        json.replace('"action":"submit"', '"action":"submit","action":"submit"'),
        JSON.stringify({ ...c, actorId: id(13) }),
        JSON.stringify({ ...c, review: { ...draft, revisionVersion: '03' } }),
        new Uint8Array([0xff]),
      ])
        assert.equal((await call('POST', operation(300), body)).status, 400);
      for (const headers of [
        { 'x-tenant-id': id(2) },
        { cookie: 'x=y' },
        { 'content-encoding': 'gzip' },
        { 'if-match': '3' },
        { 'content-length': '1' },
        { 'content-length': '013' },
      ])
        assert.equal((await call('POST', operation(300), c, headers)).status, 400);
      assert.equal((await call('POST', operation(301), c)).status, 400);
      assert.equal((await call('POST', operation(300) + '?x=1', c)).status, 400);
      assert.equal((await call('GET', revision('9007199254740992'))).status, 400);
      assert.equal((await call('DELETE', operation(300))).status, 405);
      assert.equal(writes, before);
    },
  );
  await t.test(
    'malformed read and post-write receipts fail before commit; original SQL state and ledger roll back',
    async () => {
      badRead = true;
      const before = commits;
      assert.equal((await call('GET', revision())).status, 503);
      assert.equal(commits, before);
      badRead = false;
      corrupt = true;
      assert.equal((await post(facts(draft, 'submit', 300))).status, 503);
      corrupt = false;
      assert.deepEqual(await state(), { state: 'draft', version: 3 });
      assert.equal((await call('GET', operation(300))).status, 404);
      assert.equal(
        (await db.query('SELECT count(*) AS n FROM app_private.synthetic_reference_transitions'))
          .rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'request cancellation after SQL mutation rolls back and stalled-body abort does not wait for cancellation',
    async () => {
      const controller = new AbortController();
      abortAfterWrite = controller;
      assert.equal((await post(facts(draft, 'submit', 300), controller.signal)).status, 400);
      abortAfterWrite = null;
      assert.deepEqual(await state(), { state: 'draft', version: 3 });
      let cancelled = false;
      const ctrl = new AbortController(),
        body = new ReadableStream({
          cancel() {
            cancelled = true;
            return new Promise(() => {});
          },
        });
      const r = new Request('https://synthetic.invalid' + operation(300), {
        method: 'POST',
        headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' },
        body,
        duplex: 'half',
        signal: ctrl.signal,
      });
      setTimeout(() => ctrl.abort(), 20);
      assert.equal((await service()(r)).status, 400);
      assert.equal(cancelled, true);
    },
  );
  await t.test(
    'discarded successful response recovers by GET and exact POST replay keeps one revision increment',
    async () => {
      original = facts(draft, 'submit', 300);
      const first = await post(original);
      assert.equal(first.status, 200);
      await first.body.cancel();
      const before = writes,
        recovered = await call('GET', operation(300));
      assert.equal(recovered.status, 200);
      submitted = await recovered.json();
      assert.equal(writes, before);
      assert.deepEqual(
        validateSyntheticReferenceTransitionReceipt(submitted, original, cat, id(10)),
        submitted,
      );
      assert.deepEqual(await (await post(original)).json(), submitted);
      assert.deepEqual(await state(), { state: 'pending', version: 4 });
      actor = 13;
      pending = await read('4', 'reviews');
      assert.deepEqual(pending.attributes, draft.attributes);
      assert.equal((await call('GET', operation(300))).status, 404);
      actor = 10;
      badOriginal = true;
      assert.equal((await call('GET', operation(300))).status, 503);
      badOriginal = false;
      assert.equal(reads, 0);
    },
  );
  await t.test(
    'catalogue activation retains historical review, withdrawal/resubmission invalidate old reviews, rejection reason remains exact',
    async () => {
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
        JSON.stringify({
          ...cat,
          version: '2',
          locations: cat.locations.map((r) => ({ ...r, label: 'Synthetic renamed county' })),
        }),
      ]);
      assert.deepEqual(await (await call('GET', operation(300))).json(), submitted);
      assert.equal((await post(facts(pending, 'withdraw', 301))).status, 200);
      const fresh = await read('5');
      assert.equal(fresh.attributes.location.county.label, 'Synthetic original county');
      assert.equal((await post(facts(fresh, 'submit', 302))).status, 200);
      actor = 13;
      assert.equal((await post(facts(pending, 'approve', 303))).status, 409);
      const current = await read('6', 'reviews');
      assert.equal((await post(facts(current, 'reject', 303, ' '))).status, 400);
      const c = facts(current, 'reject', 303, 'Synthetic additional evidence required'),
        r = await post(c);
      assert.equal(r.status, 200);
      const receipt = await r.json();
      assert.deepEqual(
        validateSyntheticReferenceTransitionReceipt(receipt, c, cat, id(13)),
        receipt,
      );
      assert.deepEqual(await (await call('GET', operation(303))).json(), receipt);
      assert.deepEqual(await state(), { state: 'rejected', version: 7 });
      actor = 10;
    },
  );
  await t.test(
    'approval preserves current pause and historical labels and refuses old operational context',
    async () => {
      const d = await read('3', 'listings', 101);
      assert.equal((await post(facts(d, 'submit', 310))).status, 200);
      actor = 13;
      const stale = await read('4', 'reviews', 101);
      await database.transaction({ tenantId: id(1), actorId: id(13) }, (q) =>
        q.query("SELECT app_api.set_publication($1,2,'paused')", [id(101)]),
      );
      assert.equal((await post(facts(stale, 'approve', 311))).status, 409);
      const current = await read('4', 'reviews', 101),
        c = facts(current, 'approve', 311),
        r = await post(c);
      assert.equal(r.status, 200);
      assert.deepEqual(
        validateSyntheticReferenceTransitionReceipt(await r.json(), c, cat, id(13)).state,
        'approved',
      );
      assert.equal(
        (
          await db.query('SELECT publication_status FROM app_private.listings WHERE id=$1', [
            id(101),
          ])
        ).rows[0].publication_status,
        'paused',
      );
      actor = 10;
    },
  );
  await t.test(
    'anonymous public reference page uses approved historical facts and fails closed before commit on corrupted projections',
    async () => {
      const path = '/v3/properties?limit=10';
      const anonymous = () => service()(new Request('https://synthetic.invalid' + path));
      assert.deepEqual((await (await anonymous()).json()).items, []);
      const lv = (await db.query('SELECT version FROM app_private.listings WHERE id=$1', [id(101)]))
        .rows[0].version;
      await database.transaction({ tenantId: id(1), actorId: id(13) }, (q) =>
        q.query("SELECT app_api.set_publication($1,$2,'published')", [id(101), lv]),
      );
      const response = await anonymous();
      assert.equal(response.status, 200);
      const page = await response.json();
      assert.equal(page.policy, 'synthetic-reference-public-v1');
      assert.equal(page.limit, 10);
      assert.equal(page.items.length, 1);
      assert.equal(page.items[0].id, id(101));
      assert.equal(page.items[0].reference.revisionVersion, '5');
      assert.equal(page.items[0].reference.attributes.catalogueVersion, '1');
      assert.equal(
        page.items[0].reference.attributes.location.county.label,
        'Synthetic original county',
      );
      const raw = JSON.stringify(page);
      assert.equal(lastPublicCatalogue.locations.length, 1);
      assert.equal(lastPublicCatalogue.amenities.length, 0);
      assert.ok(!JSON.stringify(lastPublicCatalogue).includes('unselected'));
      for (const secret of [
        'PRIVATE-MODERATION-API',
        'referenceCatalogue',
        'actorId',
        'reason',
        'review',
      ])
        assert.ok(!raw.includes('"' + secret + '"') && !raw.includes('PRIVATE-MODERATION-API'));
      for (const kind of [
        'rename',
        'extra',
        'version',
        'getter',
        'photoextra',
        'titleobject',
        'coordinate',
        'overpage',
        'catalogueGetter',
        'photoGetter',
      ]) {
        badPublic = kind;
        const before = commits;
        assert.equal((await anonymous()).status, 503);
        assert.equal(commits, before);
      }
      badPublic = '';
      assert.equal(reads, 0);
      tenant = 2;
      assert.deepEqual((await (await anonymous()).json()).items, []);
      tenant = 1;
      for (const suffix of ['?tenant=2', '?limit=01', '?limit=1&limit=1'])
        assert.equal((await call('GET', '/v3/properties' + suffix)).status, 400);
      assert.equal((await call('POST', '/v3/properties', {})).status, 405);
      const legacy = await (await call('GET', '/v2/properties')).json();
      assert.ok(!Object.hasOwn(legacy.items[0], 'reference'));
      await database.transaction({ tenantId: id(1), actorId: id(10) }, (q) =>
        seedGuardedListingDraft(q, {
          listingId: id(102),
          slug: 'synthetic-legacy-public',
          actorId: id(10),
          content,
        }),
      );
      for (let position = 0; position < 4; position++)
        await seedSyntheticSealedMedia(db, { tenantId: id(1), listingId: id(102), position });
      await database.transaction({ tenantId: id(1), actorId: id(10) }, async (q) => {
        await q.query("SELECT app_api.confirm_availability($1,1,'available')", [id(102)]);
        await q.query('SELECT app_api.submit_revision($1,1,2)', [id(102)]);
      });
      await database.transaction({ tenantId: id(1), actorId: id(13) }, async (q) => {
        await q.query('SELECT app_api.decide_revision($1,1,3,true,NULL)', [id(102)]);
      });
      const legacyVersion = (
        await db.query('SELECT version FROM app_private.listings WHERE id=$1', [id(102)])
      ).rows[0].version;
      await database.transaction({ tenantId: id(1), actorId: id(13) }, (q) =>
        q.query("SELECT app_api.set_publication($1,$2,'published')", [id(102), legacyVersion]),
      );
      const mixed = await (await anonymous()).json();
      assert.equal(mixed.items.length, 2);
      assert.deepEqual(mixed.items.find((p) => p.id === id(102)).reference, {
        attributes: null,
        revisionVersion: null,
      });
    },
  );
  await t.test(
    'membership revocation, reassignment and changed same-operation facts deny recovery/replay',
    async () => {
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      assert.equal((await call('GET', operation(300))).status, 403);
      assert.equal((await post(original)).status, 403);
      await db.query(
        'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      assert.equal(
        (await post({ ...original, review: { ...original.review, listingVersion: '3' } })).status,
        409,
      );
      await db.query('UPDATE app_private.listings SET assigned_agent_id=$1 WHERE id=$2', [
        id(11),
        id(100),
      ]);
      assert.equal((await call('GET', operation(300))).status, 404);
      assert.equal((await post(original)).status, 404);
    },
  );
});
