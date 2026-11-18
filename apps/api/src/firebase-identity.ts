import { createHash } from 'node:crypto';
import { applicationDefault, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth, type DecodedIdToken } from 'firebase-admin/auth';
import { AuthenticationError, type VerifiedIdentity } from './auth.js';

export interface FirebaseIdentityConfig {
  readonly projectId: string;
  /** Optional Identity Platform tenant, distinct from a realtor company membership. */
  readonly authTenantId?: string;
}
export interface FirebaseSubject {
  readonly projectId: string;
  readonly authTenantId: string | null;
  readonly uid: string;
}
export type FirebaseActorResolver = (subject: FirebaseSubject) => Promise<string | null>;
interface TokenVerifier {
  verifyIdToken(token: string, checkRevoked: boolean): Promise<DecodedIdToken>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const compact = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;

/** Firebase Admin verifies Google's fixed project issuer/keys and current revocation.
 * Explicit active subject mapping is required: Firebase UIDs are not PostgreSQL actor UUIDs.
 * Tenant/company permissions still come from current restricted SQL membership.
 */
export interface FirebaseVerifiedToken extends VerifiedIdentity {
  readonly expiresAt: number;
}
export function createFirebaseTokenVerifier(
  input: FirebaseIdentityConfig,
  resolveActor: FirebaseActorResolver,
  options: { verifier?: TokenVerifier; now?: () => number } = {},
): (token: string, requireRecentSignIn?: boolean) => Promise<FirebaseVerifiedToken> {
  const projectId = input.projectId,
    authTenantId = input.authTenantId ?? null;
  if (
    !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId) ||
    (authTenantId !== null && !/^[A-Za-z0-9_-]{1,128}$/.test(authTenantId)) ||
    process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined
  )
    throw Error('Invalid hosted Firebase identity configuration.');
  let verifier = options.verifier;
  const now = options.now ?? Date.now;
  return async (token, requireRecentSignIn = false) => {
    try {
      if (
        process.env.FIREBASE_AUTH_EMULATOR_HOST !== undefined ||
        typeof token !== 'string' ||
        token.length > 8192 ||
        !compact.test(token)
      )
        throw new AuthenticationError();
      if (!verifier) {
        const name =
          'realtor-firebase-' + createHash('sha256').update(projectId).digest('hex').slice(0, 16);
        const app =
          getApps().find((app) => app.name === name) ??
          initializeApp(
            {
              projectId,
              credential: applicationDefault(),
            },
            name,
          );
        if (app.options.projectId !== projectId) throw new AuthenticationError();
        const auth = getAuth(app);
        verifier = authTenantId ? auth.tenantManager().authForTenant(authTenantId) : auth;
      }
      const decoded = await verifier.verifyIdToken(token, true);
      const seconds = Math.floor(now() / 1000);
      if (
        decoded.iss !== 'https://securetoken.google.com/' + projectId ||
        decoded.aud !== projectId ||
        typeof decoded.sub !== 'string' ||
        !decoded.sub ||
        decoded.sub.length > 128 ||
        decoded.uid !== decoded.sub ||
        /[\x00-\x20\x7f]/.test(decoded.uid) ||
        !Number.isSafeInteger(decoded.exp) ||
        !Number.isSafeInteger(decoded.iat) ||
        !Number.isSafeInteger(decoded.auth_time) ||
        decoded.exp <= seconds ||
        decoded.iat > seconds ||
        decoded.exp <= decoded.iat ||
        decoded.exp - decoded.iat > 3600 ||
        decoded.auth_time < 0 ||
        decoded.iat < 0 ||
        decoded.auth_time > decoded.iat ||
        decoded.email_verified !== true ||
        typeof decoded.email !== 'string' ||
        !decoded.email ||
        decoded.email.length > 320 ||
        !decoded.firebase ||
        decoded.firebase.sign_in_provider === 'anonymous' ||
        typeof decoded.firebase.sign_in_provider !== 'string' ||
        (decoded.firebase.tenant ?? null) !== authTenantId ||
        (requireRecentSignIn && seconds - decoded.auth_time > 300)
      )
        throw new AuthenticationError();
      const actorId = await resolveActor(
        Object.freeze({ projectId, authTenantId, uid: decoded.uid }),
      );
      if (typeof actorId !== 'string' || !uuid.test(actorId)) throw new AuthenticationError();
      return Object.freeze({ actorId, expiresAt: decoded.exp * 1000 });
    } catch {
      throw new AuthenticationError();
    }
  };
}

export function createFirebaseIdentityVerifier(
  input: FirebaseIdentityConfig,
  resolveActor: FirebaseActorResolver,
  options: { verifier?: TokenVerifier; now?: () => number } = {},
): (token: string, requireRecentSignIn?: boolean) => Promise<VerifiedIdentity> {
  const verify = createFirebaseTokenVerifier(input, resolveActor, options);
  return async (token, recent = false) => {
    const { actorId } = await verify(token, recent);
    return Object.freeze({ actorId });
  };
}

/** Read-only binding lookup. Enrollment/revocation is a separate controlled administrative action. */
export function createPostgresFirebaseActorResolver(database: {
  query(sql: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}): FirebaseActorResolver {
  return async (subject) => {
    const { rows } = await database.query(
      `SELECT actor_id FROM identity.firebase_actor_bindings
      WHERE project_id=$1 AND auth_tenant_id=COALESCE($2,'') AND firebase_uid=$3 AND active=true`,
      [subject.projectId, subject.authTenantId, subject.uid],
    );
    if (rows.length !== 1) return null;
    const id = rows[0]!.actor_id;
    return typeof id === 'string' && uuid.test(id) ? id : null;
  };
}
