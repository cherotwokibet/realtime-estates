import {
  validateStaffInvitationIssueRecord,
  validateStaffInvitationRedemptionRecord,
  validateStaffIssuedInvitationState,
  type StaffInvitationIssueRecord as InvitationIssueRecord,
  type StaffInvitationRedemptionRecord as InvitationRedemptionRecord,
  type StaffIssuedInvitationState as IssuedInvitationState,
} from '@realtor/domain';
import { createIdentityVerifier, type IdentityVerifierConfig } from './auth.js';
import type { TransactionDatabase, TransactionQuery } from './database.js';
import { createStaffInvitationRecipientVerifier } from './staff-invitation-recipient.js';
import {
  hashStaffInvitationSecret,
  issueStaffInvitationSecret,
  type StaffInvitationSecret,
} from './staff-invitation-secret.js';

export interface InvitationCandidateInput {
  readonly tenantId: string;
  readonly operationId: string;
  readonly invitationId: string;
}
export type { StaffInvitationIssueRecord as InvitationIssueRecord } from '@realtor/domain';
export interface InvitationIssueResult {
  readonly receipt: InvitationIssueRecord;
  readonly secretAvailable: boolean;
  /** Explicit one-time reveal, after the transaction resolved successfully. Never serialized. */
  takeSecretOnce(): string;
  destroySecret(): void;
}
export type {
  StaffInvitationRedemptionRecord as InvitationRedemptionRecord,
  StaffIssuedInvitationState as IssuedInvitationState,
} from '@realtor/domain';
export class StaffInvitationCandidateError extends Error {
  readonly code = 'INVALID_STAFF_INVITATION_CANDIDATE';
  constructor() {
    super('Synthetic staff invitation unavailable.');
  }
}
const invalid = (): never => {
  throw new StaffInvitationCandidateError();
};
const uuid = (value: unknown): string => {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  )
    return invalid();
  return value;
};
function own(value: unknown, fields: readonly string[]): Record<string, unknown> {
  try {
    if (
      !value ||
      typeof value !== 'object' ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
      return invalid();
    const keys = Reflect.ownKeys(value),
      result: Record<string, unknown> = Object.create(null);
    if (
      keys.length !== fields.length ||
      keys.some((key) => typeof key !== 'string' || !fields.includes(key))
    )
      return invalid();
    for (const key of fields) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return invalid();
      result[key] = descriptor.value;
    }
    return result;
  } catch {
    return invalid();
  }
}
function input(value: unknown): InvitationCandidateInput {
  const row = own(value, ['tenantId', 'operationId', 'invitationId']);
  return Object.freeze({
    tenantId: uuid(row.tenantId),
    operationId: uuid(row.operationId),
    invitationId: uuid(row.invitationId),
  });
}
function issueRecord(
  value: unknown,
  command: InvitationCandidateInput,
  actorId: string,
): InvitationIssueRecord {
  try {
    return validateStaffInvitationIssueRecord(
      value,
      command.operationId,
      command.invitationId,
      actorId,
    );
  } catch {
    return invalid();
  }
}
function redemptionRecord(
  value: unknown,
  command: InvitationCandidateInput,
  memberId: string,
): InvitationRedemptionRecord {
  try {
    return validateStaffInvitationRedemptionRecord(
      value,
      command.operationId,
      command.invitationId,
      memberId,
    );
  } catch {
    return invalid();
  }
}
function issuedState(value: unknown, command: InvitationCandidateInput): IssuedInvitationState {
  try {
    return validateStaffIssuedInvitationState(value, command.operationId, command.invitationId);
  } catch {
    return invalid();
  }
}
async function scalar(
  query: TransactionQuery,
  sql: string,
  args: readonly unknown[],
): Promise<unknown> {
  const rows = (await query.query(sql, args)).rows;
  if (rows.length !== 1) return invalid();
  return own(rows[0], ['result']).result;
}
function issueResult(
  receipt: InvitationIssueRecord,
  secret: StaffInvitationSecret | null,
): InvitationIssueResult {
  const result = Object.create(null) as InvitationIssueResult;
  Object.defineProperties(result, {
    receipt: { value: receipt, enumerable: true },
    secretAvailable: { value: secret !== null, enumerable: true },
    takeSecretOnce: {
      value: () => {
        if (process.env.NODE_ENV === 'production' || secret === null) return invalid();
        return secret.takeSecretOnce();
      },
    },
    destroySecret: { value: () => secret?.destroy() },
  });
  return Object.freeze(result);
}

