import {
  validateListingReferenceCatalogue,
  validateSyntheticReferenceDraftCommand,
  validateSyntheticReferenceDraftReceipt,
  validateSyntheticReferenceCreationCommand,
  validateSyntheticReferenceCreationReceipt,
  validateSyntheticReferenceSuccessorCommand,
  validateSyntheticReferenceSuccessorReceipt,
  validateSyntheticReferenceRevision,
  validateSyntheticReferenceContext,
  validateSyntheticReferencePublicAttributes,
  PROPERTY_TYPES,
  type PropertyType,
  validateSyntheticReferenceTransitionCommand,
  validateSyntheticReferenceTransitionReceipt,
  validateListingVerificationCommand,
  validateListingVerificationReceipt,
  validateListingVerificationOriginal,
  validateListingVerificationHistory,
  validateListingDuplicateRequest,
  validateListingDuplicateCandidates,
  previewListingImport,
  validateReviewMediaGallery,
  validateListingControlCommand,
  validateListingControlReceipt,
  validateListingControlSnapshot,
  type ListingControlCommand,
  validateListingSuccessorCommand,
  validateListingSuccessorReceipt,
  validateListingSuccessorSnapshot,
  type ListingSuccessorCommand,
  validateListingCreationCommand,
  validateListingCreationReceipt,
  validateListingCreationSnapshot,
  type ListingCreationCommand,
  validateStaffListingPage,
  validateStaffListingSummary,
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
  /** Isolated synthetic reference candidates only; omitted keeps every v3 reference route unavailable. */
  readonly referenceDraftMode?: 'synthetic-reference-draft-v1';
  /** Separate isolated candidate. Requires reference draft mode; never installs schema. */
  readonly referenceModerationMode?: 'synthetic-reference-transition-v1';
  /** Fifth isolated candidate; requires moderation mode and never installs schema. */
  readonly referenceCreationMode?: 'synthetic-reference-creation-v1';
  readonly referenceSuccessorMode?: 'synthetic-reference-successor-v1';
  /** Explicit synthetic private-check policy; omission leaves its routes unavailable. */
  readonly verificationMode?: 'synthetic-check-record-v1';
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

function assertDecisionJsonTokens(source: string, stringVersions = false): void {
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
        !stringVersions &&
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
  stringVersions = false,
  deadlineMs = 0,
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
  let emptyChunks = 0;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
  const expires = deadlineMs ? Date.now() + deadlineMs : 0;
  const timedOut = () => new HttpError(408, 'REQUEST_TIMEOUT', 'Request body deadline exceeded.');
  const timeout: Promise<never> | null = deadlineMs
    ? new Promise((_, reject) => {
        deadlineTimer = setTimeout(() => reject(timedOut()), deadlineMs);
      })
    : null;
  let abortBody: (() => void) | undefined;
  const aborted: Promise<never> | null = deadlineMs
    ? new Promise((_, reject) => {
        abortBody = () => reject(new HttpError(400, 'REQUEST_ABORTED', 'Request was cancelled.'));
        request.signal.addEventListener('abort', abortBody, { once: true });
        if (request.signal.aborted) abortBody();
      })
    : null;
  try {
    for (;;) {
      if (expires && Date.now() >= expires) throw timedOut();
      const { value, done } = await (timeout
        ? Promise.race([reader.read(), timeout, aborted!])
        : reader.read());
      if (done) break;
      if (deadlineMs && !value.byteLength) {
        if (++emptyChunks > 1024)
          throw new HttpError(400, 'INVALID_INPUT', 'Too many empty body frames.');
        if (emptyChunks % 64 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
        continue;
      }
      emptyChunks = 0;
      size += value.byteLength;
      if (size > maximum) {
        if (deadlineMs) void reader.cancel().catch(() => undefined);
        else await reader.cancel();
        throw new HttpError(413, 'BODY_TOO_LARGE', 'Request body is too large.');
      }
      chunks.push(value);
    }
  } catch (error) {
    if (deadlineMs) void reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    if (deadlineTimer) clearTimeout(deadlineTimer);
    if (abortBody) request.signal.removeEventListener('abort', abortBody);
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
    if (strictDecision) assertDecisionJsonTokens(source, stringVersions);
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
function publicReferenceRow(row: Record<string, unknown>): Record<string, unknown> {
  const keys = [
    'id',
    'slug',
    'revision',
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
    'photos',
    'pricing',
    'location',
    'referenceAttributes',
    'referenceRevisionVersion',
    'referenceCatalogue',
  ];
  if (
    !row ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(row)) ||
    Reflect.ownKeys(row).length !== keys.length ||
    Reflect.ownKeys(row).some((k) => typeof k !== 'string' || !keys.includes(k))
  )
    throw Error('Invalid public reference projection.');
  const captured: Record<string, unknown> = {};
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(row, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value'))
      throw Error('Invalid public projection field.');
    captured[key] = d.value;
  }
  const { referenceAttributes, referenceRevisionVersion, referenceCatalogue, ...base } = captured;
  const checkedCatalogue =
    referenceAttributes === null ? null : validateListingReferenceCatalogue(referenceCatalogue);
  if (new TextEncoder().encode(JSON.stringify(checkedCatalogue)).byteLength > 131072)
    throw Error('Public reference validation context too large.');
  for (const field of [
    'id',
    'slug',
    'title',
    'description',
    'purpose',
    'propertyType',
    'currency',
    'amountMinor',
    'country',
    'locality',
    'publicPrecision',
  ])
    if (typeof base[field] !== 'string') throw Error('Invalid public scalar field.');
  if (
    typeof base.revision !== 'number' ||
    !Number.isInteger(base.revision) ||
    base.revision < 1 ||
    base.revision > 2147483647 ||
    !/^[1-9]\d{0,14}$/.test(base.amountMinor as string) ||
    BigInt(base.amountMinor as string) > 100000000000000n
  )
    throw Error('Invalid public numeric field.');
  for (const field of ['bedrooms', 'privateBathrooms', 'sharedBathrooms'])
    if (
      base[field] !== null &&
      (typeof base[field] !== 'number' ||
        !Number.isSafeInteger(base[field]) ||
        (base[field] as number) < 0)
    )
      throw Error('Invalid public room count.');
  for (const field of ['latitude', 'longitude'])
    if (
      base[field] !== null &&
      (typeof base[field] !== 'string' || !Number.isFinite(Number(base[field])))
    )
      throw Error('Invalid public coordinate.');
  if (base.rentPeriod !== null && typeof base.rentPeriod !== 'string')
    throw Error('Invalid public rental period.');
  if (
    base.currency !== 'KES' ||
    base.country !== 'KE' ||
    !['rent', 'sale'].includes(base.purpose as string) ||
    !['area', 'exact'].includes(base.publicPrecision as string) ||
    (base.purpose === 'sale' && base.rentPeriod !== null) ||
    (base.purpose === 'rent' &&
      !['day', 'week', 'month', 'year'].includes(base.rentPeriod as string)) ||
    (base.latitude === null) !== (base.longitude === null) ||
    (base.publicPrecision === 'area' && base.latitude !== null) ||
    (base.latitude !== null &&
      (Number(base.latitude) < -90 ||
        Number(base.latitude) > 90 ||
        Number(base.longitude) < -180 ||
        Number(base.longitude) > 180))
  )
    throw Error('Invalid public location or listing kind.');
  const rawPhotos = base.photos;
  if (
    !Array.isArray(rawPhotos) ||
    Object.getPrototypeOf(rawPhotos) !== Array.prototype ||
    rawPhotos.length < 4 ||
    rawPhotos.length > 12 ||
    Reflect.ownKeys(rawPhotos).length !== rawPhotos.length + 1
  )
    throw Error('Invalid public photos.');
  const photoKeys = new Set<string>();
  base.photos = Object.freeze(
    Array.from({ length: rawPhotos.length }, (_, i) => {
      const d = Object.getOwnPropertyDescriptor(rawPhotos, String(i));
      if (!d?.enumerable || !Object.hasOwn(d, 'value'))
        throw Error('Invalid public photo element.');
      const photo = d.value;
      if (
        !photo ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(photo)) ||
        Reflect.ownKeys(photo).length !== 2 ||
        Reflect.ownKeys(photo).some((k) => k !== 'key' && k !== 'alt')
      )
        throw Error('Invalid public photo fields.');
      const key = Object.getOwnPropertyDescriptor(photo, 'key'),
        alt = Object.getOwnPropertyDescriptor(photo, 'alt');
      if (
        !key?.enumerable ||
        !alt?.enumerable ||
        !Object.hasOwn(key, 'value') ||
        !Object.hasOwn(alt, 'value') ||
        typeof key.value !== 'string' ||
        typeof alt.value !== 'string' ||
        key.value.length > 1024 ||
        [...alt.value].length > 300 ||
        !alt.value.trim() ||
        !/^[A-Za-z\d][A-Za-z\d/_-]*\.(?:webp|jpg|png)$/.test(key.value) ||
        photoKeys.has(key.value)
      )
        throw Error('Invalid public photo values.');
      photoKeys.add(key.value);
      return Object.freeze({ key: key.value, alt: alt.value });
    }),
  );
  if (
    !PROPERTY_TYPES.includes(base.propertyType as PropertyType) ||
    (referenceAttributes === null && referenceCatalogue !== null)
  )
    throw Error('Invalid public reference context.');
  const reference = validateSyntheticReferencePublicAttributes(
    { attributes: referenceAttributes, revisionVersion: referenceRevisionVersion },
    checkedCatalogue,
    base.propertyType as PropertyType,
  );
  const item = publicRowV2(base);
  if (reference.attributes) {
    const l = reference.attributes.location,
      expected = {
        county: l.county?.label ?? null,
        town: l.locality?.label ?? null,
        area: l.neighbourhood?.label ?? null,
      };
    const location = item.location as Record<string, unknown>;
    if (Object.keys(expected).some((k) => location[k] !== expected[k as keyof typeof expected]))
      throw Error('Public reference location changed.');
    const deepest = l.neighbourhood?.label ?? l.locality?.label ?? l.county?.label;
    if (deepest !== undefined && base.locality !== deepest)
      throw Error('Public reference locality changed.');
  }
  return Object.freeze({ ...item, reference });
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
  if (
    options.verificationMode !== undefined &&
    options.verificationMode !== 'synthetic-check-record-v1'
  )
    throw new Error('Unsupported verification policy.');
  const verificationEnabled = options.verificationMode === 'synthetic-check-record-v1';
  if (
    options.referenceDraftMode !== undefined &&
    options.referenceDraftMode !== 'synthetic-reference-draft-v1'
  )
    throw new Error('Unsupported reference draft mode.');
  const referenceEnabled = options.referenceDraftMode === 'synthetic-reference-draft-v1';
  if (
    options.referenceModerationMode !== undefined &&
    (options.referenceModerationMode !== 'synthetic-reference-transition-v1' || !referenceEnabled)
  )
    throw new Error('Unsupported reference moderation mode.');
  const referenceModerationEnabled =
    options.referenceModerationMode === 'synthetic-reference-transition-v1';
  if (
    options.referenceCreationMode !== undefined &&
    (options.referenceCreationMode !== 'synthetic-reference-creation-v1' ||
      !referenceModerationEnabled)
  )
    throw new Error('Unsupported reference creation mode.');
  const referenceCreationEnabled =
    options.referenceCreationMode === 'synthetic-reference-creation-v1';
  if (
    options.referenceSuccessorMode !== undefined &&
    (options.referenceSuccessorMode !== 'synthetic-reference-successor-v1' ||
      !referenceModerationEnabled)
  )
    throw new Error('Unsupported reference successor mode.');
  const referenceSuccessorEnabled =
    options.referenceSuccessorMode === 'synthetic-reference-successor-v1';
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
      if (path === '/v3/properties') {
        if (!referenceModerationEnabled)
          throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
        if (method !== 'GET')
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed.', {
            Allow: 'GET',
          });
        const values = url.searchParams.getAll('limit');
        if (
          [...url.searchParams.keys()].some((k) => k !== 'limit') ||
          values.length > 1 ||
          (values.length === 1 && !/^(?:[1-9]\d?|100)$/.test(values[0]!)) ||
          request.body !== null ||
          request.url.includes('#')
        )
          throw new HttpError(
            400,
            'INVALID_INPUT',
            'Use a bounded public page without context overrides.',
          );
        const pageLimit = limit(request);
        const items = await options.database.transaction(
          { tenantId, actorId: null, correlationId },
          async (query) => {
            const result = await query.query(
              `SELECT listing_id AS id,slug,revision_no AS revision,title,description,purpose,
            property_type AS "propertyType",currency,amount_minor::text AS "amountMinor",rent_period AS "rentPeriod",bedrooms,
            private_bathrooms AS "privateBathrooms",shared_bathrooms AS "sharedBathrooms",country,locality,public_precision AS "publicPrecision",
            latitude::text AS latitude,longitude::text AS longitude,photo_refs AS photos,pricing,location,
            reference_attributes AS "referenceAttributes",reference_revision_version AS "referenceRevisionVersion",reference_catalogue AS "referenceCatalogue"
            FROM app_api.public_listings_reference_v3 ORDER BY approved_at DESC,listing_id LIMIT $1`,
              [pageLimit],
            );
            if (result.rows.length > pageLimit)
              throw Error('Public reference projection exceeded page bound.');
            const items = result.rows.map(publicReferenceRow);
            if (
              new TextEncoder().encode(
                JSON.stringify({
                  policy: 'synthetic-reference-public-v1',
                  items,
                  limit: pageLimit,
                }),
              ).byteLength >
              3 * 1024 * 1024
            )
              throw Error('Public reference page too large.');
            if (request.signal.aborted)
              throw new HttpError(400, 'REQUEST_ABORTED', 'Request was cancelled.');
            return items;
          },
        );
        return response(
          200,
          { policy: 'synthetic-reference-public-v1', items, limit: pageLimit },
          correlationId,
        );
      }
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
      if (path.startsWith('/v3/staff/')) {
        if (!referenceEnabled) throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
        const catalogueRoute = /^\/v3\/staff\/reference-catalogues\/(current|[1-9]\d{0,15})$/.exec(
          path,
        );
        const operationRoute =
          /^\/v3\/staff\/listings\/([^/]+)\/reference-draft-operations\/([^/]+)$/.exec(path);
        const creationRoute =
          /^\/v3\/staff\/listings\/([^/]+)\/reference-creation-operations\/([^/]+)$/.exec(path);
        if (creationRoute && !referenceCreationEnabled)
          throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
        const successorRoute =
          /^\/v3\/staff\/listings\/([^/]+)\/reference-successor-operations\/([^/]+)$/.exec(path);
        if (successorRoute && !referenceSuccessorEnabled)
          throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
        const sessionRoute = path === '/v3/staff/reference-session';
        const transitionRoute =
          /^\/v3\/staff\/listings\/([^/]+)\/reference-transition-operations\/([^/]+)$/.exec(path);
        const revisionRoute =
          /^\/v3\/staff\/(listings|reviews)\/([^/]+)\/reference-revisions\/([1-9]\d{0,9})\/([1-9]\d{0,15})(\/context)?$/.exec(
            path,
          );
        const moderationRoute = transitionRoute || revisionRoute;
        if (moderationRoute && !referenceModerationEnabled)
          throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
        if (
          !catalogueRoute &&
          !operationRoute &&
          !creationRoute &&
          !successorRoute &&
          !sessionRoute &&
          !moderationRoute
        )
          throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
        if (
          ((catalogueRoute || sessionRoute || revisionRoute) && method !== 'GET') ||
          ((operationRoute || transitionRoute || creationRoute || successorRoute) &&
            !['GET', 'POST'].includes(method))
        )
          throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed.', {
            Allow: catalogueRoute || sessionRoute || revisionRoute ? 'GET' : 'GET, POST',
          });
        const actorId = await identity(request, true);
        let forbidden =
          request.url.includes('?') ||
          request.url.includes('#') ||
          (method === 'GET' && request.body !== null);
        request.headers.forEach((_, name) => {
          if (
            [
              'cookie',
              'content-encoding',
              'transfer-encoding',
              'expect',
              'range',
              'idempotency-key',
              'x-actor-id',
              'x-tenant-id',
              'x-role',
              'x-actor',
              'x-tenant',
              'x-company-id',
              'x-assigned-agent-id',
              'x-revision-version',
            ].includes(name) ||
            name.startsWith('if-') ||
            (method === 'GET' && ['content-type', 'content-length'].includes(name))
          )
            forbidden = true;
        });
        const declared = request.headers.get('content-length');
        if (
          method === 'POST' &&
          declared !== null &&
          (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > 131072)
        )
          forbidden = true;
        if (forbidden) throw new HttpError(400, 'INVALID_INPUT', 'Unsupported reference context.');
        const commandRoute = operationRoute || creationRoute || successorRoute;
        const listingId = commandRoute ? uuid(commandRoute[1], 'listingId') : null,
          operationId = commandRoute ? uuid(commandRoute[2], 'operationId') : null;
        if (
          commandRoute &&
          (commandRoute[1] !== listingId ||
            commandRoute[2] !== operationId ||
            commandRoute[1].length !== 36 ||
            commandRoute[2].length !== 36)
        )
          throw new HttpError(400, 'INVALID_INPUT', 'Canonical route IDs required.');
        const catalogueVersion =
          catalogueRoute && catalogueRoute[1] !== 'current' ? catalogueRoute[1]! : null;
        if (catalogueVersion !== null && BigInt(catalogueVersion) > 9007199254740991n)
          throw new HttpError(400, 'INVALID_INPUT', 'Invalid catalogue version.');
        const moderationListing = moderationRoute
          ? uuid(revisionRoute ? revisionRoute[2] : transitionRoute![1], 'listingId')
          : null;
        const transitionId = transitionRoute ? uuid(transitionRoute[2], 'operationId') : null;
        const moderationRevision = revisionRoute ? Number(revisionRoute[3]) : null;
        const moderationVersion = revisionRoute?.[4] ?? null;
        if (
          moderationRoute &&
          ((revisionRoute ? revisionRoute[2] : transitionRoute![1]) !== moderationListing ||
            (transitionRoute && transitionRoute[2] !== transitionId) ||
            (revisionRoute &&
              (moderationRevision! > 2147483647 || BigInt(moderationVersion!) > 9007199254740991n)))
        )
          throw new HttpError(400, 'INVALID_INPUT', 'Canonical moderation route required.');
        const result = await options.database.transaction(
          { tenantId, actorId, correlationId },
          async (query) => {
            await assertStaff(query);
            // Database membership is checked on every read; token claims never supply company/role.
            if (sessionRoute)
              return { policy: 'synthetic-reference-session-v1', tenantId, actorId };
            async function catalogue(version: string | null) {
              const data = await query.query(
                'SELECT app_api.read_synthetic_reference_catalogue($1::bigint) AS catalogue',
                [version],
              );
              if (data.rows.length !== 1) throw Error('Invalid catalogue projection.');
              const value = validateListingReferenceCatalogue(scalar(data, 'catalogue'));
              if (version !== null && value.version !== version)
                throw Error('Catalogue projection changed version.');
              if (new TextEncoder().encode(JSON.stringify(value)).byteLength > 6 * 1024 * 1024)
                throw Error('Catalogue projection too large.');
              return value;
            }
            if (catalogueRoute) return catalogue(catalogueVersion);
            if (creationRoute) {
              const active = () => {
                if (request.signal.aborted)
                  throw new HttpError(400, 'REQUEST_ABORTED', 'Request was cancelled.');
              };
              const field = (input: unknown, key: string): unknown => {
                if (
                  !input ||
                  typeof input !== 'object' ||
                  ![Object.prototype, null].includes(Object.getPrototypeOf(input))
                )
                  throw Error('Invalid creation projection.');
                const d = Object.getOwnPropertyDescriptor(input, key);
                if (!d?.enumerable || !Object.hasOwn(d, 'value'))
                  throw Error('Invalid creation projection.');
                return d.value;
              };
              const version = (input: unknown) => {
                if (
                  typeof input !== 'string' ||
                  !/^[1-9]\d{0,15}$/.test(input) ||
                  BigInt(input) > 9007199254740991n
                )
                  throw Error('Invalid creation catalogue version.');
                return input;
              };
              active();
              if (method === 'GET') {
                const data = await query.query(
                  'SELECT app_api.read_synthetic_reference_creation($1::uuid,$2::uuid) AS receipt',
                  [listingId, operationId],
                );
                if (data.rows.length !== 1) throw Error('Invalid original creation projection.');
                const raw = scalar(data, 'receipt'),
                  creation = field(raw, 'creation'),
                  draft = field(raw, 'referenceDraft'),
                  originalRequest = field(creation, 'request');
                const originalCatalogue = await catalogue(
                  version(field(field(draft, 'attributes'), 'catalogueVersion')),
                );
                const command = validateSyntheticReferenceCreationCommand(
                  {
                    policy: field(raw, 'policy'),
                    operationId: field(creation, 'operationId'),
                    listingId: field(creation, 'listingId'),
                    slug: field(originalRequest, 'slug'),
                    content: field(originalRequest, 'content'),
                    selection: field(draft, 'selection'),
                  },
                  originalCatalogue,
                );
                if (command.listingId !== listingId || command.operationId !== operationId)
                  throw Error('Original creation changed route.');
                const receipt = validateSyntheticReferenceCreationReceipt(
                  raw,
                  command,
                  originalCatalogue,
                  actorId!,
                );
                active();
                return receipt;
              }
              const body = await jsonBody(request, 131072, true, true, true, true, true, 10000);
              active();
              let selected: string;
              try {
                selected = version(field(field(body, 'selection'), 'catalogueVersion'));
              } catch {
                throw new HttpError(400, 'INVALID_INPUT', 'Invalid creation catalogue selection.');
              }
              const originalCatalogue = await catalogue(selected);
              let command;
              try {
                command = validateSyntheticReferenceCreationCommand(body, originalCatalogue);
              } catch {
                throw new HttpError(400, 'INVALID_INPUT', 'Invalid reference creation command.');
              }
              if (command.listingId !== listingId || command.operationId !== operationId)
                throw new HttpError(400, 'INVALID_INPUT', 'Reference creation changed route.');
              active();
              const data = await query.query(
                'SELECT app_api.create_synthetic_reference_listing($1::uuid,$2::uuid,$3::text,$4::jsonb,$5::jsonb) AS receipt',
                [
                  listingId,
                  operationId,
                  command.slug,
                  JSON.stringify(command.content),
                  JSON.stringify(command.selection),
                ],
              );
              if (data.rows.length !== 1) throw Error('Invalid creation projection.');
              const receipt = validateSyntheticReferenceCreationReceipt(
                scalar(data, 'receipt'),
                command,
                originalCatalogue,
                actorId!,
              );
              active();
              return receipt;
            }
            if (successorRoute) {
              const active = () => {
                if (request.signal.aborted)
                  throw new HttpError(400, 'REQUEST_ABORTED', 'Request was cancelled.');
              };
              const field = (input: unknown, key: string): unknown => {
                if (
                  !input ||
                  typeof input !== 'object' ||
                  ![Object.prototype, null].includes(Object.getPrototypeOf(input))
                )
                  throw Error('Invalid successor projection.');
                const d = Object.getOwnPropertyDescriptor(input, key);
                if (!d?.enumerable || !Object.hasOwn(d, 'value'))
                  throw Error('Invalid successor projection.');
                return d.value;
              };
              const version = (input: unknown) => {
                if (
                  typeof input !== 'string' ||
                  !/^[1-9]\d{0,15}$/.test(input) ||
                  BigInt(input) > 9007199254740991n
                )
                  throw Error('Invalid successor catalogue version.');
                return input;
              };
              active();
              if (method === 'GET') {
                const data = await query.query(
                  'SELECT app_api.read_synthetic_reference_successor($1::uuid,$2::uuid) AS receipt',
                  [listingId, operationId],
                );
                if (data.rows.length !== 1) throw Error('Invalid original successor projection.');
                const raw = scalar(data, 'receipt'),
                  successor = field(raw, 'successor'),
                  draft = field(raw, 'referenceDraft'),
                  originalRequest = field(successor, 'request');
                const originalCatalogue = await catalogue(
                  version(field(field(draft, 'attributes'), 'catalogueVersion')),
                );
                const command = validateSyntheticReferenceSuccessorCommand(
                  {
                    policy: field(raw, 'policy'),
                    operationId: field(successor, 'operationId'),
                    listingId: field(successor, 'listingId'),
                    expectedListingVersion: field(originalRequest, 'expectedListingVersion'),
                    predecessor: field(originalRequest, 'predecessor'),
                    content: field(originalRequest, 'content'),
                    selection: field(draft, 'selection'),
                  },
                  originalCatalogue,
                );
                if (command.listingId !== listingId || command.operationId !== operationId)
                  throw Error('Original successor changed route.');
                const receipt = validateSyntheticReferenceSuccessorReceipt(
                  raw,
                  command,
                  originalCatalogue,
                  actorId!,
                );
                active();
                return receipt;
              }
              const body = await jsonBody(request, 131072, true, true, true, true, true, 10000);
              active();
              let selected: string;
              try {
                selected = version(field(field(body, 'selection'), 'catalogueVersion'));
              } catch {
                throw new HttpError(400, 'INVALID_INPUT', 'Invalid successor catalogue selection.');
              }
              const originalCatalogue = await catalogue(selected);
              let command;
              try {
                command = validateSyntheticReferenceSuccessorCommand(body, originalCatalogue);
              } catch {
                throw new HttpError(400, 'INVALID_INPUT', 'Invalid reference successor command.');
              }
              if (command.listingId !== listingId || command.operationId !== operationId)
                throw new HttpError(400, 'INVALID_INPUT', 'Reference successor changed route.');
              active();
              const data = await query.query(
                'SELECT app_api.start_synthetic_reference_successor($1::uuid,$2::uuid,$3::bigint,$4::integer,$5::bigint,$6::text,$7::jsonb,$8::jsonb) AS receipt',
                [
                  listingId,
                  operationId,
                  command.expectedListingVersion,
                  command.predecessor.revision,
                  command.predecessor.version,
                  command.predecessor.state,
                  JSON.stringify(command.content),
                  JSON.stringify(command.selection),
                ],
              );
              if (data.rows.length !== 1) throw Error('Invalid successor projection.');
              const receipt = validateSyntheticReferenceSuccessorReceipt(
                scalar(data, 'receipt'),
                command,
                originalCatalogue,
                actorId!,
              );
              active();
              return receipt;
            }
            if (moderationRoute) {
              const active = () => {
                if (request.signal.aborted)
                  throw new HttpError(400, 'REQUEST_ABORTED', 'Request was cancelled.');
              };
              active();
              // Read only own data descriptors from SQL projections before their complete domain validation.
              const field = (input: unknown, key: string): unknown => {
                if (
                  !input ||
                  typeof input !== 'object' ||
                  ![Object.prototype, null].includes(Object.getPrototypeOf(input))
                )
                  throw Error('Invalid moderation projection.');
                const d = Object.getOwnPropertyDescriptor(input, key);
                if (!d?.enumerable || !Object.hasOwn(d, 'value'))
                  throw Error('Invalid moderation projection.');
                return d.value;
              };
              const historicalVersion = (review: unknown) => {
                const version = field(field(review, 'attributes'), 'catalogueVersion');
                if (
                  typeof version !== 'string' ||
                  !/^[1-9]\d{0,15}$/.test(version) ||
                  BigInt(version) > 9007199254740991n
                )
                  throw Error('Invalid historical reference version.');
                return version;
              };
              const historical = (review: unknown) => catalogue(historicalVersion(review));
              if (revisionRoute) {
                const data = await query.query(
                  revisionRoute[1] === 'reviews'
                    ? 'SELECT app_api.read_synthetic_reference_review($1::uuid,$2::integer,$3::bigint) AS review'
                    : 'SELECT app_api.read_synthetic_reference_revision($1::uuid,$2::integer,$3::bigint) AS review',
                  [moderationListing, moderationRevision, moderationVersion],
                );
                if (data.rows.length !== 1) throw Error('Invalid reference revision projection.');
                const raw = scalar(data, 'review');
                const originalCatalogue = await historical(raw);
                const review = validateSyntheticReferenceRevision(
                  raw,
                  originalCatalogue,
                  moderationListing!,
                  moderationRevision!,
                  moderationVersion!,
                );
                if (revisionRoute[1] === 'reviews' && review.state !== 'pending')
                  throw Error('Invalid pending reference review.');
                const result = revisionRoute[5]
                  ? validateSyntheticReferenceContext(
                      {
                        policy: 'synthetic-reference-context-v1',
                        review,
                        catalogue: originalCatalogue,
                      },
                      moderationListing!,
                      moderationRevision!,
                      moderationVersion!,
                      revisionRoute[1] === 'reviews' ? 'review' : 'revision',
                    )
                  : review;
                active();
                return result;
              }
              if (method === 'GET') {
                const data = await query.query(
                  'SELECT app_api.read_synthetic_reference_transition($1::uuid,$2::uuid) AS receipt',
                  [moderationListing, transitionId],
                );
                if (data.rows.length !== 1) throw Error('Invalid original transition projection.');
                const raw = scalar(data, 'receipt'),
                  rawReview = field(raw, 'review');
                const originalCatalogue = await historical(rawReview);
                const originalCommand = validateSyntheticReferenceTransitionCommand(
                  {
                    policy: field(raw, 'policy'),
                    operationId: field(raw, 'operationId'),
                    action: field(raw, 'action'),
                    listingId: field(raw, 'listingId'),
                    revision: field(raw, 'revision'),
                    review: rawReview,
                    reason: field(raw, 'reason'),
                  },
                  originalCatalogue,
                );
                if (
                  originalCommand.listingId !== moderationListing ||
                  originalCommand.operationId !== transitionId
                )
                  throw Error('Original transition changed route.');
                const receipt = validateSyntheticReferenceTransitionReceipt(
                  raw,
                  originalCommand,
                  originalCatalogue,
                  actorId!,
                );
                active();
                return receipt;
              }
              const body = await jsonBody(request, 131072, true, true, true, true, true, 10000);
              active();
              let selected;
              try {
                selected = historicalVersion(field(body, 'review'));
              } catch {
                throw new HttpError(400, 'INVALID_INPUT', 'Invalid reference transition command.');
              }
              const originalCatalogue = await catalogue(selected);
              let command;
              try {
                command = validateSyntheticReferenceTransitionCommand(body, originalCatalogue);
              } catch {
                throw new HttpError(400, 'INVALID_INPUT', 'Invalid reference transition command.');
              }
              if (command.listingId !== moderationListing || command.operationId !== transitionId)
                throw new HttpError(400, 'INVALID_INPUT', 'Reference transition changed route.');
              active();
              const data = await query.query(
                'SELECT app_api.execute_synthetic_reference_transition($1::uuid,$2::integer,$3::uuid,$4::text,$5::jsonb,$6::text) AS receipt',
                [
                  moderationListing,
                  command.revision,
                  transitionId,
                  command.action,
                  JSON.stringify(command.review),
                  command.reason,
                ],
              );
              if (data.rows.length !== 1) throw Error('Invalid reference transition receipt.');
              const receipt = validateSyntheticReferenceTransitionReceipt(
                scalar(data, 'receipt'),
                command,
                originalCatalogue,
                actorId!,
              );
              active();
              return receipt;
            }
            if (method === 'GET') {
              const data = await query.query(
                'SELECT app_api.read_synthetic_reference_draft_context($1::uuid,$2::uuid) AS original',
                [listingId, operationId],
              );
              if (data.rows.length !== 1) throw Error('Invalid original reference projection.');
              const original = scalar(data, 'original') as Record<string, unknown>;
              if (
                !original ||
                typeof original !== 'object' ||
                ![Object.prototype, null].includes(Object.getPrototypeOf(original)) ||
                Reflect.ownKeys(original).length !== 3 ||
                !['command', 'receipt', 'catalogue'].every((k) => {
                  const descriptor = Object.getOwnPropertyDescriptor(original, k);
                  return descriptor?.enumerable && Object.hasOwn(descriptor, 'value');
                })
              )
                throw Error('Invalid original context.');
              const command = validateSyntheticReferenceDraftCommand(
                original.command,
                original.catalogue,
              );
              if (command.listingId !== listingId || command.operationId !== operationId)
                throw Error('Original reference changed route.');
              return validateSyntheticReferenceDraftReceipt(
                original.receipt,
                command,
                original.catalogue,
                actorId!,
              );
            }
            const body = await jsonBody(request, 131072, true, true, true, true, true, 10000);
            const selected = (body as { selection?: { catalogueVersion?: unknown } })?.selection
              ?.catalogueVersion;
            if (
              typeof selected !== 'string' ||
              selected.length > 16 ||
              !/^[1-9]\d*$/.test(selected) ||
              BigInt(selected) > 9007199254740991n
            )
              throw new HttpError(400, 'INVALID_INPUT', 'Invalid catalogue selection.');
            const originalCatalogue = await catalogue(selected);
            let command;
            try {
              command = validateSyntheticReferenceDraftCommand(body, originalCatalogue);
            } catch {
              throw new HttpError(400, 'INVALID_INPUT', 'Invalid reference draft command.');
            }
            if (command.listingId !== listingId || command.operationId !== operationId)
              throw new HttpError(400, 'INVALID_INPUT', 'Reference command changed route.');
            const data = await query.query(
              'SELECT app_api.save_synthetic_reference_draft($1::uuid,$2::integer,$3::bigint,$4::uuid,$5::jsonb,$6::jsonb) AS receipt',
              [
                listingId,
                command.revision,
                command.expectedVersion,
                operationId,
                JSON.stringify(command.content),
                JSON.stringify(command.selection),
              ],
            );
            if (data.rows.length !== 1) throw Error('Invalid reference receipt projection.');
            return validateSyntheticReferenceDraftReceipt(
              scalar(data, 'receipt'),
              command,
              originalCatalogue,
              actorId!,
            );
          },
        );
        return response(200, result, correlationId);
      }
      if (path.startsWith('/v1/staff/') || v2Draft) {
        const actorId = await identity(request, true);
        const context = { tenantId, actorId, correlationId };
        const verificationOperation =
          /^\/v2\/staff\/listings\/([^/]+)\/verification-operations\/([^/]+)$/.exec(path);
        const verificationHistory = /^\/v2\/staff\/listings\/([^/]+)\/verification-history$/.exec(
          path,
        );
        if (verificationOperation || verificationHistory) {
          if (!verificationEnabled)
            throw new HttpError(404, 'NOT_FOUND', 'Resource is unavailable.');
          if (
            (verificationHistory && method !== 'GET') ||
            (verificationOperation && !['GET', 'POST'].includes(method))
          )
            throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method is not allowed.', {
              Allow: verificationHistory ? 'GET' : 'GET, POST',
            });
          const listingId = uuid((verificationOperation ?? verificationHistory)![1], 'listingId'),
            operationId = verificationOperation
              ? uuid(verificationOperation[2], 'operationId')
              : null;
          const match = verificationHistory
            ? /^\?limit=([1-9]\d?)(?:&beforeVersion=([1-9]\d{0,15}))?$/.exec(
                new URL(request.url).search,
              )
            : null;
          const pageLimit = match ? Number(match[1]) : 0;
          const beforeVersion = match?.[2] ?? null;
          let forbidden =
            request.url.includes('#') ||
            (verificationHistory ? !match || pageLimit > 25 : request.url.includes('?')) ||
            (method === 'GET' && request.body !== null);
          if (beforeVersion !== null && BigInt(beforeVersion) > 9007199254740991n) forbidden = true;
          const declared = request.headers.get('content-length');
          if (
            method === 'POST' &&
            declared !== null &&
            (!/^(0|[1-9]\d*)$/.test(declared) || Number(declared) > 16384)
          )
            forbidden = true;
          request.headers.forEach((_, name) => {
            if (
              [
                'cookie',
                'content-encoding',
                'transfer-encoding',
                'expect',
                'range',
                'idempotency-key',
                'x-actor-id',
                'x-tenant-id',
                'x-role',
                'x-actor',
                'x-tenant',
                'x-company-id',
                'x-assigned-agent-id',
                'x-revision-version',
              ].includes(name) ||
              name.startsWith('if-') ||
              (method === 'GET' && ['content-type', 'content-length'].includes(name))
            )
              forbidden = true;
          });
          if (forbidden)
            throw new HttpError(400, 'INVALID_INPUT', 'Unsupported private check context.');
          const value = await options.database.transaction(context, async (query) => {
            await assertAdmin(query);
            if (verificationHistory) {
              const data = await query.query(
                'SELECT app_api.read_listing_verification_history($1::uuid,$2::integer,$3::bigint) AS receipt',
                [listingId, pageLimit, beforeVersion],
              );
              if (data.rows.length !== 1) throw Error('Invalid check history projection.');
              return validateListingVerificationHistory(
                scalar(data, 'receipt'),
                listingId,
                pageLimit,
                beforeVersion,
              );
            }
            if (method === 'GET') {
              const data = await query.query(
                'SELECT app_api.read_listing_verification($1::uuid,$2::uuid) AS receipt',
                [listingId, operationId],
              );
              if (data.rows.length !== 1) throw Error('Invalid original check projection.');
              return validateListingVerificationOriginal(
                scalar(data, 'receipt'),
                listingId,
                operationId!,
                actorId!,
              );
            }
            let command;
            try {
              command = validateListingVerificationCommand(
                await jsonBody(request, 16384, true, true, true, true),
              );
            } catch (error) {
              if (error instanceof HttpError) throw error;
              throw new HttpError(400, 'INVALID_INPUT', 'Invalid synthetic check command.');
            }
            if (command.target.listingId !== listingId || command.operationId !== operationId)
              throw new HttpError(400, 'INVALID_INPUT', 'Check command changed route.');
            const data = await query.query(
              'SELECT app_api.record_synthetic_listing_verification($1::uuid,$2::uuid,$3::bigint,$4::integer,$5::bigint,$6::bigint,$7::text,$8::text,$9::text,$10::text,$11::text) AS receipt',
              [
                listingId,
                operationId,
                command.target.listingVersion,
                command.target.revision,
                command.target.revisionVersion,
                command.expectedVerificationVersion,
                command.subject,
                command.outcome,
                command.evidenceReference,
                command.note,
                command.observedAt,
              ],
            );
            if (data.rows.length !== 1) throw Error('Invalid check receipt projection.');
            return validateListingVerificationReceipt(scalar(data, 'receipt'), command, actorId!);
          });
          return response(200, value, correlationId);
        }
        if (path === '/v2/staff/listing-import-preview') {
          if (method !== 'POST')
            throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Import previews require POST.', {
              Allow: 'POST',
            });
          let forbidden = request.url.includes('?') || request.url.includes('#');
          request.headers.forEach((_, name) => {
            if (
              [
                'cookie',
                'content-encoding',
                'transfer-encoding',
                'expect',
                'range',
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
          if (forbidden) throw new HttpError(400, 'INVALID_INPUT', 'Unsupported import context.');
          // JSON escaping can expand a32KiB CSV; the domain separately bounds decoded CSV.
          const body = record(await jsonBody(request, 256 * 1024, false, true, true), ['csv']);
          if (typeof body.csv !== 'string')
            throw new HttpError(400, 'INVALID_INPUT', 'A CSV string is required.');
          const csv = body.csv;
          const preview = await options.database.transaction(context, async (query) => {
            await assertAdmin(query);
            let parsed;
            try {
              parsed = previewListingImport(csv);
            } catch {
              throw new HttpError(400, 'INVALID_INPUT', 'Use a valid bounded listing CSV file.');
            }
            const candidates = [
              ...new Set(parsed.rows.flatMap((row) => (row.slug === null ? [] : [row.slug]))),
            ];
            let existing: string[] = [];
            if (candidates.length) {
              const result = await query.query(
                'SELECT app_api.read_listing_import_stock($1::text[]) AS receipt',
                [candidates],
              );
              if (result.rows.length !== 1) throw new Error('Invalid import stock projection.');
              const values = scalar(result, 'receipt');
              if (
                !Array.isArray(values) ||
                Object.getPrototypeOf(values) !== Array.prototype ||
                values.length > candidates.length ||
                Reflect.ownKeys(values).length !== values.length + 1
              )
                throw new Error('Invalid import stock projection.');
              const seen = new Set<string>();
              for (let i = 0; i < values.length; i++) {
                const descriptor = Object.getOwnPropertyDescriptor(values, String(i));
                if (
                  !descriptor?.enumerable ||
                  !Object.hasOwn(descriptor, 'value') ||
                  typeof descriptor.value !== 'string' ||
                  !candidates.includes(descriptor.value) ||
                  seen.has(descriptor.value)
                )
                  throw new Error('Invalid import stock projection.');
                seen.add(descriptor.value);
                existing.push(descriptor.value);
              }
            }
            return previewListingImport(csv, existing, true);
          });
          return response(200, preview, correlationId);
        }
        const duplicateRoute = /^\/v2\/staff\/listings\/([^/]+)\/duplicate-candidates$/.exec(path);
        if (duplicateRoute) {
          if (method !== 'GET')
            throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Duplicate reads require GET.', {
              Allow: 'GET',
            });
          const listingId = uuid(duplicateRoute[1], 'listingId');
          const search = new URL(request.url).search;
          const parameters =
            /^\?listingVersion=([1-9]\d{0,15})&revision=([1-9]\d{0,9})&revisionVersion=([1-9]\d{0,15})&limit=([1-9]\d?)$/.exec(
              search,
            );
          let forbidden = request.body !== null || request.url.includes('#') || !parameters;
          request.headers.forEach((_, name) => {
            if (
              [
                'cookie',
                'content-type',
                'content-length',
                'content-encoding',
                'transfer-encoding',
                'expect',
                'range',
                'idempotency-key',
                'x-actor-id',
                'x-tenant-id',
                'x-role',
                'x-actor',
                'x-tenant',
                'x-company-id',
                'x-assigned-agent-id',
                'x-revision-version',
              ].includes(name) ||
              name.startsWith('if-')
            )
              forbidden = true;
          });
          if (forbidden || !parameters)
            throw new HttpError(400, 'INVALID_INPUT', 'Unsupported duplicate lookup.');
          let lookup;
          try {
            lookup = validateListingDuplicateRequest({
              listingId,
              listingVersion: parameters[1],
              revision: Number(parameters[2]),
              revisionVersion: parameters[3],
              limit: Number(parameters[4]),
            });
          } catch {
            throw new HttpError(400, 'INVALID_INPUT', 'Invalid duplicate target.');
          }
          const result = await options.database.transaction(context, async (query) => {
            await assertAdmin(query);
            const found = await query.query(
              'SELECT app_api.read_listing_duplicate_candidates($1::uuid,$2::bigint,$3::integer,$4::bigint,$5::integer) AS receipt',
              [
                lookup.listingId,
                lookup.listingVersion,
                lookup.revision,
                lookup.revisionVersion,
                lookup.limit,
              ],
            );
            if (found.rows.length !== 1) throw new Error('Invalid duplicate projection.');
            return validateListingDuplicateCandidates(scalar(found, 'receipt'), lookup);
          });
          return response(200, result, correlationId);
        }
        const reviewGalleryRoute =
          /^\/v2\/staff\/reviews\/([^/]+)\/revisions\/([1-9]\d*)\/media-gallery$/.exec(path);
        if (reviewGalleryRoute) {
          if (method !== 'GET')
            throw new HttpError(405, 'METHOD_NOT_ALLOWED', 'Gallery reads require GET.', {
              Allow: 'GET',
            });
          const listingId = uuid(reviewGalleryRoute[1], 'listingId'),
            revision = Number(reviewGalleryRoute[2]),
            expected = request.headers.get('x-revision-version');
          if (
            !Number.isSafeInteger(revision) ||
            revision > 2147483647 ||
            expected === null ||
            !/^[1-9]\d{0,15}$/.test(expected) ||
            BigInt(expected) > 9007199254740991n
          )
            throw new HttpError(400, 'INVALID_INPUT', 'Invalid gallery revision version.');
          let forbidden =
            request.body !== null || request.url.includes('?') || request.url.includes('#');
          request.headers.forEach((_, name) => {
            if (
              [
                'cookie',
                'content-type',
                'content-length',
                'content-encoding',
                'transfer-encoding',
                'expect',
                'range',
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
          if (forbidden) throw new HttpError(400, 'INVALID_INPUT', 'Unsupported gallery context.');
          const gallery = await options.database.transaction(context, async (query) => {
            await assertAdmin(query);
            const result = await query.query(
              'SELECT app_api.read_review_media_gallery($1::uuid,$2::integer,$3::bigint) AS receipt',
              [listingId, revision, expected],
            );
            if (result.rows.length !== 1) throw new Error('Invalid gallery projection.');
            return validateReviewMediaGallery(
              scalar(result, 'receipt'),
              listingId,
              revision,
              expected,
            );
          });
          return response(200, gallery, correlationId);
        }
        const listingDetailRoute = /^\/v2\/staff\/listings\/([^/]+)$/.exec(path);
        if (listingDetailRoute) {
          if (method !== 'GET')
            throw new HttpError(
              405,
              'METHOD_NOT_ALLOWED',
              'Method is not allowed for this route.',
              { Allow: 'GET' },
            );
          const listingId = uuid(listingDetailRoute[1], 'listingId');
          let forbidden =
            request.body !== null || request.url.includes('?') || request.url.includes('#');
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
          if (forbidden)
            throw new HttpError(
              400,
              'INVALID_INPUT',
              'Listing detail does not accept caller context.',
            );
          const summary = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            const result = await query.query(
              `SELECT l.id AS "listingId",l.slug,l.assigned_agent_id AS "assignedAgentId",l.version::text AS version,
              l.availability,l.publication_status AS "publicationStatus",l.published_revision_no AS "publishedRevision",
              to_char(greatest(l.updated_at,r.updated_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "changedAt",
              CASE WHEN r.revision_no IS NULL THEN NULL ELSE jsonb_build_object('revision',r.revision_no,'state',r.state,'version',r.version::text,'title',r.title,
                'updatedAt',to_char(r.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) END AS latest
              FROM app_private.listings l LEFT JOIN LATERAL (SELECT revision_no,state,version,title,updated_at FROM app_private.listing_revisions
                WHERE tenant_id=l.tenant_id AND listing_id=l.id ORDER BY revision_no DESC LIMIT 1) r ON true
              WHERE l.tenant_id=$1::uuid AND l.id=$2::uuid`,
              [tenantId, listingId],
            );
            if (result.rows.length === 0)
              throw new HttpError(404, 'NOT_FOUND', 'Resource unavailable.');
            if (result.rows.length !== 1) throw new Error('Unexpected listing detail cardinality.');
            return validateStaffListingSummary(result.rows[0], listingId);
          });
          return response(200, summary, correlationId);
        }
        const controlRoute =
          /^\/v2\/staff\/listings\/([^/]+)\/(availability|publication)-operations\/([^/]+)$/.exec(
            path,
          );
        if (controlRoute) {
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
              'Listing controls do not accept query context.',
            );
          const listingId = uuid(controlRoute[1], 'listingId'),
            operationId = uuid(controlRoute[3], 'operationId'),
            kind = controlRoute[2] === 'availability' ? 'confirm_availability' : 'set_publication',
            field = kind === 'confirm_availability' ? 'availability' : 'publicationStatus',
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
            throw new HttpError(400, 'INVALID_INPUT', 'Unsupported listing control context.');
          const declared = request.headers.get('content-length');
          if (write && declared !== null && !/^(?:0|[1-9]\d*)$/.test(declared))
            throw new HttpError(400, 'INVALID_INPUT', 'Content length must be canonical.');
          let command: ListingControlCommand | undefined;
          if (write) {
            const raw = await jsonBody(request, 4096, true, true, true, true);
            try {
              const body = record(raw, ['expectedListingVersion', field]);
              command = validateListingControlCommand({ ...body, listingId, operationId, kind });
            } catch {
              throw new HttpError(400, 'INVALID_INPUT', 'Review the listing control fields.');
            }
          }
          const receipt = await options.database.transaction(context, async (query) => {
            await assertStaff(query);
            if (command) {
              const stored = await query.query(
                'SELECT app_api.control_listing($1::uuid,$2::uuid,$3,$4::bigint,$5) AS receipt',
                [
                  listingId,
                  operationId,
                  command.kind,
                  command.expectedListingVersion,
                  command.kind === 'confirm_availability'
                    ? command.availability
                    : command.publicationStatus,
                ],
              );
              return validateListingControlReceipt(scalar(stored, 'receipt'), command, actorId!);
            }
            const stored = await query.query(
              'SELECT app_api.read_listing_control($1::uuid,$2::uuid,$3) AS receipt',
              [listingId, operationId, kind],
            );
            return validateListingControlSnapshot(
              scalar(stored, 'receipt'),
              listingId,
              operationId,
              kind,
              actorId!,
            );
          });
          return response(200, receipt, correlationId);
        }
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
            // Allocation belongs to retained creation/successor operations, not ordinary edits.
            const expected = version(body.expectedVersion, false);
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
