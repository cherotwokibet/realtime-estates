import {
  validateListingSuccessorCommand,
  validateListingSuccessorReceipt,
  validateListingSuccessorSnapshot,
  type ListingSuccessorCommand,
  validateListingCreationCommand,
  validateListingCreationReceipt,
  validateListingCreationSnapshot,
  type ListingCreationCommand,
  validateStaffListingPage,
  validateViewingOutcomeCommand,
  validateViewingOutcomeReceipt,
  type ViewingOutcomeCommand,
} from '@realtor/domain';
import {
  validateViewingReminderAdmissionCommand,
  validateViewingReminderAdmissionReceipt,
  validateViewingReminderAdmissionSnapshot,
  validateViewingReminderCaptureCommand,
  validateViewingReminderCaptureReceipt,
  type ViewingReminderAdmissionCommand,
  type ViewingReminderCaptureCommand,
} from '@realtor/domain';
import { randomUUID } from 'node:crypto';
import {
  validateViewingRescheduleCommand,
  validateViewingRescheduleReceipt,
  type ViewingRescheduleCommand,
  validateViewingHistoryPage,
  validateViewingTerminationCommand,
  validateViewingTerminationReceipt,
  type ViewingTerminationCommand,
  validateViewingConfirmationCommand,
  validateViewingConfirmationReceipt,
  type ViewingConfirmationCommand,
  validateViewingOriginal,
  validateViewingRequestCommand,
  validateViewingProposalCommand,
  validateViewingReceipt,
  validateViewingDetail,
  validateViewingPage,
  type ViewingOriginal,
} from '@realtor/domain';
import {
  validateContactCommand,
  validateContactReceipt,
  validateContactPage,
  validateEnquiryActivityPage,
  calculateWirePricingV2,
  kesFromMinor,
  normalizeKenyanPhone,
  parseListingJsonV2,
  parseListingSuccessorJsonV2,
  validatePricingInputV2,
  validatePublicLocationV2,
} from '@realtor/domain';
import {
  DatabaseSafetyError,
  type TransactionDatabase,
  type TransactionQuery,
} from './database.js';

export interface VerifiedIdentity {
  readonly actorId: string;
}
export interface LimiterResult {
  readonly allowed: boolean;
  readonly retryAfterSeconds: number;
}
export interface EnquiryLimiter {
  consume(key: string): LimiterResult | Promise<LimiterResult>;
}
export interface ApiServiceOptions {
  /** Explicit internal synthetic mode. Omission disables all reminder admission/capture HTTP routes. */
  readonly reminderCaptureMode?: 'capture-only-v1';
  readonly database: TransactionDatabase;
  /** Trusted deployment/hostname mapping, never selected from request body/query/token claims. */
  readonly tenantId: string;
  /** Trusted current disclosure version. Deployment must supply reviewed notice text for this version. */
  readonly privacyNoticeVersion: string;
  readonly verifyAuthorization: (request: Request) => Promise<VerifiedIdentity>;
  readonly limiter?: EnquiryLimiter;
  /** Derive from a trusted socket/proxy configuration. Do not trust arbitrary forwarded headers. */
  readonly clientKey?: (request: Request) => string;
  readonly uuid?: () => string;
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly headers?: Record<string, string>,
  ) {
    super(message);
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value))
    throw new HttpError(400, 'INVALID_INPUT', `${field} must be a UUID.`);
  return value.toLowerCase();
}
function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    throw new HttpError(400, 'INVALID_INPUT', 'Request contains unsupported fields.');
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, maximum: number): string {
  if (
    typeof value !== 'string' ||
    value.trim().length < 1 ||
    value.trim().length > maximum ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)
  )
    throw new HttpError(
      400,
      'INVALID_INPUT',
      `${field} is required and must be at most ${maximum} characters.`,
    );
  return value.trim();
}
function version(value: unknown, allowNew = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowNew ? 0 : 1))
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'expectedVersion must be a non-negative integer for a new draft or positive integer for an existing revision.',
    );
  return value;
}
function limit(request: Request): number {
  const value = new URL(request.url).searchParams.get('limit');
  if (value === null) return 50;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100)
    throw new HttpError(400, 'INVALID_INPUT', 'limit must be between 1 and 100.');
  return Number(value);
}

function assertDecisionJsonTokens(source: string): void {
  // Check original tokens before JSON.parse can round a fractional version. Whole
  // string tokens keep reason text separate; decoding keys catches escaped duplicates.
  // JSON.parse below independently rejects every syntax error or skipped character.
  const tokens =
    source.match(
      /"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g,
    ) ?? [];
  const containers: (Set<string> | null)[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === '{') containers.push(new Set());
    else if (token === '[') containers.push(null);
    else if (token === '}' || token === ']') containers.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ':') {
      const keys = containers.at(-1),
        key = JSON.parse(token) as string;
      if (!keys || keys.has(key)) throw new Error('Duplicate JSON object key.');
      keys.add(key);
      if (
        ['expectedVersion', 'expectedEnquiryVersion'].includes(key) &&
        !/^[1-9]\d*$/.test(tokens[index + 2] ?? '')
      )
        throw new Error('Expected version requires a positive integer JSON literal.');
    }
  }
}
async function jsonBody(
  request: Request,
  maximum: number,
  integerMoney = false,
  strictDecision = false,
  exactLength = false,
  integerRevision = false,
): Promise<unknown> {
  if (
    !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get('content-type') ?? '')
  )
    throw new HttpError(415, 'JSON_REQUIRED', 'Use application/json.');
  const declared = request.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum))
    throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
  if (!request.body) throw new HttpError(400, 'INVALID_JSON', 'A JSON body is required.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) {
        await reader.cancel();
        throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  if (exactLength && declared !== null && Number(declared) !== size)
    throw new HttpError(400, 'INVALID_INPUT', 'Declared body length does not match the command.');
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    const source = new TextDecoder('utf-8', { fatal: true }).decode(body);
    if (strictDecision) assertDecisionJsonTokens(source);
    return integerMoney
      ? integerRevision
        ? parseListingSuccessorJsonV2(source)
        : parseListingJsonV2(source)
      : JSON.parse(source);
  } catch {
    throw new HttpError(
      400,
      'INVALID_JSON',
      integerMoney
        ? 'Request body must contain valid JSON with integer-literal minor-unit amounts.'
        : 'Request body must contain valid JSON.',
    );
  }
}

/** Process-local development protection: bounded memory and fail-closed capacity. Use a distributed limiter before public launch. */
export function createLocalEnquiryLimiter(
  options: {
    readonly limit?: number;
    readonly windowMs?: number;
    readonly maxEntries?: number;
    readonly now?: () => number;
  } = {},
): EnquiryLimiter {
  const maximum = options.limit ?? 10;
  const windowMs = options.windowMs ?? 60000;
  const maxEntries = options.maxEntries ?? 1000;
  const now = options.now ?? Date.now;
  if (![maximum, windowMs, maxEntries].every((value) => Number.isSafeInteger(value) && value > 0))
    throw new Error('Limiter bounds must be positive integers.');
  const entries = new Map<string, { count: number; expires: number }>();
  return {
    consume(key) {
      const current = now();
      for (const [candidate, state] of entries)
        if (state.expires <= current) entries.delete(candidate);
      const existing = entries.get(key);
      if (!existing && entries.size >= maxEntries)
        return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      const state = existing ?? { count: 0, expires: current + windowMs };
      entries.set(key, state);
      if (state.count >= maximum)
        return {
          allowed: false,
          retryAfterSeconds: Math.max(1, Math.ceil((state.expires - current) / 1000)),
        };
      state.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

function response(
  status: number,
  payload: unknown,
  correlationId: string,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'X-Request-Id': correlationId,
      ...extra,
    },
  });
}
function safeError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof DatabaseSafetyError)
    return new HttpError(503, 'SERVICE_UNAVAILABLE', 'Service is unavailable.');
  const code =
    typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : '';
  if (code === '42501') return new HttpError(403, 'FORBIDDEN', 'This operation is not allowed.');
  if (code === 'P0002') return new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
  if (code === '40001' || code === '23505')
    return new HttpError(
      409,
      'CONFLICT',
      'Resource version or idempotency key conflicts with the request.',
    );
  if (['23514', '23502', '23503', '22P02', '22003'].includes(code))
    return new HttpError(
      422,
      'INVALID_STATE',
      'Request does not satisfy the current data or workflow requirements.',
    );
  return new HttpError(503, 'SERVICE_UNAVAILABLE', 'Service is unavailable.');
}
async function assertStaff(query: TransactionQuery): Promise<void> {
  const result = await query.query('SELECT app_private.staff_role() AS role');
  if (!['agent', 'admin'].includes(String(result.rows[0]?.role)))
    throw new HttpError(403, 'FORBIDDEN', 'An active staff membership is required.');
}
async function assertAdmin(query: TransactionQuery): Promise<void> {
  const result = await query.query('SELECT app_private.staff_role() AS role');
  if (result.rows[0]?.role !== 'admin')
    throw new HttpError(403, 'FORBIDDEN', 'An active admin membership is required.');
}
function scalar(result: { readonly rows: Record<string, unknown>[] }, key: string): unknown {
  const value = result.rows[0]?.[key];
  if (value === undefined || value === null) throw new Error('Unexpected database response.');
  return value;
}

const DRAFT_FIELDS = [
  'title',
  'description',
  'purpose',
  'propertyType',
  'currency',
  'amountMinor',
  'rentPeriod',
  'bedrooms',
  'privateBathrooms',
  'sharedBathrooms',
  'country',
  'locality',
  'publicPrecision',
  'latitude',
  'longitude',
  'privateAddress',
] as const;
function draftContentV2(input: unknown): Record<string, unknown> {
  const content = record(input, [...DRAFT_FIELDS, 'pricing', 'location']);
  try {
    const pricing = validatePricingInputV2(content.pricing);
    const location = validatePublicLocationV2(content.location);
    if (
      content.amountMinor != null &&
      (typeof content.amountMinor !== 'number' ||
        !Number.isSafeInteger(content.amountMinor) ||
        content.amountMinor <= 0 ||
        content.amountMinor > 100_000_000_000_000)
    )
      throw new Error('Invalid base amount.');
    // Incomplete drafts remain supported. Complete price inputs use the same arithmetic as the client.
    if (content.amountMinor != null && (content.purpose === 'rent' || content.purpose === 'sale')) {
      calculateWirePricingV2(
        kesFromMinor(content.amountMinor as number),
        content.purpose,
        content.rentPeriod as 'day' | 'week' | 'month' | 'year' | null,
        pricing,
      );
    }
    return { ...content, pricing, location };
  } catch {
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'Supply valid v2 pricing and public location fields.',
    );
  }
}

function publicRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    ...row,
    amountMinor: Number(row.amountMinor),
    latitude: row.latitude === null ? null : Number(row.latitude),
    longitude: row.longitude === null ? null : Number(row.longitude),
  };
}

function publicRowV2(row: Record<string, unknown>): Record<string, unknown> {
  const item = publicRow(row);
  const pricing = validatePricingInputV2(item.pricing);
  const location = validatePublicLocationV2(item.location);
  // Fail closed if persisted disclosure no longer satisfies the shared exact-money contract.
  calculateWirePricingV2(
    kesFromMinor(item.amountMinor as number),
    item.purpose as 'rent' | 'sale',
    item.rentPeriod as 'day' | 'week' | 'month' | 'year' | null,
    pricing,
  );
  return { ...item, pricing, location };
}

const REVIEW_METADATA = `r.listing_id AS "listingId",l.slug,r.revision_no AS revision,r.state,r.version::text AS version,
  l.version::text AS "listingVersion",r.title,r.purpose,r.property_type AS "propertyType",r.amount_minor::text AS "amountMinor",r.rent_period AS "rentPeriod",
  r.submitted_at AS "submittedAt",r.submitted_by AS "submittedBy",l.publication_status AS "publicationStatus",l.published_revision_no AS "publishedRevision",
  l.availability,l.last_availability_confirmed_at AS "lastAvailabilityConfirmedAt",
  (SELECT count(*)::integer FROM app_private.revision_media m WHERE m.tenant_id=r.tenant_id AND m.listing_id=r.listing_id AND m.revision_no=r.revision_no AND m.accepted) AS "acceptedPhotoCount"`;
