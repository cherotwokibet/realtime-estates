import { randomUUID } from "node:crypto";
import { calculateWirePricingV2, kesFromMinor, normalizeKenyanPhone, parseListingJsonV2, validatePricingInputV2, validatePublicLocationV2 } from "@realtor/domain";
import { DatabaseSafetyError, type TransactionDatabase, type TransactionQuery } from "./database.js";

export interface VerifiedIdentity { readonly actorId: string }
export interface LimiterResult { readonly allowed: boolean; readonly retryAfterSeconds: number }
export interface EnquiryLimiter { consume(key: string): LimiterResult | Promise<LimiterResult> }
export interface ApiServiceOptions {
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
  constructor(readonly status: number, readonly code: string, message: string, readonly headers?: Record<string, string>) { super(message); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown, field: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new HttpError(400, "INVALID_INPUT", `${field} must be a UUID.`);
  return value.toLowerCase();
}
function record(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new HttpError(400, "INVALID_INPUT", "Request contains unsupported fields.");
  return value as Record<string, unknown>;
}
function text(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new HttpError(400, "INVALID_INPUT", `${field} is required and must be at most ${maximum} characters.`);
  return value.trim();
}
function version(value: unknown, allowNew = false): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < (allowNew ? 0 : 1)) throw new HttpError(400, "INVALID_INPUT", "expectedVersion must be a non-negative integer for a new draft or positive integer for an existing revision.");
  return value;
}
function limit(request: Request): number {
  const value = new URL(request.url).searchParams.get("limit");
  if (value === null) return 50;
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 100) throw new HttpError(400, "INVALID_INPUT", "limit must be between 1 and 100.");
  return Number(value);
}

function assertDecisionJsonTokens(source: string): void {
  // Check original tokens before JSON.parse can round a fractional version. Whole
  // string tokens keep reason text separate; decoding keys catches escaped duplicates.
  // JSON.parse below independently rejects every syntax error or skipped character.
  const tokens = source.match(/"(?:\\[\s\S]|[^"\\])*"|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null|[{}\[\]:,]/g) ?? [];
  const containers: (Set<string> | null)[] = [];
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index]!;
    if (token === "{") containers.push(new Set());
    else if (token === "[") containers.push(null);
    else if (token === "}" || token === "]") containers.pop();
    else if (token.startsWith('"') && tokens[index + 1] === ":") {
      const keys = containers.at(-1), key = JSON.parse(token) as string;
      if (!keys || keys.has(key)) throw new Error("Duplicate JSON object key.");
      keys.add(key);
      if (key === "expectedVersion" && !/^[1-9]\d*$/.test(tokens[index + 2] ?? "")) throw new Error("Expected version requires a positive integer JSON literal.");
    }
  }
}
async function jsonBody(request: Request, maximum: number, integerMoney = false, strictDecision = false): Promise<unknown> {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers.get("content-type") ?? "")) throw new HttpError(415, "JSON_REQUIRED", "Use application/json.");
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large.");
  if (!request.body) throw new HttpError(400, "INVALID_JSON", "A JSON body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximum) { await reader.cancel(); throw new HttpError(413, "BODY_TOO_LARGE", "Request body is too large."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try {
    const source = new TextDecoder("utf-8", { fatal: true }).decode(body);
    if (strictDecision) assertDecisionJsonTokens(source);
    return integerMoney ? parseListingJsonV2(source) : JSON.parse(source);
  }
  catch { throw new HttpError(400, "INVALID_JSON", integerMoney ? "Request body must contain valid JSON with integer-literal minor-unit amounts." : "Request body must contain valid JSON."); }
}

