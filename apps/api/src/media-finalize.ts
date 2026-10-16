import { randomUUID } from 'node:crypto';
import { isProxy } from 'node:util/types';
import type {
  MediaAttachIntentView,
  MediaAttachTerminalReceipt,
} from '@realtor/media/coordinator-database';
import {
  createTenantResolver,
  parseBearerHeader,
  type TenantConfiguration,
  type VerifiedIdentity,
} from './auth.js';
import type { TransactionDatabase } from './database.js';

const UUID =
  '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}';
const ID = new RegExp(`^${UUID}$`);
const ROUTE = new RegExp(
  `^/v2/staff/listings/(${UUID})/revisions/([1-9]\\d*)/media-attach-intents/(${UUID})/finalize$`,
);
const FACTS = ['kind', 'operationId', 'jobId', 'listingId', 'revision', 'expectedVersion'] as const;
const REASONS = {
  conflict: ['VERSION_CONFLICT', 'ASSIGNMENT_CHANGED'],
  expired: ['JOB_EXPIRED'],
  rejected: [
    'REVISION_NOT_DRAFT',
    'DUPLICATE_OUTPUT',
    'CAPACITY_REACHED',
    'JOB_ALREADY_ATTACHED',
    'PROVENANCE_CHANGED',
  ],
} as const;
interface Resource {
  readonly listingId: string;
  readonly revision: number;
  readonly operationId: string;
}
export interface DevelopmentMediaFinalizeOptions {
  readonly tenant: TenantConfiguration;
  readonly database: TransactionDatabase;
  readonly verifyBearer: (bearer: string) => Promise<VerifiedIdentity>;
  /** Trusted restricted coordinator adapter; never a browser-selected command. */
  readonly coordinator: Readonly<{
    finalizeMedia(operationId: string): Promise<MediaAttachIntentView>;
  }>;
}
export interface DevelopmentMediaFinalizeApi {
  handle(request: Request): Promise<Response>;
  /** Drain this adapter only; caller-owned database/coordinator remain open. */
  close(): Promise<void>;
}
class BoundaryError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
function invalid(): never {
  throw new BoundaryError(503, 'ATTACHMENT_UNCONFIRMED');
}
function record(value: unknown, fields: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    isProxy(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)
  )
    invalid();
  const result: Record<string, unknown> = {};
  // Future/private fields never enter the projected public envelope.
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) invalid();
    result[field] = descriptor.value;
  }
  return result;
}
function version(value: unknown, maximum: bigint): string {
  if (typeof value !== 'string' || !/^[1-9]\d{0,15}$/.test(value) || BigInt(value) > maximum)
    invalid();
  return value;
}
function projection(value: unknown, resource: Resource): MediaAttachIntentView {
  const row = record(value, [...FACTS, 'altText', 'status', 'receipt']);
  if (
    row.kind !== 'attach_media' ||
    row.operationId !== resource.operationId ||
    row.listingId !== resource.listingId ||
    row.revision !== resource.revision
  )
    throw new BoundaryError(404, 'NOT_FOUND');
  if (
    typeof row.jobId !== 'string' ||
    !ID.test(row.jobId) ||
    row.jobId !== row.jobId.toLowerCase() ||
    row.jobId === resource.operationId
  )
    invalid();
  const expectedVersion = version(row.expectedVersion, 9007199254740990n);
  if (
    typeof row.altText !== 'string' ||
    row.altText !== row.altText.trim() ||
    [...row.altText].length < 1 ||
    [...row.altText].length > 300 ||
    /[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(row.altText)
  )
    invalid();
  const common = {
    kind: 'attach_media' as const,
    operationId: resource.operationId,
    jobId: row.jobId,
    listingId: resource.listingId,
    revision: resource.revision,
    expectedVersion,
  };
  if (row.status === 'ready') {
    if (row.receipt !== null) invalid();
    return Object.freeze({ ...common, altText: row.altText, status: 'ready', receipt: null });
  }
  if (
    typeof row.status !== 'string' ||
    !['applied', 'conflict', 'rejected', 'expired'].includes(row.status)
  )
    invalid();
  const terminal = record(row.receipt, [
    ...FACTS,
    'version',
    'outcome',
    'reason',
    'mediaId',
    'position',
    'completedAt',
  ]);
  if (FACTS.some((field) => terminal[field] !== common[field]) || terminal.outcome !== row.status)
    invalid();
  const resultVersion = version(terminal.version, 9007199254740991n);
  if (row.status === 'applied') {
    if (
      terminal.reason !== null ||
      BigInt(resultVersion) !== BigInt(expectedVersion) + 1n ||
      typeof terminal.mediaId !== 'string' ||
      !ID.test(terminal.mediaId) ||
      terminal.mediaId !== terminal.mediaId.toLowerCase() ||
      [common.operationId, common.jobId].includes(terminal.mediaId) ||
      typeof terminal.position !== 'number' ||
      !Number.isInteger(terminal.position) ||
      terminal.position < 0 ||
      terminal.position > 11
    )
      invalid();
  } else if (
    terminal.mediaId !== null ||
    terminal.position !== null ||
    !REASONS[row.status as keyof typeof REASONS].includes(terminal.reason as never)
  )
    invalid();
  if (
    typeof terminal.completedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(terminal.completedAt) ||
    !Number.isFinite(Date.parse(terminal.completedAt)) ||
    new Date(terminal.completedAt).toISOString() !== terminal.completedAt.slice(0, 23) + 'Z'
  )
    invalid();
  const receipt = Object.freeze({
    ...common,
    version: resultVersion,
    outcome: row.status,
    reason: terminal.reason,
    mediaId: terminal.mediaId,
    position: terminal.position,
    completedAt: terminal.completedAt,
  }) as MediaAttachTerminalReceipt;
  return Object.freeze({
    ...common,
    altText: row.altText,
    status: row.status,
    receipt,
  }) as MediaAttachIntentView;
}
function sameBinding(a: MediaAttachIntentView, b: MediaAttachIntentView): boolean {
  return FACTS.every((field) => a[field] === b[field]) && a.altText === b.altText;
}
function wire(value: MediaAttachIntentView): Record<string, unknown> {
  return {
    ...value,
    receipt:
      value.receipt === null
        ? null
        : { ...value.receipt, completedAt: value.receipt.completedAt.slice(0, 23) + 'Z' },
  };
}
function response(status: number, payload: unknown, requestId: string): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': requestId,
    },
  });
}
async function emptyBody(request: Request): Promise<void> {
  if (request.body === null) return;
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const denied = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new BoundaryError(400, 'INVALID_INPUT')), 1000);
  });
  try {
    // The existing development bridge represents an empty POST as an empty
    // Uint8Array stream. Accept that representation, never any posted metadata.
    for (let n = 0; n < 2; n++) {
      const item = await Promise.race([reader.read(), denied]);
      if (item.done) return;
      if (item.value.byteLength !== 0) throw new BoundaryError(400, 'INVALID_INPUT');
    }
    throw new BoundaryError(400, 'INVALID_INPUT');
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

/** Explicit synthetic loopback command. Existing intent creation and GET remain read-only. */
export function createDevelopmentMediaFinalizeApi(
  options: DevelopmentMediaFinalizeOptions,
): DevelopmentMediaFinalizeApi {
  if (process.env.NODE_ENV === 'production')
    throw new Error('The synthetic media finalizer is development-only.');
  const resolver = createTenantResolver([options.tenant]),
    tenantId = options.tenant.tenantId.toLowerCase();
  if (
    !ID.test(tenantId) ||
    typeof options.verifyBearer !== 'function' ||
    typeof options.database?.transaction !== 'function' ||
    typeof options.coordinator?.finalizeMedia !== 'function'
  )
    throw new Error('Invalid trusted finalization configuration.');
  const database = options.database,
    verify = options.verifyBearer,
    finalize = options.coordinator.finalizeMedia.bind(options.coordinator);
  let closing = false,
    closed: Promise<void> | undefined;
  const active = new Set<Promise<Response>>();
  async function read(
    resource: Resource,
    actorId: string,
    requestId: string,
  ): Promise<MediaAttachIntentView> {
    let value: unknown;
    try {
      value = await database.transaction(
        { tenantId, actorId, correlationId: requestId },
        async (query) => {
          const result = await query.query(
            'SELECT app_api.read_media_attach_intent($1::uuid) AS receipt',
            [resource.operationId],
          );
          if (result.rows.length !== 1) invalid();
          return result.rows[0]?.receipt;
        },
      );
    } catch (error) {
      if (error instanceof BoundaryError) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
      if (['42501', 'P0002'].includes(code)) throw new BoundaryError(404, 'NOT_FOUND');
      invalid();
    }
    return projection(value, resource);
  }
  async function dispatch(request: Request): Promise<Response> {
    const requestId = randomUUID();
    let invoked = false;
    try {
      const url = new URL(request.url),
        match = ROUTE.exec(url.pathname);
      if (!match || url.search || url.hash) throw new BoundaryError(404, 'NOT_FOUND');
      if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))
        throw new BoundaryError(404, 'NOT_FOUND');
      try {
        if (resolver(url.host).tenantId.toLowerCase() !== tenantId) throw new Error();
      } catch {
        throw new BoundaryError(404, 'NOT_FOUND');
      }
      const host = request.headers.get('host');
      if (host !== null && host !== url.host) throw new BoundaryError(404, 'NOT_FOUND');
      if (request.method !== 'POST') throw new BoundaryError(405, 'METHOD_NOT_ALLOWED');
      const revision = Number(match[2]);
      if (!Number.isSafeInteger(revision) || revision > 2147483647)
        throw new BoundaryError(400, 'INVALID_INPUT');
      if (
        request.headers.has('cookie') ||
        request.headers.has('expect') ||
        request.headers.has('transfer-encoding') ||
        request.headers.has('content-type') ||
        request.headers.has('content-encoding') ||
        !['0', null].includes(request.headers.get('content-length'))
      )
        throw new BoundaryError(400, 'INVALID_INPUT');
      if (request.headers.has('origin') && request.headers.get('origin') !== url.origin)
        throw new BoundaryError(403, 'FORBIDDEN');
      await emptyBody(request);
      let actorId: string;
      try {
        actorId = (
          await verify(parseBearerHeader(request.headers.get('authorization') ?? undefined))
        ).actorId;
        if (!ID.test(actorId)) throw new Error();
        actorId = actorId.toLowerCase();
      } catch {
        throw new BoundaryError(401, 'UNAUTHENTICATED');
      }
      const resource = Object.freeze({
        listingId: match[1]!.toLowerCase(),
        revision,
        operationId: match[3]!.toLowerCase(),
      });
      const before = await read(resource, actorId, requestId);
      if (before.status !== 'ready') return response(200, wire(before), requestId);
      if (request.signal.aborted) throw new BoundaryError(400, 'REQUEST_ABORTED');
      invoked = true;
      let raw: unknown,
        commandFailed = false;
      try {
        raw = await finalize(resource.operationId);
      } catch {
        commandFailed = true;
      }
      // A lost/failed command result is reconciled only by an authorized original
      // read. Never call finalize again, manufacture failure, or adopt new facts.
      const after = await read(resource, actorId, requestId);
      if (!sameBinding(before, after) || after.status === 'ready') invalid();
      if (!commandFailed) {
        const returned = projection(raw, resource);
        if (
          returned.status === 'ready' ||
          !sameBinding(before, returned) ||
          JSON.stringify(returned) !== JSON.stringify(after)
        )
          invalid();
      }
      return response(200, wire(after), requestId);
    } catch (error) {
      const known =
        error instanceof BoundaryError ? error : new BoundaryError(503, 'ATTACHMENT_UNCONFIRMED');
      return response(
        known.status,
        {
          error: {
            code: known.code,
            message:
              known.status === 503
                ? 'The original attachment result is unconfirmed. Check its saved intent.'
                : 'Attachment request is unavailable.',
          },
          requestId,
          ...(invoked ? { submissionUncertain: true } : {}),
        },
        requestId,
      );
    }
  }
  function handle(request: Request): Promise<Response> {
    if (closing) {
      const id = randomUUID();
      return Promise.resolve(
        response(
          503,
          {
            error: {
              code: 'SERVICE_UNAVAILABLE',
              message: 'The development finalizer is closing.',
            },
            requestId: id,
          },
          id,
        ),
      );
    }
    const work = dispatch(request);
    active.add(work);
    void work.finally(() => active.delete(work)).catch(() => undefined);
    return work;
  }
  function close(): Promise<void> {
    closing = true;
    closed ??= Promise.allSettled([...active]).then(() => undefined);
    return closed;
  }
  return Object.freeze({ handle, close });
}
