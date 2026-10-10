# Shared API client

This TypeScript package implements public property reads, enquiries and the narrow authenticated v2 staff draft read/save/submit contract. It uses `@realtor/domain` for v2 pricing and location validation and requires Fetch, URL, AbortController and their web-platform types. Authentication UI, token acquisition/storage, staff listing creation, media processing and moderation decisions are outside this package. UI connections are separate application integrations.

```ts
import { RealtorApiClient, ApiClientError } from '@realtor/api-client';

const api = new RealtorApiClient({
  baseUrl: 'https://api.example.invalid', // Trusted agency deployment configuration.
  privacyNoticeVersion: 'reviewed-notice-version',
});
const properties = await api.listProperties({ limit: 20 });
const propertiesV2 = await api.listPropertiesV2({ limit: 20 });

// Generate ONCE when starting the submission and retain with its original body
// until a definite result. Persist both securely if retries span app restarts.
const idempotencyKey = crypto.randomUUID();
try {
  const receipt = await api.submitEnquiry({
    listingId: properties.items[0]?.id ?? null,
    name: 'Example prospect',
    phone: '0700000000',
    message: 'I would like to know more.',
    origin: 'web',
    noticeVersion: 'reviewed-notice-version',
    noticeAcknowledged: true, // Set only after the actual disclosure is shown/acknowledged.
  }, { idempotencyKey });
  // receipt.id means the server saved an enquiry, not that a message was delivered.
} catch (error) {
  if (error instanceof ApiClientError && error.submissionUncertain) {
    // Show an honest pending/unknown outcome. A manual retry must reuse the
    // original key and body; never create a new key to recover from uncertainty.
  }
}
```

Use `allowLoopbackHttp: true` only for explicit local development with `http://localhost`, `http://127.0.0.1` or `http://[::1]`. Configuration accepts an origin only, without credentials, path, query or fragment. All other endpoints require HTTPS. HTTPS configuration is not proof of server ownership: deployment/account/hostname verification remains a launch gate.

Every call may receive `signal`, `timeoutMs` and an explicit `bearerToken`; tokens are never stored as shared client configuration. Public catalogue reads also accept `limit` (1–100). Enquiry POST requires a caller-retained UUID idempotency key and returns its saved UUID. There are no automatic retries. Notice version must match the configured current version; the server checks its own authoritative version again. The client does not generate notice text or infer consent from the presence of contact data.

Requests use `credentials: 'omit'`, `redirect: 'error'` and `cache: 'no-store'`. Node Fetch redirect behavior has a separate real-HTTP regression suite; controlled transport tests inspect these request flags. Browser and React Native device behavior have **not** been verified here. Before sending any real bearer token or enquiry on a native transport, prove that the exact pinned transport rejects redirects before following them and does not attach ambient credentials. A check of `response.redirected` happens after sending and cannot prevent a noncompliant transport from leaking data. Injected transports must enforce the Fetch contract; this package does not make an unsafe transport safe.

The entire request and body read has a timeout (default 10 seconds, configurable 1–120000 ms). Errors have typed `kind`, optional safe server code, request UUID, status and numeric retry-after seconds. Raw server messages, contact data, tokens and low-level transport errors are not copied into client errors. A PUT/POST interrupted after starting, receiving an invalid response or returning a server failure has `submissionUncertain: true`; it may already have committed. Cancellation does not undo a server write. A compliant Fetch implementation is needed to abort underlying network work as well as settle the client promise.

Response validation uses strict field allowlists and immutable returned DTOs. It rejects unknown tenant/private fields, unsafe/invalid KES money, incompatible rental periods and room counts, malformed reviewed photo references and precise coordinates on area-only listings. It fails on malformed pages rather than presenting an empty catalogue. Current flat `amountMinor` and `rentPeriod` map conceptually to the domain's `KesMoney.minorUnits` and rental period; this deliberately narrow wire contract is not full domain convergence. Missing fee fields remain absent/unknown, never assumed zero. Photo keys are opaque references, not URLs: callers must use a separately trusted asset origin. Any wire-shape additions require deliberate client/server version work.

`listProperties` keeps its v1 response contract unchanged. `listPropertiesV2` adds a validated public `location` (`county`, `town`, `area`, each string or null) and a derived `PricingDisclosure`. The v2 wire carries only a disclosure declaration and named known/quote-required charge inputs; server-supplied totals or extra fields are rejected. Shared domain logic computes exact KES known mandatory subtotals, separates refundable deposits and optional costs, and preserves unresolved mandatory costs. A declaration of `complete` with a mandatory quote outstanding remains incomplete. Even a complete mandatory declaration is not independent verification of every tax or an all-inclusive price. Empty undeclared charges never imply zero fees. Limits are 32 charges, 64 characters per charge ID, 160 per charge name/location component. V2 uses the same transport, per-call credentials, timeout, cancellation and no-retry policy as v1.

