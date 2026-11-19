import { readHostedDatabaseEnvironment, type HostedDatabaseConfig } from './hosted-database.js';
import { createIdentityDatabase, type IdentityProfile } from './identity-database.js';
import { AuthenticationError } from './auth.js';
import { createBrowserIdentity, type BrowserIdentityConfig } from './browser-identity.js';
import { createPostgresBrowserIdentityStore } from './browser-identity-store.js';
import {
  createFirebaseBrowserIdentity,
  type FirebaseBrowserIdentityConfig,
} from './firebase-browser-identity.js';
import {
  createFirebaseTokenVerifier,
  createPostgresFirebaseActorResolver,
} from './firebase-identity.js';

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
  databaseUrl?: string;
  databaseConfig: HostedDatabaseConfig;
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
  return { config: Object.freeze({ ...parsed }), ...readIdentityStorageEnvironment(env) };
}
export function readIdentityStorageEnvironment(env: Environment, projectId?: string) {
  const databaseConfig = readHostedDatabaseEnvironment(env, 'BROWSER_IDENTITY', projectId);
  const encryptionKey = env.BROWSER_IDENTITY_STORAGE_KEY ?? '';
  if (!/^[0-9a-f]{64}$/.test(encryptionKey)) throw Error('Invalid identity storage key.');
  return {
    databaseConfig,
    databaseUrl: databaseConfig.kind === 'tls-url' ? databaseConfig.connectionString : undefined,
    encryptionKey,
  };
}

export function readFirebaseBrowserEnvironment(env: Environment): {
  config: FirebaseBrowserIdentityConfig;
  databaseUrl?: string;
  databaseConfig: HostedDatabaseConfig;
  encryptionKey: string;
} | null {
  if (env.FIREBASE_BROWSER_CONFIG === undefined) return null;
  if (
    env.BROWSER_IDENTITY_CONFIG !== undefined ||
    !['staging', 'production'].includes(env.APP_ENV ?? '') ||
    Object.entries(env).some(
      ([name, value]) =>
        value !== undefined &&
        (name === 'WEB_CUSTOMER_PREVIEW_CONFIG' ||
          name.startsWith('STAFF_PREVIEW_') ||
          name === 'FIREBASE_AUTH_EMULATOR_HOST'),
    )
  )
    throw Error('Hosted Firebase identity requires an isolated deployment.');
  if (env.FIREBASE_BROWSER_CONFIG.length > 4096)
    throw Error('Invalid Firebase browser configuration.');
  const config = JSON.parse(env.FIREBASE_BROWSER_CONFIG),
    keys = Object.keys(config ?? {});
  if (
    !config ||
    typeof config !== 'object' ||
    Array.isArray(config) ||
    keys.some((k) => !['projectId', 'applicationOrigin', 'tenantId', 'authTenantId'].includes(k)) ||
    ['projectId', 'applicationOrigin', 'tenantId'].some((k) => typeof config[k] !== 'string') ||
    (config.authTenantId !== undefined && typeof config.authTenantId !== 'string')
  )
    throw Error('Invalid Firebase browser configuration.');
  return {
    config: Object.freeze({ ...config }),
    ...readIdentityStorageEnvironment(env, config.projectId),
  };
}

/** Mount in each web/admin Node deployment. Provider tokens never enter client components. */
export function configuredBrowserIdentityRuntime(
  environment: () => Environment = () => process.env,
  profile: IdentityProfile = 'auth',
) {
  let storage: ReturnType<typeof createIdentityDatabase> | undefined;
  let current:
    | ReturnType<typeof createBrowserIdentity>
    | ReturnType<typeof createFirebaseBrowserIdentity>
    | undefined;
  function configured() {
    if (!current) {
      const env = environment(),
        firebase = readFirebaseBrowserEnvironment(env);
      const settings = firebase ?? readBrowserIdentityEnvironment(env);
      if (!settings) return null;
      // Validate every URL and provider setting before allocating a database pool.
      const database = {
        async query(sql: string, values: unknown[]) {
          if (!storage) throw Error('Identity database unavailable.');
          return storage.query(sql, values);
        },
      };
      const store = createPostgresBrowserIdentityStore(database, settings.encryptionKey);
      const instance = firebase
        ? createFirebaseBrowserIdentity(
            firebase.config,
            store,
            createFirebaseTokenVerifier(
              firebase.config,
              createPostgresFirebaseActorResolver(database),
            ),
          )
        : createBrowserIdentity(settings.config as BrowserIdentityConfig, store);
      storage = createIdentityDatabase(settings.databaseConfig, profile);
      current = instance;
    }
    return current;
  }
  return Object.freeze({
    database: Object.freeze({
      async query(sql: string, values: unknown[]) {
        if (!configured() || !storage) throw Error('Identity database unavailable.');
        return storage.query(sql, values);
      },
    }),
    async close() {
      await storage?.close();
    },
    async authenticateSession(request: Request) {
      try {
        const instance = configured();
        if (!instance || !('authenticateSession' in instance)) throw new AuthenticationError();
        return await instance.authenticateSession(request);
      } catch {
        throw new AuthenticationError();
      }
    },
    async handle(request: Request): Promise<Response> {
      try {
        const instance = configured();
        return instance ? await instance.handle(request) : unavailable();
      } catch {
        return unavailable();
      }
    },
    async authenticate(request: Request) {
      try {
        const instance = configured();
        if (!instance) throw new AuthenticationError();
        const identity = await instance.authenticate(request);
        return Object.freeze({ ...identity, tenantId: instance.tenantId });
      } catch {
        throw new AuthenticationError();
      }
    },
  });
}
export function configuredBrowserIdentityRoutes(
  environment: () => Environment = () => process.env,
) {
  return configuredBrowserIdentityRuntime(environment).handle;
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
