# Protected synthetic reminder HTTP and SDK — 15 October 2026

The API enables four fixed staff routes only when its trusted configuration explicitly selects `reminderCaptureMode: 'capture-only-v1'`. Omission disables the routes. Admission POST accepts operation ID, expected viewing version and explicit due/expiry; original admission GET reads saved evidence. Capture POST accepts only an operation ID beneath the admission; original capture GET is read-only. No caller clock, actor, company, recipient or delivery mode is accepted.

Capture and capture recovery read the immutable admission inside the current-authority database transaction. Strict snapshot validation binds its route and verified requester before the capture query. Receipt validation runs before commit. Duplicate JSON keys, ambiguous versions, extra fields, forbidden headers/query/fragment, invalid byte lengths and oversized bodies are rejected. Existing endpoint body handling remains compatible.

The SDK retains detached validated admission facts. Each write makes one POST; recovery makes GET only. Invalid successful or discarded committed write replies remain uncertain, without hidden retries. Original admission recovery can validate either the retained command or a self-contained saved snapshot. Captured, duplicate, waiting and suppressed receipts bind their original admission and operation.

## Verification

Final suites passed: 180 API, 203 SDK unit, 169 domain and 67 signed HTTP integration checks; eight workspace typechecks and API/package builds also passed. The seven focused API, seven SDK and two domain snapshot contexts overlap those totals. The standalone signed scenario overlaps the 67 integration checks.

The new actual RS256/JWKS loopback HTTP scenario uses restricted SQL credentials and normal protected synthetic workflows. It consumes valid committed admission/capture replies and deliberately throws, then recovers exact originals by GET and explicit replay. Current assignment loss denies reads and fresh captures; restoration recovers unchanged originals. Duplicate admission, requester isolation, rescheduling, new phone agreement, waiting, closure and cancellation preserve old decisions. Owner readback verifies four admissions, nine attempts, two captures and two capture audits. Six saved viewing states retain separate old/new slot agreements.

This deliberately discarded-reply test is not a literal socket outage. PGlite is not hosted PostgreSQL concurrency evidence. The 213 database checks belong to the preceding SQL checkpoint and were not rerun here. Prior admin/operator/browser checks likewise remain historical. No reminder BFF, browser form, preview capture mode, device, UAT, provider delivery or cutover pass is claimed.

Evidence logs are under `../rebuild-preservation/2026-10-12-source/viewing-reminder-http-*` and `viewing-reminder-sdk-focused.log`. Source tests are checked in with the implementation.

## Exact next work

Add fixed admin BFF admission/capture routes and POST recovery adapters that perform upstream GET only. Capture BFF reads the immutable admission server-side before one capture POST. Browser transport must retain exact admission/window/version/operation, block uncertain discard, clear private feeds on denied reads and never adopt another viewing automatically.

Provide explicit empty due/expiry operator inputs and a SQL-only synthetic capture label. Add an explicit synthetic preview mode and a fault affecting only the first captured reply, then prove actual two-tab uncertain recovery, stale state, access restoration and lifecycle suppression. No invented reminder cadence or outbound provider send.

Service identity, recipient consent/channel, cadence/budget, provider idempotency/lease and hosted race evidence remain separate gates. Private off-device source destination/push access remains requested. Checklist 16/97; accepted gates 0/14. KES 10,000 is the total recurring monthly client price. Vendor resources and old live system remain preserved.
