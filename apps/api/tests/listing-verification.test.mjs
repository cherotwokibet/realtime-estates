import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
import { planListingVerification, normalizeStaffDraftContentV2 } from '@realtor/domain';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  now = '2026-10-22T20:00:00.000Z';
const command = (n = 300, version = '0') => ({
  operationId: id(n),
  policy: 'synthetic-check-record-v1',
  target: { listingId: id(100), listingVersion: '1', revision: 1, revisionVersion: '2' },
  expectedVerificationVersion: version,
  subject: 'identity',
  outcome: 'supported',
  evidenceReference: 'synthetic:identity-fixture',
  note: 'Synthetic identity assessment.',
  observedAt: '2026-01-01T00:00:00.000Z',
});
const receipt = () => ({
  kind: 'listing_verification_receipt',
  operationId: id(300),
  listingId: id(100),
  actorId: id(10),
  request: command(),
  decision: {
    outcome: 'recorded',
    reason: null,
    record: planListingVerification(
      command(),
      { target: command().target, verificationVersion: '0', lastRecordedAt: null },
      'admin',
      id(10),
      now,
    ).record,
  },
  completedAt: now,
});
const path = `/v2/staff/listings/${id(100)}/verification-operations/${id(300)}`;
const req = ({
  method = 'POST',
  url = path,
  headers = {},
  body = JSON.stringify(command()),
} = {}) =>
  new Request('https://synthetic.invalid' + url, {
    method,
    headers: {
      authorization: 'Bearer synthetic',
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...headers,
    },
    ...(method === 'POST' ? { body } : {}),
  });
