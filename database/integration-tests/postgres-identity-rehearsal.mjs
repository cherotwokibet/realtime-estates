import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import pg from 'pg';
import {
  assertSafeIdentityConnection,
  createIdentityDatabase,
} from '../../apps/api/dist/identity-database.js';
import { createPostgresBrowserIdentityStore } from '../../apps/api/dist/browser-identity-store.js';
import { createCustomerOriginals } from '../../apps/api/dist/customer-browser-originals.js';
import { createStaffOriginals } from '../../apps/api/dist/staff-browser-originals.js';

// Called only after the caller's explicit owned disposable CI target checks.
export async function verifyIdentityPostgres(
  t,
  owner,
  ownerUrl,
  database,
  { tenant, actor, otherTenant, id },
) {
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  assert.equal(process.env.REALTOR_POSTGRES_TEST_POLICY, 'owned-disposable-ci-v1');
  const profiles = ['auth', 'customer', 'staff'];
  const clients = new Map(),
    stores = new Map();
  try {
    await t.test(
      'identity proposals install through restricted migration login with a non-login owner',
      async () => {
        await owner.query(`CREATE ROLE staging_ci_identity_owner NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION;
        CREATE ROLE staging_ci_identity_migration LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD 'synthetic-ci-identity-migration-only';
        GRANT CREATE ON DATABASE realtor_synthetic_ci TO staging_ci_identity_owner;
        GRANT staging_ci_identity_owner TO staging_ci_identity_migration WITH INHERIT TRUE;
        GRANT realtor_owner TO staging_ci_identity_migration WITH SET TRUE;`);
        const url = new URL(ownerUrl);
        url.username = 'staging_ci_identity_migration';
        url.password = 'synthetic-ci-identity-migration-only';
        const migration = new pg.Client({
          connectionString: url.href,
          connectionTimeoutMillis: 5000,
        });
        try {
          await migration.connect();
          assert.deepEqual(
            (
              await migration.query(
                'SELECT rolsuper,rolcreaterole,rolcreatedb,rolbypassrls FROM pg_roles WHERE rolname=session_user',
              )
            ).rows[0],
            { rolsuper: false, rolcreaterole: false, rolcreatedb: false, rolbypassrls: false },
          );
          await migration.query('BEGIN; SET LOCAL ROLE staging_ci_identity_owner');
          for (const file of [
            'browser-identity-state.sql',
            'firebase-actor-bindings.sql',
            'customer-browser-originals.sql',
            'staff-browser-originals.sql',
          ]) {
            await migration.query(
              await readFile(new URL('../proposals/' + file, import.meta.url), 'utf8'),
            );
          }
          await migration.query('COMMIT');
          await migration.query(
            await readFile(
              new URL('../proposals/firebase-api-binding-lookup.sql', import.meta.url),
              'utf8',
            ),
          );
          const tables = (
            await owner.query(
              "SELECT pg_get_userbyid(c.relowner) AS owner FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='identity' AND c.relkind='r'",
            )
          ).rows;
          assert.equal(tables.length, 4);
          assert.ok(tables.every((r) => r.owner === 'staging_ci_identity_owner'));
          assert.equal(
            (
              await owner.query(
                "SELECT pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname='identity'",
              )
            ).rows[0].owner,
            'staging_ci_identity_owner',
          );
        } finally {
          await migration.end();
          await owner.query(
            'REVOKE staging_ci_identity_owner,realtor_owner FROM staging_ci_identity_migration; ALTER ROLE staging_ci_identity_migration NOLOGIN;',
          );
        }
        assert.equal(
          (
            await owner.query(
              "SELECT count(*)::int AS n FROM pg_auth_members WHERE member='staging_ci_identity_migration'::regrole",
            )
          ).rows[0].n,
          0,
        );
      },
    );
    // Fail before dependent cases if the preceding subtest could not install its schema.
    assert.equal(
      (await owner.query("SELECT count(*)::int AS n FROM pg_tables WHERE schemaname='identity'"))
        .rows[0].n,
      4,
    );
    for (const profile of profiles) {
      const user = 'staging_ci_identity_' + profile;
      await owner.query(`CREATE ROLE ${user} LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD 'synthetic-ci-browser-only';
        GRANT USAGE ON SCHEMA identity TO ${user};
        GRANT SELECT ON identity.firebase_actor_bindings TO ${user};
        GRANT SELECT,INSERT,UPDATE,DELETE ON identity.browser_state TO ${user};`);
      if (profile !== 'auth')
        await owner.query(
          `GRANT SELECT,INSERT,UPDATE,DELETE ON identity.${profile}_browser_originals TO ${user}`,
        );
      const url = new URL(ownerUrl);
      url.username = user;
      url.password = 'synthetic-ci-browser-only';
      const client = new pg.Client({ connectionString: url.href, connectionTimeoutMillis: 5000 });
      clients.set(profile, client);
      await client.connect();
      // Explicit loopback CI transport injection: this does not verify hosted TLS, ADC or IAM.
      const pool = new pg.Pool({
        connectionString: url.href,
        max: 2,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 1000,
        statement_timeout: 10000,
      });
      stores.set(
        profile,
        createIdentityDatabase({ kind: 'tls-url', connectionString: url.href }, profile, {
          pool: () => pool,
        }),
      );
    }
    await owner.query(
      "INSERT INTO identity.firebase_actor_bindings(project_id,firebase_uid,actor_id) VALUES('realtor-synthetic-staging','synthetic-admin',$1)",
      [actor],
    );
    await t.test(
      'three real login profiles pass exact attestation and deny enrollment, app access and cross-profile reads',
      async () => {
        for (const profile of profiles) {
          const client = clients.get(profile),
            user = 'staging_ci_identity_' + profile;
          await assertSafeIdentityConnection(client, profile, user);
          await assert.rejects(
            assertSafeIdentityConnection(client, profile, 'different-synthetic-user'),
          );
          for (const sql of [
            'UPDATE identity.firebase_actor_bindings SET active=false',
            'SELECT * FROM app_private.tenants',
            'TRUNCATE identity.browser_state',
            'CREATE TABLE identity.unapproved_ci_table(id int)',
            'SET ROLE realtor_owner',
            'SET ROLE api_runtime',
          ]) {
            await assert.rejects(client.query(sql), (e) => e.code === '42501');
          }
          for (const other of ['customer', 'staff'].filter((p) => p !== profile)) {
            await assert.rejects(
              client.query('SELECT * FROM identity.' + other + '_browser_originals'),
              (e) => e.code === '42501',
            );
          }
          assert.equal(
            (await client.query('SELECT active FROM identity.firebase_actor_bindings')).rows[0]
              .active,
            true,
          );
          if (profile !== 'auth')
            await assert.rejects(assertSafeIdentityConnection(client, 'auth', user));
        }
      },
    );
    await t.test(
      'production identity wrapper refuses newly unsafe grants before a payload query',
      async () => {
        const customer = stores.get('customer');
        await owner.query(
          'GRANT SELECT ON identity.staff_browser_originals TO staging_ci_identity_customer',
        );
        try {
          await assert.rejects(
            customer.query('SELECT 7 AS payload', []),
            (e) => e.message === 'Identity database is unavailable.',
          );
        } finally {
          await owner.query(
            'REVOKE SELECT ON identity.staff_browser_originals FROM staging_ci_identity_customer',
          );
        }
        await owner.query('GRANT api_runtime TO staging_ci_identity_customer');
        try {
          await assert.rejects(
            customer.query('SELECT 7 AS payload', []),
            (e) => e.message === 'Identity database is unavailable.',
          );
        } finally {
          await owner.query('REVOKE api_runtime FROM staging_ci_identity_customer');
        }
        assert.equal((await customer.query('SELECT 7 AS payload', [])).rows[0].payload, 7);
      },
    );
    await t.test(
      'encrypted login consume and logout work across real pooled connections and adapters',
      async () => {
        const key = randomBytes(32).toString('hex'),
          db = stores.get('auth');
        const a = createPostgresBrowserIdentityStore(db, key),
          b = createPostgresBrowserIdentityStore(db, key);
        const prefix = 'cd'.repeat(32),
          loginKey = prefix + ':login:' + 'ef'.repeat(32),
          sessionKey = prefix + ':session:' + 'ab'.repeat(32);
        const tx = {
          state: 'synthetic-ci-state',
          verifier: 'synthetic-ci-verifier',
          nonce: 'synthetic-ci-nonce',
          expiresAt: 1000,
        };
        await a.putLogin(loginKey, tx);
        const claimed = await Promise.all([
          a.claimLogin(loginKey, tx.state, 100),
          b.claimLogin(loginKey, tx.state, 100),
        ]);
        assert.equal(claimed.filter(Boolean).length, 1);
        assert.deepEqual(claimed.find(Boolean), tx);
        const session = {
          actorId: actor,
          accessToken: 'synthetic-ci-not-a-valid-token',
          csrf: 'synthetic-ci-csrf',
          expiresAt: 2000,
        };
        assert.equal(await a.completeLogin(loginKey, sessionKey, session, 100), true);
        assert.deepEqual(await b.getSession(sessionKey, 200), session);
        const raw = JSON.stringify(
          (await owner.query('SELECT * FROM identity.browser_state')).rows,
        );
        for (const value of [tx.state, tx.verifier, tx.nonce, session.accessToken, session.csrf])
          assert.equal(raw.includes(value), false);
        await b.cancelLogin(loginKey);
        assert.equal(await a.getSession(sessionKey, 200), null);
      },
    );
    await t.test(
      'customer and staff originals retain encrypted commands with actor/company scope',
      async () => {
        const key = randomBytes(32).toString('hex'),
          scope = { tenantId: tenant, actorId: actor };
        const cases = [
          [
            'customer',
            createCustomerOriginals,
            {
              policy: 'customer-favourite-command-v1',
              operationId: id(9801),
              listingId: id(9800),
              expectedVersion: '0',
              saved: true,
            },
          ],
          [
            'staff',
            createStaffOriginals,
            {
              policy: 'staff-branch-command-v1',
              operationId: id(9901),
              branchId: id(9900),
              expectedVersion: '0',
              name: 'Synthetic identity branch',
              active: true,
              reason: 'Synthetic identity rehearsal.',
            },
          ],
        ];
        for (const [profile, factory, command] of cases) {
          const a = factory(stores.get(profile), key),
            b = factory(stores.get(profile), key);
          assert.equal(await a.reserve(scope, command), true);
          assert.equal(await b.reserve(scope, command), false);
          assert.deepEqual(await b.read(scope), command);
          assert.equal(await b.read({ ...scope, tenantId: otherTenant }), null);
          assert.equal(await b.read({ ...scope, actorId: id(9999) }), null);
          const raw = JSON.stringify(
            (await owner.query('SELECT sealed FROM identity.' + profile + '_browser_originals'))
              .rows,
          );
          assert.equal(raw.includes(command.operationId), false);
          await b.missing(scope, command.operationId);
          assert.equal(await a.retry(scope, command.operationId), true);
          await a.clear(scope, command.operationId);
          assert.equal(await b.read(scope), null);
        }
      },
    );
    await t.test(
      'API security-definer binding lookup remains company scoped and denies direct identity-table access',
      async () => {
        const resolve = (tenantId, uid) =>
          database.transaction(
            { tenantId, actorId: actor, correlationId: 'synthetic-identity-ci' },
            async (q) =>
              (
                await q.query(
                  "SELECT app_api.resolve_firebase_actor('realtor-synthetic-staging',NULL,$1) AS actor",
                  [uid],
                )
              ).rows[0].actor,
          );
        assert.equal(await resolve(tenant, 'synthetic-admin'), actor);
        assert.equal(await resolve(otherTenant, 'synthetic-admin'), null);
        assert.equal(await resolve(tenant, 'missing-synthetic-uid'), null);
        await owner.query(
          "UPDATE identity.firebase_actor_bindings SET active=false WHERE firebase_uid='synthetic-admin'",
        );
        assert.equal(await resolve(tenant, 'synthetic-admin'), null);
        await owner.query(
          "UPDATE identity.firebase_actor_bindings SET active=true WHERE firebase_uid='synthetic-admin'",
        );
        await assert.rejects(
          database.transaction(
            { tenantId: tenant, actorId: actor, correlationId: 'synthetic-identity-denial' },
            (q) => q.query('SELECT * FROM identity.firebase_actor_bindings'),
          ),
          (e) => e.code === '42501',
        );
      },
    );
  } finally {
    await Promise.allSettled([...stores.values()].map((db) => db.close()));
    await Promise.allSettled([...clients.values()].map((client) => client.end()));
  }
}
