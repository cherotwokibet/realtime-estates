import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fixture } from '../../../database/tests/public-media-fixtures.mjs';
import { assertSafeIdentityConnection, createIdentityDatabase } from '../dist/identity-database.js';
import { assertSafeRuntimeConnection } from '../dist/database.js';
const login = 'realtor-web@realtor-synthetic-staging.iam';
async function setup(profile = 'customer', extra = '') {
  const db = await fixture();
  for (const name of [
    'browser-identity-state.sql',
    'firebase-actor-bindings.sql',
    'customer-browser-originals.sql',
    'staff-browser-originals.sql',
  ])
    await db.exec(
      await readFile(new URL('../../../database/proposals/' + name, import.meta.url), 'utf8'),
    );
  const table = profile === 'auth' ? null : 'identity.' + profile + '_browser_originals';
  await db.exec(`CREATE ROLE "${login}" LOGIN NOINHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
 GRANT USAGE ON SCHEMA identity TO "${login}";
 GRANT SELECT ON identity.firebase_actor_bindings TO "${login}";
 GRANT SELECT,INSERT,UPDATE,DELETE ON identity.browser_state TO "${login}";
 ${table ? `GRANT SELECT,INSERT,UPDATE,DELETE ON ${table} TO "${login}";` : ''}
 ${extra}`);
  return db;
}
test('dedicated identity login accepts only its exact original-store profile and cannot administer app data or bindings', async () => {
  const db = await setup();
  try {
    await assert.rejects(assertSafeIdentityConnection(db, 'customer', login));
    await db.exec(`SET SESSION AUTHORIZATION "${login}"`);
    await assertSafeIdentityConnection(db, 'customer', login);
    await assert.rejects(assertSafeIdentityConnection(db, 'staff', login));
    await assert.rejects(assertSafeIdentityConnection(db, 'auth', login));
    await assert.rejects(assertSafeIdentityConnection(db, 'customer', 'wrong_login'));
    for (const sql of [
      'SELECT * FROM app_private.memberships',
      'SELECT * FROM identity.staff_browser_originals',
      'UPDATE identity.firebase_actor_bindings SET active=false',
    ])
      await assert.rejects(db.query(sql));
  } finally {
    await db.close();
  }
});
test('staff and auth-only identity logins pass their own least-privilege profiles', async () => {
  for (const profile of ['staff', 'auth']) {
    const db = await setup(profile);
    try {
      await db.exec(`SET SESSION AUTHORIZATION "${login}"`);
      await assertSafeIdentityConnection(db, profile, login);
    } finally {
      await db.close();
    }
  }
});
test('identity attestation rejects inherited/admin roles, enrollment writes, cross-store reads and missing nonce rights', async (t) => {
  const cases = [
    ['inherited access', `ALTER ROLE "${login}" INHERIT;`],
    ['role administration', `ALTER ROLE "${login}" CREATEROLE;`],
    ['database administration', `ALTER ROLE "${login}" CREATEDB;`],
    ['API role membership', `GRANT api_runtime TO "${login}";`],
    ['app API schema access', `GRANT USAGE ON SCHEMA app_api TO "${login}";`],
    ['binding enrollment', `GRANT UPDATE ON identity.firebase_actor_bindings TO "${login}";`],
    ['cross-store read', `GRANT SELECT ON identity.staff_browser_originals TO "${login}";`],
    ['missing nonce mutation', `REVOKE UPDATE ON identity.browser_state FROM "${login}";`],
    ['table ownership', `ALTER TABLE identity.customer_browser_originals OWNER TO "${login}";`],
  ];
  for (const [label, sql] of cases)
    await t.test(label, async () => {
      const db = await setup('customer', sql);
      try {
        await db.exec(`SET SESSION AUTHORIZATION "${login}"`);
        await assert.rejects(assertSafeIdentityConnection(db, 'customer', login));
      } finally {
        await db.close();
      }
    });
});
test('identity query wrapper attests before each query and destroys an unsafe client without executing its payload', async () => {
  const db = await setup();
  let released,
    queries = [],
    ends = 0;
  const pool = {
    async connect() {
      return {
        async query(sql, args) {
          queries.push(sql);
          return db.query(sql, args);
        },
        release(bad) {
          released = bad;
        },
      };
    },
    async end() {
      ends++;
    },
  };
  const config = {
    kind: 'tls-url',
    connectionString:
      'postgres://' +
      encodeURIComponent(login) +
      ':synthetic-secret@db.example/app?sslmode=verify-full',
  };
  const identity = createIdentityDatabase(config, 'customer', { pool: () => pool });
  try {
    await assert.rejects(
      identity.query('SELECT 7 AS payload', []),
      (e) => e.message === 'Identity database is unavailable.',
    );
    assert.equal(released, true);
    assert.equal(queries.length, 1);
    assert.ok(queries[0].startsWith('SELECT current_user'));
    await db.exec(`SET SESSION AUTHORIZATION "${login}"`);
    queries = [];
    assert.equal((await identity.query('SELECT 7 AS payload', [])).rows[0].payload, 7);
    assert.equal(queries.length, 2);
    assert.equal(released, false);
    await identity.close();
    assert.equal(ends, 1);
  } finally {
    await db.close();
  }
});
test('API login role attestation also refuses role/database/replication administration capabilities', async () => {
  for (const capability of ['CREATEROLE', 'CREATEDB', 'REPLICATION']) {
    const db = await fixture();
    try {
      await db.exec(
        `CREATE ROLE synthetic_api_login LOGIN NOINHERIT ${capability};GRANT api_runtime TO synthetic_api_login;SET SESSION AUTHORIZATION synthetic_api_login;`,
      );
      await assert.rejects(assertSafeRuntimeConnection(db));
    } finally {
      await db.close();
    }
  }
});
