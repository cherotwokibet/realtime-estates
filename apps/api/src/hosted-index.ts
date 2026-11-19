import { createHostedPostgresDatabase } from './hosted-database-runtime.js';
import { readHostedApiEnvironment, createHostedApiHandler } from './hosted-api.js';
import { createHostedApiServer } from './hosted-http.js';
async function main() {
  const settings = readHostedApiEnvironment(process.env);
  if (!process.env.K_SERVICE) throw Error('Controlled Cloud Run staging runtime required.');
  // No schema setup, preview data or owner login fallback: the existing adapter attests every connection.
  const database = await createHostedPostgresDatabase(settings.databaseConfig);
  const server = createHostedApiServer(
    settings.config.applicationOrigin,
    createHostedApiHandler(settings.config, database),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(settings.port, '0.0.0.0', () => resolve());
    });
  } catch (e) {
    await database.close();
    throw e;
  }
  let closing = false;
  const close = () => {
    if (closing) return;
    closing = true;
    const forced = setTimeout(() => server.closeAllConnections(), 8000);
    forced.unref();
    server.close(() => {
      clearTimeout(forced);
      void database.close().catch(() => {});
    });
  };
  process.once('SIGTERM', close);
  process.once('SIGINT', close);
}
void main().catch(() => {
  console.error('Staging API startup failed.');
  process.exitCode = 1;
});