function fixture({ role = 'admin', data = receipt(), enabled = true } = {}) {
  const calls = [],
    contexts = [];
  let commits = 0;
  const service = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic',
    ...(enabled ? { verificationMode: 'synthetic-check-record-v1' } : {}),
    verifyAuthorization: async (r) => {
      if (r.headers.get('authorization') !== 'Bearer synthetic') throw Error();
      return { actorId: id(10) };
    },
    database: {
      async transaction(context, work) {
        contexts.push(context);
        const result = await work({
          async query(sql, args) {
            calls.push({ sql, args });
            if (sql.includes('staff_role')) return { rows: [{ role }] };
            return {
              rows: [
                {
                  receipt: sql.includes('read_listing_verification_history')
                    ? {
                        kind: 'listing_verification_history',
                        beforeVersion: null,
                        listingId: id(100),
                        verificationVersion: '1',
                        records: [receipt().decision.record],
                        hasMore: false,
                      }
                    : data,
                },
              ],
            };
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
test('private verification API is unavailable without explicit synthetic policy and rejects unauthenticated/nonadmin', async () => {
  const off = fixture({ enabled: false });
  assert.equal((await off.service(req())).status, 404);
  assert.equal(off.calls.length, 0);
  const f = fixture();
  assert.equal((await f.service(req({ headers: { authorization: '' } }))).status, 401);
  assert.equal(f.calls.length, 0);
  const denied = fixture({ role: 'agent' });
  assert.equal((await denied.service(req())).status, 403);
  assert.equal(denied.calls.length, 1);
  assert.equal(denied.commits, 0);
});
test('private verification API uses fixed typed command and validates actor/original before commit', async () => {
  const f = fixture(),
    response = await f.service(req());
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), receipt());
  assert.equal(f.contexts[0].tenantId, id(1));
  assert.equal(f.contexts[0].actorId, id(10));
  assert.equal(f.commits, 1);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.deepEqual(f.calls.at(-1).args, [
    id(100),
    id(300),
    '1',
    1,
    '2',
    '0',
    'identity',
    'supported',
    'synthetic:identity-fixture',
    'Synthetic identity assessment.',
    '2026-01-01T00:00:00.000Z',
  ]);
  assert.match(f.calls.at(-1).sql, /app_api\.record_synthetic_listing_verification\(\$1::uuid/);
  const original = fixture();
  assert.equal((await original.service(req({ method: 'GET' }))).status, 200);
  assert.match(original.calls.at(-1).sql, /read_listing_verification\(/);
  const h = fixture();
  const history = await h.service(
    req({ method: 'GET', url: `/v2/staff/listings/${id(100)}/verification-history?limit=20` }),
  );
  assert.equal(history.status, 200);
  assert.equal((await history.json()).records.length, 1);
});
test('private verification API refuses caller authority, query/framing aliases and changed route facts before mutation', async () => {
  const badBodies = [
    JSON.stringify({ ...command(), actorId: id(11) }),
    JSON.stringify({ ...command(), policy: 'live-v1' }),
    JSON.stringify({ ...command(), operationId: id(301) }),
    JSON.stringify(command()).replace('"revision":1', '"revision":1.0'),
    JSON.stringify(command()).replace(
      '"note":"Synthetic identity assessment."',
      '"note":"Synthetic identity assessment.","note":"Changed"',
    ),
  ];
  for (const body of badBodies) {
    const f = fixture();
    assert.equal((await f.service(req({ body }))).status, 400);
    assert.equal(
      f.calls.some((x) => x.sql.includes('record_synthetic_listing_verification')),
      false,
    );
  }
  for (const headers of [
    { cookie: 'a=1' },
    { 'x-tenant-id': id(2) },
    { 'idempotency-key': id(9) },
    { 'if-match': '1' },
    { 'content-length': '0001' },
  ]) {
    const f = fixture();
    assert.equal((await f.service(req({ headers }))).status, 400);
    assert.equal(f.commits, 0);
  }
  for (const url of [
    path + '?',
    path + '?x=1',
    path + '#fragment',
    `/v2/staff/listings/${id(100)}/verification-history?limit=26`,
    `/v2/staff/listings/${id(100)}/verification-history?limit=1&limit=1`,
  ]) {
    const f = fixture();
    assert.equal((await f.service(req({ method: 'GET', url }))).status, 400);
    assert.equal(f.calls.length, 0);
  }
  assert.equal((await fixture().service(req({ method: 'PUT' }))).status, 405);
});
test('private verification malformed or wrong-actor projections fail safely before committing', async () => {
  for (const data of [
    { ...receipt(), actorId: id(11) },
    { ...receipt(), privateAddress: 'SECRET' },
    { ...receipt(), request: { ...command(), note: 'Changed' } },
  ]) {
    const f = fixture({ data });
    const r = await f.service(req());
    assert.equal(r.status, 503);
    assert.equal(f.commits, 0);
    assert.doesNotMatch(await r.text(), /SECRET|Changed/);
  }
});
test('verification SDK/API compose with restricted SQL, stable original recovery, bounded history and current-role restoration', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'synthetic-check-api','Synthetic check API')",
    [id(1)],
  );
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [id(1), id(10)],
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
  await database.transaction({ tenantId: id(1), actorId: id(10) }, (q) =>
    seedGuardedListingDraft(q, {
      listingId: id(100),
      slug: 'synthetic-check-api-stock',
      actorId: id(10),
      content: normalizeStaffDraftContentV2({
        title: 'Synthetic check stock',
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      }),
    }),
  );
  const service = createApiService({
    tenantId: id(1),
    privacyNoticeVersion: 'synthetic',
    verificationMode: 'synthetic-check-record-v1',
    verifyAuthorization: async () => ({ actorId: id(10) }),
    database,
  });
  const sdk = new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic',
      fetch: async (url, init) => service(new Request(url, init)),
    }),
    options = { bearerToken: 'synthetic' };
  const before = (await db.query('SELECT to_jsonb(l) AS listing FROM app_private.listings l')).rows;
  const first = await sdk.recordSyntheticListingVerificationV2(command(), options);
  assert.equal(first.decision.record.verificationVersion, '1');
  assert.deepEqual(await sdk.recordSyntheticListingVerificationV2(command(), options), first);
  const second = command(301, '1');
  await sdk.recordSyntheticListingVerificationV2(second, options);
  assert.deepEqual(await sdk.getListingVerificationReceiptV2(command(), options), first);
  assert.deepEqual(await sdk.getListingVerificationOriginalV2(id(100), id(300), options), first);
  const history = await sdk.getListingVerificationHistoryV2(id(100), 1, options);
  assert.equal(history.verificationVersion, '2');
  assert.equal(history.records.length, 1);
  assert.equal(history.hasMore, true);
  const older = await sdk.getListingVerificationHistoryV2(id(100), 1, options, '2');
  assert.equal(older.beforeVersion, '2');
  assert.equal(older.records[0].verificationVersion, '1');
  assert.equal(older.hasMore, false);
  await db.query(
    "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
    [id(1), id(10)],
  );
  await assert.rejects(
    () => sdk.getListingVerificationReceiptV2(command(), options),
    (e) => e.status === 403,
  );
  await db.query(
    "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
    [id(1), id(10)],
  );
  assert.deepEqual(await sdk.getListingVerificationReceiptV2(command(), options), first);
  assert.deepEqual(
    (await db.query('SELECT to_jsonb(l) AS listing FROM app_private.listings l')).rows,
    before,
  );
  assert.equal(
    (
      await db.query(
        "SELECT count(*)::int AS n FROM app_private.audit_events WHERE action='listing.synthetic_check_recorded'",
      )
    ).rows[0].n,
    2,
  );
});
