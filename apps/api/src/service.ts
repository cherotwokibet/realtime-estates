import { randomUUID } from "node:crypto";
import { normalizeKenyanPhone } from "@realtor/domain";
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

async function jsonBody(request: Request, maximum: number): Promise<unknown> {
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
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)); }
  catch { throw new HttpError(400, "INVALID_JSON", "Request body must contain valid JSON."); }
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
function scalar(result: { readonly rows: Record<string, unknown>[] }, key: string): unknown {
  const value = result.rows[0]?.[key];
  if (value === undefined || value === null) throw new Error("Unexpected database response.");
  return value;
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
      if (path === "/v1/properties" && method === "GET") {
        const pageLimit = limit(request);
        const result = await options.database.transaction({ tenantId, actorId: null, correlationId }, query => query.query(`SELECT listing_id AS id,slug,revision_no AS revision,title,description,purpose,
          property_type AS "propertyType",currency,amount_minor::text AS "amountMinor",rent_period AS "rentPeriod",bedrooms,
          private_bathrooms AS "privateBathrooms",shared_bathrooms AS "sharedBathrooms",country,locality,public_precision AS "publicPrecision",
          latitude::text AS latitude,longitude::text AS longitude,photo_refs AS photos
          FROM app_api.public_listings ORDER BY approved_at DESC,listing_id LIMIT $1`, [pageLimit]));
        const items = result.rows.map(row => ({ ...row, amountMinor: Number(row.amountMinor), latitude: row.latitude === null ? null : Number(row.latitude), longitude: row.longitude === null ? null : Number(row.longitude) }));
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
      const draftRoute = /^\/v1\/staff\/listings\/([^/]+)\/drafts\/([1-9]\d*)(\/submit)?$/.exec(path);
      if (path.startsWith("/v1/staff/")) {
        const actorId = await identity(request, true);
        const context = { tenantId, actorId, correlationId };
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
          if (draftRoute[3] && method === "POST") {
            const body = record(await jsonBody(request, 4096), ["expectedVersion"]);
            const expected = version(body.expectedVersion);
            const result = await options.database.transaction(context, query => query.query("SELECT app_api.submit_revision($1::uuid,$2::integer,$3::bigint) AS version", [id, revision, expected]));
            return response(200, { version: String(scalar(result, "version")) }, correlationId);
          }
          if (!draftRoute[3] && method === "PUT") {
            const body = record(await jsonBody(request, 64 * 1024), ["expectedVersion", "content"]);
            const content = record(body.content, ["title", "description", "purpose", "propertyType", "currency", "amountMinor", "rentPeriod", "bedrooms", "privateBathrooms", "sharedBathrooms", "country", "locality", "publicPrecision", "latitude", "longitude", "privateAddress"]);
            const expected = version(body.expectedVersion, true);
            const result = await options.database.transaction(context, query => query.query("SELECT app_api.save_draft($1::uuid,$2::integer,$3::bigint,$4::jsonb) AS version", [id, revision, expected, JSON.stringify(content)]));
            return response(200, { version: String(scalar(result, "version")) }, correlationId);
          }
          throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method is not allowed for this route.", { Allow: draftRoute[3] ? "POST" : "PUT" });
        }
      }
      const allowedMethods: Record<string, string> = { "/v1/properties": "GET", "/v1/enquiries": "POST", "/v1/staff/listings": "GET, POST", "/v1/staff/enquiries": "GET" };
      if (allowedMethods[path]) throw new HttpError(405, "METHOD_NOT_ALLOWED", "Method is not allowed for this route.", { Allow: allowedMethods[path] });
      throw new HttpError(404, "NOT_FOUND", "Route is unavailable.");
    } catch (error) {
      const safe = safeError(error);
      return response(safe.status, { error: { code: safe.code, message: safe.message }, requestId: correlationId }, correlationId, safe.headers);
    }
  };
}
