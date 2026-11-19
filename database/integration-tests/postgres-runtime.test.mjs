import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { PostgresTransactionDatabase } from '../../apps/api/dist/database.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  OTHER_ADMIN = id(20);
function ownedCiUrl() {
  const raw = process.env.REALTOR_POSTGRES_TEST_URL;
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.REALTOR_POSTGRES_TEST_POLICY !== 'owned-disposable-ci-v1' ||
    !raw
  )
    throw Error('Explicit disposable GitHub CI PostgreSQL required.');
  const u = new URL(raw);
  if (
    u.protocol !== 'postgresql:' ||
    u.hostname !== '127.0.0.1' ||
    u.pathname !== '/realtor_synthetic_ci' ||
    u.username !== 'postgres' ||
    u.password !== 'synthetic-ci-admin-only' ||
    u.port !== '5432' ||
    u.search ||
    u.hash
  )
    throw Error('Disposable CI PostgreSQL target refused.');
  return u;
}
test('real PostgreSQL TCP runtime isolates transactions and serializes concurrent originals', async (t) => {
  const ownerUrl = ownedCiUrl(),
    owner = new pg.Client({ connectionString: ownerUrl.href, connectionTimeoutMillis: 5000 });
  let pool;
  try {
    await owner.connect();
    assert.equal(
      (await owner.query('SELECT current_database() AS name')).rows[0].name,
      'realtor_synthetic_ci',
    );
    const version = (await owner.query('SHOW server_version')).rows[0].server_version;
    assert.match(version, /^17\./);
    t.diagnostic('Real PostgreSQL server version ' + version);
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM pg_namespace WHERE nspname IN ('app_private','app_api','identity')",
        )
      ).rows[0].n,
      0,
      'Refuse a database containing existing application schemas.',
    );
    let migrationsReady = false;
    await t.test(
      'migration bootstrap needs explicit SET and INHERIT authority and works without superuser',
      async () => {
        await owner.query(
          "CREATE ROLE staging_ci_migration LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB CREATEROLE NOREPLICATION PASSWORD 'synthetic-ci-migration-only'; GRANT CREATE ON DATABASE realtor_synthetic_ci TO staging_ci_migration;",
        );
        const migrationUrl = new URL(ownerUrl);
        migrationUrl.username = 'staging_ci_migration';
        migrationUrl.password = 'synthetic-ci-migration-only';
        const migration = new pg.Client({
          connectionString: migrationUrl.href,
          connectionTimeoutMillis: 5000,
        });
        try {
          await migration.connect();
          const attributes = (
            await migration.query(
              'SELECT rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication,rolinherit FROM pg_roles WHERE rolname=current_user',
            )
          ).rows[0];
          assert.deepEqual(attributes, {
            rolsuper: false,
            rolbypassrls: false,
            rolcreatedb: false,
            rolcreaterole: true,
            rolreplication: false,
            rolinherit: false,
          });
          await migration.query("SET createrole_self_grant = ''");
          await assert.rejects(
            applyTestMigrations(
              { exec: (sql) => migration.query(sql) },
              { through: '0001_foundation.sql' },
            ),
            (e) => e.code === '42501',
            'Default non-superuser administration must not silently confer owner SET authority.',
          );
          await migration.query('ROLLBACK');
          assert.equal(
            (
              await owner.query(
                "SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('realtor_owner','api_runtime')",
              )
            ).rows[0].n,
            0,
          );
          // Session-local, migration-only grant policy: no runtime principal is altered.
          await migration.query("SET createrole_self_grant = 'set'");
          await assert.rejects(
            applyTestMigrations(
              { exec: (sql) => migration.query(sql) },
              { through: '0001_foundation.sql' },
            ),
            (e) => e.code === '42501' && e.message === 'permission denied for schema app_private',
            'SET alone cannot grant owner schema privileges before the role switch.',
          );
          await migration.query('ROLLBACK');
          assert.equal(
            (
              await owner.query(
                "SELECT count(*)::int AS n FROM pg_roles WHERE rolname IN ('realtor_owner','api_runtime')",
              )
            ).rows[0].n,
            0,
          );
          await migration.query("SET createrole_self_grant = 'set,inherit'");
          await applyTestMigrations({ exec: (sql) => migration.query(sql) });
          await migration.query(
            await readFile(new URL('../proposals/staff-branches.sql', import.meta.url), 'utf8'),
          );
          assert.equal(
            (await migration.query('SELECT session_user,current_user')).rows[0].current_user,
            'staging_ci_migration',
          );
          assert.equal(
            (
              await owner.query(
                "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='app_private'",
              )
            ).rows[0].owner,
            'realtor_owner',
          );
          await migration.query('RESET createrole_self_grant');
          migrationsReady = true;
        } finally {
          await migration.end();
          // This disposable migration login must not become an application login.
          for (const role of ['realtor_owner', 'api_runtime', 'media_coordinator']) {
            if ((await owner.query('SELECT 1 FROM pg_roles WHERE rolname=$1', [role])).rowCount) {
              await owner.query('REVOKE ' + role + ' FROM staging_ci_migration');
            }
          }
          await owner.query('ALTER ROLE staging_ci_migration NOLOGIN NOCREATEROLE');
        }
      },
    );
    assert.ok(
      migrationsReady,
      'Restricted migration bootstrap failed; do not run runtime cases on a partial schema.',
    );
    await owner.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'ci-first','Synthetic CI first'),($2,'ci-second','Synthetic CI second')",
      [T, OTHER],
    );
    await owner.query(
      "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin'),($3,$4,'admin')",
      [T, ADMIN, OTHER, OTHER_ADMIN],
    );
    await owner.query(
      "CREATE ROLE staging_ci_runtime LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD 'synthetic-ci-runtime-only'; GRANT api_runtime TO staging_ci_runtime;",
    );
    const runtimeUrl = new URL(ownerUrl);
    runtimeUrl.username = 'staging_ci_runtime';
    runtimeUrl.password = 'synthetic-ci-runtime-only';
    pool = new pg.Pool({
      connectionString: runtimeUrl.href,
      max: 2,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 1000,
      statement_timeout: 10000,
      query_timeout: 12000,
    });
    const database = new PostgresTransactionDatabase(pool);
    await database.checkConnection();
    const context = { tenantId: T, actorId: ADMIN, correlationId: 'synthetic-postgres-ci' };
    const save = (q, operation, branch, name = 'Synthetic branch') =>
      q
        .query('SELECT app_api.save_staff_branch($1,$2,$3,$4,$5,$6) AS record', [
          operation,
          branch,
          '0',
          name,
          true,
          'Synthetic concurrency verification.',
        ])
        .then((r) => r.rows[0].record);
    async function concurrent(commands) {
      let arrivals = 0,
        release;
      let timer;
      const ready = new Promise((r, reject) => {
        timer = setTimeout(
          () => reject(Error('Concurrent PostgreSQL rendezvous timed out.')),
          10000,
        );
        release = () => {
          clearTimeout(timer);
          r();
        };
      });
      const pids = [];
      const results = await Promise.all(
        commands.map((command) =>
          database.transaction(context, async (q) => {
            pids.push((await q.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
            if (++arrivals === commands.length) release();
            await ready;
            return command(q);
          }),
        ),
      );
      assert.equal(
        new Set(pids).size,
        2,
        'Concurrent operations must use distinct real backend connections.',
      );
      return results;
    }
    await t.test(
      'same original on two connections commits one operation/audit and returns the same receipt',
      async () => {
        const results = await concurrent([
          (q) => save(q, id(601), id(600)),
          (q) => save(q, id(601), id(600)),
        ]);
        assert.equal(
          (
            await owner.query(
              "SELECT count(*)::int AS n FROM app_private.audit_events WHERE object_id=$1 AND action='staff.branch_saved'",
              [id(600)],
            )
          ).rows[0].n,
          1,
        );
        assert.deepEqual(results[0], results[1]);
        assert.equal(results[0].outcome, 'applied');
        assert.equal(results[0].version, '1');
        assert.equal(
          (
            await owner.query(
              'SELECT count(*)::int AS n FROM app_private.staff_branch_operations WHERE branch_id=$1',
              [id(600)],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test(
      'different originals with one expected version produce one applied and one conflict',
      async () => {
        const results = await concurrent([
          (q) => save(q, id(611), id(610), 'Synthetic branch one'),
          (q) => save(q, id(612), id(610), 'Synthetic branch two'),
        ]);
        assert.deepEqual(results.map((r) => r.outcome).sort(), ['applied', 'conflict']);
        assert.ok(results.every((r) => r.version === '1'));
        assert.equal(
          (
            await owner.query(
              "SELECT count(*)::int AS n FROM app_private.staff_branch_operations WHERE branch_id=$1 AND outcome='applied'",
              [id(610)],
            )
          ).rows[0].n,
          1,
        );
      },
    );
    await t.test('changed facts cannot reuse a committed original', async () => {
      await assert.rejects(
        database.transaction(context, (q) => save(q, id(601), id(600), 'Changed synthetic facts')),
        (e) => e.code === '23505',
      );
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int AS n FROM app_private.staff_branch_operations WHERE operation_id=$1',
            [id(601)],
          )
        ).rows[0].n,
        1,
      );
    });
    await t.test('application failure rolls back the SQL mutation and original', async () => {
      await assert.rejects(
        database.transaction(context, async (q) => {
          await save(q, id(621), id(620));
          throw Error('Synthetic failure before commit.');
        }),
      );
      assert.equal(
        (
          await owner.query(
            'SELECT count(*)::int AS n FROM app_private.staff_branch_operations WHERE operation_id=$1',
            [id(621)],
          )
        ).rows[0].n,
        0,
      );
    });
    await t.test(
      'current company/actor and membership revocation deny recovery without exposing an original',
      async () => {
        await assert.rejects(
          database.transaction({ ...context, actorId: OTHER_ADMIN }, (q) =>
            q.query('SELECT app_api.read_staff_branch_operation($1)', [id(601)]),
          ),
          (e) => e.code === '42501',
        );
        await owner.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
          [T, ADMIN],
        );
        await assert.rejects(
          database.transaction(context, (q) =>
            q.query('SELECT app_api.read_staff_branch_operation($1)', [id(601)]),
          ),
          (e) => e.code === '42501',
        );
        await owner.query(
          'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
          [T, ADMIN],
        );
        const result = await database.transaction(context, (q) =>
          q.query('SELECT app_api.read_staff_branch_operation($1) AS record', [id(601)]),
        );
        assert.equal(result.rows[0].record.operationId, id(601));
      },
    );
    await t.test(
      'pooled connections clear transaction role/context after successful and failed requests',
      async () => {
        const client = await pool.connect();
        try {
          const r = (
            await client.query(
              "SELECT current_user,session_user,current_setting('realtor.tenant_id',true) AS tenant,current_setting('realtor.actor_id',true) AS actor",
            )
          ).rows[0];
          assert.equal(r.current_user, 'staging_ci_runtime');
          assert.equal(r.session_user, 'staging_ci_runtime');
          assert.ok(!r.tenant);
          assert.ok(!r.actor);
          await assert.rejects(
            client.query('SELECT * FROM app_private.staff_branch_operations'),
            (e) => e.code === '42501',
          );
        } finally {
          client.release();
        }
      },
    );
  } finally {
    await pool?.end();
    await owner.end();
  }
});
