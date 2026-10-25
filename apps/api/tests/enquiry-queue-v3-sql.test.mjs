import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../../../database/test-helpers/migrations.mjs';
import { createApiService, createLocalEnquiryLimiter } from '../dist/service.js';
import { PostgresTransactionDatabase } from '../dist/database.js';

const id = (number) => `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`;
const TENANT = id(1),
  FOREIGN_TENANT = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  INACTIVE = id(14),
  FOREIGN_ADMIN = id(20),
  FOREIGN_ENQUIRY = id(2000);
const login = 'enquiry_queue_v3_test_login';
const summaryKeys = [
  'id',
  'listingId',
  'contactedRevision',
  'name',
  'origin',
  'status',
  'assignedAgentId',
  'nextActionAt',
  'version',
  'createdAt',
  'updatedAt',
].sort();
const pageKeys = [
  'policy',
  'items',
  'limit',
  'filter',
  'after',
  'hasMore',
  'nextAfter',
  'asOf',
  'timeZone',
].sort();
const openStatuses = new Set(['new', 'assigned', 'contacted', 'qualified']);

async function fixture() {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    const bootstrapUser = (await db.query('SELECT session_user AS name')).rows[0].name;
    assert.equal(typeof bootstrapUser, 'string');
    const bootstrapQuoted = '"' + bootstrapUser.replaceAll('"', '""') + '"';
    await db.query(
      `INSERT INTO app_private.tenants(id,slug,display_name)
       VALUES($1,'queue-v3-a','Synthetic Queue A'),($2,'queue-v3-b','Synthetic Queue B')`,
      [TENANT, FOREIGN_TENANT],
    );
    for (const [tenant, user, role, active] of [
      [TENANT, ADMIN, 'admin', true],
      [TENANT, AGENT, 'agent', true],
      [TENANT, PEER, 'agent', true],
      [TENANT, CUSTOMER, 'customer', true],
      [TENANT, INACTIVE, 'agent', false],
      [FOREIGN_TENANT, FOREIGN_ADMIN, 'admin', true],
    ])
      await db.query(
        `INSERT INTO app_private.memberships(tenant_id,user_id,role,active,revoked_at)
         VALUES($1,$2,$3,$4,CASE WHEN $4 THEN NULL ELSE now() END)`,
        [tenant, user, role, active],
      );
    // Privileged synthetic fixture setup only. Reads below use the normal migrations,
    // restricted login, actual API handler and current RLS membership/assignment rules.
    // All 108 creation instants share one projected millisecond. Rows 19/20 also
    // share the exact microsecond, so both timestamp precision and ID direction matter.
    await db.query(
      `WITH clock AS (
         SELECT date_trunc('milliseconds',statement_timestamp()) AS as_of,
           date_trunc('day',statement_timestamp() AT TIME ZONE 'Africa/Nairobi')
             AT TIME ZONE 'Africa/Nairobi' AS day_start
       ) INSERT INTO app_private.enquiries(
         tenant_id,id,idempotency_key,assigned_agent_id,contact_name,email,message,
         origin,notice_version,status,next_action_at,closure_reason,created_at,updated_at
       ) SELECT $1,('00000000-0000-4000-8000-' || lpad((1000+n)::text,12,'0'))::uuid,
         ('00000000-0000-4000-8000-' || lpad((1000+n)::text,12,'0'))::uuid,
         CASE WHEN n >= 105 OR n % 2 = 0 THEN $2::uuid
           WHEN n=101 THEN $3::uuid ELSE NULL END,
         'Synthetic queue contact ' || n,'queue-' || n || '@example.invalid',
         'PRIVATE SYNTHETIC QUEUE MESSAGE ' || n,'web','synthetic-queue-v3',
         CASE WHEN n IN (100,104) THEN 'contacted' WHEN n=101 THEN 'qualified'
           WHEN n=102 THEN 'closed_lost' WHEN n=103 THEN 'spam'
           WHEN n >= 105 OR n % 2 = 0 THEN 'assigned' ELSE 'new' END,
         CASE WHEN n IN (100,101,102,103,104) THEN clock.as_of - interval '2 days'
           WHEN n=105 THEN clock.day_start
           WHEN n=106 THEN clock.day_start + interval '1 day' - interval '1 millisecond'
           WHEN n=107 THEN clock.day_start + interval '1 day' ELSE NULL END,
         CASE WHEN n IN (102,103) THEN 'Synthetic closed reason' ELSE NULL END,
         timestamptz '2026-01-15 12:00:00.000900+00'
           - (CASE WHEN n=20 THEN 19 ELSE n END) * interval '1 microsecond',
         timestamptz '2026-01-15 12:00:00.000900+00'
       FROM generate_series(0,107) n CROSS JOIN clock`,
      [TENANT, AGENT, PEER],
    );
    await db.query(
      `INSERT INTO app_private.enquiries(
         tenant_id,id,idempotency_key,assigned_agent_id,contact_name,email,message,
         origin,notice_version,status,next_action_at,created_at,updated_at
       ) VALUES($1,$2,$2,$3,'FOREIGN SYNTHETIC CONTACT','foreign@example.invalid',
         'FOREIGN PRIVATE MESSAGE','web','synthetic-queue-v3','contacted',
         now()-interval '3 days',timestamptz '2026-01-16 12:00:00+00',now())`,
      [FOREIGN_TENANT, FOREIGN_ENQUIRY, FOREIGN_ADMIN],
    );
    const precision = (
      await db.query(
        `SELECT count(*)::int AS total,count(DISTINCT created_at)::int AS exact,
         count(DISTINCT date_trunc('milliseconds',created_at))::int AS projected
         FROM app_private.enquiries WHERE tenant_id=$1`,
        [TENANT],
      )
    ).rows[0];
    assert.deepEqual(precision, { total: 108, exact: 107, projected: 1 });
    const expected = (
      await db.query(
        `SELECT id,status,assigned_agent_id AS "assignedAgentId",
         to_char(next_action_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "nextActionAt"
         FROM app_private.enquiries WHERE tenant_id=$1 ORDER BY created_at DESC,id ASC`,
        [TENANT],
      )
    ).rows;
    const initialCounts = (
      await db.query(
        `SELECT (SELECT count(*)::int FROM app_private.enquiries) AS enquiries,
         (SELECT count(*)::int FROM app_private.enquiry_operations) AS operations,
         (SELECT count(*)::int FROM app_private.audit_events) AS audits`,
      )
    ).rows[0];
    await db.exec(
      `CREATE ROLE ${login} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
       GRANT api_runtime TO ${login}; SET SESSION AUTHORIZATION ${login};`,
    );
    // PGlite has one connection. Serialize checkouts instead of claiming a
    // multi-connection PostgreSQL concurrency test.
    let tail = Promise.resolve();
    const statements = [];
    const database = new PostgresTransactionDatabase({
      async connect() {
        let unlock;
        const next = new Promise((resolve) => (unlock = resolve));
        const previous = tail;
        tail = next;
        await previous;
        return {
          query(sql, values) {
            statements.push(sql);
            return db.query(sql, values ? [...values] : []);
          },
          release() {
            unlock();
          },
        };
      },
    });
    await database.checkConnection();
    const subjects = {
      admin: ADMIN,
      agent: AGENT,
      peer: PEER,
      customer: CUSTOMER,
      inactive: INACTIVE,
      foreign: FOREIGN_ADMIN,
    };
    // Synthetic identity callback isolates this service/RLS test from the
    // separately maintained signed-JWT/HTTP verification suites.
    const verifyAuthorization = async (request) => {
      const actorId = subjects[request.headers.get('authorization')?.replace('Bearer ', '')];
      if (!actorId) throw Error('Synthetic identity unavailable');
      return { actorId };
    };
    const options = {
      database,
      privacyNoticeVersion: 'synthetic-queue-v3',
      verifyAuthorization,
      limiter: createLocalEnquiryLimiter({ limit: 100 }),
      clientKey: () => 'synthetic-queue-socket',
    };
    const service = createApiService({ ...options, tenantId: TENANT });
    const other = createApiService({ ...options, tenantId: FOREIGN_TENANT });
    async function maintenance(operation) {
      // Only this test-owned fixture connection temporarily regains bootstrap
      // authority; no API/runtime role acquires DELETE or membership authority.
      await db.exec(`SET SESSION AUTHORIZATION ${bootstrapQuoted}; RESET ROLE;`);
      try {
        return await operation(db);
      } finally {
        await db.exec(`SET SESSION AUTHORIZATION ${login}; RESET ROLE;`);
        await database.checkConnection();
      }
    }
    return { db, database, service, other, expected, initialCounts, statements, maintenance };
  } catch (error) {
    await db.close();
    throw error;
  }
}

