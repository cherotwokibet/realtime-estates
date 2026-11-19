import { randomUUID } from 'node:crypto';
import { createHostedCustomerFavourites } from './customer-favourites-http.js';
import { createApiService } from './service.js';
import { createFirebaseIdentityVerifier, type FirebaseActorResolver } from './firebase-identity.js';
import { parseBearerHeader, AuthenticationError, type VerifiedIdentity } from './auth.js';
import type { TransactionDatabase } from './database.js';
import { readHostedDatabaseEnvironment } from './hosted-database.js';
export interface HostedApiConfig {
  readonly policy: 'realtor-staging-api-v1';
  readonly projectId: string;
  readonly tenantId: string;
  readonly applicationOrigin: string;
  readonly privacyNoticeVersion: string;
  readonly authTenantId?: string;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validateHostedApiConfig(value: unknown): HostedApiConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid staging API configuration.');
  const v = value as HostedApiConfig,
    keys = Object.keys(v);
  if (
    keys.some(
      (k) =>
        ![
          'policy',
          'projectId',
          'tenantId',
          'applicationOrigin',
          'privacyNoticeVersion',
          'authTenantId',
        ].includes(k),
    ) ||
    ['policy', 'projectId', 'tenantId', 'applicationOrigin', 'privacyNoticeVersion'].some(
      (k) => !keys.includes(k),
    ) ||
    v.policy !== 'realtor-staging-api-v1' ||
    typeof v.projectId !== 'string' ||
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(v.projectId) ||
    typeof v.tenantId !== 'string' ||
    !uuid.test(v.tenantId) ||
    typeof v.applicationOrigin !== 'string' ||
    typeof v.privacyNoticeVersion !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(v.privacyNoticeVersion) ||
    (v.authTenantId !== undefined &&
      (typeof v.authTenantId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v.authTenantId)))
  )
    throw Error('Invalid staging API configuration.');
  const origin = new URL(v.applicationOrigin);
  if (origin.protocol !== 'https:' || origin.origin !== v.applicationOrigin)
    throw Error('HTTPS staging origin required.');
  return Object.freeze({ ...v });
}
export function readHostedApiEnvironment(env: Readonly<Record<string, string | undefined>>) {
  if (
    env.NODE_ENV !== 'production' ||
    env.APP_ENV !== 'staging' ||
    !env.HOSTED_API_CONFIG ||
    env.HOSTED_API_CONFIG.length > 4096
  )
    throw Error('Explicit staging API deployment required.');
  if (
    Object.entries(env).some(
      ([k, v]) =>
        v !== undefined &&
        (k.startsWith('STAFF_PREVIEW_') ||
          k === 'WEB_CUSTOMER_PREVIEW_CONFIG' ||
          k === 'FIREBASE_AUTH_EMULATOR_HOST' ||
          k === 'BROWSER_IDENTITY_CONFIG' ||
          k === 'API_MODE'),
    )
  )
    throw Error('Preview configuration is unavailable.');
  if (env.GOOGLE_APPLICATION_CREDENTIALS !== undefined)
    throw Error('Use the attached staging workload identity.');
  if (env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw Error('TLS verification must remain enabled.');
  const config = validateHostedApiConfig(JSON.parse(env.HOSTED_API_CONFIG));
  if (env.GOOGLE_CLOUD_PROJECT !== config.projectId)
    throw Error('Staging API project does not match.');
  const databaseConfig = readHostedDatabaseEnvironment(env, 'HOSTED_API', config.projectId);
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid API port.');
  return Object.freeze({
    config,
    databaseConfig,
    databaseUrl: databaseConfig.kind === 'tls-url' ? databaseConfig.connectionString : undefined,
    port,
  });
}
/** Verified Firebase subject lookup, under the API's attested role and fixed company context. */
export function createFirebaseApiActorResolver(
  database: TransactionDatabase,
  tenantId: string,
): FirebaseActorResolver {
  if (!uuid.test(tenantId)) throw Error('Invalid company.');
  return async (subject) =>
    database.transaction(
      { tenantId, actorId: null, correlationId: randomUUID() },
      async (query) => {
        const { rows } = await query.query(
          'SELECT app_api.resolve_firebase_actor($1,$2,$3) AS actor_id',
          [subject.projectId, subject.authTenantId, subject.uid],
        );
        const actor = rows.length === 1 ? rows[0]?.actor_id : null;
        return typeof actor === 'string' && uuid.test(actor) ? actor : null;
      },
    );
}
const U = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const customer = new RegExp(
  '^/v2/customer/(?:account|favourites(?:/' + U + ')?|favourite-operations/' + U + ')$',
);
const staff = new RegExp('^/v2/staff/(?:session|branches(?:/(?:operations/)?' + U + ')?)$');
export function isHostedApiPath(path: string) {
  return customer.test(path) || staff.test(path);
}
const reply = (status: number, code: string) =>
  Response.json(
    { error: { code, message: 'Staging API request unavailable.' } },
    { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } },
  );
/** Dependency injection is server construction only; no verifier/provider switch is exposed over HTTP. */
export function createHostedApiHandler(
  input: HostedApiConfig,
  database: TransactionDatabase,
  verifyToken?: (token: string) => Promise<VerifiedIdentity>,
) {
  const config = validateHostedApiConfig(input);
  const verify =
    verifyToken ??
    createFirebaseIdentityVerifier(
      config,
      createFirebaseApiActorResolver(database, config.tenantId),
    );
  async function authorize(request: Request) {
    try {
      return await verify(parseBearerHeader(request.headers.get('authorization') ?? undefined));
    } catch {
      throw new AuthenticationError();
    }
  }
  const customerHandler = createHostedCustomerFavourites({
    tenantId: config.tenantId,
    database,
    verifyAuthorization: authorize,
  });
  const staffHandler = createApiService({
    tenantId: config.tenantId,
    database,
    privacyNoticeVersion: config.privacyNoticeVersion,
    verifyAuthorization: authorize,
    staffBranchMode: 'hosted-staff-branches-v1',
  });
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (
      url.origin !== config.applicationOrigin ||
      url.hash ||
      request.headers.has('cookie') ||
      request.headers.get('sec-fetch-site') === 'cross-site' ||
      (request.headers.has('origin') && request.headers.get('origin') !== config.applicationOrigin)
    )
      return reply(403, 'ORIGIN_REFUSED');
    for (const h of [
      'x-actor-id',
      'x-tenant-id',
      'x-role',
      'x-company-id',
      'x-preview-instance',
      'x-assigned-agent-id',
    ])
      if (request.headers.has(h)) return reply(400, 'IDENTITY_REFUSED');
    if (!isHostedApiPath(url.pathname)) return reply(404, 'NOT_FOUND');
    if (!['GET', 'POST'].includes(request.method)) return reply(405, 'METHOD_NOT_ALLOWED');
    if (request.signal.aborted) return reply(408, 'REQUEST_CANCELLED');
    // Whitelist before invoking the shared service: no synthetic extension or unrelated route is exposed.
    return url.pathname.startsWith('/v2/customer/')
      ? customerHandler(request)
      : staffHandler(request);
  };
}
