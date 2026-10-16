import { propertiesForCompany } from '@realtor/demo';
import {
  createIdentityVerifier,
  createTenantResolver,
  parseBearerHeader,
  TenantResolutionError,
  type TenantConfiguration,
} from './auth.js';
import { createPostgresDatabase } from './database.js';
import { createApiService } from './service.js';
import { createDevelopmentServer } from './http.js';

// Public hosting needs a deployment adapter, distributed abuse controls and provider verification.
if (process.env.NODE_ENV === 'production')
  throw new Error('This HTTP adapter is development-only. Production integration is not accepted.');
const mode = process.env.API_MODE ?? 'demo';
if (!['demo', 'database'].includes(mode)) throw new Error('API_MODE must be demo or database.');
const port = Number(process.env.PORT ?? 4000);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
const clientAddresses = new WeakMap<Request, string>();
let handler: (request: Request) => Promise<Response>;
let closeDatabase: undefined | (() => Promise<void>);
const json = (status: number, payload: unknown) =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
if (mode === 'database') {
  const required = (name: string): string => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing server configuration: ${name}.`);
    return value;
  };
  const configurations: TenantConfiguration[] = JSON.parse(required('TRUSTED_TENANTS_JSON'));
  const resolveTenant = createTenantResolver(configurations);
  const verify = createIdentityVerifier({
    issuer: required('AUTH_ISSUER'),
    audience: required('AUTH_AUDIENCE'),
    jwksUrl: required('AUTH_JWKS_URL'),
  });
  const database = await createPostgresDatabase({ connectionString: required('DATABASE_URL') });
  closeDatabase = () => database.close();
  const services = new Map(
    configurations.map((tenant) => [
      tenant.tenantId,
      createApiService({
        database,
        tenantId: tenant.tenantId,
        privacyNoticeVersion: required('PRIVACY_NOTICE_VERSION'),
        verifyAuthorization: (request) =>
          verify(parseBearerHeader(request.headers.get('authorization') ?? undefined)),
        clientKey: (request) => clientAddresses.get(request) ?? 'unknown-socket',
      }),
    ]),
  );
  handler = async (request) => {
    try {
      const tenant = resolveTenant(new URL(request.url).host);
      if (request.method === 'GET' && new URL(request.url).pathname === '/health')
        return json(200, {
          status: 'development',
          persistentStorage: true,
          authentication: 'verifier-configured',
          productionReady: false,
        });
      return await services.get(tenant.tenantId)!(request);
    } catch (error) {
      return json(error instanceof TenantResolutionError ? 404 : 503, {
        error: 'SERVICE_UNAVAILABLE',
      });
    }
  };
} else {
  handler = async (request) => {
    const path = new URL(request.url).pathname;
    if (request.method === 'GET' && path === '/health')
      return json(200, {
        status: 'development',
        persistentStorage: false,
        authentication: false,
        productionReady: false,
      });
    if (request.method === 'GET' && path === '/v1/demo/properties')
      return json(200, { synthetic: true, items: propertiesForCompany('realtime-estates') });
    return json(404, {
      error: 'NOT_FOUND',
      message: 'Synthetic preview. Database operations require explicit server configuration.',
    });
  };
}
const server = createDevelopmentServer(handler, clientAddresses);
server.listen(port, '127.0.0.1', () =>
  console.log(`Development API listening on loopback port ${port}; mode=${mode}`),
);
const stop = () => {
  server.close(() => {
    if (closeDatabase) {
      void closeDatabase().finally(() => process.exit(0));
    } else process.exit(0);
  });
  server.closeIdleConnections();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
