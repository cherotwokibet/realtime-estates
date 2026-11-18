import { Pool } from 'pg';
import { createBrowserIdentity, type BrowserIdentityConfig } from './browser-identity.js';
import { createPostgresBrowserIdentityStore } from './browser-identity-store.js';

type Environment = Readonly<Record<string, string | undefined>>;
const names = [
  'issuer',
  'authorizationEndpoint',
  'tokenEndpoint',
  'jwksUrl',
  'clientId',
  'clientSecret',
  'apiAudience',
  'applicationOrigin',
  'tenantId',
] as const;
/** Explicit hosted configuration only. Default-off and independent of disposable preview credentials. */
export function readBrowserIdentityEnvironment(env: Environment): {
  config: BrowserIdentityConfig;
  databaseUrl: string;
  encryptionKey: string;
} | null {
  if (env.BROWSER_IDENTITY_CONFIG === undefined) return null;
  if (
    !['staging', 'production'].includes(env.APP_ENV ?? '') ||
    Object.entries(env).some(
      ([name, value]) =>
        value !== undefined &&
        (name === 'WEB_CUSTOMER_PREVIEW_CONFIG' || name.startsWith('STAFF_PREVIEW_')),
    )
  )
    throw Error('Hosted identity requires an explicit isolated deployment.');
  const raw = env.BROWSER_IDENTITY_CONFIG;
  if (raw.length > 16384) throw Error('Invalid hosted identity configuration.');
  const parsed = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    Object.keys(parsed).length !== names.length ||
    names.some((name) => typeof parsed[name] !== 'string') ||
    Object.keys(parsed).some((name) => !names.includes(name as (typeof names)[number]))
  )
    throw Error('Invalid hosted identity configuration.');
  const url = new URL(env.BROWSER_IDENTITY_DATABASE_URL ?? '');
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !url.username ||
    !url.password ||
    !url.hostname ||
    url.searchParams.getAll('sslmode').length !== 1 ||
    url.searchParams.get('sslmode') !== 'verify-full' ||
    [...url.searchParams.keys()].some((name) => name !== 'sslmode')
  )
    throw Error('A dedicated TLS-verified identity database connection is required.');
  const encryptionKey = env.BROWSER_IDENTITY_STORAGE_KEY ?? '';
  if (!/^[0-9a-f]{64}$/.test(encryptionKey)) throw Error('Invalid identity storage key.');
  return { config: Object.freeze({ ...parsed }), databaseUrl: url.href, encryptionKey };
}

/** Mount in each web/admin Node deployment. Provider tokens never enter client components. */
export function configuredBrowserIdentityRoutes(
  environment: () => Environment = () => process.env,
) {
  let current: ReturnType<typeof createBrowserIdentity> | undefined;
  return async (request: Request): Promise<Response> => {
    try {
      if (!current) {
        const settings = readBrowserIdentityEnvironment(environment());
        if (!settings) return unavailable();
        // Validate every URL and provider setting before allocating a database pool.
        let pool: Pool | undefined;
        const database = {
          async query(sql: string, values: unknown[]) {
            if (!pool) throw Error('Identity database unavailable.');
            return pool.query(sql, values);
          },
        };
        const store = createPostgresBrowserIdentityStore(database, settings.encryptionKey);
        current = createBrowserIdentity(settings.config, store);
        pool = new Pool({
          connectionString: settings.databaseUrl,
          max: 3,
          connectionTimeoutMillis: 5000,
          idleTimeoutMillis: 30000,
          statement_timeout: 5000,
          query_timeout: 5000,
        });
        pool.on('error', () => {
          /* Request errors are generic; never log credential-bearing errors. */
        });
      }
      return await current.handle(request);
    } catch {
      return unavailable();
    }
  };
}
function unavailable() {
  return Response.json(
    { error: 'SIGN_IN_UNAVAILABLE' },
    {
      status: 503,
      headers: {
        'Cache-Control': 'no-store',
        'Referrer-Policy': 'no-referrer',
        'X-Content-Type-Options': 'nosniff',
      },
    },
  );
}