function request(query = '', actor = 'admin', extras = {}) {
  return new Request(`https://synthetic.invalid/v3/staff/enquiries${query ? '?' + query : ''}`, {
    headers: actor ? { authorization: `Bearer ${actor}` } : {},
    ...extras,
  });
}
function matches(row, filter, asOf) {
  if (filter === 'all') return true;
  if (!openStatuses.has(row.status)) return false;
  if (filter === 'open') return true;
  if (row.nextActionAt === null) return false;
  const due = Date.parse(row.nextActionAt),
    now = Date.parse(asOf);
  if (filter === 'overdue') return due < now;
  const offset = 3 * 60 * 60 * 1000;
  const nextMidnight = Math.floor((now + offset) / 86400000) * 86400000 + 86400000 - offset;
  return due >= now && due < nextMidnight;
}
function expectedPage(expected, body, actor = ADMIN) {
  const visible = expected.filter((row) => actor === ADMIN || row.assignedAgentId === actor);
  const anchor = body.after === null ? -1 : visible.findIndex((row) => row.id === body.after);
  assert.ok(body.after === null || anchor !== -1, 'expected cursor is visible');
  return visible.slice(anchor + 1).filter((row) => matches(row, body.filter, body.asOf));
}

test('v3 enquiry queue traverses real restricted SQL with precise cursors, complete follow-ups and current visibility', async () => {
  const fixtureValue = await fixture();
  const { db, database, service, other, expected, initialCounts, statements, maintenance } =
    fixtureValue;
  try {
    async function read(query = '', actor = 'admin', handler = service) {
      const before = statements.length,
        started = Date.now();
      const response = await handler(request(query, actor));
      assert.equal(response.status, 200, await response.clone().text());
      assert.match(response.headers.get('cache-control'), /no-store/);
      const body = await response.json();
      const selected = new URLSearchParams(query);
      assert.deepEqual(Object.keys(body).sort(), pageKeys);
      assert.equal(body.policy, 'staff-enquiry-queue-v3');
      assert.equal(body.timeZone, 'Africa/Nairobi');
      assert.equal(body.limit, Number(selected.get('limit') ?? '50'));
      assert.equal(body.filter, selected.get('filter') ?? 'all');
      assert.equal(body.after, selected.get('after'));
      assert.match(body.asOf, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
      assert.equal(new Date(body.asOf).toISOString(), body.asOf);
      assert.ok(
        Date.parse(body.asOf) >= started - 1000 && Date.parse(body.asOf) <= Date.now() + 1000,
      );
      assert.equal(
        statements.slice(before).filter((sql) => /app_private\.enquiries\b/.test(sql)).length,
        1,
        'anchor, visibility, filter and page are one SQL statement',
      );
      assert.ok(body.items.length <= body.limit);
      assert.equal(body.nextAfter, body.hasMore ? body.items.at(-1)?.id : null);
      for (const item of body.items) {
        assert.deepEqual(Object.keys(item).sort(), summaryKeys);
        assert.equal(item.listingId, null);
        assert.equal(item.contactedRevision, null);
        assert.equal(item.version, '1');
      }
      assert.ok(!JSON.stringify(body).includes('PRIVATE MESSAGE'));
      assert.ok(!JSON.stringify(body).includes('PRIVATE SYNTHETIC QUEUE MESSAGE'));
      if (handler === service) {
        const remaining = expectedPage(expected, body, actor === 'agent' ? AGENT : ADMIN);
        assert.deepEqual(
          body.items.map((row) => row.id),
          remaining.slice(0, body.limit).map((row) => row.id),
        );
        assert.equal(body.hasMore, remaining.length > body.limit);
      }
      return body;
    }

    const first = await read();
    assert.equal(first.limit, 50);
    assert.equal(first.filter, 'all');
    assert.equal(first.after, null);
    assert.equal(first.hasMore, true);
    assert.ok(
      !first.items.some((row) => row.id === id(1104)),
      'old overdue record is behind the old 50-row slice',
    );
    const allIds = [];
    let after = null;
    do {
      const page = await read('limit=20&filter=all' + (after ? '&after=' + after : ''));
      assert.equal(page.after, after);
      assert.equal(page.limit, 20);
      assert.equal(page.filter, 'all');
      allIds.push(...page.items.map((row) => row.id));
      if (allIds.length === 20) assert.equal(page.nextAfter, id(1019));
      if (allIds.length === 40)
        assert.equal(page.items[0].id, id(1020), 'exact microsecond tie uses ascending UUID');
      after = page.nextAfter;
    } while (after !== null);
    assert.equal(allIds.length, 108);
    assert.equal(new Set(allIds).size, 108);
    assert.deepEqual(
      allIds,
      expected.map((row) => row.id),
    );
    assert.ok(allIds.includes(id(1104)));
    const empty = await read('limit=1&after=' + allIds.at(-1));
    assert.deepEqual(empty.items, []);
    assert.equal(empty.hasMore, false);
    assert.equal(empty.nextAfter, null);
    const maximum = await read('limit=100');
    assert.equal(maximum.items.length, 100);
    assert.equal(maximum.hasMore, true);

    for (const filter of ['open', 'overdue', 'today']) {
      const page = await read('limit=100&filter=' + filter);
      assert.ok(page.items.every((row) => openStatuses.has(row.status)));
      if (filter === 'overdue') {
        assert.ok(
          page.items.some((row) => row.id === id(1104)),
          'server filter finds old overdue work directly',
        );
        assert.ok(
          !page.items.some((row) => [id(1102), id(1103)].includes(row.id)),
          'closed/spam historical dates excluded',
        );
      }
      if (filter === 'today') {
        const upcoming = expected.find((row) => row.id === id(1106));
        const midnight = expected.find((row) => row.id === id(1107));
        assert.equal(
          page.items.some((row) => row.id === upcoming.id),
          matches(upcoming, filter, page.asOf),
        );
        assert.equal(
          page.items.some((row) => row.id === midnight.id),
          matches(midnight, filter, page.asOf),
        );
      }
    }
    // A cursor locates the visible record, not a record that still satisfies the filter.
    const afterClosed = await read('limit=100&filter=open&after=' + id(1102));
    assert.ok(afterClosed.items.some((row) => row.id === id(1104)));
    const agentPage = await read('limit=100&filter=all', 'agent');
    assert.ok(agentPage.items.every((row) => row.assignedAgentId === AGENT));
    await read('limit=100&filter=overdue', 'agent');
    await read('limit=100&filter=today', 'agent');
    const foreign = await read('filter=overdue', 'foreign', other);
    assert.deepEqual(
      foreign.items.map((row) => row.id),
      [FOREIGN_ENQUIRY],
    );
    assert.ok(!allIds.includes(FOREIGN_ENQUIRY));
    for (const [actor, expectedStatus] of [
      [null, 401],
      ['customer', 403],
      ['inactive', 403],
      ['foreign', 403],
    ])
      assert.equal((await service(request('', actor))).status, expectedStatus, String(actor));
    for (const [cursor, actor] of [
      [id(9999), 'admin'],
      [FOREIGN_ENQUIRY, 'admin'],
      [id(1001), 'agent'],
    ])
      assert.equal(
        (await service(request('after=' + cursor, actor))).status,
        404,
        `${actor}:${cursor}`,
      );

    for (const query of [
      'limit=0',
      'limit=101',
      'limit=01',
      'limit=1.0',
      'limit=1e1',
      'limit=',
      'limit=1&limit=2',
      'filter=',
      'filter=closed',
      'filter=Open',
      'filter=%20open',
      'filter=open&filter=open',
      'after=',
      'after=invalid',
      'after=00000000-0000-4000-8000-00000000ABCD',
      'after=' + id(1000) + '&after=' + id(1001),
      'tenantId=' + FOREIGN_TENANT,
      'offset=50',
      'sort=oldest',
    ])
      assert.equal((await service(request(query))).status, 400, query);
    const wrongMethod = await service(request('', 'admin', { method: 'POST' }));
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');

    const beforeMutation = await maintenance(
      async (connection) =>
        (
          await connection.query(
            `SELECT (SELECT count(*)::int FROM app_private.enquiries) AS enquiries,
         (SELECT count(*)::int FROM app_private.enquiry_operations) AS operations,
         (SELECT count(*)::int FROM app_private.audit_events) AS audits`,
          )
        ).rows[0],
    );
    assert.deepEqual(
      beforeMutation,
      initialCounts,
      'queue reads create no enquiry, receipt or audit writes',
    );
    await maintenance((connection) =>
      connection.query('DELETE FROM app_private.enquiries WHERE tenant_id=$1 AND id=$2', [
        TENANT,
        id(1014),
      ]),
    );
    expected.splice(
      expected.findIndex((row) => row.id === id(1014)),
      1,
    );
    assert.equal(
      (await service(request('after=' + id(1014)))).status,
      404,
      'a previously visible deleted anchor fails closed',
    );
    await read('filter=open&limit=1');
    await maintenance((connection) =>
      connection.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [TENANT, AGENT],
      ),
    );
    assert.equal((await service(request('after=' + id(1000), 'agent'))).status, 403);
    await database.checkConnection();
  } finally {
    await db.close();
  }
});