V2 display-text bounds count Unicode code points to match PostgreSQL `length(text)`: title/locality 160, description 10000 and photo alternative text 300. These base display fields retain the existing trimming and control-character checks and reject unpaired surrogates; paired emoji remain valid. Nested v2 charge/location strings also count code points, but require already-trimmed input under their stricter shared contract. V1 and enquiry/configuration text retain their existing UTF-16 code-unit bounds; v2 does not change those contracts.

V2 response JSON additionally requires every numeric `amountMinor` token to be an integer literal, with no fractional or exponent notation, including escaped JSON field names. The shared parser checks the original text so an unsafe fractional input cannot become an apparently safe integer through JavaScript rounding. Normal coordinate decimals are unaffected. V1 and enquiry JSON parsing remain unchanged.

Tenant scoping is the server's responsibility. The client sends no tenant or actor override, and a safe DTO alone cannot prove that a configured hostname belongs to the intended realtor. Authentication verification and database authorization remain server gates.

## Staff draft v2

`getStaffDraftV2(listingId, revision, options)`, `saveStaffDraftV2(listingId, revision, input, options)` and `submitStaffDraftV2(listingId, revision, input, options)` require a nonblank `bearerToken` on every call, including runtime validation. They use the actual `/v2/staff/listings/:id/drafts/:revision` GET/PUT and `/submit` POST endpoints. A token authorizes nothing by itself: verified identity, active tenant membership and authoritative assignment remain server/database decisions. No request accepts a role, actor or tenant grant.

```ts
const staffOptions = { bearerToken: tokenForThisRequest };
const draft = await api.getStaffDraftV2(listingId, revision, staffOptions);
if (draft.state === 'draft') {
  const saved = await api.saveStaffDraftV2(listingId, revision, {
    expectedVersion: draft.version,
    content: { ...draft.content, title: 'Updated title' },
  }, staffOptions);
  // Submit only after the user reviews the saved draft and required media.
  const submitted = await api.submitStaffDraftV2(listingId, revision, {
    expectedVersion: saved.version,
  }, staffOptions);
  // This receipt is a new revision version; pending review does not publish it.
}
```

`StaffDraftV2` contains the requested revision, its state, its revision version and raw `StaffDraftContentV2`. The content preserves `pricing: PricingInputV2` and `location: PublicLocationV2`; it does not replace editable inputs with derived totals. Private address and coordinates belong only in authenticated staff UI and must never be reused as a public property projection. Exact GET field allowlists, immutable canonical copies and original-text v2 money parsing apply. Nullable fields stay null, including unknown prices, counts and location components.

`validateStaffDraftContentV2(unknown)` returns a canonical **full replacement**, not a partial patch. Required pricing/location objects must be present. Omitted base fields become null, with `KES`, `KE` and area precision defaults. Editors must preserve all loaded, unedited fields, including private address, coordinates and bathroom counts. Incomplete drafts are supported; base/purpose/period-dependent arithmetic runs only when those inputs exist. Final API/SQL validation and submission requirements remain authoritative; canonicalization does not promise acceptance or complete a missing rental period or media.

Read versions are canonical positive decimal strings within PostgreSQL bigint range. Preserve `draft.version` exactly; a listing version is a different concurrency token. Writes require that string and reject values above `Number.MAX_SAFE_INTEGER` before converting to the current API's numeric `expectedVersion`. New revision creation may use `'0'` on save only; malformed/rounded versions are never inferred or repaired. Save/submit return `{ version: string }` and send no idempotency header. An HTTP 401/403/409 is a definite typed failure; a 409 must not automatically refresh the version and resubmit. After an uncertain write, read the draft and reconcile the actual content/state/version before any deliberate next action. No save or submit is automatically retried, and a submitted revision cannot be edited.

## Moderation v2

`listReviewsV2({ bearerToken, limit? })` reads `/v2/staff/reviews?limit=...` and returns `ReviewPageV2` with immutable, compact pending `ReviewSummaryV2` records. Limit is 1–100, default 50; the bounded page provides no total or cursor and must not be treated as the complete backlog when it reaches its limit. Compact records contain submitted listing metadata, revision and listing version strings, availability/publication metadata and accepted photo counts. They contain no full content or private address. Current tenant admin membership is checked by the server, including when an agent is assigned to the listing.

`getReviewV2(listingId, revision, { bearerToken })` reads the exact review revision and returns `ReviewDetailV2`. Draft, pending, approved and rejected states are supported for explicit readback. It includes the canonical full staff content, raw pricing inputs, nullable location, accepted photo references and submission/decision metadata. Strict UUID/version/enum/timestamp/count/text validation applies; metadata must match the content, and returned photo references must match the accepted count. Timestamps use canonical ISO UTC milliseconds. These are admin-only private data and trusted metadata references, not independently verified image bytes.

