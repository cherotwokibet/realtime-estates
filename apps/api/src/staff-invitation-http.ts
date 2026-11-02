import {
  parseStaffIssuedInvitationJson,
  validateStaffInvitationIssueCommand,
  validateStaffInvitationRedemptionCommand,
  validateStaffInvitationRawSecret,
  validateStaffInvitationIssueResponse,
} from '@realtor/domain';
import { parseBearerHeader, type IdentityVerifierConfig } from './auth.js';
import type { TransactionDatabase } from './database.js';
import { createStaffInvitationRedemptionCandidate } from './staff-invitation-redemption.js';

class InputError extends Error {
  constructor(readonly status: number) {
    super('Invitation request unavailable.');
  }
}
function exact(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new InputError(400);
  const keys = Reflect.ownKeys(value),
    row: Record<string, unknown> = Object.create(null);
  if (
    keys.length !== fields.length ||
    keys.some((key) => typeof key !== 'string' || !fields.includes(key))
  )
    throw new InputError(400);
  for (const field of fields) {
    const d = Object.getOwnPropertyDescriptor(value, field);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw new InputError(400);
    row[field] = d.value;
  }
  return row;
}
async function body(request: Request): Promise<unknown> {
  if (
    request.headers.get('content-type') !== 'application/json' ||
    request.headers.has('content-encoding')
  )
    throw new InputError(400);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9]\d*)$/.test(length) || Number(length) > 2048))
    throw new InputError(413);
  const reader = request.body?.getReader();
  if (!reader) throw new InputError(400);
  let total = 0;
  const parts: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > 2048) throw new InputError(413);
      parts.push(next.value);
    }
    if (length !== null && Number(length) !== total) throw new InputError(400);
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      bytes.set(part, offset);
      offset += part.byteLength;
    }
    try {
      return parseStaffIssuedInvitationJson(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes),
      );
    } catch {
      throw new InputError(400);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
function json(status: number, payload: unknown, requestId: string, allow?: string): Response {
  return Response.json(payload, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': requestId,
      ...(allow ? { Allow: allow } : {}),
    },
  });
}
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const route = new RegExp(
  '^/v2/staff/(invitation-issues|invitation-redemptions)/(' +
    UUID +
    ')/operations/(' +
    UUID +
    ')(\/state)?$',
);
/** Separate opt-in handler; caller supplies host-resolved company and trusted verifier config. */
export function createStaffInvitationHttpCandidate(options: {
  mode: 'synthetic-single-use-invitations-v1';
  identity: IdentityVerifierConfig;
  database: TransactionDatabase;
  tenantId: string;
}) {
  const candidate = createStaffInvitationRedemptionCandidate({
    database: options.database,
    identity: options.identity,
    mode: options.mode,
  });
  const tenantId = options.tenantId;
  if (!new RegExp('^' + UUID + '$').test(tenantId))
    throw Error('Canonical invitation company required.');
  return async (request: Request, requestId: string): Promise<Response> => {
    let allow: string | undefined;
    try {
      if (process.env.NODE_ENV === 'production') throw new InputError(404);
      const url = new URL(request.url),
        match = route.exec(url.pathname);
      if (!match || url.search || url.hash || (match[1] === 'invitation-redemptions' && match[4]))
        throw new InputError(404);
      const state = !!match[4],
        redemption = match[1] === 'invitation-redemptions';
      allow = state ? 'GET' : 'GET, POST';
      if (!['GET', ...(state ? [] : ['POST'])].includes(request.method)) throw new InputError(405);
      if (
        [
          'cookie',
          'if-match',
          'if-none-match',
          'if-modified-since',
          'if-unmodified-since',
          'range',
          'if-range',
          'idempotency-key',
        ].some((name) => request.headers.has(name))
      )
        throw new InputError(400);
      const bearer = parseBearerHeader(request.headers.get('authorization') ?? undefined);
      const input = { tenantId, invitationId: match[2]!, operationId: match[3]! };
      if (request.method === 'GET') {
        if (
          request.body ||
          request.headers.has('transfer-encoding') ||
          (request.headers.has('content-length') && request.headers.get('content-length') !== '0')
        )
          throw new InputError(400);
        return json(
          200,
          state
            ? await candidate.readState(input, bearer)
            : redemption
              ? await candidate.readRedemption(input, bearer)
              : await candidate.readIssue(input, bearer),
          requestId,
        );
      }
      let command,
        secret: string | null = null;
      try {
        const parsed = await body(request);
        if (redemption) {
          const submission = exact(parsed, ['command', 'secret']);
          command = validateStaffInvitationRedemptionCommand(submission.command);
          secret = validateStaffInvitationRawSecret(submission.secret);
        } else command = validateStaffInvitationIssueCommand(parsed);
        if (
          command.operationId !== input.operationId ||
          command.invitationId !== input.invitationId
        )
          throw Error();
      } catch (error) {
        if (error instanceof InputError) throw error;
        throw new InputError(400);
      }
      if (redemption) return json(200, await candidate.redeem(input, bearer, secret), requestId);
      const result = await candidate.issue(input, bearer);
      try {
        const disclosed = validateStaffInvitationIssueResponse(
          {
            policy: 'staff-invitation-issue-response-v1',
            record: result.receipt,
            secret: result.secretAvailable ? result.takeSecretOnce() : null,
          },
          command.operationId,
          command.invitationId,
        );
        return json(200, disclosed, requestId);
      } finally {
        result.destroySecret();
      }
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
      const status =
        error instanceof InputError
          ? error.status
          : code === 'UNAUTHENTICATED'
            ? 401
            : code === '42501'
              ? 403
              : code === 'P0002'
                ? 404
                : code === '23505' || code === '40001'
                  ? 409
                  : ['23514', '23502', '23503', '22P02'].includes(code as string)
                    ? 422
                    : 503;
      const name = (
        {
          400: 'INVALID_INPUT',
          401: 'UNAUTHENTICATED',
          403: 'FORBIDDEN',
          404: 'NOT_FOUND',
          405: 'METHOD_NOT_ALLOWED',
          409: 'CONFLICT',
          413: 'BODY_TOO_LARGE',
          422: 'INVALID_STATE',
          503: 'SERVICE_UNAVAILABLE',
        } as Record<number, string>
      )[status]!;
      return json(
        status,
        { error: { code: name, message: 'Staff invitation operation unavailable.' }, requestId },
        requestId,
        status === 405 ? allow : undefined,
      );
    }
  };
}