/** Process-local development protection: bounded memory and fail-closed capacity. Use a distributed limiter before public launch. */
export function createLocalEnquiryLimiter(options: { readonly limit?: number; readonly windowMs?: number; readonly maxEntries?: number; readonly now?: () => number } = {}): EnquiryLimiter {
  const maximum = options.limit ?? 10;
  const windowMs = options.windowMs ?? 60000;
  const maxEntries = options.maxEntries ?? 1000;
  const now = options.now ?? Date.now;
  if (![maximum, windowMs, maxEntries].every(value => Number.isSafeInteger(value) && value > 0)) throw new Error("Limiter bounds must be positive integers.");
  const entries = new Map<string, { count: number; expires: number }>();
  return {
    consume(key) {
      const current = now();
      for (const [candidate, state] of entries) if (state.expires <= current) entries.delete(candidate);
      const existing = entries.get(key);
      if (!existing && entries.size >= maxEntries) return { allowed: false, retryAfterSeconds: Math.ceil(windowMs / 1000) };
      const state = existing ?? { count: 0, expires: current + windowMs };
      entries.set(key, state);
      if (state.count >= maximum) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((state.expires - current) / 1000)) };
      state.count += 1;
      return { allowed: true, retryAfterSeconds: 0 };
    },
  };
}

function response(status: number, payload: unknown, correlationId: string, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Request-Id": correlationId, ...extra } });
}
function safeError(error: unknown): HttpError {
  if (error instanceof HttpError) return error;
  if (error instanceof DatabaseSafetyError) return new HttpError(503, "SERVICE_UNAVAILABLE", "Service is unavailable.");
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  if (code === "42501") return new HttpError(403, "FORBIDDEN", "This operation is not allowed.");
  if (code === "P0002") return new HttpError(404, "NOT_FOUND", "Resource is unavailable.");
  if (code === "40001" || code === "23505") return new HttpError(409, "CONFLICT", "Resource version or idempotency key conflicts with the request.");
  if (["23514", "23502", "23503", "22P02", "22003"].includes(code)) return new HttpError(422, "INVALID_STATE", "Request does not satisfy the current data or workflow requirements.");
  return new HttpError(503, "SERVICE_UNAVAILABLE", "Service is unavailable.");
}
async function assertStaff(query: TransactionQuery): Promise<void> {
  const result = await query.query("SELECT app_private.staff_role() AS role");
  if (!["agent", "admin"].includes(String(result.rows[0]?.role))) throw new HttpError(403, "FORBIDDEN", "An active staff membership is required.");
}
async function assertAdmin(query: TransactionQuery): Promise<void> {
  const result = await query.query("SELECT app_private.staff_role() AS role");
  if (result.rows[0]?.role !== "admin") throw new HttpError(403, "FORBIDDEN", "An active admin membership is required.");
}
function scalar(result: { readonly rows: Record<string, unknown>[] }, key: string): unknown {
  const value = result.rows[0]?.[key];
  if (value === undefined || value === null) throw new Error("Unexpected database response.");
  return value;
}

const DRAFT_FIELDS = ["title", "description", "purpose", "propertyType", "currency", "amountMinor", "rentPeriod", "bedrooms", "privateBathrooms", "sharedBathrooms", "country", "locality", "publicPrecision", "latitude", "longitude", "privateAddress"] as const;
function draftContentV2(input: unknown): Record<string, unknown> {
  const content = record(input, [...DRAFT_FIELDS, "pricing", "location"]);
  try {
    const pricing = validatePricingInputV2(content.pricing);
    const location = validatePublicLocationV2(content.location);
    if (content.amountMinor != null && (typeof content.amountMinor !== "number" || !Number.isSafeInteger(content.amountMinor) || content.amountMinor <= 0 || content.amountMinor > 100_000_000_000_000)) throw new Error("Invalid base amount.");
    // Incomplete drafts remain supported. Complete price inputs use the same arithmetic as the client.
    if (content.amountMinor != null && (content.purpose === "rent" || content.purpose === "sale")) {
      calculateWirePricingV2(kesFromMinor(content.amountMinor as number), content.purpose, content.rentPeriod as "day" | "week" | "month" | "year" | null, pricing);
    }
    return { ...content, pricing, location };
  } catch { throw new HttpError(400, "INVALID_INPUT", "Supply valid v2 pricing and public location fields."); }
}

function publicRow(row: Record<string, unknown>): Record<string, unknown> {
  return { ...row, amountMinor: Number(row.amountMinor), latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude) };
}

