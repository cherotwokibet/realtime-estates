import test from 'node:test';
import assert from 'node:assert/strict';
import { createApiService } from '../dist/service.js';
import { LISTING_IMPORT_COLUMNS } from '@realtor/domain';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../../../database/test-helpers/guarded-listing-fixture.mjs';
import { normalizeStaffDraftContentV2 } from '@realtor/domain';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
const T = '00000000-0000-4000-8000-000000000001',
  A = '00000000-0000-4000-8000-000000000010';
const csv = (slug = 'new-stock') =>
  LISTING_IMPORT_COLUMNS.join(',') +
  '\n' +
  [
    slug,
    'Synthetic title',
    '',
    'rent',
    'apartment',
    '20000.05',
    'month',
    '1',
    '1',
    '0',
    'KE',
    'Synthetic locality',
    'area',
  ].join(',');
function fixture({ role = 'admin', receipt = [], error } = {}) {
  const calls = [],
    contexts = [];
  let commits = 0;
  const service = createApiService({
    tenantId: T,
    privacyNoticeVersion: 'synthetic',
    verifyAuthorization: async (r) => {
      if (r.headers.get('authorization') !== 'Bearer synthetic') throw Error('denied');
      return { actorId: A };
    },
    database: {
      async transaction(context, work) {
        contexts.push(context);
        const value = await work({
          async query(sql, args) {
            calls.push({ sql, args });
            if (sql.includes('staff_role')) return { rows: [{ role }] };
            if (error) throw error;
            return { rows: [{ receipt }] };
          },
        });
        commits++;
        return value;
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
const req = ({
  method = 'POST',
  suffix = '',
  headers = {},
  body = JSON.stringify({ csv: csv() }),
} = {}) =>
  new Request('https://synthetic.invalid/v2/staff/listing-import-preview' + suffix, {
    method,
    headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json', ...headers },
    ...(method === 'GET' ? {} : { body }),
  });
test('import preview uses trusted actor/company, bounded typed stock read and exact KES without writes', async () => {
  const f = fixture({ receipt: ['new-stock'] }),
    r = await f.service(req());
  assert.equal(r.status, 200);
  const p = await r.json();
  assert.equal(p.existingStockChecked, true);
  assert.equal(p.invalidRows, 1);
  assert.equal(p.rows[0].issues[0].code, 'EXISTING_SLUG');
  assert.equal(p.rows[0].content, null);
  assert.deepEqual(f.calls.at(-1), {
    sql: 'SELECT app_api.read_listing_import_stock($1::text[]) AS receipt',
    args: [['new-stock']],
  });
  assert.equal(f.contexts[0].tenantId, T);
  assert.equal(f.contexts[0].actorId, A);
  assert.equal(f.commits, 1);
  assert.match(r.headers.get('cache-control'), /no-store/);
  const free = await fixture().service(req());
  assert.equal((await free.json()).rows[0].content.amountMinor, 2000005);
});
test('import preview requires verified identity and current admin on every request', async () => {
  const missing = fixture();
  assert.equal((await missing.service(req({ headers: { authorization: '' } }))).status, 401);
  assert.equal(missing.calls.length, 0);
  for (const role of ['agent', 'customer', null]) {
    const f = fixture({ role });
    assert.equal((await f.service(req())).status, 403);
    assert.equal(f.calls.length, 1);
    assert.equal(f.commits, 0);
  }
});
test('import preview rejects extra context, methods and malformed bounded JSON/CSV', async () => {
  for (const input of [
    { method: 'GET' },
    { suffix: '?x=1' },
    { body: '{"csv":"a","csv":"b"}' },
    { body: JSON.stringify({ csv: csv(), tenantId: T }) },
    { body: JSON.stringify({ csv: 42 }) },
    { body: JSON.stringify({ csv: 'x'.repeat(32769) }) },
    { body: JSON.stringify({ csv: 'bad-header' }) },
    { headers: { 'content-length': '1' } },
    { headers: { 'content-type': 'text/plain' } },
    ...[
      'x-tenant-id',
      'x-actor-id',
      'x-role',
      'cookie',
      'range',
      'if-match',
      'idempotency-key',
      'content-encoding',
      'transfer-encoding',
    ].map((name) => ({ headers: { [name]: '1' } })),
  ]) {
    const f = fixture();
    assert.ok([400, 405, 413, 415].includes((await f.service(req(input))).status));
    assert.ok(f.calls.every((c) => c.sql.includes('staff_role')));
    assert.equal(f.commits, 0);
  }
});
test('invalid slug rows skip SQL but still require admin; duplicate valid candidates are compared once', async () => {
  const f = fixture(),
    r = await f.service(req({ body: JSON.stringify({ csv: csv('UPPER') }) }));
  assert.equal(r.status, 200);
  assert.equal((await r.json()).existingStockChecked, true);
  assert.equal(f.calls.length, 1);
  const repeated = fixture();
  const text = csv() + '\n' + csv().split('\n')[1];
  const p = await (await repeated.service(req({ body: JSON.stringify({ csv: text }) }))).json();
  assert.equal(p.invalidRows, 2);
  assert.deepEqual(repeated.calls.at(-1).args, [['new-stock']]);
});
test('malformed/unrequested stock projection fails before transaction commit without invoking accessors', async () => {
  let invoked = 0;
  const accessor = [];
  Object.defineProperty(accessor, '0', {
    enumerable: true,
    get() {
      invoked++;
      return 'new-stock';
    },
  });
  for (const receipt of [
    null,
    {},
    ['other-company'],
    ['new-stock', 'new-stock'],
    Array(1),
    accessor,
  ]) {
    const f = fixture({ receipt });
    const r = await f.service(req());
    assert.equal(r.status, 503);
    assert.equal(f.commits, 0);
    assert.doesNotMatch(await r.text(), /other-company/);
  }
  assert.equal(invoked, 0);
});
test('import service composes with current restricted SQL and leaves listing/audit history untouched', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await applyTestMigrations(db);
  await db.query(
    "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'synthetic-import-api','Synthetic import API')",
    [T],
  );
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
    [T, A],
  );
  // One sequential PGlite session with actual restricted-role transactions;
  // verifier is a test double, not signed HTTP or hosted multi-session evidence.
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
  await database.transaction({ tenantId: T, actorId: A }, (q) =>
    seedGuardedListingDraft(q, {
      listingId: '00000000-0000-4000-8000-000000000100',
      slug: 'new-stock',
      actorId: A,
      content: normalizeStaffDraftContentV2({
        title: 'Synthetic existing stock',
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      }),
    }),
  );
  const service = createApiService({
    tenantId: T,
    privacyNoticeVersion: 'synthetic',
    verifyAuthorization: async () => ({ actorId: A }),
    database,
  });
  const snapshot = async () =>
    (
      await db.query(
        'SELECT (SELECT count(*) FROM app_private.listings)::text AS listings,(SELECT count(*) FROM app_private.listing_revisions)::text AS revisions,(SELECT count(*) FROM app_private.audit_events)::text AS audits',
      )
    ).rows;
  const before = await snapshot();
  const sdk = new RealtorApiClient({
    baseUrl: 'https://synthetic.invalid',
    privacyNoticeVersion: 'synthetic',
    fetch: async (url, init) => service(new Request(url, init)),
  });
  const checked = await sdk.previewListingImportV2(csv(), { bearerToken: 'synthetic' });
  assert.equal(checked.existingStockChecked, true);
  assert.equal(checked.rows[0].issues[0].code, 'EXISTING_SLUG');
  assert.deepEqual(await snapshot(), before);
  const p = await (await service(req())).json();
  assert.equal(p.existingStockChecked, true);
  assert.equal(p.rows[0].issues[0].code, 'EXISTING_SLUG');
  assert.deepEqual(await snapshot(), before);
  await db.query(
    "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
    [T, A],
  );
  assert.equal((await service(req())).status, 403);
  assert.deepEqual(await snapshot(), before);
  await db.query(
    "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
    [T, A],
  );
  assert.equal((await service(req())).status, 200);
  assert.deepEqual(await snapshot(), before);
});
