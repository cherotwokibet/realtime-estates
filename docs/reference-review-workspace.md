# Saved reference review workspace — 23 October 2026, checkpoint 145

The synthetic reviewer can load an exact saved revision together with its original catalogue. The opt-in API reads both inside one current-authorized transaction. It selects the catalogue from the stored attributes, validates the complete pair before commit, and never guesses from the current catalogue pointer or a browser hint.

`GET /v3/staff/{listings|reviews}/{listingId}/reference-revisions/{revision}/{expectedVersion}/context` returns `synthetic-reference-context-v1`, with `review` and `catalogue`. The domain validator enforces exact own data fields, detached frozen values, full historical snapshot/path/version binding and pending state for review reads. Catalogue remains limited to 6 MiB and review to 128 KiB. Only the separate context SDK transport accepts their combined byte allowance plus 128 bytes of envelope; ordinary moderation reads/writes retain 128 KiB. Strict UTF-8, duplicate-key and integer-token validation, framing, cancellation, deadlines and no automatic retries remain active.

The default-off server loader checks the synthetic preview modes, uses the current API session for company/actor, and returns no credential prop. Exact 404/409 pending reads produce a recovery-only shell: a lost committed approval may have removed the pending row, but its retained original must still be recoverable. Denied, malformed and failed reads do not become fresh decision workspaces.

`ReferenceReviewWorkspace` renders every private content field, saved historical locations/amenities, operational state and ordered photo fingerprints. It uses the existing verified reviewer image component. Acknowledgement and rejection reason are explicit. All new decisions stay disabled while restoring session storage. Restored originals start uncertain; only their original GET recovery is available. Unconfirmed results cannot be replaced or discarded. Settled originals require explicit clearing. A changed server-bound identity/version remounts the local workspace. The page is `/reviews/{id}/{revision}/references/{version}`; transition/recovery BFF POST entry points are registered and retain their existing separate mode/current-session checks.

## Verification

- Domain: 267 checks passed, including two new context cases.
- API: 258 checks passed, including one new restricted-SQL context case.
- SDK unit: 255 checks passed, including three new context transport cases.
- SDK integration: 84 checks passed; the existing moderation flow now verifies initial discovery after catalogue activation and role denial.
- Admin: 338 checks plus seven static markup checks passed, including four new loader cases and three new reviewer markup cases.
- Canonical admin reference integration: 13 checks passed. Existing moderation cases now enter the mounted transition/recovery handler functions, load authoritative historical props, and prove recovery-only loading after committed approval.
- Focused domain/SDK 20 and API/SDK integration 18 checks overlap those full suites. Focused loader three was run before its fourth recovery-shell case; the final full admin run includes all four.

All final listed suites have zero failures and zero skipped checks. Initial diagnostics are retained: two invalid test fixtures (mutation of frozen content and overlong labels), a missing test-build import extension, a mock error missing its required request ID, and a formatting check overlapping an in-progress edit. The fixtures/imports/mock were corrected without relaxing validation. Final checks are recorded separately.

These are code, static markup and in-process restricted PGlite proofs. No new actual browser interaction, sessionStorage/reload, Next runtime/build, signed moderation HTTP, native image check, hosted PostgreSQL race, device check, full-root test, operator UAT or cutover acceptance is claimed. The fourth SQL proposal is still absent from default migrations and the preview launcher. Normal production startup and the old live system are unchanged. KES 10,000 remains the complete monthly client price baseline.

## Exact next work

Extend the explicit disposable preview launcher with a separately validated moderation mode, load the fourth SQL proposal only there, and seed an independently authored pending adopted revision under a different submitter. Add signed loopback checks for context/transition/original recovery and rejection of incompatible modes before starting a fresh isolated UI checkout. Do not reuse an occupied `.next` or control the old rejected runtime. Then verify the actual mounted screen, storage reconstruction after a lost decision reply, historical catalogue activation, actor/access loss, rejection reason, verified photos and settled clearing in a real browser. Keep evidence and unresolved acceptance gates explicit. Public reference mapping, creation/successor/import conversion and external rights/accounts/retention/devices/UAT/cutover remain open.

Evidence files are in sibling `rebuild-preservation/2026-10-12-source/reference-context-*`. Source, restore and dashboard publication identifiers are recorded in the continuation journal after verification.