function publicRowV2(row: Record<string, unknown>): Record<string, unknown> {
  const item = publicRow(row);
  const pricing = validatePricingInputV2(item.pricing);
  const location = validatePublicLocationV2(item.location);
  // Fail closed if persisted disclosure no longer satisfies the shared exact-money contract.
  calculateWirePricingV2(kesFromMinor(item.amountMinor as number), item.purpose as "rent" | "sale", item.rentPeriod as "day" | "week" | "month" | "year" | null, pricing);
  return { ...item, pricing, location };
}

const REVIEW_METADATA = `r.listing_id AS "listingId",l.slug,r.revision_no AS revision,r.state,r.version::text AS version,
  l.version::text AS "listingVersion",r.title,r.purpose,r.property_type AS "propertyType",r.amount_minor::text AS "amountMinor",r.rent_period AS "rentPeriod",
  r.submitted_at AS "submittedAt",r.submitted_by AS "submittedBy",l.publication_status AS "publicationStatus",l.published_revision_no AS "publishedRevision",
  l.availability,l.last_availability_confirmed_at AS "lastAvailabilityConfirmedAt",
  (SELECT count(*)::integer FROM app_private.revision_media m WHERE m.tenant_id=r.tenant_id AND m.listing_id=r.listing_id AND m.revision_no=r.revision_no AND m.accepted) AS "acceptedPhotoCount"`;
const REVIEW_FIELDS = ["listingId", "slug", "revision", "state", "version", "listingVersion", "title", "purpose", "propertyType", "amountMinor", "rentPeriod", "submittedAt", "submittedBy", "publicationStatus", "publishedRevision", "availability", "lastAvailabilityConfirmedAt", "acceptedPhotoCount"] as const;
function reviewMetadata(row: Record<string, unknown>): Record<string, unknown> {
  const metadata = Object.fromEntries(REVIEW_FIELDS.map(field => [field, row[field]]));
  return { ...metadata, amountMinor: row.amountMinor === null ? null : Number(row.amountMinor) };
}
function reviewQuery(url: URL, queue: boolean): void {
  if ([...url.searchParams.keys()].some(key => !queue || key !== "limit") || url.searchParams.getAll("limit").length > 1) {
    throw new HttpError(400, "INVALID_INPUT", "Review requests do not accept context overrides or unsupported query fields.");
  }
}
function rejectionReason(input: unknown): string {
  if (typeof input !== "string" || input !== input.trim() || input.length === 0 || [...input].length > 1000 || /[\u0000-\u001f\u007f-\u009f]/u.test(input) || /[\ud800-\udfff]/u.test(input)) {
    throw new HttpError(400, "INVALID_INPUT", "Rejection needs trimmed, nonblank, control-free text of at most 1000 characters.");
  }
  return input;
}

function mediaAltText(input: unknown): string {
  if (typeof input !== "string" || input !== input.trim() || input.length === 0 || [...input].length > 300 || /[\u0000-\u001f\u007f-\u009f]/u.test(input) || /[\ud800-\udfff]/u.test(input)) {
    throw new HttpError(400, "INVALID_INPUT", "altText needs trimmed, nonblank, control-free text of at most 300 characters.");
  }
  return input;
}
function mediaProjection(input: unknown, listingId: string, revision: number, job: boolean, resourceId: string | null): Record<string, unknown> {
  // Never forward private storage context or future SQL fields through this endpoint.
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Unexpected media response.");
  const row = input as Record<string, unknown>;
  if (row.kind !== "register_media_upload" || row.listingId !== listingId || row.revision !== revision) throw new HttpError(404, "NOT_FOUND", "Resource is unavailable.");
  if (resourceId !== null && row[job ? "jobId" : "operationId"] !== resourceId) throw new HttpError(404, "NOT_FOUND", "Resource is unavailable.");
  if (job ? !["registered", "expired"].includes(String(row.state)) : row.outcome !== "registered") throw new Error("Unexpected media state.");
  const fields = ["kind", "operationId", "jobId", "listingId", "revision", "expectedVersion", "altText", job ? "state" : "outcome"];
  const projected = Object.fromEntries(fields.map(field => [field, row[field]]));
  // JSONB timestamptz uses offsets/microseconds. The wire contract uses UTC milliseconds.
  for (const field of ["registeredAt", "expiresAt"]) {
    if (typeof row[field] !== "string" || !Number.isFinite(Date.parse(row[field]))) throw new Error("Unexpected media timestamp.");
    projected[field] = new Date(row[field]).toISOString();
  }
  return projected;
}

