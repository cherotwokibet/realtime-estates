# Moderator image consumer — 17 October 2026

The development-only `createDevelopmentReviewMediaPreviewApi` factory pins the reviewer route and `read_review_media_preview` SQL call. It accepts only the exact `review_media_preview` / `pending` / current-admin projection. The original draft factory retains its route, draft state and assigned-agent/admin policy. Caller options cannot select or override policy.

Both factories share the existing bounded byte-verification engine: immutable request/capture/seal/output identity, native manifest and byte digest/count/format checks, owned byte snapshots, cancellation and drain. SQL authorization runs before storage reads and again after I/O; a changed association, version, state, actor role or provenance prevents image delivery. Admission remains per factory; coordinated admission across two composed consumers is not yet established.

Verification: 27 focused checks passed (20 existing draft and seven new reviewer checks). All eight workspace type checks and four package builds passed. The first full API run passed 210/211: the existing signed native upload reply-loss test received a response before its deliberate disconnect. With no source edits, the repeated full API suite passed all 211, with zero skips. Both logs are retained; this does not establish a root cause for the first failure. Evidence is in sibling `rebuild-preservation/2026-10-12-source/review-media-consumer-*.txt`.

The new tests use boundary doubles and synthetic WebP header bytes; they do not prove actual native decoding. The reviewer factory is not yet composed into the native preview coordinator, HTTP server, SDK, admin BFF or review UI. No reviewer browser/device check, hosted PostgreSQL race, current CI, operator UAT or cutover is claimed. Database policy was verified at checkpoint103; SQL is unchanged here.

Next: compose the fixed reviewer consumer with native stores and shared admission/lifecycle; add signed loopback tests that use real sealed native outputs and revoke reviewer authority or decide a revision during I/O. Then implement the fixed SDK/BFF/review UI path and inspect real decoded images in the browser. Keep rights/accounts/retention/legacy RPC retirement/device/UAT/cutover gates explicit. KES10,000 remains the total recurring client price; vendor resources and the old live system remain intact.

The full native preview regression suite also passed all 50 checks, zero skips; this protects the existing draft composition and does not establish an integrated reviewer native journey.
