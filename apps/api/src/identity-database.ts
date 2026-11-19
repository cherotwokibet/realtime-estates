import type { IdentityStateDatabase } from './browser-identity-store.js';
import {
  createHostedPool,
  type HostedDatabaseConfig,
  type HostedPoolClient,
} from './hosted-database.js';
export type IdentityProfile = 'auth' | 'customer' | 'staff';
/** Dedicated login: no inherited/owner/API rights or binding enrollment. Grants are reviewed separately. */
export async function assertSafeIdentityConnection(
  client: Pick<HostedPoolClient, 'query'>,
  profile: IdentityProfile,
  expectedUser?: string,
) {
  if (!['auth', 'customer', 'staff'].includes(profile)) throw Error('Invalid identity profile.');
  const table =
    profile === 'auth'
      ? null
      : 'identity.' + (profile === 'customer' ? 'customer' : 'staff') + '_browser_originals';
  const { rows } = await client.query(
    `SELECT current_user AS "currentUser",session_user AS "sessionUser",
    r.rolsuper AS superuser,r.rolbypassrls AS "bypassRls",r.rolinherit AS "inheritsRoles",r.rolcanlogin AS "canLogin",
    r.rolcreatedb OR r.rolcreaterole OR r.rolreplication AS "canAdminister",
    EXISTS(SELECT 1 FROM pg_roles m WHERE m.rolname<>session_user AND pg_has_role(session_user,m.oid,'MEMBER')) AS "otherRoleMembership",
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('identity','app_private','app_api') AND pg_has_role(session_user,n.nspowner,'MEMBER')) AS "schemaOwner",
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('identity','app_private','app_api') AND pg_has_role(session_user,c.relowner,'MEMBER')) AS "tableOwner",
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('identity','app_private','app_api') AND has_schema_privilege(session_user,n.oid,'CREATE')) AS "canCreate",
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('app_private','app_api') AND has_schema_privilege(session_user,n.oid,'USAGE')) AS "appUsage",
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname='identity' AND has_schema_privilege(session_user,n.oid,'USAGE')) AS "identityUsage",
    has_table_privilege(session_user,'identity.firebase_actor_bindings','SELECT') AS "bindingRead",
    has_table_privilege(session_user,'identity.firebase_actor_bindings','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS "bindingWrite",
    (SELECT bool_and(has_table_privilege(session_user,'identity.browser_state',p)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p) AS "browserAccess",
    has_table_privilege(session_user,'identity.browser_state','TRUNCATE,REFERENCES,TRIGGER') AS "browserExtra",
    ($1::text IS NULL OR (SELECT bool_and(has_table_privilege(session_user,to_regclass($1),p)) FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE']) p)) AS "originalsAccess",
    COALESCE(has_table_privilege(session_user,to_regclass($1),'TRUNCATE,REFERENCES,TRIGGER'),false) AS "originalsExtra",
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='identity' AND c.relkind IN ('r','p','v','m','f') AND c.relname NOT IN ('browser_state','firebase_actor_bindings',COALESCE($2,'')) AND has_table_privilege(session_user,c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) AS "otherIdentityAccess"
    FROM pg_roles r WHERE r.rolname=session_user`,
    [table, table?.split('.')[1] ?? null],
  );
  const f = rows[0];
  if (
    !f ||
    f.currentUser !== f.sessionUser ||
    (expectedUser !== undefined && f.sessionUser !== expectedUser) ||
    [
      'superuser',
      'bypassRls',
      'inheritsRoles',
      'canAdminister',
      'otherRoleMembership',
      'schemaOwner',
      'tableOwner',
      'canCreate',
      'appUsage',
      'bindingWrite',
      'browserExtra',
      'originalsExtra',
      'otherIdentityAccess',
    ].some((k) => f[k] !== false) ||
    ['canLogin', 'identityUsage', 'bindingRead', 'browserAccess', 'originalsAccess'].some(
      (k) => f[k] !== true,
    )
  )
    throw Error('Identity database role is unsafe.');
}
export function createIdentityDatabase(
  config: HostedDatabaseConfig,
  profile: IdentityProfile,
  dependencies: { pool?: () => ReturnType<typeof createHostedPool> } = {},
): IdentityStateDatabase & { close(): Promise<void> } {
  if (!['auth', 'customer', 'staff'].includes(profile)) throw Error('Invalid identity profile.');
  const pool = dependencies.pool?.() ?? createHostedPool(config, 3);
  const expectedUser =
    config.kind === 'cloud-sql-iam'
      ? config.user
      : decodeURIComponent(new URL(config.connectionString).username);
  return Object.freeze({
    async query(sql: string, values: unknown[]) {
      const client = await pool.connect();
      let unsafe = false;
      try {
        await assertSafeIdentityConnection(client, profile, expectedUser);
        return await client.query(sql, values);
      } catch {
        unsafe = true;
        throw Error('Identity database is unavailable.');
      } finally {
        client.release(unsafe);
      }
    },
    close: () => pool.end(),
  });
}
