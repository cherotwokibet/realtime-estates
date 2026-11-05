# Guarded floor-plan upload and original recovery — checkpoint366

5 November 2026 EAT. Synthetic data only.

Authenticated floor-plan file preparation and read-only original recovery now have bounded binary upload routes and shared client support. All 39 focused checks passed, including an actual Windows processing run through the client and API handler. Progress remains 54/97 (56%).

The default-off, production-refused staff API accepts PUT /v2/staff/listings/{listing}/floor-plan-inputs/{revision}/{expectedVersion}/{requestId} and GET on that same original target. An explicit server capability owns preparation/recovery; the API never accepts company, actor, job, claim, nonce or storage IDs from callers. SQL current-gallery authorization and current-draft/version checks precede body consumption; registration repeats fresh authority inside the coordinator. Bodies are bounded at10MiB and15seconds, with length checks, abort handling and a per-service one-write guard. Recovery reads require current staff authority but retain the original expected version.

The shared client snapshots the file and command, sends one binary upload and validates exact compact receipts and no-store responses. Invalid acknowledgements mark the upload uncertain; GET original recovery never resends bytes. New tests exercise real restricted isolated SQL, malformed/empty/oversize/failed/stalled/cancelled input, stale targets, spoofed headers, concurrent writes, blocked/foreign results and SDK recovery. The native integration runs the actual Windows worker through an in-process Request/Response API handler and shared client; after a mismatched acknowledgement, original recovery repeats neither upload, registration, claim, persistence, native processing nor seal. This is not a listening-network/browser/device test. The remaining provider cases simulate preparation receipts.

Validation: domain/API/client TypeScript builds;39 focused Node tests,0 failures,0 skips in floor366-upload.txt; targeted formatting and whitespace checks. The first focused draft run had two test-harness errors (wrong response envelope and omitted privacyNoticeVersion), corrected before the final run. A generic validation failure after dispatch was normalized to ApiClientError INVALID_RESPONSE with submissionUncertain=true and covered by the native malformed-acknowledgement case. Shared preparation fixture extraction preserves the earlier coordinator tests. No GitHub Actions or paid compute used.

Next, connect session-bound BFF routes and author/reviewer screens, then approved/public/successor snapshot rules under task06-4. Keep source/job/store/lease identities server-only and retain exact original commands for uncertain outcomes.

No author UI, public integration, production enablement or launch gate is accepted.54/97 broad tasks,0/14 exit gates.
