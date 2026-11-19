import { PostgresTransactionDatabase, type DatabasePool, type DatabaseRow } from './database.js';
import { createHostedPool, type HostedDatabaseConfig } from './hosted-database.js';
/** The API keeps its original per-transaction role attestation for both transports. */
export async function createHostedPostgresDatabase(config: HostedDatabaseConfig) {
  const pool = createHostedPool(config, 5);
  const adapter: DatabasePool = {
    async connect() {
      const client = await pool.connect();
      return {
        async query<Row extends DatabaseRow = DatabaseRow>(
          sql: string,
          values?: readonly unknown[],
        ) {
          const { rows } = await client.query(sql, values ? [...values] : undefined);
          return { rows: rows as Row[] };
        },
        release: (destroy?: boolean) => client.release(destroy),
      };
    },
    end: () => pool.end(),
  };
  const database = new PostgresTransactionDatabase(adapter);
  try {
    await database.checkConnection();
    return database;
  } catch (e) {
    await database.close();
    throw e;
  }
}
