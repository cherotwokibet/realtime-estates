import { Pool, type PoolConfig } from 'pg';
export type HostedDatabaseConfig =
  | Readonly<{ kind: 'tls-url'; connectionString: string }>
  | Readonly<{
      kind: 'cloud-sql-iam';
      projectId: string;
      instanceConnectionName: string;
      database: string;
      serviceAccount: string;
      user: string;
      ipType: 'PUBLIC' | 'PRIVATE';
    }>;
type Environment = Readonly<Record<string, string | undefined>>;
/** Exactly one explicit transport. No pg environment defaults or fallback after connector failure. */
export function readHostedDatabaseEnvironment(
  env: Environment,
  prefix: 'HOSTED_API' | 'BROWSER_IDENTITY',
  projectId?: string,
): HostedDatabaseConfig {
  const url = env[prefix + '_DATABASE_URL'],
    raw = env[prefix + '_CLOUD_SQL_CONFIG'];
  if ((url === undefined) === (raw === undefined))
    throw Error('Exactly one hosted database transport is required.');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw Error('TLS verification must remain enabled.');
  if (url !== undefined) {
    const u = new URL(url);
    if (
      !['postgres:', 'postgresql:'].includes(u.protocol) ||
      !u.username ||
      !u.password ||
      !u.hostname ||
      u.hash ||
      u.searchParams.getAll('sslmode').length !== 1 ||
      u.searchParams.get('sslmode') !== 'verify-full' ||
      [...u.searchParams.keys()].some((k) => k !== 'sslmode')
    )
      throw Error('Dedicated TLS-verified database required.');
    return Object.freeze({ kind: 'tls-url', connectionString: u.href });
  }
  if (
    env.NODE_ENV !== 'production' ||
    env.APP_ENV !== 'staging' ||
    !env.K_SERVICE ||
    env.GOOGLE_APPLICATION_CREDENTIALS !== undefined ||
    Object.entries(env).some(([k, v]) => v !== undefined && k.startsWith('PG'))
  )
    throw Error('Cloud SQL requires the attached staging workload identity.');
  if (
    !projectId ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
    env.GOOGLE_CLOUD_PROJECT !== projectId ||
    raw!.length > 4096
  )
    throw Error('Cloud SQL project must match the application.');
  const c = JSON.parse(raw!);
  if (
    !c ||
    typeof c !== 'object' ||
    Array.isArray(c) ||
    Object.keys(c).sort().join(',') !== 'database,instanceConnectionName,ipType,serviceAccount' ||
    !Object.values(c).every((v) => typeof v === 'string')
  )
    throw Error('Invalid Cloud SQL configuration.');
  const parts = c.instanceConnectionName.split(':');
  if (
    parts.length !== 3 ||
    parts[0] !== projectId ||
    !/^[a-z]+(?:-[a-z0-9]+)+[0-9]$/.test(parts[1]) ||
    !/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(parts[2]) ||
    !/^[a-z][a-z0-9_]{0,62}$/.test(c.database) ||
    !['PUBLIC', 'PRIVATE'].includes(c.ipType)
  )
    throw Error('Invalid Cloud SQL target.');
  const suffix = '@' + projectId + '.iam.gserviceaccount.com';
  if (
    !c.serviceAccount.endsWith(suffix) ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(c.serviceAccount.slice(0, -suffix.length))
  )
    throw Error('Use a dedicated service account from the configured project.');
  const user = c.serviceAccount.slice(0, -'.gserviceaccount.com'.length);
  if (user.length > 63) throw Error('IAM database username is too long.');
  return Object.freeze({
    kind: 'cloud-sql-iam',
    projectId,
    instanceConnectionName: c.instanceConnectionName,
    database: c.database,
    serviceAccount: c.serviceAccount,
    user,
    ipType: c.ipType,
  });
}
export interface HostedPoolClient {
  query(sql: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  release(destroy?: boolean): void;
}
interface ManagedDriverPool {
  connect(): Promise<HostedPoolClient>;
  end(): Promise<void>;
  on(event: 'error', handler: () => void): unknown;
}
interface ConnectorAdapter {
  getOptions(input: {
    instanceConnectionName: string;
    ipType: 'PUBLIC' | 'PRIVATE';
    authType: 'IAM';
  }): Promise<{ stream: NonNullable<PoolConfig['stream']> }>;
  close(): void;
}
interface Dependencies {
  connector?: () => Promise<ConnectorAdapter>;
  pool?: (options: PoolConfig) => ManagedDriverPool;
}
/** Lazy and single-flight. Constructing a page/runtime never contacts Google or opens a database. */
export function createHostedPool(
  config: HostedDatabaseConfig,
  max: number,
  dependencies: Dependencies = {},
) {
  if (!Number.isInteger(max) || max < 1 || max > 5) throw Error('Invalid hosted pool bound.');
  let closed = false,
    pending: Promise<{ pool: ManagedDriverPool; connector?: ConnectorAdapter }> | undefined,
    ending: Promise<void> | undefined;
  async function initialize() {
    let connector: ConnectorAdapter | undefined, pool: ManagedDriverPool | undefined;
    try {
      const common: PoolConfig = {
        max,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30000,
        statement_timeout: 5000,
        query_timeout: 5000,
      };
      let options: PoolConfig;
      if (config.kind === 'tls-url')
        options = { ...common, connectionString: config.connectionString };
      else {
        connector = await (
          dependencies.connector ??
          (async () => {
            const { Connector, AuthTypes, IpAddressTypes } =
              await import('@google-cloud/cloud-sql-connector');
            const sdk = new Connector();
            return {
              getOptions: (input) =>
                sdk.getOptions({
                  instanceConnectionName: input.instanceConnectionName,
                  authType: AuthTypes.IAM,
                  ipType:
                    input.ipType === 'PUBLIC' ? IpAddressTypes.PUBLIC : IpAddressTypes.PRIVATE,
                }),
              close: () => sdk.close(),
            };
          })
        )();
        if (closed) throw Error('Hosted pool closed.');
        const result = await connector.getOptions({
          instanceConnectionName: config.instanceConnectionName,
          ipType: config.ipType,
          authType: 'IAM',
        });
        if (!result || typeof result.stream !== 'function')
          throw Error('Invalid connector stream.');
        options = {
          ...common,
          stream: result.stream,
          user: config.user,
          database: config.database,
        };
      }
      if (closed) throw Error('Hosted pool closed.');
      pool = (dependencies.pool ?? ((opts) => new Pool(opts) as unknown as ManagedDriverPool))(
        options,
      );
      pool.on('error', () => {
        /* Never log credential-bearing background diagnostics. */
      });
      return { pool, connector };
    } catch {
      try {
        await pool?.end();
      } catch {}
      try {
        connector?.close();
      } catch {}
      throw Error('Hosted database is unavailable.');
    }
  }
  function get() {
    if (closed) throw Error('Hosted pool closed.');
    if (!pending)
      pending = initialize().catch((e) => {
        pending = undefined;
        throw e;
      });
    return pending;
  }
  return Object.freeze({
    async connect(): Promise<HostedPoolClient> {
      const state = await get();
      if (closed) throw Error('Hosted pool closed.');
      let client: HostedPoolClient;
      try {
        client = await state.pool.connect();
      } catch {
        throw Error('Hosted database is unavailable.');
      }
      if (closed) {
        client.release(true);
        throw Error('Hosted pool closed.');
      }
      return client;
    },
    end(): Promise<void> {
      if (ending) return ending;
      closed = true;
      ending = (async () => {
        if (!pending) return;
        let state;
        try {
          state = await pending;
        } catch {
          return;
        }
        try {
          await state.pool.end();
        } finally {
          state.connector?.close();
        }
      })();
      return ending;
    },
  });
}
