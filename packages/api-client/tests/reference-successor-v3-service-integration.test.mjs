import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { RealtorApiClient } from '../dist/index.js';
import { createApiService } from '../../../apps/api/dist/service.js';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { seedSyntheticSealedMedia } from '../../../database/test-helpers/synthetic-sealed-media.mjs';
import { catalogue, command, id } from './fixtures/reference-successor.mjs';
test('successor SDK and opt-in API retain one full original through rollback, lost reply and current access changes', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  for (const name of [
    'listing-reference-draft.sql',
    'listing-reference-catalogue-install.sql',
    'listing-reference-read.sql',
    'listing-reference-moderation.sql',
    'listing-reference-successor.sql',
  ])
    await db.exec(
      await readFile(new URL('../../../database/proposals/' + name, import.meta.url), 'utf8'),
    );
  for (const tenant of [1, 2]) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name)VALUES($1,$2,$2)', [
      id(tenant),
      'synthetic-reference-wire-' + tenant,
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
  async function seedTerminal(listing) {
    await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
    try {
      await db.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
        [id(1), id(10)],
      );
      await seedGuardedListingDraft(db, {
        listingId: id(listing),
        slug: 'synthetic-successor-' + listing,
        actorId: id(10),
        content: command(listing).content,
      });
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
    for (let position = 0; position < 4; position++)
      await seedSyntheticSealedMedia(db, {
        tenantId: id(1),
        listingId: id(listing),
        revision: 1,
        position,
        mediaId: id(listing * 10 + position),
      });
    await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
    try {
      await db.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
        [id(1), id(10)],
      );
      await db.query('SELECT app_api.submit_revision($1,1,2)', [id(listing)]);
      await db.query("SELECT set_config('realtor.actor_id',$1,true)", [id(13)]);
      await db.query(
        "SELECT app_api.decide_revision($1,1,3,false,'Synthetic successor predecessor')",
        [id(listing)],
      );
      await db.exec('COMMIT');
    } catch (e) {
      await db.exec('ROLLBACK');
      throw e;
    }
  }
  for (const listing of [100, 101, 102, 103]) await seedTerminal(listing);
  const cat = catalogue();
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(cat),
  ]);
  let actor = 10,
    tenant = 1,
    sqlFault = null,
    wireFault = false,
    transactions = 0,
    writes = 0,
    getterReads = 0,
    cancelAfterSql = null;
  const database = {
    async transaction(context, work) {
      transactions++;
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime');
      try {
        await db.query(
          "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
          [context.tenantId, context.actorId],
        );
        const result = await work({
          async query(sql, args) {
            const result = await db.query(sql, args);
            if (sql.includes('start_synthetic_reference_successor')) {
              writes++;
              if (sqlFault === 'write') result.rows[0].receipt.successor.actorId = id(99);
              cancelAfterSql?.abort();
            }
            if (sql.includes('read_synthetic_reference_successor') && sqlFault === 'read')
              Object.defineProperty(result.rows[0].receipt, 'successor', {
                enumerable: true,
                get() {
                  getterReads++;
                  throw Error('PRIVATE getter');
                },
              });
            return result;
          },
        });
        await db.exec('COMMIT');
        return result;
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  const modes = {
    referenceDraftMode: 'synthetic-reference-draft-v1',
    referenceModerationMode: 'synthetic-reference-transition-v1',
    referenceSuccessorMode: 'synthetic-reference-successor-v1',
  };
  const base = () => ({
    tenantId: id(tenant),
    privacyNoticeVersion: 'synthetic',
    database,
    verifyAuthorization: async (r) => {
      if (r.headers.get('authorization') !== 'Bearer synthetic') throw Error('Invalid token');
      return { actorId: id(actor) };
    },
  });
  const service = (enabled = true) =>
    createApiService({
      ...base(),
      ...modes,
      ...(!enabled ? { referenceSuccessorMode: undefined } : {}),
    });
  const calls = [];
  const sdk = () =>
    new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic',
      fetch: async (url, init) => {
        calls.push({ url, init });
        const response = await service()(new Request(url, init));
        if (wireFault && init.method === 'POST' && response.ok) {
          wireFault = false;
          const data = await response.json();
          data.referenceDraft.revisionVersion = '4';
          return Response.json(data);
        }
        return response;
      },
    });
  const opts = { bearerToken: 'synthetic' },
    c = command(),
    route = (x) =>
      `https://synthetic.invalid/v3/staff/listings/${x.listingId}/reference-successor-operations/${x.operationId}`;
  const request = (method = 'POST', input = c, url = route(input), headers = {}, signal) =>
    new Request(url, {
      method,
      headers: {
        authorization: 'Bearer synthetic',
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      ...(method === 'POST' ? { body: JSON.stringify(input) } : {}),
      ...(signal ? { signal } : {}),
    });
  const count = async () =>
    (
      await db.query(
        'SELECT count(*)::integer AS n FROM app_private.synthetic_reference_successor_receipts',
      )
    ).rows[0].n;
  const post = (x = c) => sdk().startSyntheticReferenceSuccessorV3(x, cat, id(10), opts),
    get = () => sdk().getSyntheticReferenceSuccessorReceiptV3(c, cat, id(10), opts);
  await t.test(
    'successor is separately default-off and invalid or orphan startup modes refuse before I/O',
    async () => {
      const before = transactions;
      assert.equal((await service(false)(request())).status, 404);
      assert.equal(transactions, before);
      for (const config of [
        { referenceSuccessorMode: modes.referenceSuccessorMode },
        {
          referenceDraftMode: modes.referenceDraftMode,
          referenceSuccessorMode: modes.referenceSuccessorMode,
        },
        { ...modes, referenceSuccessorMode: 'live' },
      ])
        assert.throws(() => createApiService({ ...base(), ...config }));
    },
  );
  await t.test(
    'canonical route, method, authority headers and exact full body fail closed before a write',
    async () => {
      const before = writes;
      for (const [req, status] of [
        [request('PUT'), 405],
        [request('POST', c, route(c) + '?tenant=2'), 400],
        [request('GET', c, route(c), { 'content-type': 'application/json' }), 400],
        [request('POST', c, route(c), { 'x-tenant-id': id(2) }), 400],
        [request('POST', { ...c, actorId: id(10) }), 400],
        [request('POST', { ...c, listingId: id(999) }, route(c)), 400],
      ])
        assert.equal((await service()(req)).status, status);
      assert.equal(writes, before);
      assert.equal(await count(), 0);
    },
  );
  await t.test(
    'authentication, current write authority, stale predecessors and body bounds leave no successor original',
    async () => {
      assert.equal(
        (await service()(request('POST', c, route(c), { authorization: 'Bearer invalid' }))).status,
        401,
      );
      for (const [user, company, status] of [
        [12, 1, 403],
        [11, 1, 404],
        [10, 2, 404],
      ]) {
        actor = user;
        tenant = company;
        assert.equal((await service()(request())).status, status);
      }
      actor = 10;
      tenant = 1;
      for (const patch of [
        { expectedListingVersion: '2' },
        { predecessor: { ...c.predecessor, version: '3' } },
      ]) {
        assert.equal((await service()(request('POST', { ...c, ...patch }))).status, 409);
      }
      const headers = { authorization: 'Bearer synthetic', 'content-type': 'application/json' };
      assert.equal(
        (
          await service()(
            new Request(route(c), {
              method: 'POST',
              headers,
              body: ' '.repeat(131073) + JSON.stringify(c),
            }),
          )
        ).status,
        413,
      );
      assert.equal(
        (
          await service()(
            new Request(route(c), {
              method: 'POST',
              headers,
              body: JSON.stringify(c).replace('"revision":1', '"revision":1.0'),
            }),
          )
        ).status,
        400,
      );
      assert.equal(await count(), 0);
      assert.equal(
        (await db.query('SELECT count(*)::int AS n FROM app_private.listing_successor_requests'))
          .rows[0].n,
        0,
      );
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::int AS n FROM app_private.listing_revisions WHERE revision_no=2',
          )
        ).rows[0].n,
        0,
      );
    },
  );
  await t.test(
    'untrusted SQL receipt rolls allocation back and cannot create a recoverable original',
    async () => {
      sqlFault = 'write';
      const response = await service()(request());
      assert.equal(response.status, 503);
      sqlFault = null;
      assert.equal(await count(), 0);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM app_private.listing_revisions WHERE revision_no=2',
          )
        ).rows[0].n,
        0,
      );
      assert.equal((await service()(request('GET'))).status, 404);
    },
  );
  let original;
  await t.test(
    'a malformed reply after commit is uncertain; one explicit GET recovers the same original without allocating again',
    async () => {
      wireFault = true;
      const before = writes,
        callBefore = calls.length;
      await assert.rejects(
        () => post(),
        (e) => e.kind === 'INVALID_RESPONSE' && e.submissionUncertain,
      );
      assert.equal(writes, before + 1);
      assert.equal(calls.length, callBefore + 1);
      assert.equal(await count(), 1);
      original = await get();
      assert.equal(original.successor.actorId, id(10));
      assert.equal(original.successor.decision.result.revisionVersion, '2');
      assert.equal(original.referenceDraft.revisionVersion, '3');
      assert.equal(original.referenceDraft.attributes.catalogueVersion, '1');
      assert.equal(writes, before + 1);
      assert.equal(calls.at(-1).init.method, 'GET');
    },
  );
  await t.test(
    'malformed original SQL projections never execute getters or return private details',
    async () => {
      sqlFault = 'read';
      const response = await service()(request('GET'));
      assert.equal(response.status, 503);
      assert.ok(!(await response.text()).includes('PRIVATE'));
      assert.equal(getterReads, 0);
      sqlFault = null;
      assert.deepEqual(await get(), original);
    },
  );
  await t.test(
    'current customer, requester, company, revoked membership and assignment changes deny recovery',
    async () => {
      for (const [user, company, status] of [
        [12, 1, 403],
        [11, 1, 404],
        [10, 2, 404],
      ]) {
        actor = user;
        tenant = company;
        assert.equal((await service()(request('GET'))).status, status);
        assert.equal((await service()(request())).status, status);
      }
      actor = 10;
      tenant = 1;
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      assert.equal((await service()(request('GET'))).status, 403);
      assert.equal((await service()(request())).status, 403);
      await db.query(
        'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      await db.query(
        'UPDATE app_private.listings SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
        [id(11), id(1), c.listingId],
      );
      assert.equal((await service()(request('GET'))).status, 404);
      assert.equal((await service()(request())).status, 404);
      await db.query(
        'UPDATE app_private.listings SET assigned_agent_id=$1 WHERE tenant_id=$2 AND id=$3',
        [id(10), id(1), c.listingId],
      );
      assert.deepEqual(await get(), original);
    },
  );
  await t.test(
    'historical originals survive pointer activation and later edits; new stale successor rolls back',
    async () => {
      const newer = {
        ...catalogue('2'),
        locations: [{ ...cat.locations[0], label: 'Synthetic newer county' }],
      };
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
        JSON.stringify(newer),
      ]);
      assert.deepEqual(await get(), original);
      assert.deepEqual(await post(), original);
      const response = await service()(request('POST', command(101, 1001)));
      assert.equal(response.status, 409);
      assert.equal(await count(), 1);
      await database.transaction({ tenantId: id(1), actorId: id(10) }, (q) =>
        q.query('SELECT app_api.save_synthetic_reference_draft($1,2,3,$2,$3::jsonb,$4::jsonb)', [
          c.listingId,
          id(1010),
          JSON.stringify({
            ...c.content,
            title: 'Synthetic later draft',
            locality: 'Synthetic newer county',
            location: { county: 'Synthetic newer county', town: null, area: null },
          }),
          JSON.stringify({ ...c.selection, catalogueVersion: '2' }),
        ]),
      );
      assert.deepEqual(await get(), original);
      assert.deepEqual(await post(), original);
    },
  );
  await t.test(
    'large valid Unicode composite crosses the dedicated response bound and matches the retained command',
    async () => {
      const largeCat = catalogue('3', true);
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(2,$1::jsonb)', [
        JSON.stringify(largeCat),
      ]);
      const large = command(102, 1002, largeCat, true);
      const out = await sdk().startSyntheticReferenceSuccessorV3(large, largeCat, id(10), opts);
      assert.ok(new TextEncoder().encode(JSON.stringify(out)).byteLength > 131072);
      assert.deepEqual(
        await sdk().getSyntheticReferenceSuccessorReceiptV3(large, largeCat, id(10), opts),
        out,
      );
    },
  );
  await t.test(
    'cancellation after SQL execution is checked before transaction commit and leaves no original',
    async () => {
      const latest = catalogue('3', true),
        fresh = command(103, 1003, latest),
        controller = new AbortController();
      cancelAfterSql = controller;
      const response = await service()(request('POST', fresh, route(fresh), {}, controller.signal));
      cancelAfterSql = null;
      assert.equal(response.status, 400);
      assert.equal(await count(), 2);
      assert.equal(
        (
          await db.query(
            'SELECT count(*)::integer AS n FROM app_private.listing_revisions WHERE listing_id=$1 AND revision_no=2',
            [fresh.listingId],
          )
        ).rows[0].n,
        0,
      );
    },
  );
});