```ts
const review = await api.getReviewV2(listingId, revision, { bearerToken });
if (review.state === 'pending') {
  const receipt = await api.decideReviewV2(listingId, revision, {
    expectedVersion: review.version, // Revision version, never listingVersion.
    decision: 'reject',
    reason: 'Correct the location before approval.',
  }, { bearerToken });
  // Reload the exact review to reconcile its state and decision metadata.
}
```

`decideReviewV2` posts only `expectedVersion`, `decision` and `reason` to the exact revision's `/decision` endpoint. Approval requires `reason: null`. Rejection requires an already-trimmed nonblank reason of at most 1000 Unicode code points, without control characters or unpaired surrogates; newline is a control character. It returns `ReviewDecisionReceiptV2` with a canonical version string and matching approved/rejected state. Every call requires its own bearer; no credential is retained. Revision versions use the same safe numeric write conversion as staff saves. No automatic retries or idempotency header are added. Authorization failures and stale 409 decisions remain definite; interrupted/malformed/server-failed writes can have committed and are marked uncertain. Reconcile by reading the exact revision before another action. A decision receipt alone does not prove public visibility, current availability or live deployment; those require separate readback and server publication gates.

The response character limit is checked **after** `response.text()` completes; it is a parsing cap, not a streaming download or memory bound. Current API responses have bounded item/photo/text fields. Connecting arbitrary/untrusted servers requires a separately enforced streaming/proxy byte limit. Browser CORS, TLS, persistent credential storage, native redirects/credentials, real provider identity, deployment and actual devices remain unverified.

## Verification

From the repository root after the root workspace manifest/lock has been integrated:

```powershell
npm run build --workspace @realtor/api-client
node --test packages/api-client/tests/transport.test.mjs
node --test packages/api-client/tests/http-transport.test.mjs
node --test packages/api-client/tests/v2.test.mjs
node --test packages/api-client/tests/staff-v2.test.mjs
node --test packages/api-client/tests/moderation-v2.test.mjs
npm run build --workspace @realtor/api
node --test packages/api-client/tests/service-integration.test.mjs
node --test packages/api-client/tests/v2-service-integration.test.mjs
node --test packages/api-client/tests/staff-v2-service-integration.test.mjs
node --test packages/api-client/tests/moderation-v2-service-integration.test.mjs
```

`transport.test.mjs` tests malformed data, credential flags/per-call tokens, redirect indicators, cancellation/timeouts, notice/key validation and no automatic retries using controlled Fetch responses. `http-transport.test.mjs` uses Node Fetch and ephemeral loopback HTTP servers with synthetic values. `service-integration.test.mjs` runs this client against the actual API handler and migration-backed in-memory PGlite with a nonowner/non-bypass login; it checks tenant isolation, exact money, private projection, durable replay/conflict and stale notices. The latter is an in-process service/database integration, not a live HTTP/cloud/Supabase/provider-auth test. It uses trusted synthetic accepted-media metadata, without testing upload bytes or a media processor. No production data or services are touched.

`v2.test.mjs` covers shared disclosure derivation, strict extension validation and unchanged v1 behavior using controlled transport. `v2-service-integration.test.mjs` applies migrations 0001 and 0002 and exercises the actual API service and restricted SQL transactions, including two-company projection and preservation of the published snapshot while a replacement is drafted or rejected. These remain in-process tests with synthetic metadata, not device or deployment proof.

`staff-v2.test.mjs` checks incomplete canonical content, per-call credentials, strict DTO/version/money validation, distinct authorization/conflict errors and uncertain write outcomes without retry. `staff-v2-service-integration.test.mjs` runs against both migrations, the actual API service and a restricted nonowner/non-bypass PGlite login. It proves assignment/company isolation, exact raw cents/quotes/null locations, stale-save preservation, server submission gates and actual committed save/submit operations whose responses are deliberately lost. Identity verification is injected synthetic test data, not provider-auth proof. Accepted media is trusted fixture metadata only; no real property, customer, upload or external service is used.

`moderation-v2.test.mjs` covers exact queue/detail contracts, metadata coherence, original-text money validation, decision reasons, required per-call credentials and definite/uncertain errors without retries. `moderation-v2-service-integration.test.mjs` exercises both migrations and the actual service with a restricted runtime login: admin/company isolation, private content boundaries, independent listing/revision tokens, stale decisions, rejection/pending preservation of the approved snapshot, replacement approval and an actual approval commit followed by a deliberately lost response. These are in-process synthetic integration tests, not production/provider/device proof.
