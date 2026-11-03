# Signed administrator audit API and shared client — 3 November 2026

Owner: Boniface + Codex. Local synthetic supporting work for 08-7; 53/97 deliverables, zero accepted stage gates remain unchanged.

The isolated metadata candidate now composes through `GET /v2/staff/audit-events` and `RealtorApiClient.listAdminAuditEvents`. The service requires explicit `synthetic-admin-audit-v1`, is off when omitted and unavailable in production. It never installs its SQL. The configured company and verified subject determine transaction authority; the database and API each check current administrator membership. The API rejects caller-selected authority, cookie/conditional/range/body framing, unknown or duplicate filters, oversized URLs and non-GET methods. Parameters remain typed SQL arguments with a two-second statement timeout.

The shared domain contract copies fixed own data fields, refuses accessors and extra/private fields, binds company/filters/cursor/order and preserves exact bigint strings. Pages are capped at twenty events. The SDK requires explicit bearer options and uses one GET, no-store, omitted credentials and redirect refusal. Its existing strict streamed transport now gives audit responses a 32KiB ceiling, duplicate-key rejection, required no-store response, cancellation and deadline protection. It does not replay or automatically retry reads. No private summary, reason or arbitrary correlation text is exposed.

The signed composition uses ephemeral RS256 keys/JWKS, actual HTTP servers, the shared SDK and disposable PGlite with the maintained migration order plus isolated audit proposal. The test adapter executes `SET LOCAL ROLE api_runtime`; it is not a production login pool. An actual settings-approval command and its exact replay produce one durable audit event. Reads return its original company/actor/action/object/version. Signed agents, customers, foreign admins, a same token at the other company, wrong audience and corrupted signature are denied. The other company's own admin sees its empty history. Demotion, revocation and company disable immediately deny the retained token. Every owned ephemeral server/database closes in `finally`. No real provider or customer data is used.

Final verification:

- `npm run test:admin-audit`: **12/12**, zero failures/skips; fresh domain/API/SDK builds. Raw `audit319-maintained4.txt`. Includes domain2, API3, SDK3, signed composition1 and database3; counts overlap the broader suites.
- Entire maintained domain suite: **356/356**, `audit319-domain-full.txt`.
- Entire maintained API suite: **363/363**, `audit319-api-full.txt`.
- Entire maintained SDK suite with the new audit test registered: **346/346**, `audit319-sdk-full5.txt`. Earlier `audit319-sdk-full.txt` has343 before that registration; retain its narrower scope.
- Touched TypeScript/tests/package/docs formatting and Git whitespace checks passed. No web/admin/native UI was changed, built or device-tested here.

Earlier failures are retained, not counted as passes: `audit319-focused1.txt` caught a real timezone mismatch (SQL rendered session timezone +03 while the contract expected UTC) and an incorrect error-status test expectation; SQL now renders fixed UTC microsecond timestamps. `audit319-focused2.txt` then caught an incorrect test assumption about SDK denial kinds; the maintained SDK reports `HTTP` with403/`FORBIDDEN` or401/`UNAUTHENTICATED`, and the signed assertions now verify that actual envelope. `audit319-focused3.txt` passed12/12 before further signed-filter/signature/revocation assertions; maintained4 is final.

The first source inventory is `docs/ADMIN-ACTION-AUDIT-MATRIX.md`: sixteen action/read families, their SQL/event facts and existing focused proofs to inspect. It is not an assertion that every dispatcher kind or UI route has been freshly audited. Exact remaining work: reconcile each reachable admin mutation and legacy endpoint, check meaningful event/receipt and denied/no-write/replay assertions for each, fix gaps, and connect a safe no-store admin read screen using the existing BFF/session. The safe audit timeline alone cannot close the literal “every admin action” criterion. The current SQL candidate remains outside normal migrations; underlying existing administrator raw-table access is unchanged. Descending pages are live keysets, not a consistent cross-request snapshot or production load benchmark.

No app GitHub push, Actions run, spending, provider activation, vendor-resource/live-system/cutover change. KES10,000 total recurring client price per realtor per month remains the baseline.
