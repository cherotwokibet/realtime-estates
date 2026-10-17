import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
test('duplicate SDK composes with restricted current SQL and preserves history through demotion and restoration', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'synthetic-duplicate-api','Synthetic duplicate API')",
    [id(8)],
  );
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [id(8), id(9)],
  );
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
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      }
    },
  };
  for (const n of [100, 101, 102])
    await database.transaction({ tenantId: id(8), actorId: id(9) }, (q) =>
      seedGuardedListingDraft(q, {
        listingId: id(n),
        actorId: id(9),
        slug: `synthetic-duplicate-${n}`,
        content: normalizeStaffDraftContentV2({
          title: 'Synthetic matching apartment',
          purpose: 'rent',
          propertyType: 'apartment',
          locality: 'Synthetic Nairobi',
          pricing: { declaration: 'not_declared', charges: [] },
          location: { county: null, town: null, area: null },
        }),
      }),
    );
  const service = createApiService({
    tenantId: id(8),
    privacyNoticeVersion: 'synthetic',
    verifyAuthorization: async () => ({ actorId: id(9) }),
    database,
  });
  const sdk = new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic',
    fetch: async (url, init) => service(new Request(url, init)),
  });
  const snapshot = async () =>
    (
      await db.query(
        'SELECT (SELECT count(*) FROM app_private.listings)::text AS listings,(SELECT count(*) FROM app_private.listing_revisions)::text AS revisions,(SELECT count(*) FROM app_private.audit_events)::text AS audits',
      )
    ).rows;
  const before = await snapshot();
  const input = {
      listingId: id(100),
      listingVersion: '1',
      revision: 1,
      revisionVersion: '2',
      limit: 1,
    },
    options = { bearerToken: 'synthetic' };
  const found = await sdk.getListingDuplicateCandidatesV2(input, options);
  assert.equal(found.matches[0].listingId, id(101));
  assert.equal(found.hasMore, true);
  await assert.rejects(
    () => sdk.getListingDuplicateCandidatesV2({ ...input, revisionVersion: '1' }, options),
    (e) => e.status === 409,
  );
  await db.query(
    "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
    [id(8), id(9)],
  );
  await assert.rejects(
    () => sdk.getListingDuplicateCandidatesV2(input, options),
    (e) => e.status === 403,
  );
  await db.query(
    "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
    [id(8), id(9)],
  );
  assert.deepEqual(await sdk.getListingDuplicateCandidatesV2(input, options), found);
  assert.deepEqual(await snapshot(), before);
});
const lookup = {
  listingId: id(1),
  listingVersion: '2',
  revision: 3,
  revisionVersion: '4',
  limit: 2,
};
const target = { listingId: id(1), listingVersion: '2', revision: 3, revisionVersion: '4' };
const projection = () => ({
  kind: 'listing_duplicate_candidates',
  policy: 'exact-current-work-v1',
  target,
  comparison: 'compared',
  matches: [],
  hasMore: false,
});
const path = `/v2/staff/listings/${id(1)}/duplicate-candidates`;
const query = '?listingVersion=2&revision=3&revisionVersion=4&limit=2';
const request = (suffix = query, headers = {}, method = 'GET') =>
  new Request('https://synthetic.invalid' + path + suffix, {
    method,
    headers: { authorization: 'Bearer synthetic', ...headers },
  });
function fixture({ role = 'admin', data = projection(), error } = {}) {
  const calls = [],
    contexts = [];
  let commits = 0;
  const service = createApiService({
    tenantId: id(8),
    privacyNoticeVersion: 'synthetic',
    verifyAuthorization: async (r) => {
      if (r.headers.get('authorization') !== 'Bearer synthetic') throw Error();
      return { actorId: id(9) };
    },
    database: {
      async transaction(context, work) {
        contexts.push(context);
        const result = await work({
          async query(sql, args) {
            calls.push({ sql, args });
            if (sql.includes('staff_role')) return { rows: [{ role }] };
            if (error) throw error;
            return { rows: [{ receipt: data }] };
          },
        });
        commits++;
        return result;
      },
    },
  });
  return {
    service,
    calls,
    contexts,
    get commits() {
      return commits;
    },
  };
}
test('duplicate API uses exact typed lookup and trusted context, validates before commit', async () => {
  const f = fixture(),
    response = await f.service(request());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), projection());
  assert.deepEqual(f.calls.at(-1), {
    sql: 'SELECT app_api.read_listing_duplicate_candidates($1::uuid,$2::bigint,$3::integer,$4::bigint,$5::integer) AS receipt',
    args: [lookup.listingId, '2', 3, '4', 2],
  });
  assert.equal(f.contexts[0].tenantId, id(8));
  assert.equal(f.contexts[0].actorId, id(9));
  assert.equal(f.commits, 1);
  assert.match(response.headers.get('cache-control'), /no-store/);
});
test('duplicate API denies missing identity and current nonadmin before SQL projection', async () => {
  const f = fixture();
  assert.equal((await f.service(request(query, { authorization: '' }))).status, 401);
  assert.equal(f.calls.length, 0);
  for (const role of ['agent', null]) {
    const denied = fixture({ role });
    assert.equal((await denied.service(request())).status, 403);
    assert.equal(denied.calls.length, 1);
    assert.equal(denied.commits, 0);
  }
});
test('duplicate API rejects query ambiguity, caller context, unsafe currency and unsupported methods', async () => {
  for (const suffix of [
    '',
    query + '&limit=2',
    query + '#fragment',
    query.replace('revision=3', 'revision=03'),
    query.replace('limit=2', 'limit=26'),
    query.replace('listingVersion=2', 'listingVersion=9007199254740992'),
    query.replace('limit=2', 'limit=%32'),
    query + '&actorId=' + id(8),
  ]) {
    const f = fixture();
    assert.equal((await f.service(request(suffix))).status, 400);
    assert.equal(f.calls.length, 0);
  }
  for (const name of [
    'cookie',
    'content-length',
    'content-type',
    'x-tenant-id',
    'x-actor-id',
    'idempotency-key',
    'if-match',
    'x-revision-version',
  ]) {
    const f = fixture();
    assert.equal((await f.service(request(query, { [name]: '0' }))).status, 400);
    assert.equal(f.calls.length, 0);
  }
  assert.equal((await fixture().service(request(query, {}, 'POST'))).status, 405);
});
test('duplicate API rejects mismatched/private projections without committing and maps SQL denials safely', async () => {
  for (const data of [
    { ...projection(), privateAddress: 'secret' },
    { ...projection(), target: { ...target, listingVersion: '3' } },
    { ...projection(), comparison: 'insufficient_facts', hasMore: true },
  ]) {
    const f = fixture({ data });
    const result = await f.service(request());
    assert.equal(result.status, 503);
    assert.equal(f.commits, 0);
    assert.doesNotMatch(await result.text(), /secret|privateAddress/);
  }
  for (const [code, expected] of [
    ['P0002', 404],
    ['40001', 409],
  ])
    assert.equal((await fixture({ error: { code } }).service(request())).status, expected);
});
