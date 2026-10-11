# Executed admin gallery evidence

11 October 2026, Africa/Nairobi. Independently authored local synthetic replacement work. Vendor originals and live services were preserved. This checkpoint implements read/remove/reorder UI; uploading and previewing actual images remains open.

## Executed verification

The frozen source manifest and exact commands are retained outside the checkout in `rebuild-preservation/2026-10-11-source/verification-gallery-ui-final-1.json`. All six commands exited0:

1. Shared package builds.
2. API build.
3. Admin model/policy test compilation.
4. All API tests, API development HTTP-preview tests, API-client unit/integration tests and admin tests: **272 tests passed**,200 top-level tests including nested children in the total; zero failures, skips, cancellations or todos. TAP duration54750.4236ms. [Full test log](admin-gallery-tests.txt).
5. All eight workspace typechecks. [Typecheck log](admin-gallery-types.txt).
6. Admin production build, including the new workspace/removal/order/original-operation BFF routes. [Build log](admin-gallery-build.txt).

Runtime source hashes stayed unchanged through this verification. Next development mode later regenerated two `next-env.d.ts` import paths; those generated paths were restored to the exact verified production-build bytes before the source checkpoint. Documentation and browser evidence were added afterward without changing the verified runtime source.

Restricted PGlite/API/SDK tests exercise current staff authorization and tenant/assignment denial, complete legacy/unaccepted sets, sparse positions, statement-consistent versions, read-only workspace behavior and version changes after removal/order. Pure admin tests exercise immutable complete-set commands and exact original-receipt matching. Preview policy/real signed HTTP tests exercise bounded parsing and the development-only route allowlist. Existing API/SDK tests were included; the entire database/media/native suite was not rerun in this checkpoint. The earlier456-test backend checkpoint remains separate and is not added to272.

## Actual browser session

The owned synthetic staff preview ran on127.0.0.1:3001 with the signed loopback API on4101. Both listeners were stopped after QA; no provider or native worker was launched for this UI checkpoint.

1. Loaded a four-photo workspace at version2. Entered an unsaved title and invalid price `1e2`.
2. Moved photo2 earlier and explicitly saved the whole order. The original receipt appeared while the editor retained version2 and blocked dependent writes.
3. Explicitly read the current gallery at version3, compared saved content/photos, and chose to keep text edits with current photos. The title and invalid `1e2` remained unchanged. [Comparison screenshot](gallery-order-comparison.png).
4. In a second staff view at version3, confirmed removal of photo4, read the current gallery, and explicitly used version4 with three photos.
5. The first view, still at version3, proposed another order. Saving returned a stale-version conflict. Unsaved text and invalid price remained; no automatic version adoption occurred. [Conflict screenshot](gallery-stale-order.png).
6. Read version4 explicitly and kept local text with current photos. Corrected the price to `20000.01`, saved the draft, and observed successful readback at version5 with the title and current three-photo set preserved. [Desktop gallery screenshot](gallery-desktop.png).

The screenshot viewport was1265px wide. Requesting390×844 through the browser viewport capability did not change the observed clientWidth/scrollWidth or screenshot width; both stayed1265px. That attempt is archived outside the checkout as `gallery-viewport-attempt-1265.png`. It supplies no mobile/narrow-layout acceptance. The capability was reset and the two owned preview tabs were closed.

## Explicit limits and next step

No forced lost-network-reply or double-click browser test was performed. Uncertain original-operation behavior has model/policy review and existing API/SDK coverage, not browser fault-injection evidence. No screen-reader/assistive-technology or real-device UAT was performed. SQL-only seed photos have no deliverable image bytes; their badges are not real upload verification.

No full web/mobile production build, remote CI, production session/provider deployment, real PostgreSQL concurrency, production media isolation/quotas/retention, independent backup, customer data migration or cutover acceptance was established. All fourteen release gates remain open and checklist verification remains13/97. Rights/accounts and the controlled private platform source remote remain unresolved. Same-device bundle recovery is recorded separately in the tracker recovery document.

Next: authenticated private upload/quarantine transport and authorized image delivery integrated with the existing single-attempt processing and exact-version attachment contracts, using synthetic images and explicit uncertainty recovery. KES10,000 remains the total recurring realtor client price baseline.
