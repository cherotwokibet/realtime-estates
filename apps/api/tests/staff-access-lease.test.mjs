import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { PostgresTransactionDatabase } from '../dist/database.js';
import { createApiService } from '../dist/service.js';
import { RealtorApiClient } from '../../../packages/api-client/dist/index.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
test('staff access lease joins current restricted SQL role, verified expiry and SDK; revoked/foreign/customer access is denied', async () => {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    await db.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'lease-a','Lease A'),($2,'lease-b','Lease B')",
      [id(1), id(2)],
    );
    for (const [tenant, actor, role] of [
      [1, 10, 'admin'],
      [1, 11, 'agent'],
      [1, 13, 'customer'],
      [2, 20, 'admin'],
    ])
      await db.query(
        'INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)',
        [id(tenant), id(actor), role],
      );
    await db.exec(
      'CREATE ROLE lease_test_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS; GRANT api_runtime TO lease_test_login; SET SESSION AUTHORIZATION lease_test_login',
    );
    const database = new PostgresTransactionDatabase({
      connect: async () => ({
        query: (sql, args) => db.query(sql, args ? [...args] : []),
        release() {},
      }),
    });
    await database.checkConnection();
    let expiry = Date.now() + 3600000,
      actor = id(10),
      checks = 0;
    const service = createApiService({
      database,
      tenantId: id(1),
      privacyNoticeVersion: 'synthetic-lease-v1',
      verifyAuthorization: async () => {
        checks++;
        return { actorId: actor, expiresAt: expiry, role: 'admin', tenantId: id(2) };
      },
    });
    const request = (path = '/v2/staff/session-lease', extra = {}) =>
      new Request('https://synthetic.invalid' + path, {
        headers: { Authorization: 'Bearer synthetic.actor.signature', ...extra },
      });
    let response = await service(request());
    assert.equal(response.status, 200);
    const first = await response.json();
    assert.equal(checks, 1);
    assert.equal(first.actorId, id(10));
    assert.equal(first.tenantId, id(1));
    assert.equal(first.role, 'admin');
    assert.equal(Date.parse(first.expiresAt) - Date.parse(first.checkedAt), 30000);
    assert.match(response.headers.get('cache-control'), /no-store/);
    const client = new RealtorApiClient({
      baseUrl: 'https://synthetic.invalid',
      privacyNoticeVersion: 'synthetic-lease-v1',
      fetch: (url, init) => service(new Request(url, init)),
    });
    actor = id(11);
    expiry = Date.now() + 5000;
    const short = await client.getCurrentStaffAccessLeaseV2({
      bearerToken: 'synthetic.actor.signature',
    });
    assert.equal(short.role, 'agent');
    assert.equal(Date.parse(short.expiresAt), expiry);
    for (const value of [undefined, NaN, Infinity, Date.now() - 1]) {
      expiry = value;
      assert.equal((await service(request())).status, 401);
    }
    expiry = Date.now() + 60000;
    for (const value of [id(13), id(20)]) {
      actor = value;
      assert.equal((await service(request())).status, 403);
    }
    actor = id(10);
    for (const [path, headers] of [
      ['/v2/staff/session-lease?tenantId=' + id(2), {}],
      ['/v2/staff/session-lease', { 'x-role': 'admin' }],
      ['/v2/staff/session-lease', { cookie: 'private' }],
    ])
      assert.equal((await service(request(path, headers))).status, 400);
    await db.exec('SET SESSION AUTHORIZATION postgres; RESET ROLE');
    await db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',
      [id(1), id(10)],
    );
    await db.exec('SET SESSION AUTHORIZATION lease_test_login');
    assert.equal(
      (await service(request())).status,
      403,
      'current SQL membership is rechecked, not token role claims',
    );
  } finally {
    await db.close();
  }
});
