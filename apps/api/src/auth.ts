import { createRemoteJWKSet, jwtVerify } from 'jose';

/** Trusted server configuration only. Never build this from a request or a decoded token. */
export interface IdentityVerifierConfig {
  readonly issuer: string;
  readonly audience: string;
  readonly jwksUrl: string;
  /** Explicit exception for ephemeral loopback tests; forbidden in NODE_ENV=production. */
  readonly allowLoopbackHttpForTests?: boolean;
}

export interface VerifiedIdentity {
  readonly actorId: string;
}

export class AuthenticationError extends Error {
  readonly code = 'UNAUTHENTICATED';
  readonly statusCode = 401;

  constructor() {
    super('A valid bearer token is required.');
    this.name = 'AuthenticationError';
  }
}

export class AuthConfigurationError extends Error {
  readonly code = 'INVALID_AUTH_CONFIGURATION';

  constructor(message: string) {
    super(message);
    this.name = 'AuthConfigurationError';
  }
}

const TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_TOKEN_LENGTH = 8_192;
const MAX_ACCESS_TOKEN_AGE_SECONDS = 3_600;
const ALGORITHM = 'RS256';

function isCompactToken(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TOKEN_LENGTH && TOKEN_PATTERN.test(value);
}

/** Reject duplicate/malformed headers; returns the compact JWT, never a decoded identity. */
export function parseBearerHeader(value: string | readonly string[] | undefined): string {
  if (typeof value !== 'string' || value.length > MAX_TOKEN_LENGTH + 7) throw new AuthenticationError();
  const match = /^Bearer ([^\s]+)$/i.exec(value);
  const token = match?.[1];
  if (!isCompactToken(token)) throw new AuthenticationError();
  return token;
}

function trustedEndpoint(value: unknown, label: string, allowLoopbackHttp: boolean): URL {
  if (typeof value !== 'string' || value.length === 0 || value !== value.trim() || /[\s\\]/.test(value)) {
    throw new AuthConfigurationError(`${label} must be an explicitly configured HTTPS URL.`);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AuthConfigurationError(`${label} must be an explicitly configured HTTPS URL.`);
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(allowLoopbackHttp && loopback && url.protocol === 'http:')) {
    throw new AuthConfigurationError(`${label} requires HTTPS; HTTP is allowed only for explicit loopback tests.`);
  }
  if (url.username || url.password || url.hash || url.search || !url.hostname || url.hostname.includes('*')) {
    throw new AuthConfigurationError(`${label} cannot contain credentials, a query, a fragment or a wildcard.`);
  }
  return url;
}

/**
 * Verify signature/claims against one fixed server-trusted issuer and JWKS.
 * Only subject identity crosses this boundary; roles/tenants/membership come from the database.
 */
export function createIdentityVerifier(config: IdentityVerifierConfig): (bearer: string) => Promise<VerifiedIdentity> {
  if (!config || typeof config !== 'object') throw new AuthConfigurationError('Identity configuration is required.');
  if (config.allowLoopbackHttpForTests !== undefined && typeof config.allowLoopbackHttpForTests !== 'boolean') {
    throw new AuthConfigurationError('The loopback test exception must be an explicit boolean.');
  }
  const allowLoopbackHttp = config.allowLoopbackHttpForTests === true;
  if (allowLoopbackHttp && process.env.NODE_ENV === 'production') {
    throw new AuthConfigurationError('The loopback HTTP test exception is forbidden in production.');
  }
  const issuerUrl = trustedEndpoint(config.issuer, 'Issuer', allowLoopbackHttp);
  const jwksUrl = trustedEndpoint(config.jwksUrl, 'JWKS endpoint', allowLoopbackHttp);
  if (issuerUrl.origin !== jwksUrl.origin) {
    throw new AuthConfigurationError('The JWKS endpoint must belong to the configured issuer origin.');
  }
  if (typeof config.audience !== 'string' || config.audience.length === 0 || config.audience.length > 255 ||
      config.audience !== config.audience.trim() || /[\s\x00-\x1f\x7f*]/.test(config.audience)) {
    throw new AuthConfigurationError('One explicit non-wildcard audience is required.');
  }
  // Capture primitives so later mutation of the caller's config cannot change the trust boundary.
  const issuer = config.issuer;
  const audience = config.audience;
  const remoteKeys = createRemoteJWKSet(jwksUrl, {
    timeoutDuration: 5_000,
    cooldownDuration: 30_000,
    cacheMaxAge: 600_000,
  });

  return async (bearer: string): Promise<VerifiedIdentity> => {
    if (!isCompactToken(bearer)) throw new AuthenticationError();
    try {
      const { payload } = await jwtVerify(bearer, async (header, token) => {
        if (header.alg !== ALGORITHM || typeof header.kid !== 'string' || !header.kid.trim() || header.kid.length > 200) {
          throw new AuthenticationError();
        }
        return remoteKeys(header, token);
      }, {
        algorithms: [ALGORITHM],
        issuer,
        audience,
        requiredClaims: ['iss', 'aud', 'sub', 'exp', 'iat'],
        maxTokenAge: MAX_ACCESS_TOKEN_AGE_SECONDS,
        clockTolerance: 0,
      });
      if (typeof payload.sub !== 'string' || payload.sub.length === 0 || payload.sub.length > 255 ||
          payload.sub !== payload.sub.trim() || /[\x00-\x1f\x7f]/.test(payload.sub) ||
          typeof payload.iat !== 'number' || !Number.isSafeInteger(payload.iat) ||
          typeof payload.exp !== 'number' || !Number.isSafeInteger(payload.exp) ||
          payload.exp <= payload.iat || payload.exp - payload.iat > MAX_ACCESS_TOKEN_AGE_SECONDS) {
        throw new AuthenticationError();
      }
      return Object.freeze({ actorId: payload.sub });
    } catch {
      // Do not expose tokens, payload claims, keys, network URLs or JOSE diagnostics to callers.
      throw new AuthenticationError();
    }
  };
}

