import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createApiService } from '../dist/service.js';
import {
  normalizeStaffDraftContentV2,
  validateSyntheticReferenceDraftReceipt,
} from '@realtor/domain';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const catalogue = {
  policy: 'synthetic-reference-catalogue-v1',
  version: '1',
  country: 'KE',
  locations: [],
  amenities: [],
};
const command = (operation = 300, version = '2') => ({
  policy: 'synthetic-reference-draft-v1',
  operationId: id(operation),
  listingId: id(100),
  revision: 1,
  expectedVersion: version,
  content: normalizeStaffDraftContentV2({
    title: 'Synthetic API draft',
    location: { county: null, town: null, area: null },
    pricing: { declaration: 'not_declared', charges: [] },
  }),
  selection: {
    catalogueVersion: '1',
    location: { countyId: null, localityId: null, neighbourhoodId: null },
    amenityIds: [],
  },
});
const path = (operation) =>
  `/v3/staff/listings/${id(100)}/reference-draft-operations/${id(operation)}`;
const request = (
  method = 'POST',
  route = path(300),
  body = JSON.stringify(command()),
  headers = {},
) =>
  new Request('https://synthetic.invalid' + route, {
    method,
    headers: {
      authorization: 'Bearer synthetic',
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(method === 'POST' ? { body } : {}),
  });
test('opt-in reference API uses restricted transactions and original catalogue recovery', async (t) => {
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
  for (const tenant of [1, 2]) {
    await db.query('INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,$2,$2)', [
      id(tenant),
      'synthetic-reference-api-' + tenant,
    ]);
    for (const [user, role] of [
      [10, 'agent'],
      [11, 'agent'],
      [12, 'customer'],
      [13, 'admin'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [id(tenant), id(user), role],
      );
  }
  await db.query('SELECT app_private.install_synthetic_reference_catalogue(0,$1::jsonb)', [
    JSON.stringify(catalogue),
  ]);
  let corrupt = false,
    badOriginal = false,
    getterReads = 0,
    writes = 0,
    commits = 0,
    actor = 10,
    tenant = 1;
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
            if (sql.includes('save_synthetic_reference_draft')) writes++;
            const value = await db.query(sql, args);
            if (corrupt && sql.includes('save_synthetic_reference_draft'))
              value.rows[0].receipt.actorId = id(99);
            if (badOriginal && sql.includes('read_synthetic_reference_draft_context'))
              Object.defineProperty(value.rows[0].original, 'command', {
                enumerable: true,
                get() {
                  getterReads++;
                  return command();
                },
              });
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
  await database.transaction({ tenantId: id(1), actorId: id(10) }, (q) =>
    seedGuardedListingDraft(q, {
      listingId: id(100),
      slug: 'synthetic-reference-api-stock',
      actorId: id(10),
      content: command().content,
    }),
  );
  const service = (enabled = true) =>
    createApiService({
      tenantId: id(tenant),
      privacyNoticeVersion: 'synthetic',
      ...(enabled ? { referenceDraftMode: 'synthetic-reference-draft-v1' } : {}),
      database,
      verifyAuthorization: async (r) => {
        if (r.headers.get('authorization') !== 'Bearer synthetic')
          throw Error('Invalid synthetic token');
        return { actorId: id(actor) };
      },
    });
  let original;
  await t.test(
    'default mode is404 with no database access; invalid configuration refuses',
    async () => {
      const before = commits;
      assert.equal((await service(false)(request())).status, 404);
      assert.equal(commits, before);
      assert.throws(() =>
        createApiService({
          referenceDraftMode: 'live',
          tenantId: id(1),
          privacyNoticeVersion: 'synthetic',
          database,
          verifyAuthorization: async () => ({ actorId: id(10) }),
        }),
      );
    },
  );
  await t.test(
    'one save and exact replay/original GET return independently bound receipt',
    async () => {
      const first = await service()(request());
      assert.equal(first.status, 200);
      assert.match(first.headers.get('cache-control'), /no-store/);
      original = await first.json();
      assert.deepEqual(
        validateSyntheticReferenceDraftReceipt(original, command(), catalogue, id(10)),
        original,
      );
      assert.deepEqual(await (await service()(request())).json(), original);
      assert.deepEqual(await (await service()(request('GET'))).json(), original);
      assert.equal(
        (await db.query('SELECT version FROM app_private.listing_revisions')).rows[0].version,
        3,
      );
      assert.equal(
        (await service()(request('GET', '/v3/staff/reference-catalogues/current'))).status,
        200,
      );
    },
  );
  await t.test(
    'wire duplicates, decimal revision, aliases, actor injection and framing refuse before mutation',
    async () => {
      const bad = [
        JSON.stringify({ ...command(), actorId: id(10) }),
        JSON.stringify(command()).replace('"revision":1', '"revision":1.0'),
        JSON.stringify(command()).replace('"revision":1', '"revision":1,"revision":1'),
        JSON.stringify(command()).replace('"expectedVersion":"2"', '"expectedVersion":2'),
      ];
      const before = writes;
      for (const body of bad)
        assert.equal((await service()(request('POST', path(300), body))).status, 400);
      for (const headers of [
        { 'x-tenant-id': id(2) },
        { 'content-encoding': 'gzip' },
        { 'content-length': '1' },
        { cookie: 'synthetic=1' },
      ])
        assert.equal(
          (await service()(request('POST', path(300), JSON.stringify(command()), headers))).status,
          400,
        );
      assert.equal((await service()(request('GET', path(300) + '?tenant=' + id(2)))).status, 400);
      assert.equal(writes, before);
    },
  );
  await t.test(
    'current role, assignment, tenant and original actor are rechecked for reads and writes',
    async () => {
      actor = 11;
      assert.equal((await service()(request('GET'))).status, 404);
      actor = 12;
      assert.equal((await service()(request('GET'))).status, 403);
      actor = 13;
      assert.equal((await service()(request('GET'))).status, 404);
      actor = 10;
      tenant = 2;
      assert.equal((await service()(request('GET'))).status, 404);
      tenant = 1;
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
      assert.equal((await service()(request('GET'))).status, 403);
      await db.query(
        'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
        [id(1), id(10)],
      );
    },
  );
  await t.test(
    'original recovery/replay survives new catalogue; stale new save conflicts',
    async () => {
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(1,$1::jsonb)', [
        JSON.stringify({ ...catalogue, version: '2' }),
      ]);
      assert.equal(
        (await (await service()(request('GET', '/v3/staff/reference-catalogues/current'))).json())
          .version,
        '2',
      );
      assert.deepEqual(await (await service()(request('GET'))).json(), original);
      assert.deepEqual(await (await service()(request())).json(), original);
      assert.equal(
        (await service()(request('POST', path(301), JSON.stringify(command(301, '3'))))).status,
        409,
      );
    },
  );
  await t.test(
    'malformed saved projection rejects before transaction commit and leaves no revision or receipt',
    async () => {
      const c = command(302, '3');
      c.selection.catalogueVersion = '2';
      corrupt = true;
      const before = commits;
      assert.equal((await service()(request('POST', path(302), JSON.stringify(c)))).status, 503);
      assert.equal(commits, before);
      corrupt = false;
      assert.equal(
        (await db.query('SELECT version FROM app_private.listing_revisions')).rows[0].version,
        3,
      );
      assert.equal((await service()(request('GET', path(302)))).status, 404);
      badOriginal = true;
      assert.equal((await service()(request('GET'))).status, 503);
      assert.equal(getterReads, 0);
      badOriginal = false;
    },
  );
  await t.test('bounded empty frame stream rejects without storing a command', async () => {
    let cancelled = false;
    const body = new ReadableStream({
      pull(c) {
        c.enqueue(new Uint8Array());
      },
      cancel() {
        cancelled = true;
      },
    });
    const req = new Request('https://synthetic.invalid' + path(303), {
      method: 'POST',
      headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' },
      body,
      duplex: 'half',
    });
    assert.equal((await service()(req)).status, 400);
    assert.equal(cancelled, true);
  });
  await t.test(
    'stalled and oversized streams finish despite uncooperative cancellation',
    async () => {
      for (const oversized of [false, true]) {
        let cancelled = false;
        const body = new ReadableStream({
          start(c) {
            if (oversized) c.enqueue(new Uint8Array(131073));
          },
          cancel() {
            cancelled = true;
            return new Promise(() => {});
          },
        });
        const req = new Request('https://synthetic.invalid' + path(304), {
          method: 'POST',
          headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' },
          body,
          duplex: 'half',
        });
        assert.equal((await service()(req)).status, oversized ? 413 : 408);
        assert.equal(cancelled, true);
      }
    },
  );
  await t.test(
    'legitimate catalogue over1MiB is validated and served within separate6MiB catalogue bound',
    async () => {
      const large = {
        ...catalogue,
        version: '3',
        locations: Array.from({ length: 1800 }, (_, n) => ({
          id: id(1000 + n),
          kind: 'county',
          parentId: null,
          label: '🙂'.repeat(160),
        })),
      };
      await db.query('SELECT app_private.install_synthetic_reference_catalogue(2,$1::jsonb)', [
        JSON.stringify(large),
      ]);
      const reply = await service()(request('GET', '/v3/staff/reference-catalogues/current'));
      assert.equal(reply.status, 200);
      const body = await reply.text(),
        bytes = new TextEncoder().encode(body).byteLength;
      assert.ok(bytes > 1024 * 1024 && bytes < 6 * 1024 * 1024);
      assert.equal(JSON.parse(body).locations.length, 1800);
    },
  );
});
