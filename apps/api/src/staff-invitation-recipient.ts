import { decodeJwt } from 'jose';
import { validateStaffInvitationEmail } from '@realtor/domain';
import {
  AuthenticationError,
  AuthConfigurationError,
  createIdentityVerifier,
  type IdentityVerifierConfig,
} from './auth.js';

export interface VerifiedStaffInvitationRecipient {
  readonly policy: 'verified-staff-invitation-recipient-v1';
  readonly actorId: string;
  readonly issuer: string;
  readonly recipientEmail: string;
}
const verified = new WeakSet<object>();

/** A plain request/JSON object, including a copy of a principal, is never verified authority. */
export function isVerifiedStaffInvitationRecipient(
  value: unknown,
): value is VerifiedStaffInvitationRecipient {
  return value !== null && typeof value === 'object' && verified.has(value);
}

/** Synthetic, explicitly opted-in verifier only. No routes or provider activation are installed. */
export function createStaffInvitationRecipientVerifier(
  config: IdentityVerifierConfig,
  mode: 'synthetic-verified-recipient-v1',
): (bearer: string) => Promise<VerifiedStaffInvitationRecipient> {
  if (mode !== 'synthetic-verified-recipient-v1' || process.env.NODE_ENV === 'production')
    throw new AuthConfigurationError('Explicit non-production recipient verification is required.');
  const verify = createIdentityVerifier(config),
    issuer = config.issuer;
  return async (bearer) => {
    try {
      // Verify first with the existing fixed issuer/JWKS/audience/age/signature boundary.
      // Only then read additional claims from those exact immutable token bytes.
      const identity = await verify(bearer),
        claims = decodeJwt(bearer);
      if (
        claims.sub !== identity.actorId ||
        claims.iss !== issuer ||
        claims.email_verified !== true ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
          identity.actorId,
        )
      )
        throw new AuthenticationError();
      const principal: VerifiedStaffInvitationRecipient = Object.freeze({
        policy: 'verified-staff-invitation-recipient-v1',
        actorId: identity.actorId,
        issuer,
        recipientEmail: validateStaffInvitationEmail(claims.email),
      });
      verified.add(principal);
      return principal;
    } catch {
      throw new AuthenticationError();
    }
  };
}