export interface TenantConfiguration {
  readonly tenantId: string;
  readonly slug: string;
  readonly hostnames: readonly string[];
}

export class TenantResolutionError extends Error {
  readonly code = 'UNKNOWN_TENANT';
  readonly statusCode = 404;

  constructor() {
    super('No company is configured for this hostname.');
    this.name = 'TenantResolutionError';
  }
}

function hostnameFromHost(value: unknown, allowPort: boolean): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.length > 260 || /[\s/\\?#@,]/.test(value)) return undefined;
  const match = allowPort ? /^([^:]+)(?::([0-9]{1,5}))?$/.exec(value) : /^([^:]+)$/.exec(value);
  const hostname = match?.[1]?.toLowerCase();
  const port = match?.[2];
  if (!hostname || hostname.length > 253 || (port !== undefined && (Number(port) < 1 || Number(port) > 65_535))) return undefined;
  if (!hostname.split('.').every(label => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) return undefined;
  return hostname;
}

/** Hostname chooses context only. Membership authorization still runs for every private operation. */
export function createTenantResolver(configurations: readonly TenantConfiguration[]): (host: string | undefined) => TenantConfiguration {
  if (!Array.isArray(configurations) || configurations.length === 0) {
    throw new AuthConfigurationError('At least one trusted tenant configuration is required.');
  }
  const tenants = new Set<string>();
  const hosts = new Map<string, TenantConfiguration>();
  for (const configured of configurations) {
    if (!configured || typeof configured.tenantId !== 'string' || !configured.tenantId.trim() ||
        configured.tenantId !== configured.tenantId.trim() || configured.tenantId.length > 128 ||
        /[\x00-\x1f\x7f]/.test(configured.tenantId) || tenants.has(configured.tenantId) ||
        typeof configured.slug !== 'string' || configured.slug.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(configured.slug) ||
        !Array.isArray(configured.hostnames) || configured.hostnames.length === 0) {
      throw new AuthConfigurationError('Each tenant needs a unique ID, valid slug and explicitly configured hostnames.');
    }
    const hostnames = configured.hostnames.map((host: unknown) => {
      const normalized = hostnameFromHost(host, false);
      if (!normalized || hosts.has(normalized)) throw new AuthConfigurationError('Tenant hostnames must be valid and uniquely assigned.');
      return normalized;
    });
    if (new Set(hostnames).size !== hostnames.length) throw new AuthConfigurationError('Tenant hostnames must be unique.');
    const tenant: TenantConfiguration = Object.freeze({
      tenantId: configured.tenantId,
      slug: configured.slug,
      hostnames: Object.freeze(hostnames),
    });
    tenants.add(tenant.tenantId);
    for (const hostname of hostnames) hosts.set(hostname, tenant);
  }
  return (host: string | undefined): TenantConfiguration => {
    const hostname = hostnameFromHost(host, true);
    const tenant = hostname ? hosts.get(hostname) : undefined;
    if (!tenant) throw new TenantResolutionError();
    return tenant;
  };
}
