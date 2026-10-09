import { Pool, type PoolConfig } from "pg";

export type DatabaseRow = Record<string, unknown>;
export interface QueryResult<Row extends DatabaseRow = DatabaseRow> { readonly rows: Row[] }
export interface TransactionQuery {
  query<Row extends DatabaseRow = DatabaseRow>(sql: string, values?: readonly unknown[]): Promise<QueryResult<Row>>;
}
export interface DatabaseContext { readonly tenantId: string; readonly actorId: string | null; readonly correlationId: string }
export interface TransactionDatabase {
  transaction<T>(context: DatabaseContext, operation: (query: TransactionQuery) => Promise<T>): Promise<T>;
}
export interface DatabaseClient extends TransactionQuery { release(destroy?: boolean): void }
export interface DatabasePool { connect(): Promise<DatabaseClient>; end?(): Promise<void> }

export class DatabaseSafetyError extends Error {
  readonly code = "UNSAFE_DATABASE_ROLE";
  constructor() { super("API database connection must use an isolated login with only the api_runtime role."); this.name = "DatabaseSafetyError"; }
}

/** Fail closed before any request context is installed. A migration/admin connection is never an API connection. */
export async function assertSafeRuntimeConnection(client: TransactionQuery): Promise<void> {
  const result = await client.query(`SELECT current_user AS "currentUser",session_user AS "sessionUser",
    r.rolsuper AS "superuser",r.rolbypassrls AS "bypassRls",r.rolinherit AS "inheritsRoles",
    pg_has_role(session_user,'realtor_owner','MEMBER') AS "ownerMember",
    pg_has_role(session_user,'api_runtime','MEMBER') AS "runtimeMember",
    EXISTS(SELECT 1 FROM pg_roles member WHERE member.rolname NOT IN (session_user,'api_runtime')
      AND pg_has_role(session_user,member.oid,'MEMBER')) AS "otherRoleMembership",
    EXISTS(SELECT 1 FROM pg_namespace n WHERE n.nspname IN ('app_private','app_api')
      AND pg_has_role(session_user,n.nspowner,'MEMBER')) AS "schemaOwner",
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname IN ('app_private','app_api') AND pg_has_role(session_user,c.relowner,'MEMBER')) AS "tableOwner",
    has_schema_privilege(session_user,'app_private','CREATE') OR has_schema_privilege(session_user,'app_api','CREATE') AS "canCreateInApp",
    (SELECT rolsuper OR rolbypassrls OR rolcanlogin OR rolinherit FROM pg_roles WHERE rolname='api_runtime') AS "unsafeRuntime",
    pg_has_role('api_runtime','realtor_owner','MEMBER') AS "runtimeOwnsData"
    FROM pg_roles r WHERE r.rolname=session_user`);
  const flags = result.rows[0];
  if (!flags || flags.currentUser !== flags.sessionUser || flags.superuser !== false || flags.bypassRls !== false || flags.inheritsRoles !== false || flags.ownerMember !== false || flags.runtimeMember !== true || flags.otherRoleMembership !== false || flags.schemaOwner !== false || flags.tableOwner !== false || flags.canCreateInApp !== false || flags.unsafeRuntime !== false || flags.runtimeOwnsData !== false) throw new DatabaseSafetyError();
}

export class PostgresTransactionDatabase implements TransactionDatabase {
  constructor(private readonly pool: DatabasePool) {}

  async checkConnection(): Promise<void> {
    const client = await this.pool.connect();
    let unsafe = false;
    try { await assertSafeRuntimeConnection(client); }
    catch (error) { unsafe = true; throw error; }
    finally { client.release(unsafe); }
  }

  async transaction<T>(context: DatabaseContext, operation: (query: TransactionQuery) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let began = false;
    let destroy = false;
    try {
      await assertSafeRuntimeConnection(client);
      await client.query("BEGIN");
      began = true;
      await client.query("SET LOCAL ROLE api_runtime");
      await client.query(`SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),set_config('realtor.correlation_id',$3,true)`, [context.tenantId, context.actorId ?? "", context.correlationId]);
      const result = await operation(client);
      await client.query("COMMIT");
      began = false;
      return result;
    } catch (error) {
      if (!began || error instanceof DatabaseSafetyError) destroy = true;
      if (began) {
        try { await client.query("ROLLBACK"); }
        catch { destroy = true; }
      }
      throw error;
    } finally { client.release(destroy); }
  }

  async close(): Promise<void> { await this.pool.end?.(); }
}

/** PoolConfig is server configuration; never use a client-supplied DSN, role or TLS setting. */
export async function createPostgresDatabase(config: PoolConfig): Promise<PostgresTransactionDatabase> {
  const pool = new Pool({ max: 5, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000, ...config });
  const adapter: DatabasePool = {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row extends DatabaseRow = DatabaseRow>(sql: string, values?: readonly unknown[]) {
          const result = await client.query<Row>(sql, values ? [...values] : undefined);
          return { rows: result.rows };
        },
        release(destroy?: boolean) { client.release(destroy); },
      };
    },
    end: () => pool.end(),
  };
  const database = new PostgresTransactionDatabase(adapter);
  try { await database.checkConnection(); return database; }
  catch (error) { await database.close(); throw error; }
}
