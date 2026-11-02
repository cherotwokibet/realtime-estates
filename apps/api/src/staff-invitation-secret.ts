import { createHash, randomBytes } from 'node:crypto';

export interface StaffInvitationSecret {
  readonly policy: 'staff-invitation-secret-v1';
  readonly digest: string;
  takeSecretOnce(): string;
  destroy(): void;
}
const invalid = (): never => {
  throw Error('Invitation secret unavailable.');
};

/** Canonical 32-byte base64url secret only. A digest is never accepted as a secret. */
export function hashStaffInvitationSecret(input: unknown): string {
  if (typeof input !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(input)) return invalid();
  const bytes = Buffer.from(input, 'base64url');
  try {
    if (bytes.length !== 32 || bytes.toString('base64url') !== input) return invalid();
    return createHash('sha256').update(bytes).digest('hex');
  } finally {
    bytes.fill(0);
  }
}

/**
 * Issuance building block only; not installed in any route or migration.
 * Persist the digest and immutable issue operation atomically before delivery.
 * Never regenerate on replay: a lost raw secret requires explicit revoke/new invitation.
 */
export function issueStaffInvitationSecret(): StaffInvitationSecret {
  let bytes: Buffer | null = randomBytes(32);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const destroy = () => {
    bytes?.fill(0);
    bytes = null;
  };
  const handle = Object.create(null) as StaffInvitationSecret;
  Object.defineProperties(handle, {
    policy: { value: 'staff-invitation-secret-v1', enumerable: true },
    digest: { value: digest, enumerable: true },
    takeSecretOnce: {
      value: () => {
        if (bytes === null) return invalid();
        try {
          return bytes.toString('base64url');
        } finally {
          destroy();
        }
      },
    },
    destroy: { value: destroy },
  });
  return Object.freeze(handle);
}