const REVIEW_FIELDS = [
  'listingId',
  'slug',
  'revision',
  'state',
  'version',
  'listingVersion',
  'title',
  'purpose',
  'propertyType',
  'amountMinor',
  'rentPeriod',
  'submittedAt',
  'submittedBy',
  'publicationStatus',
  'publishedRevision',
  'availability',
  'lastAvailabilityConfirmedAt',
  'acceptedPhotoCount',
] as const;
function reviewMetadata(row: Record<string, unknown>): Record<string, unknown> {
  const metadata = Object.fromEntries(REVIEW_FIELDS.map((field) => [field, row[field]]));
  return { ...metadata, amountMinor: row.amountMinor === null ? null : Number(row.amountMinor) };
}
function reviewQuery(url: URL, queue: boolean): void {
  if (
    [...url.searchParams.keys()].some((key) => !queue || key !== 'limit') ||
    url.searchParams.getAll('limit').length > 1
  ) {
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'Review requests do not accept context overrides or unsupported query fields.',
    );
  }
}
function rejectionReason(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input !== input.trim() ||
    input.length === 0 ||
    [...input].length > 1000 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(input) ||
    /[\ud800-\udfff]/u.test(input)
  ) {
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'Rejection needs trimmed, nonblank, control-free text of at most 1000 characters.',
    );
  }
  return input;
}

function mediaAltText(input: unknown): string {
  if (
    typeof input !== 'string' ||
    input !== input.trim() ||
    input.length === 0 ||
    [...input].length > 300 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(input) ||
    /[\ud800-\udfff]/u.test(input)
  ) {
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'altText needs trimmed, nonblank, control-free text of at most 300 characters.',
    );
  }
  return input;
}
function mediaProjection(
  input: unknown,
  listingId: string,
  revision: number,
  job: boolean,
  resourceId: string | null,
): Record<string, unknown> {
  // Never forward private storage context or future SQL fields through this endpoint.
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Unexpected media response.');
  const row = input as Record<string, unknown>;
  if (
    row.kind !== 'register_media_upload' ||
    row.listingId !== listingId ||
    row.revision !== revision
  )
    throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
  if (resourceId !== null && row[job ? 'jobId' : 'operationId'] !== resourceId)
    throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
  if (job ? !['registered', 'expired'].includes(String(row.state)) : row.outcome !== 'registered')
    throw new Error('Unexpected media state.');
  const fields = [
    'kind',
    'operationId',
    'jobId',
    'listingId',
    'revision',
    'expectedVersion',
    'altText',
    job ? 'state' : 'outcome',
  ];
  const projected = Object.fromEntries(fields.map((field) => [field, row[field]]));
  // JSONB timestamptz uses offsets/microseconds. The wire contract uses UTC milliseconds.
  for (const field of ['registeredAt', 'expiresAt']) {
    if (typeof row[field] !== 'string' || !Number.isFinite(Date.parse(row[field])))
      throw new Error('Unexpected media timestamp.');
    projected[field] = new Date(row[field]).toISOString();
  }
  return projected;
}
const ATTACH_REASONS = {
  conflict: ['VERSION_CONFLICT', 'ASSIGNMENT_CHANGED'],
  rejected: [
    'REVISION_NOT_DRAFT',
    'DUPLICATE_OUTPUT',
    'CAPACITY_REACHED',
    'JOB_ALREADY_ATTACHED',
    'PROVENANCE_CHANGED',
  ],
  expired: ['JOB_EXPIRED'],
} as const;
function attachProjection(
  input: unknown,
  listingId: string,
  revision: number,
  operationId: string,
  request?: { jobId: string; expected: number },
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Unexpected attachment response.');
  const row = input as Record<string, unknown>;
  if (
    row.kind !== 'attach_media' ||
    row.listingId !== listingId ||
    row.revision !== revision ||
    row.operationId !== operationId
  )
    throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
  if (
    typeof row.jobId !== 'string' ||
    !UUID.test(row.jobId) ||
    row.jobId === operationId ||
    typeof row.expectedVersion !== 'string' ||
    !/^[1-9]\d*$/.test(row.expectedVersion) ||
    BigInt(row.expectedVersion) > BigInt(Number.MAX_SAFE_INTEGER - 1)
  )
    throw new Error('Unexpected attachment identity.');
  if (request && (row.jobId !== request.jobId || row.expectedVersion !== String(request.expected)))
    throw new Error('Conflicting attachment response.');
  let altText: string;
  try {
    altText = mediaAltText(row.altText);
  } catch {
    throw new Error('Unexpected attachment description.');
  }
  const fields = ['kind', 'operationId', 'jobId', 'listingId', 'revision', 'expectedVersion'];
  const common = Object.fromEntries(fields.map((field) => [field, row[field]]));
  if (row.status === 'ready') {
    if (row.receipt !== null) throw new Error('Unexpected attachment receipt.');
    return { ...common, altText, status: 'ready', receipt: null };
  }
  if (
    typeof row.status !== 'string' ||
    !['applied', 'conflict', 'rejected', 'expired'].includes(row.status) ||
    !row.receipt ||
    typeof row.receipt !== 'object' ||
    Array.isArray(row.receipt)
  )
    throw new Error('Unexpected attachment status.');
  const terminal = row.receipt as Record<string, unknown>;
  if (
    fields.some((field) => terminal[field] !== row[field]) ||
    terminal.outcome !== row.status ||
    typeof terminal.version !== 'string' ||
    !/^[1-9]\d*$/.test(terminal.version) ||
    BigInt(terminal.version) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error('Conflicting attachment receipt.');
  if (row.status === 'applied') {
    if (
      terminal.reason !== null ||
      typeof terminal.mediaId !== 'string' ||
      !UUID.test(terminal.mediaId) ||
      [row.operationId, row.jobId].includes(terminal.mediaId.toLowerCase()) ||
      typeof terminal.position !== 'number' ||
      !Number.isInteger(terminal.position) ||
      terminal.position < 0 ||
      terminal.position > 11 ||
      BigInt(terminal.version) !== BigInt(row.expectedVersion) + 1n
    )
      throw new Error('Unexpected applied attachment.');
  } else if (
    terminal.mediaId !== null ||
    terminal.position !== null ||
    !ATTACH_REASONS[row.status as keyof typeof ATTACH_REASONS].includes(terminal.reason as never)
  )
    throw new Error('Unexpected attachment failure.');
  if (
    typeof terminal.completedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(terminal.completedAt)
  )
    throw new Error('Unexpected attachment timestamp.');
  const completedAt = terminal.completedAt.slice(0, 23) + 'Z',
    instant = Date.parse(completedAt);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== completedAt)
    throw new Error('Unexpected attachment timestamp.');
  const receipt = {
    ...common,
    version: terminal.version,
    outcome: terminal.outcome,
    reason: terminal.reason,
    mediaId: terminal.mediaId,
    position: terminal.position,
    completedAt,
  };
  return { ...common, altText, status: row.status, receipt };
}

function galleryIds(input: unknown): string[] {
  if (!Array.isArray(input) || input.length > 12)
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'orderedIds must contain at most 12 distinct photo UUIDs.',
    );
  const ids = input.map((value) => uuid(value, 'mediaId'));
  if (new Set(ids).size !== ids.length)
    throw new HttpError(400, 'INVALID_INPUT', 'orderedIds must contain distinct photo UUIDs.');
  return ids;
}
interface GalleryRequest {
  readonly kind: 'remove_media' | 'reorder_media';
  readonly operationId: string;
  readonly expected: number;
  readonly mediaId: string | null;
  readonly orderedIds: readonly string[];
}
function galleryProjection(
  input: unknown,
  listingId: string,
  revision: number,
  operationId: string,
  request?: GalleryRequest,
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Unexpected gallery response.');
  const row = input as Record<string, unknown>;
  if (row.listingId !== listingId || row.revision !== revision || row.operationId !== operationId)
    throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
  if (
    !['remove_media', 'reorder_media'].includes(String(row.kind)) ||
    typeof row.expectedVersion !== 'string' ||
    !/^[1-9]\d*$/.test(row.expectedVersion) ||
    BigInt(row.expectedVersion) > BigInt(Number.MAX_SAFE_INTEGER - 1) ||
    typeof row.version !== 'string' ||
    !/^[1-9]\d*$/.test(row.version) ||
    BigInt(row.version) > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error('Unexpected gallery identity or version.');
  let orderedIds: string[];
  try {
    orderedIds = galleryIds(row.orderedIds);
  } catch {
    throw new Error('Unexpected gallery order.');
  }
  if (
    row.kind === 'remove_media'
      ? typeof row.mediaId !== 'string' || !UUID.test(row.mediaId)
      : row.mediaId !== null
  )
    throw new Error('Unexpected gallery target.');
  if (
    request &&
    (row.kind !== request.kind ||
      row.expectedVersion !== String(request.expected) ||
      row.mediaId !== request.mediaId ||
      (request.kind === 'reorder_media' &&
        JSON.stringify(orderedIds) !== JSON.stringify(request.orderedIds)))
  )
    throw new Error('Conflicting gallery response.');
  if (row.outcome === 'applied') {
    if (
      row.reason !== null ||
      BigInt(row.version) !== BigInt(row.expectedVersion) + 1n ||
      (row.kind === 'remove_media' && orderedIds.includes(String(row.mediaId)))
    )
      throw new Error('Unexpected applied gallery response.');
  } else if (row.outcome === 'noop') {
    if (row.kind !== 'reorder_media' || row.reason !== null || row.version !== row.expectedVersion)
      throw new Error('Unexpected gallery noop.');
  } else if (row.outcome === 'conflict') {
    if (row.reason !== 'VERSION_CONFLICT' || row.version === row.expectedVersion)
      throw new Error('Unexpected gallery conflict.');
  } else if (row.outcome === 'rejected') {
    if (
      ![
        'REVISION_NOT_DRAFT',
        'MEDIA_SET_CHANGED',
        ...(row.kind === 'remove_media' ? ['MEDIA_NOT_FOUND'] : []),
      ].includes(String(row.reason)) ||
      (row.reason === 'MEDIA_NOT_FOUND' && orderedIds.includes(String(row.mediaId)))
    )
      throw new Error('Unexpected gallery rejection.');
  } else throw new Error('Unexpected gallery outcome.');
  if (
    typeof row.completedAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.completedAt)
  )
    throw new Error('Unexpected gallery timestamp.');
  const completedAt = row.completedAt.slice(0, 23) + 'Z',
    instant = Date.parse(completedAt);
  if (!Number.isFinite(instant) || new Date(instant).toISOString() !== completedAt)
    throw new Error('Unexpected gallery timestamp.');
  return {
    kind: row.kind,
    operationId,
    listingId,
    revision,
    expectedVersion: row.expectedVersion,
    version: row.version,
    outcome: row.outcome,
    reason: row.reason,
    mediaId: row.mediaId,
    orderedIds,
    completedAt,
  };
}

function workspaceProjection(
  row: Record<string, unknown>,
  listingId: string,
  revision: number,
): Record<string, unknown> {
  if (row.listingId !== listingId || row.revision !== revision)
    throw new Error('Unexpected workspace identity.');
  if (
    typeof row.version !== 'string' ||
    !/^[1-9]\d{0,18}$/.test(row.version) ||
    BigInt(row.version) > 9223372036854775807n ||
    !['draft', 'pending', 'approved', 'rejected'].includes(String(row.state))
  )
    throw new Error('Unexpected workspace revision.');
  const fields = Object.fromEntries(DRAFT_FIELDS.map((field) => [field, row[field]]));
  const content = {
    ...publicRow(fields),
    amountMinor: row.amountMinor === null ? null : Number(row.amountMinor),
    pricing: validatePricingInputV2(row.pricing),
    location: validatePublicLocationV2(row.location),
  };
  if (!Array.isArray(row.photos) || row.photos.length > 12)
    throw new Error('Unexpected workspace gallery.');
  const ids = new Set<string>();
  let previous = -1;
  const photos = row.photos.map((input) => {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw new Error('Unexpected workspace photo.');
    const photo = input as Record<string, unknown>;
    if (
      typeof photo.id !== 'string' ||
      !UUID.test(photo.id) ||
      ids.has(photo.id.toLowerCase()) ||
      typeof photo.position !== 'number' ||
      !Number.isInteger(photo.position) ||
      photo.position < 0 ||
      photo.position > 11 ||
      photo.position <= previous ||
      typeof photo.accepted !== 'boolean' ||
      !['sealed', 'legacy'].includes(String(photo.provenance)) ||
      (photo.provenance === 'sealed' && !photo.accepted)
    )
      throw new Error('Unexpected workspace photo identity or provenance.');
    if (
      typeof photo.altText !== 'string' ||
      photo.altText.length > 4096 ||
      [...photo.altText.replace(/^ +| +$/g, '')].length < 1 ||
      [...photo.altText.replace(/^ +| +$/g, '')].length > 300
    )
      throw new Error('Unexpected workspace photo description.');
    if (photo.provenance === 'sealed') {
      try {
        mediaAltText(photo.altText);
      } catch {
        throw new Error('Unexpected sealed photo description.');
      }
    }
    ids.add(photo.id.toLowerCase());
    previous = photo.position;
    // Deliberate projection: storage, provenance identifiers and coordinator details
    // are never forwarded, even if a database adapter unexpectedly adds fields.
    return {
      id: photo.id.toLowerCase(),
      position: photo.position,
      altText: photo.altText,
      accepted: photo.accepted,
      provenance: photo.provenance,
    };
  });
  return {
    listingId,
    draft: { revision, state: row.state, version: row.version, content },
    photos,
  };
}

