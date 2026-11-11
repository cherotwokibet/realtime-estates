import { randomUUID } from 'node:crypto';
import {
  parseCustomerFavouriteJson,
  validateCustomerAccount,
  validateCustomerFavouriteCommand,
  validateCustomerFavouriteReceipt,
  validateCustomerFavouriteState,
  validateCustomerFavouritesPage,
  type CustomerFavouriteCommand,
  validateCustomerPushCommand,
  validateCustomerPushPreferences,
  validateCustomerPushReceipt,
  type CustomerPushCommand,
  validateCustomerDeletionCommand,
  validateCustomerDeletionRequest,
  type CustomerDeletionCommand,
} from '@realtor/domain';
import { parseBearerHeader } from './auth.js';
import type { TransactionDatabase } from './database.js';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const validId = (v: unknown): v is string =>
  typeof v === 'string' && new RegExp('^' + UUID + '$').test(v);
class InputError extends Error {
  constructor(readonly status: number) {
    super('Customer request unavailable.');
  }
}
function json(status: number, value: unknown, id: string, allow?: string) {
  return Response.json(value, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': id,
      ...(allow ? { Allow: allow } : {}),
    },
  });
}
async function body(request: Request): Promise<unknown> {
  if (request.headers.get('content-type') !== 'application/json') throw new InputError(400);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^(0|[1-9][0-9]*)$/.test(length) || Number(length) > 2048))
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
    let at = 0;
    for (const part of parts) {
      bytes.set(part, at);
      at += part.length;
    }
    try {
      return parseCustomerFavouriteJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    } catch {
      throw new InputError(400);
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
/** Host-resolved tenant and verifier are server-owned. This handler never installs its isolated SQL. */
export function createCustomerFavouritesHttpCandidate(options: {
  mode: 'synthetic-customer-favourites-v1';
  pushMode?: 'synthetic-customer-push-v1';
  deletionMode?: 'synthetic-customer-deletion-v1';
  tenantId: string;
  database: TransactionDatabase;
  verifyAuthorization: (request: Request) => Promise<{ readonly actorId: string }>;
}) {
  if (
    options.mode !== 'synthetic-customer-favourites-v1' ||
    (options.pushMode !== undefined && options.pushMode !== 'synthetic-customer-push-v1') ||
    (options.deletionMode !== undefined &&
      (options.deletionMode !== 'synthetic-customer-deletion-v1' ||
        !options.pushMode ||
        process.env.NODE_ENV !== 'development')) ||
    process.env.NODE_ENV === 'production' ||
    !validId(options.tenantId)
  )
    throw Error('Unsupported customer favourites configuration.');
  const tenantId = options.tenantId,
    database = options.database,
    verify = options.verifyAuthorization,
    pushEnabled = options.pushMode === 'synthetic-customer-push-v1',
    deletionEnabled = options.deletionMode === 'synthetic-customer-deletion-v1';
  return async (request: Request, requestId: string = randomUUID()): Promise<Response> => {
    let pushRoute = false;
    try {
      if (process.env.NODE_ENV === 'production')
        return json(
          404,
          { error: { code: 'NOT_FOUND', message: 'Route unavailable.' } },
          requestId,
        );
      const url = new URL(request.url),
        path = url.pathname;
      const state = new RegExp('^/v2/customer/favourites/(' + UUID + ')$').exec(path),
        original = new RegExp('^/v2/customer/favourite-operations/(' + UUID + ')$').exec(path);
      const pushPreferences = pushEnabled && path === '/v2/customer/push-preferences';
      const pushOriginal = pushEnabled
        ? new RegExp('^/v2/customer/push-operations/(' + UUID + ')$').exec(path)
        : null;
      pushRoute = pushPreferences || pushOriginal !== null;
      const account = path === '/v2/customer/account',
        queue = path === '/v2/customer/favourites';
      const deletionStatus = deletionEnabled && path === '/v2/customer/deletion-request';
      const deletionSubmit = deletionEnabled
        ? new RegExp('^/v2/customer/deletion-requests/(' + UUID + ')$').exec(path)
        : null;
      if ((deletionStatus || deletionSubmit) && process.env.NODE_ENV !== 'development')
        throw new InputError(404);
      if (
        !account &&
        !queue &&
        !state &&
        !original &&
        !pushRoute &&
        !deletionStatus &&
        !deletionSubmit
      )
        throw new InputError(404);
      const method = request.method.toUpperCase();
      const canWrite = original || pushOriginal;
      const allow = deletionSubmit ? 'POST' : canWrite ? 'GET, POST' : 'GET';
      if (
        deletionSubmit ? method !== 'POST' : !(method === 'GET' || (canWrite && method === 'POST'))
      )
        return json(
          405,
          { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method unavailable.' } },
          requestId,
          allow,
        );
      const write = method === 'POST';
      const names: string[] = [];
      request.headers.forEach((_v, key) => names.push(key));
      for (const key of names)
        if (
          key.startsWith('x-') ||
          key.startsWith('if-') ||
          [
            'cookie',
            'range',
            'idempotency-key',
            'content-encoding',
            'transfer-encoding',
            'expect',
          ].includes(key) ||
          (!write && ['content-type', 'content-length'].includes(key))
        )
          throw new InputError(400);
      if (
        request.url.includes('#') ||
        (!queue && request.url.includes('?')) ||
        (!write && request.body !== null)
      )
        throw new InputError(400);
      let limit = 20,
        after: string | null = null;
      if (queue) {
        const seen = new Set<string>();
        for (const [k, v] of url.searchParams) {
          if (seen.has(k) || !['limit', 'after'].includes(k)) throw new InputError(400);
          seen.add(k);
          if (k === 'limit') {
            if (!/^(?:[1-9]|[1-4][0-9]|50)$/.test(v)) throw new InputError(400);
            limit = Number(v);
          } else {
            if (!validId(v)) throw new InputError(400);
            after = v;
          }
        }
        if (request.url.endsWith('?')) throw new InputError(400);
      }
      let actorId: string;
      try {
        parseBearerHeader(request.headers.get('authorization') ?? undefined);
        actorId = (await verify(request)).actorId;
        if (!validId(actorId)) throw Error();
      } catch {
        throw new InputError(401);
      }
      const scope = { tenantId, customerId: actorId };
      let command: CustomerFavouriteCommand | undefined;
      let pushCommand: CustomerPushCommand | undefined;
      let deletionCommand: CustomerDeletionCommand | undefined;
      if (write) {
        try {
          const input = await body(request);
          if (deletionSubmit) {
            deletionCommand = validateCustomerDeletionCommand(input);
            if (deletionCommand.requestId !== deletionSubmit[1]) throw new InputError(400);
          } else if (pushOriginal) {
            pushCommand = validateCustomerPushCommand(input);
            if (pushCommand.operationId !== pushOriginal[1]) throw new InputError(400);
          } else {
            command = validateCustomerFavouriteCommand(input);
            if (command.operationId !== original?.[1]) throw new InputError(400);
          }
        } catch (error) {
          if (error instanceof InputError) throw error;
          throw new InputError(400);
        }
      }
      const value = await database.transaction(
        { tenantId, actorId, correlationId: requestId },
        async (query) => {
          let sql: string,
            args: unknown[] = [];
          if (deletionStatus) sql = 'SELECT app_api.read_customer_deletion_request() AS result';
          else if (deletionCommand) {
            sql = 'SELECT app_api.request_customer_deletion($1,$2) AS result';
            args = [deletionCommand.requestId, deletionCommand.confirmed];
          } else if (pushPreferences)
            sql = 'SELECT app_api.read_customer_push_preferences() AS result';
          else if (pushCommand) {
            sql = 'SELECT app_api.change_customer_push_preferences($1,$2,$3,$4,$5) AS result';
            args = [
              pushCommand.operationId,
              pushCommand.expectedVersion,
              pushCommand.action,
              pushCommand.enabled,
              pushCommand.registrationId,
            ];
          } else if (pushOriginal) {
            sql = 'SELECT app_api.read_customer_push_operation($1) AS result';
            args = [pushOriginal[1]];
          } else if (account) sql = 'SELECT app_api.customer_account() AS result';
          else if (queue) {
            sql = 'SELECT app_api.list_customer_favourites($1,$2) AS result';
            args = [limit, after];
          } else if (state) {
            sql = 'SELECT app_api.read_customer_favourite($1) AS result';
            args = [state[1]];
          } else if (command) {
            sql = 'SELECT app_api.set_customer_favourite($1,$2,$3,$4) AS result';
            args = [command.operationId, command.listingId, command.expectedVersion, command.saved];
          } else {
            sql = 'SELECT app_api.read_customer_favourite_operation($1) AS result';
            args = [original![1]];
          }
          const rows = await query.query<{ result: unknown }>(sql, args);
          const r = rows.rows[0]?.result;
          if (deletionStatus) return r === null ? null : validateCustomerDeletionRequest(r, scope);
          if (deletionCommand)
            return validateCustomerDeletionRequest(r, scope, deletionCommand.requestId);
          if (pushPreferences) return validateCustomerPushPreferences(r, scope);
          if (pushOriginal)
            return validateCustomerPushReceipt(r, scope, pushOriginal[1]!, pushCommand);
          if (account) return validateCustomerAccount(r, scope);
          if (queue) return validateCustomerFavouritesPage(r, scope, limit, after);
          if (state) return validateCustomerFavouriteState(r, scope, state[1]!);
          if (command) return validateCustomerFavouriteReceipt(r, command, scope);
          // Recovery has no submitted command: first extract the immutable original request, then validate every receipt field.
          if (!r || typeof r !== 'object') throw Error('Invalid original');
          const row: Record<string, unknown> = Object.create(null);
          for (const field of ['listingId', 'expectedVersion', 'requestedSaved']) {
            const d = Object.getOwnPropertyDescriptor(r, field);
            if (!d?.enumerable || !Object.hasOwn(d, 'value')) throw Error('Invalid original');
            row[field] = d.value;
          }
          return validateCustomerFavouriteReceipt(
            r,
            validateCustomerFavouriteCommand({
              policy: 'customer-favourite-command-v1',
              operationId: original![1],
              listingId: row.listingId,
              expectedVersion: row.expectedVersion,
              saved: row.requestedSaved,
            }),
            scope,
          );
        },
      );
      return json(200, value, requestId);
    } catch (error) {
      const code = (error as { code?: string })?.code;
      const status =
        error instanceof InputError
          ? error.status
          : code === '42501'
            ? 403
            : code === 'P0002'
              ? 404
              : code === '23505'
                ? 409
                : code === '54000'
                  ? 429
                  : code === '23514' || code === '22P02'
                    ? 400
                    : 500;
      return json(
        status,
        {
          error: {
            code:
              status === 401
                ? 'UNAUTHENTICATED'
                : status === 403
                  ? 'FORBIDDEN'
                  : status === 404
                    ? 'NOT_FOUND'
                    : status === 429
                      ? pushRoute
                        ? 'PUSH_DEVICE_LIMIT'
                        : 'FAVOURITE_LIMIT'
                      : status === 500
                        ? 'UNAVAILABLE'
                        : 'INVALID_REQUEST',
            message: 'Customer request unavailable.',
          },
        },
        requestId,
      );
    }
  };
}