export function createApiService(options: ApiServiceOptions): (request: Request) => Promise<Response> {
  const tenantId = uuid(options.tenantId, "Configured tenant");
  const privacyNoticeVersion = text(options.privacyNoticeVersion, "Configured privacy notice version", 100);
  const newId = options.uuid ?? randomUUID;
  const limiter = options.limiter ?? createLocalEnquiryLimiter();
  async function identity(request: Request, required: boolean): Promise<string | null> {
    if (!request.headers.has("authorization")) {
      if (required) throw new HttpError(401, "UNAUTHENTICATED", "A valid bearer token is required.");
      return null;
    }
    try { return uuid((await options.verifyAuthorization(request)).actorId, "Verified subject"); }
    catch { throw new HttpError(401, "UNAUTHENTICATED", "A valid bearer token is required."); }
  }
  return async request => {
    const correlationId = newId();
    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method.toUpperCase();
      if ((path === "/v1/properties" || path === "/v2/properties") && method === "GET") {
        const pageLimit = limit(request);
        const v2 = path === "/v2/properties";
        const result = await options.database.transaction({ tenantId, actorId: null, correlationId }, query => query.query(`SELECT listing_id AS id,slug,revision_no AS revision,title,description,purpose,
          property_type AS "propertyType",currency,amount_minor::text AS "amountMinor",rent_period AS "rentPeriod",bedrooms,
          private_bathrooms AS "privateBathrooms",shared_bathrooms AS "sharedBathrooms",country,locality,public_precision AS "publicPrecision",
          latitude::text AS latitude,longitude::text AS longitude,photo_refs AS photos${v2 ? ",pricing,location" : ""}
          FROM app_api.${v2 ? "public_listings_v2" : "public_listings"} ORDER BY approved_at DESC,listing_id LIMIT $1`, [pageLimit]));
        const items = result.rows.map(v2 ? publicRowV2 : publicRow);
        return response(200, { items, limit: pageLimit }, correlationId);
      }
      if (path === "/v1/enquiries" && method === "POST") {
        const quota = await limiter.consume(`${tenantId}:${options.clientKey?.(request) ?? "shared-local"}`);
        if (!quota.allowed) throw new HttpError(429, "RATE_LIMITED", "Please wait before trying again.", { "Retry-After": String(quota.retryAfterSeconds) });
        const key = uuid(request.headers.get("idempotency-key"), "Idempotency-Key");
        const body = record(await jsonBody(request, 16 * 1024), ["listingId", "name", "phone", "email", "message", "origin", "noticeVersion", "noticeAcknowledged"]);
        const listingId = body.listingId == null ? null : uuid(body.listingId, "listingId");
        const name = text(body.name, "name", 160);
        const message = text(body.message, "message", 2000);
        const noticeVersion = text(body.noticeVersion, "noticeVersion", 100);
        if (noticeVersion !== privacyNoticeVersion || body.noticeAcknowledged !== true) throw new HttpError(400, "NOTICE_ACKNOWLEDGEMENT_REQUIRED", "Acknowledge the current enquiry privacy notice.");
        if (body.origin !== "web" && body.origin !== "mobile") throw new HttpError(400, "INVALID_INPUT", "origin must be web or mobile.");
        let phone: string | null = null;
        if (body.phone !== undefined && body.phone !== null) {
          try { phone = normalizeKenyanPhone(text(body.phone, "phone", 40)); }
          catch { throw new HttpError(400, "INVALID_INPUT", "Use a supported Kenyan mobile phone number."); }
        }
        const email = body.email == null ? null : text(body.email, "email", 254).toLowerCase();
        if (email !== null && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "INVALID_INPUT", "Use a valid contact email.");
        if (!phone && !email) throw new HttpError(400, "INVALID_INPUT", "Provide a phone number or email.");
        const actorId = await identity(request, false);
        const result = await options.database.transaction({ tenantId, actorId, correlationId }, query => query.query("SELECT app_api.record_enquiry($1::uuid,$2::uuid,$3::uuid,$4,$5,$6,$7,$8,$9) AS id", [newId(), key, listingId, name, phone, email, message, body.origin, noticeVersion]));
        return response(201, { id: scalar(result, "id") }, correlationId);
      }
      const draftRoute = /^\/v[12]\/staff\/listings\/([^/]+)\/drafts\/([1-9]\d*)(\/submit)?$/.exec(path);
      const reviewRoute = /^\/v2\/staff\/reviews\/([^/]+)\/revisions\/([1-9]\d*)(\/decision)?$/.exec(path);
      const v2Draft = path.startsWith("/v2/staff/");
      if (path.startsWith("/v1/staff/") || v2Draft) {
        const actorId = await identity(request, true);
        const context = { tenantId, actorId, correlationId };
        const mediaRoute = /^\/v2\/staff\/listings\/([^/]+)\/revisions\/([1-9]\d*)\/(media-registrations|media-jobs)(?:\/([^/]+))?$/.exec(path);
        if (mediaRoute) {
          if (url.search) throw new HttpError(400, "INVALID_INPUT", "Media requests do not accept query fields.");
          const id = uuid(mediaRoute[1], "listingId"), revision = Number(mediaRoute[2]);
          if (!Number.isSafeInteger(revision) || revision > 2147483647) throw new HttpError(400, "INVALID_INPUT", "revision is outside the supported range.");
          const job = mediaRoute[3] === "media-jobs", resourceId = mediaRoute[4] === undefined ? null : uuid(mediaRoute[4], job ? "jobId" : "registrationId");
          if (job && resourceId === null) throw new HttpError(404, "NOT_FOUND", "Resource is unavailable.");
          const allowedMethod = resourceId === null ? "POST" : "GET";
          if (method !== allowedMethod) throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method is not allowed for this route.", { Allow: allowedMethod });
          let registration: { registrationId: string; expected: number; altText: string } | undefined;
          if (resourceId === null) {
            const body = record(await jsonBody(request, 8 * 1024, false, true), ["registrationId", "expectedVersion", "altText"]);
            registration = { registrationId: uuid(body.registrationId, "registrationId"), expected: version(body.expectedVersion), altText: mediaAltText(body.altText) };
          }
          const result = await options.database.transaction(context, async query => {
            await assertStaff(query);
            if (registration) return query.query("SELECT app_api.register_media_upload($1::uuid,$2::integer,$3::bigint,$4::uuid,$5::text) AS receipt", [id, revision, registration.expected, registration.registrationId, registration.altText]);
            return query.query(job ? "SELECT app_api.read_media_job($1::uuid) AS receipt" : "SELECT app_api.read_media_registration($1::uuid) AS receipt", [resourceId]);
          });
          return response(200, mediaProjection(scalar(result, "receipt"), id, revision, job, resourceId), correlationId);
        }
        if (path === "/v2/staff/reviews" || reviewRoute) {
          const queue = path === "/v2/staff/reviews";
          reviewQuery(url, queue);
          if (queue) {
            if (method !== "GET") throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method is not allowed for this route.", { Allow: "GET" });
            const pageLimit = limit(request);
            const result = await options.database.transaction(context, async query => {
              await assertAdmin(query);
              return query.query(`SELECT ${REVIEW_METADATA} FROM app_private.listing_revisions r
                JOIN app_private.listings l ON l.tenant_id=r.tenant_id AND l.id=r.listing_id
                WHERE r.tenant_id=$1::uuid AND r.state='pending' ORDER BY r.submitted_at,r.listing_id,r.revision_no LIMIT $2`, [tenantId, pageLimit]);
            });
            return response(200, { items: result.rows.map(reviewMetadata), limit: pageLimit }, correlationId);
          }
          const id = uuid(reviewRoute![1], "listingId"), revision = Number(reviewRoute![2]);
          if (!Number.isSafeInteger(revision) || revision > 2147483647) throw new HttpError(400, "INVALID_INPUT", "revision is outside the supported range.");
          if (!reviewRoute![3] && method === "GET") {
            const result = await options.database.transaction(context, async query => {
              await assertAdmin(query);
              return query.query(`SELECT ${REVIEW_METADATA},r.decided_at AS "decidedAt",r.decided_by AS "decidedBy",r.decision_reason AS "decisionReason",
                r.description,r.currency,r.bedrooms,r.private_bathrooms AS "privateBathrooms",r.shared_bathrooms AS "sharedBathrooms",r.country,r.locality,
                r.public_precision AS "publicPrecision",r.latitude::text AS latitude,r.longitude::text AS longitude,r.private_address AS "privateAddress",r.pricing,r.location,
                coalesce((SELECT jsonb_agg(jsonb_build_object('key',m.public_object_key,'alt',m.alt_text) ORDER BY m.position)
                  FROM app_private.revision_media m WHERE m.tenant_id=r.tenant_id AND m.listing_id=r.listing_id AND m.revision_no=r.revision_no AND m.accepted),'[]'::jsonb) AS photos
                FROM app_private.listing_revisions r JOIN app_private.listings l ON l.tenant_id=r.tenant_id AND l.id=r.listing_id
                WHERE r.tenant_id=$1::uuid AND r.listing_id=$2::uuid AND r.revision_no=$3::integer`, [tenantId, id, revision]);
            });
            const row = result.rows[0];
            if (!row) throw new HttpError(404, "NOT_FOUND", "Resource is unavailable.");
            const fields = Object.fromEntries(DRAFT_FIELDS.map(field => [field, row[field]]));
            // An existing draft may legitimately omit purpose/price/period fields. Reading
            // it must not apply the complete-price validation used when saving v2 input.
            const content = { ...publicRow(fields), amountMinor: row.amountMinor === null ? null : Number(row.amountMinor), pricing: validatePricingInputV2(row.pricing), location: validatePublicLocationV2(row.location) };
            return response(200, { ...reviewMetadata(row), decidedAt: row.decidedAt, decidedBy: row.decidedBy, decisionReason: row.decisionReason, content, photos: row.photos }, correlationId);
          }
          if (reviewRoute![3] && method === "POST") {
            const body = record(await jsonBody(request, 8 * 1024, true, true), ["expectedVersion", "decision", "reason"]);
            const expected = version(body.expectedVersion);
            if (body.decision !== "approve" && body.decision !== "reject") throw new HttpError(400, "INVALID_INPUT", "Choose approve or reject.");
            const approve = body.decision === "approve";
            const reason = approve ? null : rejectionReason(body.reason);
            if (approve && body.reason !== null) throw new HttpError(400, "INVALID_INPUT", "Approval reason must be explicitly null.");
            const result = await options.database.transaction(context, async query => {
              await assertAdmin(query);
              return query.query("SELECT app_api.decide_revision($1::uuid,$2::integer,$3::bigint,$4::boolean,$5::text) AS version", [id, revision, expected, approve, reason]);
            });
            return response(200, { version: String(scalar(result, "version")), state: approve ? "approved" : "rejected" }, correlationId);
          }
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method is not allowed for this route.", { Allow: reviewRoute![3] ? "POST" : "GET" });
        }
        if ((path === "/v1/staff/listings" || path === "/v1/staff/enquiries") && method === "GET") {
          const pageLimit = limit(request);
          const result = await options.database.transaction(context, async query => {
            await assertStaff(query);
            return path.endsWith("/listings")
              ? query.query(`SELECT id,slug,created_by_id AS "createdById",assigned_agent_id AS "assignedAgentId",availability,publication_status AS "publicationStatus",published_revision_no AS "publishedRevision",version::text AS version FROM app_private.listings ORDER BY updated_at DESC,id LIMIT $1`, [pageLimit])
              : query.query(`SELECT id,listing_id AS "listingId",contact_name AS name,phone_e164 AS phone,email,message,origin,status,assigned_agent_id AS "assignedAgentId",next_action_at AS "nextActionAt",version::text AS version FROM app_private.enquiries ORDER BY created_at DESC,id LIMIT $1`, [pageLimit]);
          });
          return response(200, { items: result.rows, limit: pageLimit }, correlationId);
        }
        if (path === "/v1/staff/listings" && method === "POST") {
          const body = record(await jsonBody(request, 4096), ["id", "slug", "assignedAgentId"]);
          const id = body.id === undefined ? newId() : uuid(body.id, "id");
          const slug = text(body.slug, "slug", 160);
          if (!/^[a-z\d]+(?:-[a-z\d]+)*$/.test(slug)) throw new HttpError(400, "INVALID_INPUT", "Use lowercase words separated by single hyphens for slug.");
          const assigned = body.assignedAgentId === undefined ? actorId : uuid(body.assignedAgentId, "assignedAgentId");
          const result = await options.database.transaction(context, query => query.query("SELECT app_api.create_listing($1::uuid,$2,$3::uuid) AS id", [id, slug, assigned]));
          return response(201, { id: scalar(result, "id") }, correlationId);
        }
        if (draftRoute) {
          const id = uuid(draftRoute[1], "listingId");
          const revision = Number(draftRoute[2]);
          if (!Number.isSafeInteger(revision) || revision > 2147483647) throw new HttpError(400, "INVALID_INPUT", "revision is outside the supported range.");
          if (v2Draft && !draftRoute[3] && method === "GET") {
            const result = await options.database.transaction(context, async query => {
              await assertStaff(query);
              return query.query(`SELECT revision_no AS revision,state,version::text AS version,
                title,description,purpose,property_type AS "propertyType",currency,amount_minor::text AS "amountMinor",rent_period AS "rentPeriod",
                bedrooms,private_bathrooms AS "privateBathrooms",shared_bathrooms AS "sharedBathrooms",country,locality,public_precision AS "publicPrecision",
                latitude::text AS latitude,longitude::text AS longitude,private_address AS "privateAddress",pricing,location
                FROM app_private.listing_revisions WHERE tenant_id=$1::uuid AND listing_id=$2::uuid AND revision_no=$3::integer`, [tenantId, id, revision]);
            });
            const row = result.rows[0];
            if (!row) throw new HttpError(404, "NOT_FOUND", "Resource is unavailable.");
            const { revision: storedRevision, state, version: storedVersion, ...fields } = row;
            // Staff alone may read the private address. Never reuse this projection for public routes.
            const content = { ...publicRow(fields), amountMinor: fields.amountMinor === null ? null : Number(fields.amountMinor), pricing: validatePricingInputV2(fields.pricing), location: validatePublicLocationV2(fields.location) };
            return response(200, { revision: storedRevision, state, version: String(storedVersion), content }, correlationId);
          }
          if (draftRoute[3] && method === "POST") {
            const body = record(await jsonBody(request, 4096), ["expectedVersion"]);
            const expected = version(body.expectedVersion);
            const result = await options.database.transaction(context, query => query.query("SELECT app_api.submit_revision($1::uuid,$2::integer,$3::bigint) AS version", [id, revision, expected]));
            return response(200, { version: String(scalar(result, "version")) }, correlationId);
          }
          if (!draftRoute[3] && method === "PUT") {
            // 32 bounded Unicode charge labels plus a full description can exceed 64 KiB.
            const body = record(await jsonBody(request, (v2Draft ? 128 : 64) * 1024, v2Draft), ["expectedVersion", "content"]);
            const content = v2Draft ? draftContentV2(body.content) : record(body.content, DRAFT_FIELDS);
            const expected = version(body.expectedVersion, true);
            const result = await options.database.transaction(context, query => query.query(`SELECT app_api.${v2Draft ? "save_draft_v2" : "save_draft"}($1::uuid,$2::integer,$3::bigint,$4::jsonb) AS version`, [id, revision, expected, JSON.stringify(content)]));
            return response(200, { version: String(scalar(result, "version")) }, correlationId);
          }
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method is not allowed for this route.", { Allow: draftRoute[3] ? "POST" : v2Draft ? "GET, PUT" : "PUT" });
        }
      }
      const allowedMethods: Record<string, string> = { "/v1/properties": "GET", "/v2/properties": "GET", "/v1/enquiries": "POST", "/v1/staff/listings": "GET, POST", "/v1/staff/enquiries": "GET" };
      if (allowedMethods[path]) throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method is not allowed for this route.", { Allow: allowedMethods[path] });
      throw new HttpError(404, "NOT_FOUND", "Route is unavailable.");
    } catch (error) {
      const safe = safeError(error);
      return response(safe.status, { error: { code: safe.code, message: safe.message }, requestId: correlationId }, correlationId, safe.headers);
    }
  };
}