/** Synthetic-only boundary. HTTP uses a separate explicit opt-in; startup does not enable it. */
export function createStaffInvitationRedemptionCandidate(options: {
  database: TransactionDatabase;
  identity: IdentityVerifierConfig;
  mode: 'synthetic-single-use-invitations-v1';
}) {
  const mode = options.mode;
  const guard = () => {
    if (mode !== 'synthetic-single-use-invitations-v1' || process.env.NODE_ENV === 'production')
      return invalid();
  };
  guard();
  const verifyAdminIdentity = createIdentityVerifier(options.identity);
  const verifyRecipient = createStaffInvitationRecipientVerifier(
    options.identity,
    'synthetic-verified-recipient-v1',
  );
  const issuer = options.identity.issuer;
  const transaction = options.database.transaction.bind(options.database);
  return Object.freeze({
    async issue(value: unknown, bearer: string): Promise<InvitationIssueResult> {
      guard();
      const command = input(value),
        actorId = uuid((await verifyAdminIdentity(bearer)).actorId);
      let secret: StaffInvitationSecret | null = null;
      try {
        const receipt = await transaction(
          { ...command, actorId, correlationId: command.operationId },
          async (query) => {
            guard();
            // Expected absence raises P0002; roll it back to a savepoint before
            // attempting the first write. Other errors never become new issuance.
            await query.query('SAVEPOINT staff_invitation_original');
            let original: unknown;
            try {
              original = await scalar(
                query,
                'SELECT app_api.read_staff_invitation_issue($1) AS result',
                [command.operationId],
              );
            } catch (error) {
              if (
                !error ||
                typeof error !== 'object' ||
                !('code' in error) ||
                error.code !== 'P0002'
              )
                throw error;
              await query.query('ROLLBACK TO SAVEPOINT staff_invitation_original');
            }
            await query.query('RELEASE SAVEPOINT staff_invitation_original');
            if (original !== undefined) return issueRecord(original, command, actorId);
            secret = issueStaffInvitationSecret();
            return issueRecord(
              await scalar(query, 'SELECT app_api.issue_staff_invitation($1,$2,$3,$4) AS result', [
                command.operationId,
                command.invitationId,
                issuer,
                secret.digest,
              ]),
              command,
              actorId,
            );
          },
        );
        // TransactionDatabase resolves only after COMMIT. A lost/failed commit
        // destroys raw material; later GET/replay returns metadata, not a new secret.
        return issueResult(receipt, secret);
      } catch (error) {
        (secret as StaffInvitationSecret | null)?.destroy();
        throw error;
      }
    },
    async readIssue(value: unknown, bearer: string): Promise<InvitationIssueRecord> {
      guard();
      const command = input(value),
        actorId = uuid((await verifyAdminIdentity(bearer)).actorId);
      return transaction(
        { ...command, actorId, correlationId: command.operationId },
        async (query) => {
          guard();
          return issueRecord(
            await scalar(query, 'SELECT app_api.read_staff_invitation_issue($1) AS result', [
              command.operationId,
            ]),
            command,
            actorId,
          );
        },
      );
    },
    async readState(value: unknown, bearer: string): Promise<IssuedInvitationState> {
      guard();
      const command = input(value),
        actorId = uuid((await verifyAdminIdentity(bearer)).actorId);
      return transaction(
        { ...command, actorId, correlationId: command.operationId },
        async (query) => {
          guard();
          return issuedState(
            await scalar(query, 'SELECT app_api.read_issued_staff_invitation($1) AS result', [
              command.invitationId,
            ]),
            command,
          );
        },
      );
    },
    async redeem(
      value: unknown,
      bearer: string,
      rawSecret: unknown,
    ): Promise<InvitationRedemptionRecord> {
      guard();
      const command = input(value),
        recipient = await verifyRecipient(bearer),
        digest = hashStaffInvitationSecret(rawSecret);
      return transaction(
        { ...command, actorId: recipient.actorId, correlationId: command.operationId },
        async (query) => {
          guard();
          return redemptionRecord(
            await scalar(
              query,
              'SELECT app_api.redeem_staff_invitation($1,$2,$3,$4,$5) AS result',
              [
                command.operationId,
                command.invitationId,
                recipient.issuer,
                recipient.recipientEmail,
                digest,
              ],
            ),
            command,
            recipient.actorId,
          );
        },
      );
    },
    async readRedemption(value: unknown, bearer: string): Promise<InvitationRedemptionRecord> {
      guard();
      const command = input(value),
        recipient = await verifyRecipient(bearer);
      return transaction(
        { ...command, actorId: recipient.actorId, correlationId: command.operationId },
        async (query) => {
          guard();
          return redemptionRecord(
            await scalar(
              query,
              'SELECT app_api.read_staff_invitation_redemption($1,$2,$3) AS result',
              [command.operationId, recipient.issuer, recipient.recipientEmail],
            ),
            command,
            recipient.actorId,
          );
        },
      );
    },
  });
}
