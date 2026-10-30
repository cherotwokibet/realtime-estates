import test from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';

// Inventory the installed default schema, rather than only named feature fixtures.
// This is local PostgreSQL-compatible evidence, not a hosted deployment audit.
test('all default application tables and callable routines retain least-privilege authorization fences', async () => {
  const db = new PGlite();
  try {
    await applyTestMigrations(db);
    const tables = (
      await db.query(`SELECT c.relname,c.relrowsecurity,c.relforcerowsecurity,r.rolname AS owner,
    (SELECT count(*)::integer FROM pg_policy p WHERE p.polrelid=c.oid) AS policies
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_roles r ON r.oid=c.relowner
    WHERE n.nspname='app_private' AND c.relkind='r' ORDER BY c.relname`)
    ).rows;
    assert.ok(tables.length >= 30);
    for (const table of tables) {
      assert.equal(table.owner, 'realtor_owner', table.relname);
      assert.equal(table.relrowsecurity, true, table.relname);
      assert.equal(table.relforcerowsecurity, true, table.relname);
      assert.ok(table.policies > 0, table.relname);
    }
    const roles = (
      await db.query(`SELECT rolname,rolsuper,rolbypassrls,rolinherit,rolcanlogin,
    pg_has_role(rolname,'realtor_owner','MEMBER') AS owner_member
    FROM pg_roles WHERE rolname IN ('api_runtime','media_coordinator','media_maintenance') ORDER BY rolname`)
    ).rows;
    assert.equal(roles.length, 3);
    for (const role of roles) {
      for (const flag of ['rolsuper', 'rolbypassrls', 'rolinherit', 'rolcanlogin', 'owner_member'])
        assert.equal(role[flag], false, role.rolname + ':' + flag);
    }
    const writes = (
      await db.query(`SELECT r.rolname,c.relname FROM pg_roles r CROSS JOIN pg_class c
    JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE r.rolname IN ('api_runtime','media_coordinator','media_maintenance') AND n.nspname='app_private' AND c.relkind IN ('r','p')
    AND (has_table_privilege(r.oid,c.oid,'INSERT') OR has_table_privilege(r.oid,c.oid,'UPDATE') OR has_table_privilege(r.oid,c.oid,'DELETE') OR has_table_privilege(r.oid,c.oid,'TRUNCATE') OR has_table_privilege(r.oid,c.oid,'TRIGGER'))`)
    ).rows;
    assert.deepEqual(writes, []);
    const exposed = (
      await db.query(`SELECT n.nspname,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
    LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    WHERE n.nspname IN ('app_private','app_api','app_media') AND a.grantee=0 AND a.privilege_type='EXECUTE'`)
    ).rows;
    assert.deepEqual(exposed, []);
    const definers = (
      await db.query(`SELECT n.nspname,p.proname,p.proconfig,r.rolname AS owner FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_roles r ON r.oid=p.proowner
    WHERE n.nspname IN ('app_private','app_api','app_media') AND p.prosecdef ORDER BY n.nspname,p.proname`)
    ).rows;
    assert.ok(definers.length > 50);
    for (const fn of definers) {
      assert.equal(fn.owner, 'realtor_owner', fn.proname);
      assert.ok(fn.proconfig?.includes('search_path=pg_catalog'), fn.proname);
    }
    const create = (
      await db.query(`SELECT r.rolname,n.nspname FROM pg_roles r CROSS JOIN pg_namespace n
    WHERE r.rolname IN ('api_runtime','media_coordinator','media_maintenance') AND n.nspname IN ('app_private','app_api','app_media') AND has_schema_privilege(r.oid,n.oid,'CREATE')`)
    ).rows;
    assert.deepEqual(create, []);
  } finally {
    await db.close();
  }
});