const ENQUIRY_STATUSES = [
  'new',
  'assigned',
  'contacted',
  'qualified',
  'closed_won',
  'closed_lost',
  'spam',
] as const;
const ENQUIRY_SUMMARY_FIELDS = [
  'id',
  'listingId',
  'contactedRevision',
  'name',
  'origin',
  'status',
  'assignedAgentId',
  'nextActionAt',
  'version',
  'createdAt',
  'updatedAt',
] as const;
const ENQUIRY_SELECT = `e.id,e.listing_id AS "listingId",e.contacted_revision_no AS "contactedRevision",e.contact_name AS name,
  e.origin,e.status,e.assigned_agent_id AS "assignedAgentId",e.version::text AS version,
  to_char(e.next_action_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "nextActionAt",
  to_char(e.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
  to_char(e.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "updatedAt"`;
type EnquiryKind = 'assign' | 'transition' | 'reschedule';
interface EnquiryCommand {
  readonly operationId: string;
  readonly kind: EnquiryKind;
  readonly expected: number;
  readonly assignedAgentId: string | null;
  readonly status: string | null;
  readonly nextActionAt: string | null;
  readonly reason: string | null;
}
function enquiryQuery(url: URL, page: boolean, defaultLimit = 50): number {
  if (
    [...url.searchParams.keys()].some((key) => !page || key !== 'limit') ||
    url.searchParams.getAll('limit').length > 1
  ) {
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'Enquiry requests do not accept context overrides or unsupported query fields.',
    );
  }
  const selected = url.searchParams.get('limit');
  if (selected === null) return defaultLimit;
  if (!/^[1-9]\d*$/.test(selected) || Number(selected) > 100)
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'limit must be a canonical integer between 1 and 100.',
    );
  return Number(selected);
}
function enquiryInstant(input: unknown, stored = false): string {
  if (
    typeof input !== 'string' ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(input) ||
    (!stored && input.length !== 24)
  )
    throw new Error('Invalid enquiry timestamp.');
  const wire = input.length === 27 ? input.slice(0, 23) + 'Z' : input;
  if (!Number.isFinite(Date.parse(wire)) || new Date(wire).toISOString() !== wire)
    throw new Error('Invalid enquiry timestamp.');
  return wire;
}
function enquiryReason(input: unknown): string | null {
  if (input === null) return null;
  if (
    typeof input !== 'string' ||
    input !== input.trim() ||
    input.length === 0 ||
    [...input].length > 1000 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(input) ||
    /[\ud800-\udfff]/u.test(input)
  )
    throw new Error('Invalid enquiry reason.');
  return input;
}
function enquiryCommand(input: unknown): EnquiryCommand {
  const fields = [
    'operationId',
    'kind',
    'expectedVersion',
    'assignedAgentId',
    'status',
    'nextActionAt',
    'reason',
  ];
  // Every named field is required; unused selectors are explicitly null,
  // never omitted or inferred from the current enquiry.
  const body = record(input, fields);
  if (
    fields.some((field) => !Object.hasOwn(body, field)) ||
    Object.keys(body).length !== fields.length
  )
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'Supply every enquiry command field, including unused null fields.',
    );
  const expected = version(body.expectedVersion);
  if (expected > Number.MAX_SAFE_INTEGER - 1)
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'expectedVersion is outside the incrementable enquiry range.',
    );
  const operationId = uuid(body.operationId, 'operationId');
  const kind = body.kind;
  if (kind !== 'assign' && kind !== 'transition' && kind !== 'reschedule')
    throw new HttpError(400, 'INVALID_INPUT', 'Unsupported enquiry operation kind.');
  try {
    const assignedAgentId =
      body.assignedAgentId === null ? null : uuid(body.assignedAgentId, 'assignedAgentId');
    const status = body.status;
    if (status !== null && !ENQUIRY_STATUSES.includes(status as never))
      throw new Error('Invalid enquiry status.');
    const nextActionAt = body.nextActionAt === null ? null : enquiryInstant(body.nextActionAt);
    const reason = enquiryReason(body.reason);
    if (
      kind === 'assign'
        ? assignedAgentId === null || status !== null || nextActionAt !== null || reason !== null
        : kind === 'reschedule'
          ? assignedAgentId !== null || status !== null || nextActionAt === null || reason !== null
          : assignedAgentId !== null ||
            status === null ||
            (['contacted', 'qualified'].includes(String(status))
              ? nextActionAt === null
              : nextActionAt !== null) ||
            (['closed_lost', 'spam', 'new', 'assigned'].includes(String(status))
              ? reason === null
              : reason !== null)
    )
      throw new Error('Invalid enquiry selectors.');
    return {
      operationId,
      kind,
      expected,
      assignedAgentId,
      status: status as string | null,
      nextActionAt,
      reason,
    };
  } catch {
    throw new HttpError(
      400,
      'INVALID_INPUT',
      'Supply valid enquiry command selectors, UTC millisecond dates and bounded reason text.',
    );
  }
}
function enquiryVersion(input: unknown, incrementable = false): string {
  if (
    typeof input !== 'string' ||
    !/^[1-9]\d*$/.test(input) ||
    BigInt(input) > BigInt(Number.MAX_SAFE_INTEGER - (incrementable ? 1 : 0))
  )
    throw new Error('Invalid enquiry version.');
  return input;
}
function enquiryStoredId(input: unknown, nullable = false): string | null {
  if (nullable && input === null) return null;
  if (typeof input !== 'string' || !UUID.test(input) || input !== input.toLowerCase())
    throw new Error('Invalid enquiry identity.');
  return input;
}
function enquiryState(input: Record<string, unknown>): Record<string, unknown> {
  const status = input.status;
  if (!ENQUIRY_STATUSES.includes(status as never))
    throw new Error('Invalid stored enquiry status.');
  const version = enquiryVersion(input.version),
    assignedAgentId = enquiryStoredId(input.assignedAgentId, true);
  const nextActionAt =
    input.nextActionAt === null ? null : enquiryInstant(input.nextActionAt, true);
  const closureReason = enquiryReason(input.closureReason);
  if (['contacted', 'qualified'].includes(String(status)) && nextActionAt === null)
    throw new Error('Missing stored next action.');
  if (['closed_lost', 'spam'].includes(String(status)) && closureReason === null)
    throw new Error('Missing stored closure reason.');
  return { version, status, assignedAgentId, nextActionAt, closureReason };
}
function enquiryProjection(
  input: unknown,
  detail: boolean,
  resourceId?: string,
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid enquiry response.');
  const row = input as Record<string, unknown>,
    id = enquiryStoredId(row.id),
    listingId = enquiryStoredId(row.listingId, true);
  if (resourceId !== undefined && id !== resourceId)
    throw new Error('Conflicting enquiry response.');
  if (
    listingId === null
      ? row.contactedRevision !== null
      : typeof row.contactedRevision !== 'number' ||
        !Number.isSafeInteger(row.contactedRevision) ||
        row.contactedRevision < 1 ||
        row.contactedRevision > 2147483647
  )
    throw new Error('Invalid contacted revision.');
  if (
    typeof row.name !== 'string' ||
    row.name.trim().length < 1 ||
    [...row.name].length > 160 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(row.name) ||
    /[\ud800-\udfff]/u.test(row.name) ||
    !['web', 'mobile', 'staff'].includes(String(row.origin)) ||
    !ENQUIRY_STATUSES.includes(row.status as never)
  )
    throw new Error('Invalid enquiry summary.');
  const version = enquiryVersion(row.version),
    assignedAgentId = enquiryStoredId(row.assignedAgentId, true);
  const nextActionAt = row.nextActionAt === null ? null : enquiryInstant(row.nextActionAt, true);
  if (['contacted', 'qualified'].includes(String(row.status)) && nextActionAt === null)
    throw new Error('Missing next action.');
  const createdAt = enquiryInstant(row.createdAt, true),
    updatedAt = enquiryInstant(row.updatedAt, true);
  const summary = Object.fromEntries(ENQUIRY_SUMMARY_FIELDS.map((field) => [field, row[field]]));
  const projected = {
    ...summary,
    id,
    listingId,
    assignedAgentId,
    version,
    nextActionAt,
    createdAt,
    updatedAt,
  };
  if (!detail) return projected;
  const phone = row.phone,
    email = row.email;
  if (phone !== null && (typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phone)))
    throw new Error('Invalid stored phone.');
  if (
    email !== null &&
    (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  )
    throw new Error('Invalid stored email.');
  if (phone === null && email === null) throw new Error('Missing stored contact.');
  if (
    typeof row.message !== 'string' ||
    row.message.trim().length < 1 ||
    [...row.message].length > 2000 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(row.message) ||
    /[\ud800-\udfff]/u.test(row.message)
  )
    throw new Error('Invalid stored message.');
  if (
    typeof row.noticeVersion !== 'string' ||
    row.noticeVersion.trim().length < 1 ||
    [...row.noticeVersion].length > 100 ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(row.noticeVersion) ||
    /[\ud800-\udfff]/u.test(row.noticeVersion)
  )
    throw new Error('Invalid stored notice.');
  const closureReason = enquiryReason(row.closureReason);
  if (['closed_lost', 'spam'].includes(String(row.status)) && closureReason === null)
    throw new Error('Missing stored closure reason.');
  return {
    ...projected,
    phone,
    email,
    message: row.message,
    noticeVersion: row.noticeVersion,
    closureReason,
  };
}
function enquiryOperationProjection(
  input: unknown,
  enquiryId: string,
  operationId: string,
  command?: EnquiryCommand,
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new Error('Invalid enquiry receipt.');
  const row = input as Record<string, unknown>;
  if (
    row.enquiryId !== enquiryId ||
    row.operationId !== operationId ||
    !['assign', 'transition', 'reschedule'].includes(String(row.kind))
  )
    throw new Error('Conflicting enquiry receipt identity.');
  const expectedVersion = enquiryVersion(row.expectedVersion, true);
  let captured: EnquiryCommand;
  try {
    const requested = record(row.request, ['assignedAgentId', 'status', 'nextActionAt', 'reason']);
    captured = enquiryCommand({
      ...requested,
      operationId,
      kind: row.kind,
      expectedVersion: Number(expectedVersion),
    });
  } catch {
    throw new Error('Invalid stored enquiry request.');
  }
  if (
    command &&
    (command.kind !== captured.kind ||
      command.expected !== captured.expected ||
      command.assignedAgentId !== captured.assignedAgentId ||
      command.status !== captured.status ||
      command.nextActionAt !== captured.nextActionAt ||
      command.reason !== captured.reason)
  )
    throw new Error('Conflicting enquiry command receipt.');
  if (!row.result || typeof row.result !== 'object' || Array.isArray(row.result))
    throw new Error('Invalid enquiry result.');
  const result = enquiryState(row.result as Record<string, unknown>),
    outcome = row.outcome;
  if (outcome === 'applied') {
    if (row.reason !== null || BigInt(String(result.version)) !== BigInt(expectedVersion) + 1n)
      throw new Error('Invalid applied enquiry receipt.');
    if (
      (captured.kind === 'assign' && result.assignedAgentId !== captured.assignedAgentId) ||
      (captured.kind === 'transition' && result.status !== captured.status) ||
      ((captured.kind === 'transition' || captured.kind === 'reschedule') &&
        result.nextActionAt !== captured.nextActionAt)
    )
      throw new Error('Enquiry result does not match command.');
  } else if (outcome === 'noop') {
    if (
      row.reason !== null ||
      result.version !== expectedVersion ||
      captured.kind === 'transition' ||
      (captured.kind === 'assign'
        ? result.assignedAgentId !== captured.assignedAgentId
        : result.nextActionAt !== captured.nextActionAt)
    )
      throw new Error('Invalid enquiry noop.');
  } else if (outcome === 'conflict') {
    if (row.reason !== 'VERSION_CONFLICT' || result.version === expectedVersion)
      throw new Error('Invalid enquiry conflict.');
  } else if (outcome === 'rejected') {
    if (
      result.version !== expectedVersion ||
      !['ASSIGNEE_UNAVAILABLE', 'INVALID_TRANSITION'].includes(String(row.reason)) ||
      (row.reason === 'ASSIGNEE_UNAVAILABLE'
        ? captured.kind !== 'assign'
        : captured.kind === 'assign')
    )
      throw new Error('Invalid rejected enquiry receipt.');
  } else throw new Error('Invalid enquiry operation outcome.');
  if (outcome === 'applied' || outcome === 'noop') {
    if (
      (captured.kind === 'assign' && result.status === 'new') ||
      (captured.kind === 'transition' && result.closureReason !== captured.reason) ||
      (captured.kind === 'reschedule' &&
        !['contacted', 'qualified'].includes(String(result.status)))
    )
      throw new Error('Enquiry result has inconsistent workflow facts.');
  }
  return {
    operationId,
    enquiryId,
    kind: captured.kind,
    expectedVersion,
    request: {
      assignedAgentId: captured.assignedAgentId,
      status: captured.status,
      nextActionAt: captured.nextActionAt,
      reason: captured.reason,
    },
    outcome,
    reason: row.reason,
    result,
    completedAt: enquiryInstant(row.completedAt, true),
  };
}

