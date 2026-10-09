# Persistent API slice

This service is a framework-independent `(Request) => Promise<Response>` handler. `createApiService` requires a trusted configured tenant UUID, an injected transaction database, the current `privacyNoticeVersion` and a bearer-verification callback returning `{actorId}`. The HTTP bridge must resolve a hostname against a server-controlled tenant map before choosing the service. A request body, query, arbitrary header or JWT role claim cannot select a tenant or grant membership. Deployment must supply the reviewed privacy notice text corresponding to its configured version; this module does not invent legal copy.

`src/auth.ts` verifies tokens separately. Its callback adapter is `request => verify(parseBearerHeader(request.headers.get('authorization') ?? undefined))`. The service then requires a UUID subject suitable for the membership database. External identity-provider subjects that are not UUIDs need a trusted server-side mapping before using this adapter. No demo identity mapping is allowed in a public environment.

## Routes

All payloads are JSON and reject unsupported fields. The response supplies a generated `X-Request-Id` and `Cache-Control: no-store`. No cookie session or CORS allowlist is enabled by this module.

| Method/path | Contract |
| --- | --- |
| GET `/v1/properties?limit=50` | Public approved, available, recently confirmed snapshots for configured tenant; 1–100 items. Coordinates are suppressed by SQL when precision is area. No private address, staff identity or contact records. |
| POST `/v1/enquiries` | `Idempotency-Key` UUID header; `{listingId?:UUID,name,phone?:string,email?:string,message,origin:"web"|"mobile",noticeVersion,noticeAcknowledged:true}`. Notice version must match trusted current server configuration. At least phone/email. Kenyan phone format normalized. Listing must be public in this tenant. Returns `{id}`; identical retries return the original ID, changed payload/key reuse returns 409. |
| GET `/v1/staff/listings?limit=50` | Verified bearer and active agent/admin DB membership; assigned stock for agent, tenant stock for admin. Metadata only; draft detail read is a later route. |
| GET `/v1/staff/enquiries?limit=50` | Verified bearer and active staff membership; assigned enquiries for agent, tenant enquiries for admin. Contact details are private. |
| POST `/v1/staff/listings` | `{id?:UUID,slug,assignedAgentId?:UUID}`; agent attribution/assignment must be self, admin may assign an active same-tenant agent/admin. Returns `{id}`. |
| PUT `/v1/staff/listings/:id/drafts/:revision` | `{expectedVersion,content}`; SQL flat content allowlist, complete replacement draft fields, not an arbitrary patch. New revision uses expectedVersion 0; edits require the current positive revision version. Returns `{version:string}`. |
| POST `/v1/staff/listings/:id/drafts/:revision/submit` | `{expectedVersion}`; assignment, version, complete fields and 4–12 accepted media references enforced by SQL. Returns `{version:string}`. |

Public snapshot output includes `id`, `slug`, `revision`, `title`, `description`, `purpose`, `propertyType`, `currency`, `amountMinor` (safe integer number), `rentPeriod`, numeric bedroom/bathroom counts, public locality/precision and media key/alt references. Version values are returned as strings because PostgreSQL versions are bigint. Mutation inputs currently accept safe integer numeric versions; future very large versions require an explicit string-version contract. Unknown catalogue query filters are not implemented; clients must not imply server-side filtering beyond the supplied tenant and limit.

Draft content keys are `title`, `description`, `purpose`, `propertyType`, `currency`, `amountMinor`, `rentPeriod`, `bedrooms`, `privateBathrooms`, `sharedBathrooms`, `country`, `locality`, `publicPrecision`, `latitude`, `longitude`, `privateAddress`. This first API version explicitly uses a flat SQL-backed DTO rather than pretending to accept the whole shared `PropertyDraft`: `amountMinor` maps to `price.minorUnits`, `rentPeriod` maps to `rentalPeriod`, and bathroom/location fields differ. SQL constraints are authoritative for this persisted slice; a full shared DTO adapter and convergence remain follow-up work. Media acceptance, fees and moderation decisions are not writable through this HTTP slice. It cannot fake accepted uploads or approve its own requests.

## Database boundary

`createPostgresDatabase(PoolConfig)` checks the login before returning and every checkout. It rejects superuser, BYPASSRLS, inherited roles, application schema/table owners, owner-role membership, application-schema CREATE privilege, missing runtime-role membership, and a privileged/misconfigured `api_runtime`. The login must be a dedicated `LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS` with membership only in the existing `api_runtime` role and minimal connection privileges. Migration/bootstrap credentials must never be used in the API process. Supply DSN/TLS configuration through server secrets, never public brand configuration.

Each request transaction acquires a dedicated client, begins, sets local `api_runtime`, installs parameterized `realtor.tenant_id`, verified `realtor.actor_id` and generated correlation ID, executes parameterized SQL, commits or rolls back, then releases. SQL RLS and narrow SECURITY DEFINER RPCs derive current membership; request-supplied roles are never consumed. Failed rollback destroys the connection. Transaction-local settings and role disappear at commit/rollback. Queries must remain inside the supplied transaction callback.

The PostgreSQL migration itself is the authoritative persistence boundary. API errors expose safe category/status plus request ID; raw SQL/provider messages and contact data are not returned or logged by this module. Production structured logging/metrics and timeouts still need deployment integration.

## Abuse limits and current limits

The default enquiry limiter is process-local, bounded to 1,000 live keys, 10 submissions/minute/key, and fails closed when full. With no trusted socket key callback it intentionally uses a shared local bucket. It protects this development slice only. Before public launch, configure a distributed limiter, trusted proxy/client address handling, spam controls, operational alerts and tested privacy/data retention. Never take arbitrary `X-Forwarded-For` as the authoritative client key. Idempotent retries also consume quota.

Enquiry bodies are limited to 16 KiB, draft bodies to 64 KiB, and listing/submit metadata to 4 KiB. Limits count actual streamed bytes rather than trusting Content-Length. Text lengths and content constraints are checked again in SQL. This slice does not send email/WhatsApp/SMS, schedule viewings, process payments, sign media URLs, validate uploaded file bytes, manage users or bypass the remaining launch gates.

Tests execute the actual migration and API handler against disposable PGlite PostgreSQL, using a restricted login and synthetic two-tenant fixtures. A test-only verified-identity callback isolates service/database behavior; JWT signature/issuer/audience tests are separate in `auth.test.mjs`. Accepted media fixtures are inserted by the trusted test bootstrap; they are not evidence of a media processor. PGlite tests are not verification of a hosted PostgreSQL deployment, TLS, proxy configuration or real provider account.