export function createApiService(
  options: ApiServiceOptions,
): (request: Request) => Promise<Response> {
  if (
    options.reminderCaptureMode !== undefined &&
    options.reminderCaptureMode !== 'capture-only-v1'
  )
    throw new Error('Unsupported reminder capture mode.');
  const reminderCaptureEnabled = options.reminderCaptureMode === 'capture-only-v1';
  const tenantId = uuid(options.tenantId, 'Configured tenant');
  const privacyNoticeVersion = text(
    options.privacyNoticeVersion,
    'Configured privacy notice version',
    100,
  );
  const newId = options.uuid ?? randomUUID;
  const limiter = options.limiter ?? createLocalEnquiryLimiter();
  async function identity(request: Request, required: boolean): Promise<string | null> {
    if (!request.headers.has('authorization')) {
      if (required)
        throw new HttpError(401, 'UNAUTHENTICATED', 'A valid bearer token is required.');
      return null;
    }
    try {
      return uuid((await options.verifyAuthorization(request)).actorId, 'Verified subject');
    } catch {
      throw new HttpError(401, 'UNAUTHENTICATED', 'A valid bearer token is required.');
    }
  }
  return async (request) => {
    const correlationId = newId();
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();
      if ((path === '/v1/properties' || path === '/v2/properties') && method === 'GET') {
        const pageLimit = limit(request);
        const v2 = path === '/v2/properties';
        const result = await options.database.transaction(
          { tenantId, actorId: null, correlationId },
          (query) =>
            query.query(
              `SELECT listing_id AS id,slug,revision_no AS revision,title,description,purpose,
          property_type AS "propertyType",currency,amount_minor::text AS "amountMinor",rent_period AS "rentPeriod",bedrooms,
          private_bathrooms AS "privateBathrooms",shared_bathrooms AS "sharedBathrooms",country,locality,public_precision AS "publicPrecision",
          latitude::text AS latitude,longitude::text AS longitude,photo_refs AS photos${v2 ? ',pricing,location' : ''}
          FROM app_api.${v2 ? 'public_listings_v2' : 'public_listings'} ORDER BY approved_at DESC,listing_id LIMIT $1`,
              [pageLimit],
            ),
        );
        const items = result.rows.map(v2 ? publicRowV2 : publicRow);
        return response(200, { items, limit: pageLimit }, correlationId);
      }
      if (
        (path === '/v1/enquiries' || path === '/v2/staff/enquiry-captures') &&
        method === 'POST'
      ) {
        const staffCapture = path === '/v2/staff/enquiry-captures';
        const captureActor = staffCapture ? await identity(request, true) : undefined;
        if (staffCapture) enquiryQuery(url, false);
        const quota = await limiter.consume(
          `${tenantId}:${staffCapture ? `staff:${captureActor}` : 'public'}:${options.clientKey?.(request) ?? 'shared-local'}`,
        );
        if (!quota.allowed)
          throw new HttpError(429, 'RATE_LIMITED', 'Please wait before trying again.', {
            'Retry-After': String(quota.retryAfterSeconds),
          });
        const key = uuid(request.headers.get('idempotency-key'), 'Idempotency-Key');
        const body = record(await jsonBody(request, 16 * 1024), [
          'listingId',
          'name',
          'phone',
          'email',
          'message',
          ...(staffCapture ? [] : ['origin']),
          'noticeVersion',
          'noticeAcknowledged',
        ]);
        const listingId = body.listingId == null ? null : uuid(body.listingId, 'listingId');
        const name = text(body.name, 'name', 160);
        const message = text(body.message, 'message', 2000);
        const noticeVersion = text(body.noticeVersion, 'noticeVersion', 100);
        if (noticeVersion !== privacyNoticeVersion || body.noticeAcknowledged !== true)
          throw new HttpError(
            400,
            'NOTICE_ACKNOWLEDGEMENT_REQUIRED',
            'Acknowledge the current enquiry privacy notice.',
          );
        if (!staffCapture && body.origin !== 'web' && body.origin !== 'mobile')
          throw new HttpError(400, 'INVALID_INPUT', 'origin must be web or mobile.');
        let phone: string | null = null;
        if (body.phone !== undefined && body.phone !== null) {
          try {
            phone = normalizeKenyanPhone(text(body.phone, 'phone', 40));
          } catch {
            throw new HttpError(
              400,
              'INVALID_INPUT',
              'Use a supported Kenyan mobile phone number.',
            );
          }
        }
        const email = body.email == null ? null : text(body.email, 'email', 254).toLowerCase();
        if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
          throw new HttpError(400, 'INVALID_INPUT', 'Use a valid contact email.');
        if (!phone && !email)
          throw new HttpError(400, 'INVALID_INPUT', 'Provide a phone number or email.');
        const actorId = staffCapture ? captureActor! : await identity(request, false);
        const result = await options.database.transaction(
          { tenantId, actorId, correlationId },
          async (query) => {
            if (staffCapture) await assertStaff(query);
            return query.query(
              'SELECT app_api.record_enquiry($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9) AS id',
              [
                newId(),
                key,
                listingId,
                name,
                phone,
                email,
                message,
                staffCapture ? 'staff' : body.origin,
                noticeVersion,
              ],
            );
          },
        );
        return response(201, { id: scalar(result, 'id') }, correlationId);
      }
      const draftRoute = /^\/v[12]\/staff\/listings\/([^/]+)\/drafts\/([1-9]\d*)(\/submit)?$/.exec(
        path,
      );
      const reviewRoute =
        /^\/v2\/staff\/reviews\/([^/]+)\/revisions\/([1-9]\d*)(\/decision)?$/.exec(path);
      const v2Draft = path.startsWith('/v2/staff/');
      if (path.startsWith('/v1/staff/') || v2Draft) {
        const actorId = await identity(request, true);
        const context = { tenantId, actorId, correlationId };
        const successorRoute =
          /^\/v2\/staff\/listings\/([^/]+)\/revision-operations\/([^/]+)$/.exec(path);
        if (successorRoute) {
          if (method !== 'POST' && method !== 'GET')
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: 'GET, POST' },
            );
          if (request.url.includes('?') || request.url.includes('#'))
            throw new HttpError(
              400,
              'INVALID_INPUT',
              'Successor requests do not accept query context.',
            );
          const listingId = uuid(successorRoute[1], 'listingId'),
            operationId = uuid(successorRoute[2], 'operationId'),
            write = method === 'POST';
          let forbidden = false;
          request.headers.forEach((_, name) => {
            if (
              [
                'cookie',
                'content-encoding',
                'expect',
                'range',
                'transfer-encoding',
                'idempotency-key',
                'x-actor-id',
                'x-tenant-id',
                'x-role',
                'x-actor',
                'x-tenant',
                'x-company-id',
                'x-assigned-agent-id',
              ].includes(name) ||
              name.startsWith('if-')
            )
              forbidden = true;
          });
          if (
            forbidden ||
            (!write &&
              (request.body !== null ||
                request.headers.has('content-type') ||
                request.headers.has('content-length')))
          )
            throw new HttpError(400, 'INVALID_INPUT', 'Unsupported successor request context.');
          const declared = request.headers.get('content-length');
          if (write && declared !== null && !/^(?:0|[1-9]\d*)$/.test(declared))
            throw new HttpError(400, 'INVALID_INPUT', 'Content length must be canonical.');
          let command: ListingSuccessorCommand | undefined;
          if (write) {
            const raw = await jsonBody(request, 128 * 1024, true, true, true, true);
            try {
              const body = record(raw, ['expectedListingVersion', 'predecessor', 'content']);
              command = validateListingSuccessorCommand({ ...body, listingId, operationId });
            } catch {
              throw new HttpError(400, 'INVALID_INPUT', 'Review the successor revision fields.');
            }
          }
          const receipt = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            if (command) {
              const stored = await query.query(
                'SELECT app_api.start_listing_revision_v2($1::uuid,$2::uuid,$3::bigint,$4::integer,$5::bigint,$6,$7::jsonb) AS receipt',
                [
                  listingId,
                  operationId,
                  command.expectedListingVersion,
                  command.predecessor.revision,
                  command.predecessor.version,
                  command.predecessor.state,
                  JSON.stringify(command.content),
                ],
              );
              return validateListingSuccessorReceipt(scalar(stored, 'receipt'), command, actorId!);
            }
            const stored = await query.query(
              'SELECT app_api.read_listing_successor($1::uuid,$2::uuid) AS receipt',
              [listingId, operationId],
            );
            return validateListingSuccessorSnapshot(
              scalar(stored, 'receipt'),
              listingId,
              operationId,
              actorId!,
            );
          });
          return response(200, receipt, correlationId);
        }
        const creationRoute = /^\/v2\/staff\/listings\/([^/]+)\/creation-operations\/([^/]+)$/.exec(
          path,
        );
        if (creationRoute) {
          if (method !== 'POST' && method !== 'GET')
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: 'GET, POST' },
            );
          if (request.url.includes('?') || request.url.includes('#'))
            throw new HttpError(400, 'INVALID_INPUT', 'Creation does not accept query context.');
          const listingId = uuid(creationRoute[1], 'listingId'),
            operationId = uuid(creationRoute[2], 'operationId'),
            write = method === 'POST';
          let forbidden = false;
          request.headers.forEach((_, name) => {
            if (
              [
                'cookie',
                'content-encoding',
                'expect',
                'range',
                'transfer-encoding',
                'idempotency-key',
                'x-actor-id',
                'x-tenant-id',
                'x-role',
                'x-actor',
                'x-tenant',
                'x-company-id',
                'x-assigned-agent-id',
              ].includes(name) ||
              name.startsWith('if-')
            )
              forbidden = true;
          });
          if (
            forbidden ||
            (!write &&
              (request.body !== null ||
                request.headers.has('content-type') ||
                request.headers.has('content-length')))
          )
            throw new HttpError(400, 'INVALID_INPUT', 'Unsupported creation request context.');
          const declared = request.headers.get('content-length');
          if (write && declared !== null && !/^(?:0|[1-9]\d*)$/.test(declared))
            throw new HttpError(400, 'INVALID_INPUT', 'Content length must be canonical.');
          let command: ListingCreationCommand | undefined;
          if (write) {
            const raw = await jsonBody(request, 128 * 1024, true, true, true);
            try {
              const body = record(raw, ['slug', 'content']);
              command = validateListingCreationCommand({ ...body, listingId, operationId });
            } catch {
              throw new HttpError(400, 'INVALID_INPUT', 'Review the listing creation fields.');
            }
          }
          const receipt = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            if (command) {
              const stored = await query.query(
                'SELECT app_api.create_listing_draft_v2($1::uuid,$2::uuid,$3,$4::jsonb) AS receipt',
                [listingId, operationId, command.slug, JSON.stringify(command.content)],
              );
              return validateListingCreationReceipt(scalar(stored, 'receipt'), command, actorId!);
            }
            const stored = await query.query(
              'SELECT app_api.read_listing_creation($1::uuid,$2::uuid) AS receipt',
              [listingId, operationId],
            );
            const original = validateListingCreationSnapshot(
              scalar(stored, 'receipt'),
              listingId,
              operationId,
            );
            if (original.actorId !== actorId) throw new Error('Unexpected creation requester.');
            return original;
          });
          return response(200, receipt, correlationId);
        }
        if (path === '/v2/staff/listings') {
          if (method !== 'GET')
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: 'GET' },
            );
          if (
            request.url.includes('#') ||
            (request.url.includes('?') && !/^\?limit=[1-9]\d?$/.test(url.search))
          )
            throw new HttpError(400, 'INVALID_INPUT', 'Use a bounded listing queue.');
          const pageLimit = enquiryQuery(url, true, 25);
          if (pageLimit > 50)
            throw new HttpError(400, 'INVALID_INPUT', 'Listing limit must be between 1 and 50.');
          let forbidden = request.body !== null;
          request.headers.forEach((_, name) => {
            if (
              [
                'cookie',
                'content-type',
                'content-length',
                'content-encoding',
                'expect',
                'range',
                'transfer-encoding',
                'x-actor-id',
                'x-tenant-id',
                'x-role',
                'x-actor',
                'x-tenant',
              ].includes(name) ||
              name.startsWith('if-')
            )
              forbidden = true;
          });
          if (forbidden)
            throw new HttpError(
              400,
              'INVALID_INPUT',
              'Listing queue does not accept caller context.',
            );
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            return query.query(
              `SELECT l.id AS "listingId",l.slug,l.assigned_agent_id AS "assignedAgentId",l.version::text AS version,
              l.availability,l.publication_status AS "publicationStatus",l.published_revision_no AS "publishedRevision",
              to_char(greatest(l.updated_at,r.updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "changedAt",
              CASE WHEN r.revision_no IS NULL THEN NULL ELSE jsonb_build_object('revision',r.revision_no,'state',r.state,'version',r.version::text,'title',r.title,
                'updatedAt',to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) END AS latest
              FROM app_private.listings l LEFT JOIN LATERAL (SELECT revision_no,state,version,title,updated_at FROM app_private.listing_revisions
                WHERE tenant_id=l.tenant_id AND listing_id=l.id ORDER BY revision_no DESC LIMIT 1) r ON true
              WHERE l.tenant_id=$1::uuid ORDER BY greatest(l.updated_at,r.updated_at) DESC,l.id DESC LIMIT $2::integer`,
              [tenantId, pageLimit + 1],
            );
          });
          return response(
            200,
            validateStaffListingPage(
              {
                items: result.rows.slice(0, pageLimit),
                limit: pageLimit,
                truncated: result.rows.length > pageLimit,
              },
              pageLimit,
            ),
            correlationId,
          );
        }
        const reminderAdmissionRoute =
          /^\/v2\/staff\/enquiries\/([^/]+)\/viewings\/([^/]+)\/reminder-admissions$/.exec(path);
        const reminderAdmissionOriginalRoute =
          /^\/v2\/staff\/enquiries\/([^/]+)\/viewing-reminder-admissions\/([^/]+)$/.exec(path);
        const reminderCaptureRoute =
          /^\/v2\/staff\/enquiries\/([^/]+)\/viewing-reminder-admissions\/([^/]+)\/captures$/.exec(
            path,
          );
        const reminderCaptureOriginalRoute =
          /^\/v2\/staff\/enquiries\/([^/]+)\/viewing-reminder-admissions\/([^/]+)\/capture-operations\/([^/]+)$/.exec(
            path,
          );
        const reminderRoute =
          reminderAdmissionRoute ??
          reminderAdmissionOriginalRoute ??
          reminderCaptureRoute ??
          reminderCaptureOriginalRoute;
        if (reminderRoute) {
          if (!reminderCaptureEnabled)
            throw new HttpError(404, 'NOT_FOUND', 'Route is unavailable.');
          enquiryQuery(url, false);
          if (request.url.includes('?') || request.url.includes('#'))
            throw new HttpError(
              400,
              'INVALID_INPUT',
              'Reminder commands do not accept query context.',
            );
          const id = uuid(reminderRoute[1], 'enquiryId'),
            viewingId = reminderAdmissionRoute
              ? uuid(reminderAdmissionRoute[2], 'viewingId')
              : undefined;
          const admissionId = reminderAdmissionRoute
              ? undefined
              : uuid(reminderRoute[2], 'admissionOperationId'),
            operationId = reminderCaptureOriginalRoute
              ? uuid(reminderCaptureOriginalRoute[3], 'operationId')
              : undefined;
          const write = !!reminderAdmissionRoute || !!reminderCaptureRoute,
            allowed = write ? 'POST' : 'GET';
          if (method !== allowed)
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this reminder route.',
              { Allow: allowed },
            );
          let forbidden = false;
          request.headers.forEach((_, name) => {
            if (
              [
                'cookie',
                'content-encoding',
                'expect',
                'range',
                'transfer-encoding',
                'x-actor-id',
                'x-tenant-id',
                'x-role',
                'x-actor',
                'x-tenant',
                'x-revision-version',
              ].includes(name) ||
              name.startsWith('if-')
            )
              forbidden = true;
          });
          if (
            forbidden ||
            (!write &&
              (request.body !== null ||
                request.headers.has('content-type') ||
                request.headers.has('content-length')))
          )
            throw new HttpError(400, 'INVALID_INPUT', 'Unsupported reminder request context.');
          const declared = request.headers.get('content-length');
          if (write && declared !== null && !/^(?:0|[1-9]\d*)$/.test(declared))
            throw new HttpError(400, 'INVALID_INPUT', 'Content length must be canonical.');
          let admissionCommand: ViewingReminderAdmissionCommand | undefined,
            captureCommand: ViewingReminderCaptureCommand | undefined;
          if (write) {
            const raw = await jsonBody(request, 4096, false, true, true);
            try {
              if (reminderAdmissionRoute) {
                const body = record(raw, ['operationId', 'expectedVersion', 'dueAt', 'expiresAt']);
                admissionCommand = validateViewingReminderAdmissionCommand({
                  ...body,
                  expectedVersion: String(version(body.expectedVersion)),
                });
              } else
                captureCommand = validateViewingReminderCaptureCommand(
                  record(raw, ['operationId']),
                );
            } catch {
              throw new HttpError(400, 'INVALID_INPUT', 'Review the reminder command fields.');
            }
          }
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            if (admissionCommand) {
              const stored = await query.query(
                'SELECT app_api.admit_viewing_reminder($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::timestamptz,$6::timestamptz) AS receipt',
                [
                  id,
                  viewingId,
                  admissionCommand.operationId,
                  admissionCommand.expectedVersion,
                  admissionCommand.dueAt,
                  admissionCommand.expiresAt,
                ],
              );
              const receipt = validateViewingReminderAdmissionReceipt(
                scalar(stored, 'receipt'),
                id,
                viewingId!,
                admissionCommand,
              );
              if (receipt.actorId !== actorId)
                throw new Error('Unexpected reminder admission actor.');
              return receipt;
            }
            const stored = await query.query(
              'SELECT app_api.read_viewing_reminder_admission($1::uuid,$2::uuid) AS receipt',
              [id, admissionId],
            );
            const admission = validateViewingReminderAdmissionSnapshot(
              scalar(stored, 'receipt'),
              id,
              admissionId,
            );
            if (admission.actorId !== actorId)
              throw new Error('Unexpected original reminder admission actor.');
            if (reminderAdmissionOriginalRoute) return admission;
            if (admission.outcome !== 'admitted')
              throw new HttpError(
                write ? 422 : 404,
                write ? 'INVALID_STATE' : 'NOT_FOUND',
                write
                  ? 'This admission has no reminder candidate.'
                  : 'Original capture is unavailable.',
              );
            const command =
              captureCommand ?? validateViewingReminderCaptureCommand({ operationId });
            const captured = await query.query(
              write
                ? 'SELECT app_api.capture_viewing_reminder($1::uuid,$2::uuid,$3::uuid) AS receipt'
                : 'SELECT app_api.read_viewing_reminder_attempt($1::uuid,$2::uuid,$3::uuid) AS receipt',
              [id, admissionId, command.operationId],
            );
            return validateViewingReminderCaptureReceipt(
              scalar(captured, 'receipt'),
              admission,
              command,
            );
          });
          return response(200, result, correlationId);
        }
        if (path === '/v2/staff/enquiries' || path === '/v2/staff/enquiry-assignees') {
          const directory = path.endsWith('/enquiry-assignees'),
            pageLimit = enquiryQuery(url, true, directory ? 100 : 50);
          if (method !== 'GET')
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: 'GET' },
            );
          const result = await options.database.transaction(context, async (query) => {
            if (directory) {
              await assertAdmin(query);
              return query.query('SELECT app_api.list_enquiry_assignees($1::integer) AS page', [
                pageLimit,
              ]);
            }
            await assertStaff(query);
            return query.query(
              `SELECT ${ENQUIRY_SELECT} FROM app_private.enquiries e WHERE e.tenant_id=$1::uuid ORDER BY e.created_at DESC,e.id ASC LIMIT $2`,
              [tenantId, pageLimit + 1],
            );
          });
          if (directory) {
            const page = scalar(result, 'page');
            if (!page || typeof page !== 'object' || Array.isArray(page))
              throw new Error('Invalid assignee page.');
            const source = page as Record<string, unknown>;
            if (
              !Array.isArray(source.items) ||
              source.items.length > pageLimit ||
              source.limit !== pageLimit ||
              typeof source.truncated !== 'boolean' ||
              (source.truncated && source.items.length !== pageLimit)
            )
              throw new Error('Invalid assignee page bounds.');
            const items = source.items.map((item) => {
              if (!item || typeof item !== 'object' || Array.isArray(item))
                throw new Error('Invalid assignee record.');
              const row = item as Record<string, unknown>,
                userId = enquiryStoredId(row.userId);
              if (row.role !== 'agent' && row.role !== 'admin')
                throw new Error('Invalid assignee role.');
              return { userId, role: row.role };
            });
            if (new Set(items.map((item) => item.userId)).size !== items.length)
              throw new Error('Duplicate assignee record.');
            return response(
              200,
              { items, limit: pageLimit, truncated: source.truncated },
              correlationId,
            );
          }
          if (result.rows.length > pageLimit + 1) throw new Error('Invalid enquiry page bounds.');
          const projected = result.rows.map((row) => enquiryProjection(row, false));
          if (new Set(projected.map((row) => row.id)).size !== projected.length)
            throw new Error('Duplicate enquiry record.');
          return response(
            200,
            {
              items: projected.slice(0, pageLimit),
              limit: pageLimit,
              truncated: projected.length > pageLimit,
            },
            correlationId,
          );
        }
        const viewingHistoryRoute =
          /^\/v2\/staff\/enquiries\/([^/]+)\/viewings\/([^/]+)\/history$/.exec(path);
        if (viewingHistoryRoute) {
          const id = uuid(viewingHistoryRoute[1], 'enquiryId'),
            viewingId = uuid(viewingHistoryRoute[2], 'viewingId'),
            pageLimit = enquiryQuery(url, true, 25);
          if (pageLimit > 25)
            throw new HttpError(400, 'INVALID_INPUT', 'Viewing history limit cannot exceed 25.');
          if (method !== 'GET')
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for viewing history.',
              { Allow: 'GET' },
            );
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            return query.query(
              'SELECT app_api.read_viewing_history($1::uuid,$2::uuid,$3::integer) AS page',
              [id, viewingId, pageLimit],
            );
          });
          return response(
            200,
            validateViewingHistoryPage(scalar(result, 'page'), id, viewingId, pageLimit),
            correlationId,
          );
        }
        const viewingRoute =
          /^\/v2\/staff\/enquiries\/([^/]+)\/viewings(?:\/([^/]+)(\/(?:proposals|confirmations|cancellations|declines|reschedules|completions|no-shows))?)?$/.exec(
            path,
          );
        const viewingOperationRoute =
          /^\/v2\/staff\/enquiries\/([^/]+)\/viewing-operations\/([^/]+)$/.exec(path);
        if (viewingRoute || viewingOperationRoute) {
          const id = uuid((viewingRoute ?? viewingOperationRoute)![1], 'enquiryId'),
            viewingId = viewingRoute?.[2] === undefined ? null : uuid(viewingRoute[2], 'viewingId');
          const operationId = viewingOperationRoute
              ? uuid(viewingOperationRoute[2], 'operationId')
              : null,
            proposal = viewingRoute?.[3] === '/proposals',
            confirmation = viewingRoute?.[3] === '/confirmations',
            rescheduling = viewingRoute?.[3] === '/reschedules',
            ending =
              viewingRoute?.[3] === '/cancellations'
                ? 'cancel'
                : viewingRoute?.[3] === '/declines'
                  ? 'decline'
                  : undefined,
            attendance =
              viewingRoute?.[3] === '/completions'
                ? 'complete'
                : viewingRoute?.[3] === '/no-shows'
                  ? 'no_show'
                  : undefined,
            mutation = proposal || confirmation || rescheduling || !!ending || !!attendance;
          const list = !!viewingRoute && viewingId === null && method === 'GET',
            pageLimit = enquiryQuery(url, list, 25);
          if (pageLimit > 25)
            throw new HttpError(400, 'INVALID_INPUT', 'Viewing limit cannot exceed 25.');
          const allowed =
            operationId || (viewingId && !mutation)
              ? ['GET']
              : mutation
                ? ['POST']
                : ['GET', 'POST'];
          if (!allowed.includes(method))
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this viewing route.',
              { Allow: allowed.join(', ') },
            );
          let outcomeCommand: ViewingOutcomeCommand | undefined;
          let rescheduleCommand: ViewingRescheduleCommand | undefined;
          let original: ViewingOriginal | undefined,
            confirmationCommand: ViewingConfirmationCommand | undefined,
            terminationCommand: ViewingTerminationCommand | undefined;
          if (method === 'POST') {
            const raw = await jsonBody(request, 16 * 1024, false, true);
            if (attendance) {
              const body = record(raw, ['operationId', 'expectedVersion', 'occurredAt', 'reason']),
                expected = version(body.expectedVersion);
              try {
                outcomeCommand = validateViewingOutcomeCommand({
                  ...body,
                  expectedVersion: String(expected),
                });
              } catch {
                throw new HttpError(400, 'INVALID_INPUT', 'Review the viewing outcome fields.');
              }
            } else if (rescheduling) {
              const body = record(raw, ['operationId', 'expectedVersion', 'slot', 'reason']),
                expected = version(body.expectedVersion);
              try {
                rescheduleCommand = validateViewingRescheduleCommand({
                  ...body,
                  expectedVersion: String(expected),
                });
              } catch {
                throw new HttpError(400, 'INVALID_INPUT', 'Review the viewing reschedule fields.');
              }
            } else if (ending) {
              const body = record(raw, ['operationId', 'expectedVersion', 'reason']),
                expected = version(body.expectedVersion);
              try {
                terminationCommand = validateViewingTerminationCommand({
                  ...body,
                  expectedVersion: String(expected),
                });
              } catch {
                throw new HttpError(400, 'INVALID_INPUT', 'Review the viewing ending reason.');
              }
            } else if (confirmation) {
              const body = record(raw, [
                  'operationId',
                  'expectedVersion',
                  'slot',
                  'channel',
                  'agreedAt',
                  'notes',
                ]),
                expected = version(body.expectedVersion);
              try {
                confirmationCommand = validateViewingConfirmationCommand({
                  ...body,
                  expectedVersion: String(expected),
                });
              } catch {
                throw new HttpError(
                  400,
                  'INVALID_INPUT',
                  'Review the viewing phone agreement fields.',
                );
              }
            } else if (proposal) {
              const body = record(raw, ['operationId', 'expectedVersion', 'slot']),
                expected = version(body.expectedVersion);
              try {
                original = {
                  kind: 'propose',
                  viewingId: viewingId!,
                  command: validateViewingProposalCommand({
                    ...body,
                    expectedVersion: String(expected),
                  }),
                };
              } catch {
                throw new HttpError(400, 'INVALID_INPUT', 'Review the viewing proposal fields.');
              }
            } else {
              const body = record(raw, [
                  'operationId',
                  'expectedEnquiryVersion',
                  'listingId',
                  'preferredSlots',
                  'notes',
                ]),
                expected = version(body.expectedEnquiryVersion);
              try {
                original = {
                  kind: 'request',
                  command: validateViewingRequestCommand({
                    ...body,
                    expectedEnquiryVersion: String(expected),
                  }),
                };
              } catch {
                throw new HttpError(400, 'INVALID_INPUT', 'Review the viewing request fields.');
              }
            }
          }
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            if (outcomeCommand && attendance)
              return query.query(
                'SELECT app_api.record_viewing_outcome($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::timestamptz,$7::text) AS receipt',
                [
                  id,
                  viewingId,
                  outcomeCommand.operationId,
                  outcomeCommand.expectedVersion,
                  attendance,
                  outcomeCommand.occurredAt,
                  outcomeCommand.reason,
                ],
              );
            if (rescheduleCommand)
              return query.query(
                'SELECT app_api.reschedule_viewing($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::jsonb,$6::text) AS receipt',
                [
                  id,
                  viewingId,
                  rescheduleCommand.operationId,
                  rescheduleCommand.expectedVersion,
                  JSON.stringify(rescheduleCommand.slot),
                  rescheduleCommand.reason,
                ],
              );
            if (terminationCommand && ending)
              return query.query(
                'SELECT app_api.terminate_viewing($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::text) AS receipt',
                [
                  id,
                  viewingId,
                  terminationCommand.operationId,
                  terminationCommand.expectedVersion,
                  ending,
                  terminationCommand.reason,
                ],
              );
            if (confirmationCommand)
              return query.query(
                'SELECT app_api.confirm_viewing_phone($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::jsonb,$6::text,$7::timestamptz,$8::text) AS receipt',
                [
                  id,
                  viewingId,
                  confirmationCommand.operationId,
                  confirmationCommand.expectedVersion,
                  JSON.stringify(confirmationCommand.slot),
                  confirmationCommand.channel,
                  confirmationCommand.agreedAt,
                  confirmationCommand.notes,
                ],
              );
            if (original) {
              const command = original.command;
              return query.query(
                'SELECT app_api.execute_viewing_operation($1::uuid,$2::uuid,$3::uuid,$4::bigint,$5::text,$6::uuid,$7::jsonb,$8::text,$9::jsonb) AS receipt',
                original.kind === 'request'
                  ? [
                      id,
                      null,
                      command.operationId,
                      original.command.expectedEnquiryVersion,
                      'request',
                      original.command.listingId,
                      JSON.stringify(original.command.preferredSlots),
                      original.command.notes,
                      null,
                    ]
                  : [
                      id,
                      original.viewingId,
                      command.operationId,
                      original.command.expectedVersion,
                      'propose',
                      null,
                      null,
                      null,
                      JSON.stringify(original.command.slot),
                    ],
              );
            }
            if (operationId)
              return query.query(
                'SELECT app_api.read_viewing_operation($1::uuid,$2::uuid) AS receipt',
                [id, operationId],
              );
            if (viewingId)
              return query.query('SELECT app_api.read_viewing($1::uuid,$2::uuid) AS detail', [
                id,
                viewingId,
              ]);
            return query.query(
              'SELECT app_api.list_enquiry_viewings($1::uuid,$2::integer) AS page',
              [id, pageLimit],
            );
          });
          if (list)
            return response(
              200,
              validateViewingPage(scalar(result, 'page'), id, pageLimit),
              correlationId,
            );
          if (viewingId && !mutation)
            return response(
              200,
              validateViewingDetail(scalar(result, 'detail'), id, viewingId),
              correlationId,
            );
          const data = scalar(result, 'receipt');
          if (outcomeCommand && attendance) {
            const receipt = validateViewingOutcomeReceipt(
              data,
              id,
              viewingId!,
              attendance,
              outcomeCommand,
            );
            if (receipt.actorId !== actorId) throw new Error('Unexpected viewing outcome actor.');
            return response(200, receipt, correlationId);
          }
          if (rescheduleCommand) {
            const receipt = validateViewingRescheduleReceipt(
              data,
              id,
              viewingId!,
              rescheduleCommand,
            );
            if (receipt.actorId !== actorId)
              throw new Error('Unexpected viewing reschedule actor.');
            return response(200, receipt, correlationId);
          }
          if (terminationCommand && ending) {
            const receipt = validateViewingTerminationReceipt(
              data,
              id,
              viewingId!,
              ending,
              terminationCommand,
            );
            if (receipt.actorId !== actorId) throw new Error('Unexpected viewing terminal actor.');
            return response(200, receipt, correlationId);
          }
          if (confirmationCommand) {
            const receipt = validateViewingConfirmationReceipt(
              data,
              id,
              viewingId!,
              confirmationCommand,
            );
            if (receipt.actorId !== actorId)
              throw new Error('Unexpected viewing confirmation actor.');
            return response(200, receipt, correlationId);
          }
          if (!original) {
            if (!data || typeof data !== 'object' || Array.isArray(data))
              throw new Error('Invalid stored viewing receipt.');
            const stored = data as Record<string, unknown>;
            if (stored.kind === 'complete' || stored.kind === 'no_show') {
              const command = validateViewingOutcomeCommand({
                ...(stored.request as object),
                operationId: stored.operationId,
                expectedVersion: stored.expectedVersion,
              });
              if (command.operationId !== operationId || typeof stored.viewingId !== 'string')
                throw new Error('Unexpected viewing outcome operation.');
              const receipt = validateViewingOutcomeReceipt(
                data,
                id,
                stored.viewingId,
                stored.kind,
                command,
              );
              if (receipt.actorId !== actorId) throw new Error('Unexpected viewing outcome actor.');
              return response(200, receipt, correlationId);
            }
            if (stored.kind === 'reschedule') {
              const command = validateViewingRescheduleCommand({
                ...(stored.request as object),
                operationId: stored.operationId,
                expectedVersion: stored.expectedVersion,
              });
              if (command.operationId !== operationId || typeof stored.viewingId !== 'string')
                throw new Error('Unexpected viewing reschedule operation.');
              const receipt = validateViewingRescheduleReceipt(data, id, stored.viewingId, command);
              if (receipt.actorId !== actorId)
                throw new Error('Unexpected viewing reschedule actor.');
              return response(200, receipt, correlationId);
            }
            if (stored.kind === 'cancel' || stored.kind === 'decline') {
              const command = validateViewingTerminationCommand({
                ...(stored.request as object),
                operationId: stored.operationId,
                expectedVersion: stored.expectedVersion,
              });
              if (command.operationId !== operationId || typeof stored.viewingId !== 'string')
                throw new Error('Unexpected viewing terminal operation.');
              const receipt = validateViewingTerminationReceipt(
                data,
                id,
                stored.viewingId,
                stored.kind,
                command,
              );
              if (receipt.actorId !== actorId)
                throw new Error('Unexpected viewing terminal actor.');
              return response(200, receipt, correlationId);
            }
            if (stored.kind === 'confirm') {
              const command = validateViewingConfirmationCommand({
                ...(stored.request as object),
                operationId: stored.operationId,
                expectedVersion: stored.expectedVersion,
              });
              if (command.operationId !== operationId || typeof stored.viewingId !== 'string')
                throw new Error('Unexpected viewing confirmation operation.');
              const receipt = validateViewingConfirmationReceipt(
                data,
                id,
                stored.viewingId,
                command,
              );
              if (receipt.actorId !== actorId)
                throw new Error('Unexpected viewing confirmation actor.');
              return response(200, receipt, correlationId);
            }
            if (stored.kind !== 'request' && stored.kind !== 'propose')
              throw new Error('Invalid stored viewing kind.');
            original = validateViewingOriginal(
              stored.kind === 'request'
                ? {
                    kind: 'request',
                    command: {
                      ...(stored.request as object),
                      operationId: stored.operationId,
                      expectedEnquiryVersion: stored.expectedVersion,
                    },
                  }
                : {
                    kind: 'propose',
                    viewingId: stored.viewingId,
                    command: {
                      ...(stored.request as object),
                      operationId: stored.operationId,
                      expectedVersion: stored.expectedVersion,
                    },
                  },
            );
            if (original.command.operationId !== operationId)
              throw new Error('Unexpected viewing operation.');
          }
          const receipt = validateViewingReceipt(data, id, original);
          if (receipt.actorId !== actorId) throw new Error('Unexpected viewing actor.');
          return response(200, receipt, correlationId);
        }
        const contactRoute =
          /^\/v2\/staff\/enquiries\/([^/]+)\/contacts(?:\/operations\/([^/]+))?$/.exec(path);
        if (contactRoute) {
          const id = uuid(contactRoute[1], 'enquiryId'),
            operationId =
              contactRoute[2] === undefined ? null : uuid(contactRoute[2], 'operationId');
          const list = method === 'GET' && operationId === null,
            pageLimit = enquiryQuery(url, list, 50);
          if (method !== 'GET' && (method !== 'POST' || operationId !== null))
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: operationId ? 'GET' : 'GET, POST' },
            );
          let command: ReturnType<typeof validateContactCommand> | undefined;
          if (method === 'POST') {
            const body = record(await jsonBody(request, 16 * 1024, false, true), [
              'operationId',
              'expectedVersion',
              'channel',
              'outcome',
              'occurredAt',
              'notes',
            ]);
            const expected = version(body.expectedVersion);
            try {
              command = validateContactCommand({ ...body, expectedVersion: String(expected) });
            } catch {
              throw new HttpError(400, 'INVALID_INPUT', 'Review the contact entry fields.');
            }
          }
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            if (command)
              return query.query(
                'SELECT app_api.record_enquiry_contact($1::uuid,$2::uuid,$3::bigint,$4::text,$5::text,$6::timestamptz,$7::text) AS receipt',
                [
                  id,
                  command.operationId,
                  command.expectedVersion,
                  command.channel,
                  command.outcome,
                  command.occurredAt,
                  command.notes,
                ],
              );
            if (operationId)
              return query.query(
                'SELECT app_api.read_enquiry_contact($1::uuid,$2::uuid) AS receipt',
                [id, operationId],
              );
            return query.query(
              'SELECT app_api.list_enquiry_contacts($1::uuid,$2::integer) AS page',
              [id, pageLimit],
            );
          });
          if (list)
            return response(
              200,
              validateContactPage(scalar(result, 'page'), pageLimit),
              correlationId,
            );
          const receipt = validateContactReceipt(
            scalar(result, 'receipt'),
            id,
            command?.operationId ?? operationId!,
            command,
          );
          if (receipt.actorId !== actorId) throw new Error('Unexpected contact actor.');
          return response(200, receipt, correlationId);
        }
        const activityRoute = /^\/v2\/staff\/enquiries\/([^/]+)\/activity$/.exec(path);
        if (activityRoute) {
          const id = uuid(activityRoute[1], 'enquiryId'),
            pageLimit = enquiryQuery(url, true, 50);
          if (method !== 'GET')
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: 'GET' },
            );
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            return query.query(
              'SELECT app_api.list_enquiry_activity($1::uuid,$2::integer) AS page',
              [id, pageLimit],
            );
          });
          return response(
            200,
            validateEnquiryActivityPage(scalar(result, 'page'), pageLimit),
            correlationId,
          );
        }
        const enquiryRoute =
          /^\/v2\/staff\/enquiries\/([^/]+)(?:\/(operations)(?:\/([^/]+))?)?$/.exec(path);
        if (enquiryRoute) {
          enquiryQuery(url, false);
          const id = uuid(enquiryRoute[1], 'enquiryId'),
            operations = enquiryRoute[2] !== undefined;
          const operationId =
            enquiryRoute[3] === undefined ? null : uuid(enquiryRoute[3], 'operationId');
          const allowedMethod = operations && operationId === null ? 'POST' : 'GET';
          if (method !== allowedMethod)
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: allowedMethod },
            );
          const command =
            allowedMethod === 'POST'
              ? enquiryCommand(await jsonBody(request, 8 * 1024, false, true))
              : undefined;
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            if (command)
              return query.query(
                'SELECT app_api.execute_enquiry_operation($1::uuid,$2::uuid,$3::bigint,$4::text,$5::uuid,$6::text,$7::timestamptz,$8::text) AS receipt',
                [
                  id,
                  command.operationId,
                  command.expected,
                  command.kind,
                  command.assignedAgentId,
                  command.status,
                  command.nextActionAt,
                  command.reason,
                ],
              );
            if (operationId !== null)
              return query.query(
                'SELECT app_api.read_enquiry_operation($1::uuid,$2::uuid) AS receipt',
                [id, operationId],
              );
            return query.query(
              `SELECT ${ENQUIRY_SELECT},e.phone_e164 AS phone,e.email,e.message,e.notice_version AS "noticeVersion",e.closure_reason AS "closureReason" FROM app_private.enquiries e WHERE e.tenant_id=$1::uuid AND e.id=$2::uuid`,
              [tenantId, id],
            );
          });
          if (operations)
            return response(
              200,
              enquiryOperationProjection(
                scalar(result, 'receipt'),
                id,
                command?.operationId ?? operationId!,
                command,
              ),
              correlationId,
            );
          const row = result.rows[0];
          if (!row) throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
          return response(200, enquiryProjection(row, true, id), correlationId);
        }
        const workspaceRoute =
          /^\/v2\/staff\/listings\/([^/]+)\/revisions\/([1-9]\d*)\/workspace$/.exec(path);
        if (workspaceRoute) {
          if (url.search)
            throw new HttpError(
              400,
              'INVALID_INPUT',
              'Workspace requests do not accept query fields.',
            );
          const id = uuid(workspaceRoute[1], 'listingId'),
            revision = Number(workspaceRoute[2]);
          if (!Number.isSafeInteger(revision) || revision > 2147483647)
            throw new HttpError(400, 'INVALID_INPUT', 'revision is outside the supported range.');
          if (method !== 'GET')
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: 'GET' },
            );
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            // One statement snapshot binds the optimistic token to this full order.
            // RLS applies independently to the revision and correlated media rows.
            return query.query(
              `SELECT r.listing_id AS "listingId",r.revision_no AS revision,r.state,r.version::text AS version,
              r.title,r.description,r.purpose,r.property_type AS "propertyType",r.currency,r.amount_minor::text AS "amountMinor",r.rent_period AS "rentPeriod",
              r.bedrooms,r.private_bathrooms AS "privateBathrooms",r.shared_bathrooms AS "sharedBathrooms",r.country,r.locality,r.public_precision AS "publicPrecision",
              r.latitude::text AS latitude,r.longitude::text AS longitude,r.private_address AS "privateAddress",r.pricing,r.location,
              coalesce((SELECT jsonb_agg(jsonb_build_object('id',m.id,'position',m.position,'altText',m.alt_text,'accepted',m.accepted,
                'provenance',CASE WHEN m.sealed_job_id IS NOT NULL THEN 'sealed' ELSE 'legacy' END) ORDER BY m.position)
                FROM app_private.revision_media m WHERE m.tenant_id=r.tenant_id AND m.listing_id=r.listing_id AND m.revision_no=r.revision_no),'[]'::jsonb) AS photos
              FROM app_private.listing_revisions r WHERE r.tenant_id=$1::uuid AND r.listing_id=$2::uuid AND r.revision_no=$3::integer`,
              [tenantId, id, revision],
            );
          });
          const row = result.rows[0];
          if (!row) throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
          return response(200, workspaceProjection(row, id, revision), correlationId);
        }
        const galleryRoute =
          /^\/v2\/staff\/listings\/([^/]+)\/revisions\/([1-9]\d*)\/(media-removals|media-reorders|media-operations)(?:\/([^/]+))?$/.exec(
            path,
          );
        if (galleryRoute) {
          if (url.search)
            throw new HttpError(400, 'INVALID_INPUT', 'Media requests do not accept query fields.');
          const id = uuid(galleryRoute[1], 'listingId'),
            revision = Number(galleryRoute[2]);
          if (!Number.isSafeInteger(revision) || revision > 2147483647)
            throw new HttpError(400, 'INVALID_INPUT', 'revision is outside the supported range.');
          const read = galleryRoute[3] === 'media-operations',
            readId = galleryRoute[4] === undefined ? null : uuid(galleryRoute[4], 'operationId');
          if (read ? readId === null : readId !== null)
            throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
          const allowedMethod = read ? 'GET' : 'POST';
          if (method !== allowedMethod)
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: allowedMethod },
            );
          let command: GalleryRequest | undefined;
          if (!read) {
            const remove = galleryRoute[3] === 'media-removals',
              body = record(await jsonBody(request, 8 * 1024, false, true), [
                'operationId',
                'expectedVersion',
                remove ? 'mediaId' : 'orderedIds',
              ]),
              expected = version(body.expectedVersion);
            if (expected > Number.MAX_SAFE_INTEGER - 1)
              throw new HttpError(
                400,
                'INVALID_INPUT',
                'expectedVersion is outside the incrementable media range.',
              );
            command = {
              kind: remove ? 'remove_media' : 'reorder_media',
              operationId: uuid(body.operationId, 'operationId'),
              expected,
              mediaId: remove ? uuid(body.mediaId, 'mediaId') : null,
              orderedIds: remove ? [] : galleryIds(body.orderedIds),
            };
          }
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            if (!command)
              return query.query('SELECT app_api.read_media_operation($1::uuid) AS receipt', [
                readId,
              ]);
            return command.kind === 'remove_media'
              ? query.query(
                  'SELECT app_api.remove_draft_media($1::uuid,$2::integer,$3::bigint,$4::uuid,$5::uuid) AS receipt',
                  [id, revision, command.expected, command.operationId, command.mediaId],
                )
              : query.query(
                  'SELECT app_api.reorder_draft_media($1::uuid,$2::integer,$3::bigint,$4::uuid,$5::uuid[]) AS receipt',
                  [id, revision, command.expected, command.operationId, command.orderedIds],
                );
          });
          return response(
            200,
            galleryProjection(
              scalar(result, 'receipt'),
              id,
              revision,
              command?.operationId ?? readId!,
              command,
            ),
            correlationId,
          );
        }
        const attachRoute =
          /^\/v2\/staff\/listings\/([^/]+)\/revisions\/([1-9]\d*)\/media-attach-intents(?:\/([^/]+))?$/.exec(
            path,
          );
        if (attachRoute) {
          if (url.search)
            throw new HttpError(400, 'INVALID_INPUT', 'Media requests do not accept query fields.');
          const id = uuid(attachRoute[1], 'listingId'),
            revision = Number(attachRoute[2]);
          if (!Number.isSafeInteger(revision) || revision > 2147483647)
            throw new HttpError(400, 'INVALID_INPUT', 'revision is outside the supported range.');
          const readId = attachRoute[3] === undefined ? null : uuid(attachRoute[3], 'operationId'),
            allowedMethod = readId === null ? 'POST' : 'GET';
          if (method !== allowedMethod)
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: allowedMethod },
            );
          let creation: { operationId: string; jobId: string; expected: number } | undefined;
          if (readId === null) {
            const body = record(await jsonBody(request, 8 * 1024, false, true), [
                'operationId',
                'jobId',
                'expectedVersion',
              ]),
              expected = version(body.expectedVersion);
            if (expected > Number.MAX_SAFE_INTEGER - 1)
              throw new HttpError(
                400,
                'INVALID_INPUT',
                'expectedVersion is outside the attachment range.',
              );
            creation = {
              operationId: uuid(body.operationId, 'operationId'),
              jobId: uuid(body.jobId, 'jobId'),
              expected,
            };
            if (creation.operationId === creation.jobId)
              throw new HttpError(
                400,
                'INVALID_INPUT',
                'Attachment operation and job identities must differ.',
              );
          }
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            // The tuple-bearing SQL command validates URL context before allocating intent state.
            if (creation)
              return query.query(
                'SELECT app_api.create_media_attach_intent($1::uuid,$2::integer,$3::bigint,$4::uuid,$5::uuid) AS receipt',
                [id, revision, creation.expected, creation.operationId, creation.jobId],
              );
            return query.query('SELECT app_api.read_media_attach_intent($1::uuid) AS receipt', [
              readId,
            ]);
          });
          return response(
            200,
            attachProjection(
              scalar(result, 'receipt'),
              id,
              revision,
              creation?.operationId ?? readId!,
              creation,
            ),
            correlationId,
          );
        }
        const mediaRoute =
          /^\/v2\/staff\/listings\/([^/]+)\/revisions\/([1-9]\d*)\/(media-registrations|media-jobs)(?:\/([^/]+))?$/.exec(
            path,
          );
        if (mediaRoute) {
          if (url.search)
            throw new HttpError(400, 'INVALID_INPUT', 'Media requests do not accept query fields.');
          const id = uuid(mediaRoute[1], 'listingId'),
            revision = Number(mediaRoute[2]);
          if (!Number.isSafeInteger(revision) || revision > 2147483647)
            throw new HttpError(400, 'INVALID_INPUT', 'revision is outside the supported range.');
          const job = mediaRoute[3] === 'media-jobs',
            resourceId =
              mediaRoute[4] === undefined
                ? null
                : uuid(mediaRoute[4], job ? 'jobId' : 'registrationId');
          if (job && resourceId === null)
            throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
          const allowedMethod = resourceId === null ? 'POST' : 'GET';
          if (method !== allowedMethod)
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: allowedMethod },
            );
          let registration:
            { registrationId: string; expected: number; altText: string } | undefined;
          if (resourceId === null) {
            const body = record(await jsonBody(request, 8 * 1024, false, true), [
              'registrationId',
              'expectedVersion',
              'altText',
            ]);
            registration = {
              registrationId: uuid(body.registrationId, 'registrationId'),
              expected: version(body.expectedVersion),
              altText: mediaAltText(body.altText),
            };
          }
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            if (registration)
              return query.query(
                'SELECT app_api.register_media_upload($1::uuid,$2::integer,$3::bigint,$4::uuid,$5::text) AS receipt',
                [
                  id,
                  revision,
                  registration.expected,
                  registration.registrationId,
                  registration.altText,
                ],
              );
            return query.query(
              job
                ? 'SELECT app_api.read_media_job($1::uuid) AS receipt'
                : 'SELECT app_api.read_media_registration($1::uuid) AS receipt',
              [resourceId],
            );
          });
          return response(
            200,
            mediaProjection(scalar(result, 'receipt'), id, revision, job, resourceId),
            correlationId,
          );
        }
        if (path === '/v2/staff/reviews' || reviewRoute) {
          const queue = path === '/v2/staff/reviews';
          reviewQuery(url, queue);
          if (queue) {
            if (method !== 'GET')
              throw new HttpError(
                405,
                'METHOD_NOT_ALLOWED',
                'Method is not allowed for this route.',
                { Allow: 'GET' },
              );
            const pageLimit = limit(request);
            const result = await options.database.transaction(context, async (query) => {
              await assertAdmin(query);
              return query.query(
                `SELECT ${REVIEW_METADATA} FROM app_private.listing_revisions r
                JOIN app_private.listings l ON l.tenant_id=r.tenant_id AND l.id=r.listing_id
                WHERE r.tenant_id=$1::uuid AND r.state='pending' ORDER BY r.submitted_at,r.listing_id,r.revision_no LIMIT $2`,
                [tenantId, pageLimit],
              );
            });
            return response(
              200,
              { items: result.rows.map(reviewMetadata), limit: pageLimit },
              correlationId,
            );
          }
          const id = uuid(reviewRoute![1], 'listingId'),
            revision = Number(reviewRoute![2]);
          if (!Number.isSafeInteger(revision) || revision > 2147483647)
            throw new HttpError(400, 'INVALID_INPUT', 'revision is outside the supported range.');
          if (!reviewRoute![3] && method === 'GET') {
            const result = await options.database.transaction(context, async (query) => {
              await assertAdmin(query);
              return query.query(
                `SELECT ${REVIEW_METADATA},r.decided_at AS "decidedAt",r.decided_by AS "decidedBy",r.decision_reason AS "decisionReason",
                r.description,r.currency,r.bedrooms,r.private_bathrooms AS "privateBathrooms",r.shared_bathrooms AS "sharedBathrooms",r.country,r.locality,
                r.public_precision AS "publicPrecision",r.latitude::text AS latitude,r.longitude::text AS longitude,r.private_address AS "privateAddress",r.pricing,r.location,
                coalesce((SELECT jsonb_agg(jsonb_build_object('key',m.public_object_key,'alt',m.alt_text) ORDER BY m.position)
                  FROM app_private.revision_media m WHERE m.tenant_id=r.tenant_id AND m.listing_id=r.listing_id AND m.revision_no=r.revision_no AND m.accepted),'[]'::jsonb) AS photos
                FROM app_private.listing_revisions r JOIN app_private.listings l ON l.tenant_id=r.tenant_id AND l.id=r.listing_id
                WHERE r.tenant_id=$1::uuid AND r.listing_id=$2::uuid AND r.revision_no=$3::integer`,
                [tenantId, id, revision],
              );
            });
            const row = result.rows[0];
            if (!row) throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
            const fields = Object.fromEntries(DRAFT_FIELDS.map((field) => [field, row[field]]));
            // An existing draft may legitimately omit purpose/price/period fields. Reading
            // it must not apply the complete-price validation used when saving v2 input.
            const content = {
              ...publicRow(fields),
              amountMinor: row.amountMinor === null ? null : Number(row.amountMinor),
              pricing: validatePricingInputV2(row.pricing),
              location: validatePublicLocationV2(row.location),
            };
            return response(
              200,
              {
                ...reviewMetadata(row),
                decidedAt: row.decidedAt,
                decidedBy: row.decidedBy,
                decisionReason: row.decisionReason,
                content,
                photos: row.photos,
              },
              correlationId,
            );
          }
          if (reviewRoute![3] && method === 'POST') {
            const body = record(await jsonBody(request, 8 * 1024, true, true), [
              'expectedVersion',
              'decision',
              'reason',
            ]);
            const expected = version(body.expectedVersion);
            if (body.decision !== 'approve' && body.decision !== 'reject')
              throw new HttpError(400, 'INVALID_INPUT', 'Choose approve or reject.');
            const approve = body.decision === 'approve';
            const reason = approve ? null : rejectionReason(body.reason);
            if (approve && body.reason !== null)
              throw new HttpError(400, 'INVALID_INPUT', 'Approval reason must be explicitly null.');
            const result = await options.database.transaction(context, async (query) => {
              await assertAdmin(query);
              return query.query(
                'SELECT app_api.decide_revision($1::uuid,$2::integer,$3::bigint,$4::boolean,$5::text) AS version',
                [id, revision, expected, approve, reason],
              );
            });
            return response(
              200,
              {
                version: String(scalar(result, 'version')),
                state: approve ? 'approved' : 'rejected',
              },
              correlationId,
            );
          }
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed for this route.', {
            Allow: reviewRoute![3] ? 'POST' : 'GET',
          });
        }
        if ((path === '/v1/staff/listings' || path === '/v1/staff/enquiries') && method === 'GET') {
          const pageLimit = limit(request);
          const result = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            return path.endsWith('/listings')
              ? query.query(
                  `SELECT id,slug,created_by_id AS "createdById",assigned_agent_id AS "assignedAgentId",availability,publication_status AS "publicationStatus",published_revision_no AS "publishedRevision",version::text AS version FROM app_private.listings ORDER BY updated_at DESC,id LIMIT $1`,
                  [pageLimit],
                )
              : query.query(
                  `SELECT id,listing_id AS "listingId",contact_name AS name,phone_e164 AS phone,email,message,origin,status,assigned_agent_id AS "assignedAgentId",next_action_at AS "nextActionAt",version::text AS version FROM app_private.enquiries ORDER BY created_at DESC,id LIMIT $1`,
                  [pageLimit],
                );
          });
          return response(200, { items: result.rows, limit: pageLimit }, correlationId);
        }
        if (path === '/v1/staff/listings' && method === 'POST') {
          const body = record(await jsonBody(request, 4096), ['id', 'slug', 'assignedAgentId']);
          const id = body.id === undefined ? newId() : uuid(body.id, 'id');
          const slug = text(body.slug, 'slug', 160);
          if (!/^[a-z\d]+(?:-[a-z\d]+)*$/.test(slug))
            throw new HttpError(
              400,
              'INVALID_INPUT',
              'Use lowercase words separated by single hyphens for slug.',
            );
          const assigned =
            body.assignedAgentId === undefined
              ? actorId
              : uuid(body.assignedAgentId, 'assignedAgentId');
          const result = await options.database.transaction(context, (query) =>
            query.query('SELECT app_api.create_listing($1::uuid,$2,$3::uuid) AS id', [
              id,
              slug,
              assigned,
            ]),
          );
          return response(201, { id: scalar(result, 'id') }, correlationId);
        }
        if (draftRoute) {
          const id = uuid(draftRoute[1], 'listingId');
          const revision = Number(draftRoute[2]);
          if (!Number.isSafeInteger(revision) || revision > 2147483647)
            throw new HttpError(400, 'INVALID_INPUT', 'revision is outside the supported range.');
          if (v2Draft && !draftRoute[3] && method === 'GET') {
            const result = await options.database.transaction(context, async (query) => {
              await assertStaff(query);
              return query.query(
                `SELECT revision_no AS revision,state,version::text AS version,
                title,description,purpose,property_type AS "propertyType",currency,amount_minor::text AS "amountMinor",rent_period AS "rentPeriod",
                bedrooms,private_bathrooms AS "privateBathrooms",shared_bathrooms AS "sharedBathrooms",country,locality,public_precision AS "publicPrecision",
                latitude::text AS latitude,longitude::text AS longitude,private_address AS "privateAddress",pricing,location
                FROM app_private.listing_revisions WHERE tenant_id=$1::uuid AND listing_id=$2::uuid AND revision_no=$3::integer`,
                [tenantId, id, revision],
              );
            });
            const row = result.rows[0];
            if (!row) throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
            const { revision: storedRevision, state, version: storedVersion, ...fields } = row;
            // Staff alone may read the private address. Never reuse this projection for public routes.
            const content = {
              ...publicRow(fields),
              amountMinor: fields.amountMinor === null ? null : Number(fields.amountMinor),
              pricing: validatePricingInputV2(fields.pricing),
              location: validatePublicLocationV2(fields.location),
            };
            return response(
              200,
              { revision: storedRevision, state, version: String(storedVersion), content },
              correlationId,
            );
          }
          if (draftRoute[3] && method === 'POST') {
            const body = record(await jsonBody(request, 4096), ['expectedVersion']);
            const expected = version(body.expectedVersion);
            const result = await options.database.transaction(context, (query) =>
              query.query(
                'SELECT app_api.submit_revision($1::uuid,$2::integer,$3::bigint) AS version',
                [id, revision, expected],
              ),
            );
            return response(200, { version: String(scalar(result, 'version')) }, correlationId);
          }
          if (!draftRoute[3] && method === 'PUT') {
            // 32 bounded Unicode charge labels plus a full description can exceed 64 KiB.
            const body = record(await jsonBody(request, (v2Draft ? 128 : 64) * 1024, v2Draft), [
              'expectedVersion',
              'content',
            ]);
            const content = v2Draft
              ? draftContentV2(body.content)
              : record(body.content, DRAFT_FIELDS);
            const expected = version(body.expectedVersion, true);
            const result = await options.database.transaction(context, (query) =>
              query.query(
                `SELECT app_api.${v2Draft ? 'save_draft_v2' : 'save_draft'}($1::uuid,$2::integer,$3::bigint,$4::jsonb) AS version`,
                [id, revision, expected, JSON.stringify(content)],
              ),
            );
            return response(200, { version: String(scalar(result, 'version')) }, correlationId);
          }
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed for this route.', {
            Allow: draftRoute[3] ? 'POST' : v2Draft ? 'GET, PUT' : 'PUT',
          });
        }
      }
      const allowedMethods: Record<string, string> = {
        '/v1/properties': 'GET',
        '/v2/properties': 'GET',
        '/v1/enquiries': 'POST',
        '/v1/staff/listings': 'GET, POST',
        '/v1/staff/enquiries': 'GET',
      };
      if (allowedMethods[path])
        throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed for this route.', {
          Allow: allowedMethods[path],
        });
      throw new HttpError(404, 'NOT_FOUND', 'Route is unavailable.');
    } catch (error) {
      const safe = safeError(error);
      return response(
        safe.status,
        { error: { code: safe.code, message: safe.message }, requestId: correlationId },
        correlationId,
        safe.headers,
      );
    }
  };
}
