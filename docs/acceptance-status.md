# Replacement acceptance status and defect/retest index

Updated 2026-10-30. All 24 substantive vendor findings plus reserved R-001 and all 35 replacement acceptance cases are linked below. This is maintained traceability, **not release acceptance**. No legacy PASS is imported as a replacement PASS.

Case states deliberately distinguish partial evidence, not run, deferred and the reserved header. Every unresolved case has a named gap and next action. Test counts overlap and must not be added into a platform completion figure.

## Execution records

| ID | Evidence at source commit | Actual scope |
| --- | --- | --- |
| domain223 | [evidence/2026-10-30-listing-reports/domain-full.txt](evidence/2026-10-30-listing-reports/domain-full.txt) · 6b8569b | 306 passed; Windows / Full report-era domain regression |
| api223 | [evidence/2026-10-30-listing-reports/api-full.txt](evidence/2026-10-30-listing-reports/api-full.txt) · 6b8569b | 312 passed; Windows / Full report-era API/restricted SQL regression; runtime unchanged since proof |
| sdk223 | [evidence/2026-10-30-listing-reports/sdk-full-final.txt](evidence/2026-10-30-listing-reports/sdk-full-final.txt) · 6b8569b | 307 passed; Windows / Full SDK transport regression with report tests included |
| web223 | [evidence/2026-10-30-listing-reports/web-full-final.txt](evidence/2026-10-30-listing-reports/web-full-final.txt) · 6b8569b | 114 passed; Windows / Full web boundary/config/render regression |
| admin223 | [evidence/2026-10-30-listing-reports/admin-full-final.txt](evidence/2026-10-30-listing-reports/admin-full-final.txt) · 6b8569b | 448 + 34 passed; Windows / Full admin boundary and existing rendering regression |
| signedReport223 | [evidence/2026-10-30-listing-reports/signed-http-lost-results.txt](evidence/2026-10-30-listing-reports/signed-http-lost-results.txt) · 6b8569b | 3 passed; Windows / Actual signed loopback HTTP/restricted SQL capture/review and committed-reply original recovery |
| reportBff223 | [evidence/2026-10-30-listing-reports/admin-boundaries-final.txt](evidence/2026-10-30-listing-reports/admin-boundaries-final.txt) · 6b8569b | 3 passed; Windows / Admin BFF current server identity, malformed writes, uncertainty and original GET |
| reportRender223 | [evidence/2026-10-30-listing-reports/admin-report-render.txt](evidence/2026-10-30-listing-reports/admin-report-render.txt) · 6b8569b | 1 passed; Windows / Initial report SSR labels/disclosure; browser interaction verified separately |
| webBuild223 | [evidence/2026-10-30-listing-reports/web-build-final.txt](evidence/2026-10-30-listing-reports/web-build-final.txt) · 6b8569b | Windows / Complete one-worker web production build including TypeScript |
| adminBuild223 | [evidence/2026-10-30-listing-reports/admin-build-final.txt](evidence/2026-10-30-listing-reports/admin-build-final.txt) · 6b8569b | Windows / Complete one-worker admin production build including TypeScript |
| sqlFailed223 | [evidence/2026-10-30-listing-reports/sql-full-final.txt](evidence/2026-10-30-listing-reports/sql-full-final.txt) · 6b8569b | Windows / RETAINED FAILED full run:363passed/1 stale expected-table inventory failed; no skip, corrected separately; not364/364 |
| sqlInventory223 | [evidence/2026-10-30-listing-reports/sql-inventory-corrected.txt](evidence/2026-10-30-listing-reports/sql-inventory-corrected.txt) · 6b8569b | 1 passed; Windows / Corrected exact table/forced-RLS inventory; no runtime SQL change |
| authInventory223 | [evidence/2026-10-30-listing-reports/authorization-inventory.txt](evidence/2026-10-30-listing-reports/authorization-inventory.txt) · 6b8569b | 1 passed; Windows / All installed default private tables/definers and three restricted role privilege fences |
| authApi223 | [evidence/2026-10-30-listing-reports/authorization-api.txt](evidence/2026-10-30-listing-reports/authorization-api.txt) · 6b8569b | 20 passed; Windows / Actual ephemeral RS256/JWKS and HTTP boundary negatives; no provider integration |
| authRoles223 | [evidence/2026-10-30-listing-reports/authorization-role-tenants.txt](evidence/2026-10-30-listing-reports/authorization-role-tenants.txt) · 6b8569b | 26 passed; Windows / Two synthetic companies actual API/restricted SQL role/ownership/projection and pool rollback checks |
| authStorage223 | [evidence/2026-10-30-listing-reports/authorization-storage.txt](evidence/2026-10-30-listing-reports/authorization-storage.txt) · 6b8569b | 47 passed; Windows / Owned filesystem local/durable storage, forged upload authority, links and cleanup refusal |
| browserReport223 | [evidence/2026-10-30-listing-reports.md](evidence/2026-10-30-listing-reports.md) · 6b8569b | Actual synthetic public/admin browser capture/review,320px/public unchanged and both lost-reply GET recoveries; no external messages |
| authorizationReview223 | [evidence/2026-10-30-authorization-review.md](evidence/2026-10-30-authorization-review.md) · 6b8569b | Local API/storage authorization review with source fingerprints and explicit production/provider/device limits |
| apiLab222 | [evidence/2026-10-29-performance/api-final.json](evidence/2026-10-29-performance/api-final.json) · aa41497 | Windows /actual1000-listing two-company PGlite/HTTP lab,48 timed reads/4 clients plus12 probes; metadata only, no sustainable/hosted/device capacity claim |
| webLabFailed222 | [evidence/2026-10-29-performance/web-initial.json](evidence/2026-10-29-performance/web-initial.json) · aa41497 | Windows /retained FAILED first cold web deadline while another DB test ran; no pass inferred; incomplete local probe instrumentation corrected later |
| webLab222 | [evidence/2026-10-29-performance/web-complete.json](evidence/2026-10-29-performance/web-complete.json) · aa41497 | Windows /current production DEMO web cold/warm headers, HTML and initial local JS gzip; no connected production DB/field vitals/CDN/device claim |
| keyboard222 | [evidence/2026-10-29-public-keyboard.md](evidence/2026-10-29-public-keyboard.md) · aa41497 | Actual browser /320/390/1280 reflow, focus targets,13 Tab sequence, keyboard form/gallery/navigation; bounded browser work, not full assistive technology/device audit |
| web222 | [evidence/2026-10-29-public-keyboard/web-tests-complete.txt](evidence/2026-10-29-public-keyboard/web-tests-complete.txt) · aa41497 | 109 passed; Windows /final complete109 web checks and test compilation after native fragment focus correction; earlier109 runs overlap |
| webBuild222 | [evidence/2026-10-29-public-keyboard/web-build-complete.txt](evidence/2026-10-29-public-keyboard/web-build-complete.txt) · aa41497 | Windows /final one-worker complete Next16.4.2 production build including TypeScript; no hosted/actual device pass |
| preservation221 | [evidence/2026-10-29-preservation/verification.json](evidence/2026-10-29-preservation/verification.json) · 895a955 | Windows /2254 original file byte hashes and four read-only archive checksums/inventory reconciled; preservation only, no original/vendor UAT result imported as an application pass |
| domain220 | [evidence/2026-10-29-company-settings/domain-full-final.txt](evidence/2026-10-29-company-settings/domain-full-final.txt) · d532848 | 302 passed; Windows / full shared domain contracts including exact company settings and duplicate-key JSON; no provider/device proof |
| api220 | [evidence/2026-10-29-company-settings/api-full.txt](evidence/2026-10-29-company-settings/api-full.txt) · c17256f | 307 passed; Windows / retained full current API run; settings service source unchanged by later admin-only reconciliation/status correction |
| database220 | [evidence/2026-10-29-company-settings/database-full.txt](evidence/2026-10-29-company-settings/database-full.txt) · c17256f | 357 passed; Windows / full default restricted PGlite schema including immutable approved settings/current roles/tenant/original recovery; no hosted concurrent PostgreSQL proof |
| admin220 | [evidence/2026-10-29-company-settings/admin-full-final.txt](evidence/2026-10-29-company-settings/admin-full-final.txt) · d532848 | 445 + 34 passed; Windows / complete admin logic/BFF and SSR UI suites after final pending-state/status correction; no production identity or device pass |
| web220 | [evidence/2026-10-29-company-settings/web-full.txt](evidence/2026-10-29-company-settings/web-full.txt) · c17256f | 109 passed; Windows / full web contract/SSR/transport suite including configured-company anonymous settings read; web source unchanged afterward |
| signed220 | [evidence/2026-10-29-company-settings/signed-final.txt](evidence/2026-10-29-company-settings/signed-final.txt) · c17256f | 3 passed; Windows / real ephemeral RS256 HTTP and restricted SQL / approval, original replay after deliberately lost reply, public projection and agent denial |
| browser220 | [evidence/2026-10-29-company-settings.md](evidence/2026-10-29-company-settings.md) · d532848 | Windows / actual synthetic settings editor, four approvals, lost-result recovery, cross-tab version conflict/rebase/adoption, keyboard/320px and anonymous public readback; extra stale-instance browser check not run |
| builds220 | [evidence/2026-10-29-company-settings/verification-summary.json](evidence/2026-10-29-company-settings/verification-summary.json) · d532848 | Windows / all workspace typechecks, full current admin/web production builds with one worker, exact executed counts and teardown limits; no hosted Actions/device/release proof |
| ci219 | [evidence/2026-10-29-ci-efficiency/local-planner-final.txt](evidence/2026-10-29-ci-efficiency/local-planner-final.txt) · 84067fe | 8 passed; Windows / local dependency-free CI planner with real disposable Git ranges; no hosted Actions run, account/budget change or application acceptance |
| design218 | [evidence/2026-10-29-connected-design.md](evidence/2026-10-29-connected-design.md) · 8d3fa7f | Windows / in-app browser /16 prototype screens at1280/320px,390px public and critical in-memory recovery/decision flows; design-only, no backend/device/operator acceptance |
| api217 | [evidence/2026-10-29-public-gallery/api-full.txt](evidence/2026-10-29-public-gallery/api-full.txt) · 0951abc | 307 passed; Windows / full current API, public anonymous sealed-image boundary and retained draft/reviewer authorization; SQL/adapters plus doubles |
| database217 | [evidence/2026-10-29-public-gallery/database-full.txt](evidence/2026-10-29-public-gallery/database-full.txt) · 0951abc | 353 passed; Windows / full default-schema restricted PGlite including public-current publication/freshness/provenance and role checks; no hosted concurrent sessions |
| web217 | [evidence/2026-10-29-public-gallery/web-full-final.txt](evidence/2026-10-29-public-gallery/web-full-final.txt) · 0951abc | 107 passed; Windows / compiled web models, SSR markup and bounded anonymous proxy transport tests; physical devices not exercised |
| signed217 | [evidence/2026-10-29-public-gallery/signed-http-full.txt](evidence/2026-10-29-public-gallery/signed-http-full.txt) · 0951abc | 96 passed; Windows / complete signed loopback HTTP and restricted SQL; actual four-image native upload/codec/approval/anonymous decode/pause journey included |
| browser217 | [evidence/2026-10-29-public-gallery.md](evidence/2026-10-29-public-gallery.md) · 0951abc | Windows / actual public Next/native browser gallery, keyboard pause/error/refresh/resume, four decoded images, exact fees and320/390px layout/area privacy; no real device/operator/full accessibility audit |
| media216 | [evidence/2026-10-28-live-media-retirement/media-full-final.txt](evidence/2026-10-28-live-media-retirement/media-full-final.txt) · 1a2e18e | 207 passed; Windows / actual supervisor, codec, restricted SQL and filesystem plus contract doubles; live same-instance retirement, synthetic historical expiry fixtures, not production retention |
| signed216 | [evidence/2026-10-28-live-media-retirement/signed-http-full-final.txt](evidence/2026-10-28-live-media-retirement/signed-http-full-final.txt) · 1a2e18e | 95 passed; Windows / complete current signed loopback HTTP, restricted SQL and actual native image boundaries; synthetic tenants only |
| admin216 | [evidence/2026-10-28-live-media-retirement/admin-tests-final.txt](evidence/2026-10-28-live-media-retirement/admin-tests-final.txt) · 1a2e18e | 441 + 33 passed; Windows / compiled admin boundaries and SSR plus actual held-loopback transport cancellation; no device acceptance |
| browser216 | [evidence/2026-10-28-live-media-retirement.md](evidence/2026-10-28-live-media-retirement.md) · 1a2e18e | Windows / actual synthetic native-backed admin browser cancellation, corrupt input, 0/3 refusal, 4/12 decoded gallery, 12 submission and narrow keyboard checks; thirteenth API refusal separate, no physical device |
| media215 | [evidence/2026-10-28-expired-media-cleanup/media-full-current.txt](evidence/2026-10-28-expired-media-cleanup/media-full-current.txt) · 0595a6f | 205 passed; Windows / full media suite, actual native codec/supervisor, restricted SQL and owned-filesystem expiry plus contract doubles; offline foundation, not a running sweeper |
| database215 | [evidence/2026-10-28-expired-media-cleanup/database-full-corrected.txt](evidence/2026-10-28-expired-media-cleanup/database-full-corrected.txt) · 0595a6f | 350 passed; Windows / complete corrected default-schema restricted PGlite regression including forced-RLS and separate exact processing/maintenance grants; no hosted PostgreSQL race claim |
| calendar214 | [evidence/2026-10-28-viewing-calendar.md](evidence/2026-10-28-viewing-calendar.md) · 842f493 | Windows / actual synthetic browser request/calendar/confirmation/cancellation/history/reassignment and capture-only uncertainty recovery; no external delivery or device acceptance |
| signed214 | [evidence/2026-10-28-viewing-calendar/signed-http-full-current.txt](evidence/2026-10-28-viewing-calendar/signed-http-full-current.txt) · 842f493 | 90 passed; Windows / actual loopback signed HTTP and restricted PGlite, two synthetic companies; full current dev suite |
| admin214 | [evidence/2026-10-28-viewing-calendar/admin-tests.txt](evidence/2026-10-28-viewing-calendar/admin-tests.txt) · 842f493 | 437 + 33 passed; Windows / compiled admin boundaries and SSR UI checks including calendar/date/navigation semantics |
| api212 | [evidence/2026-10-28-operations-overview/api-full.txt](evidence/2026-10-28-operations-overview/api-full.txt) · 86cf7ed | 297 passed; Windows / Node24 / restricted PGlite and API boundary tests; synthetic actors |
| sdk212 | [evidence/2026-10-28-operations-overview/sdk-full.txt](evidence/2026-10-28-operations-overview/sdk-full.txt) · 86cf7ed | 300 passed; Windows / Node24 / client transport and validation tests; synthetic actors |
| domain212 | [evidence/2026-10-28-operations-overview/domain-full.txt](evidence/2026-10-28-operations-overview/domain-full.txt) · 86cf7ed | 296 passed; Windows / Node24 / pure domain contract tests |
| admin212 | [evidence/2026-10-28-operations-overview/admin-tests-fixed.txt](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt) · 86cf7ed | 437 + 30 passed; Windows / Node24 / compiled Next server boundaries and SSR UI checks |
| signed212 | [evidence/2026-10-28-operations-overview/signed-http-full.txt](evidence/2026-10-28-operations-overview/signed-http-full.txt) · 86cf7ed | 89 passed; Windows / Node24 / actual loopback HTTP, ephemeral signed identities and restricted PGlite; two synthetic companies |
| media213 | [evidence/2026-10-28-upload-acceptance/media-full.txt](evidence/2026-10-28-upload-acceptance/media-full.txt) · 86cf7ed | 194 passed; Windows / Node24 / actual supervised native codec and restricted PGlite plus contract doubles; synthetic bytes only |
| search210 | [evidence/2026-10-28-search-and-enquiry-acceptance.md](evidence/2026-10-28-search-and-enquiry-acceptance.md) · 45c9621 | Windows / in-app browser / current local synthetic Next web and admin journeys, keyboard and narrow viewport; no physical devices |
| mobile211 | [evidence/2026-10-28-mobile-offline.md](evidence/2026-10-28-mobile-offline.md) · 9aedc88 | Windows / mobile controller tests and Android Hermes export; no installed device test |
| operations212 | [evidence/2026-10-28-operations-overview.md](evidence/2026-10-28-operations-overview.md) · 86cf7ed | Windows / in-app browser / current admin overview actions, narrow keyboard layout and foreign-record denial |
| backup212 | [evidence/2026-10-28-operations-overview/publication.json](evidence/2026-10-28-operations-overview/publication.json) · 86cf7ed | Windows / complete source-history bundle / fresh clean clone and fsck; same device only, no production data restore |

## Requirements, cases and open gaps

### AC-001 — traceability

**R-001 · reserved · reserved correction**

Expected: Exactly 24 substantive rows; R-001 marked reserved, every substantive row has case/evidence linkage; no claim of 25 real defects
Observed: Header artefact reconciled to 24 substantive original findings; stable R IDs preserved.
Evidence: No product execution pass attached.
Still open: No product defect or product test pass is attached to the reserved header ID.
Next: Retain the correction and validate the original report when changing mappings. Owner: Boniface + Codex.

### AC-002 — role bypass

**R-002 · partial · GAP-AC-002**
Original finding: Regular role can create listings.
Expected: Protected data withheld; 401/403 as appropriate; no listing/object/job created. Assigned agent/admin permitted
Observed: Current signed customer, revoked and foreign actor denials; server-owned staff access and guarded listing commands.
Evidence: [api212](evidence/2026-10-28-operations-overview/api-full.txt), [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt), [authorizationReview223](evidence/2026-10-30-authorization-review.md), [authInventory223](evidence/2026-10-30-listing-reports/authorization-inventory.txt), [authRoles223](evidence/2026-10-30-listing-reports/authorization-role-tenants.txt), [authStorage223](evidence/2026-10-30-listing-reports/authorization-storage.txt)
Still open: Production identity, native route bypass and deployed storage permissions still require verification.
Next: Complete the real identity/browser/native denial matrix on the release candidate. Owner: Boniface + Codex.

### AC-003 — owner/tenant denial

**R-003 · partial · GAP-AC-003**
Original finding: Cross-account owner edit accepted.
Expected: Requests denied, unchanged records/media. Server derives actor; only authorized admin reassignment succeeds; all queries/exports/subscriptions scoped
Observed: Current company/assignment checks, exact operation recovery and raw viewing-table denial.
Evidence: [api212](evidence/2026-10-28-operations-overview/api-full.txt), [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt), [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt), [media213](evidence/2026-10-28-upload-acceptance/media-full.txt), [authorizationReview223](evidence/2026-10-30-authorization-review.md), [authInventory223](evidence/2026-10-30-listing-reports/authorization-inventory.txt), [authRoles223](evidence/2026-10-30-listing-reports/authorization-role-tenants.txt), [authStorage223](evidence/2026-10-30-listing-reports/authorization-storage.txt)
Still open: Exports, subscriptions and full production pooled/storage isolation are not accepted.
Next: Implement and test scoped export/session/job paths, then rerun the complete two-company matrix. Owner: Boniface + Codex.

### AC-004 — logout/revoke

**R-004 · partial · GAP-AC-004**
Original finding: Logout leaves private owner view in another tab.
Expected: Private cards/reasons/drafts/subscriptions clear across tabs; requests denied after sign-out/revocation; no background repopulation
Observed: A current foreign enquiry read hides loaded private details; current membership revocation is denied at SQL/API.
Evidence: [operations212](evidence/2026-10-28-operations-overview.md), [api212](evidence/2026-10-28-operations-overview/api-full.txt)
Still open: Sign-out broadcast, two-tab private cache clearing, native expiry and subscription teardown are unimplemented or unverified.
Next: Implement provider-backed logout/expiry and verify two tabs plus native storage. Owner: Boniface + Codex.

### AC-005 — interruption/idempotency

**R-005 · partial · GAP-AC-005**
Original finding: Uploads stall without recovery.
Expected: Per-file error/retry, draft retained, accepted files reused, one listing result, no public partial revision; expired objects cleaned and audited
Observed: Actual browser Cancel at third upload preserved two photos and recovered the original confirmed stop. Live original-instance retirement/drain, exact authorized incomplete workspace cleanup, verified/reference protection and uncertainty guards passed locally.
Evidence: [media216](evidence/2026-10-28-live-media-retirement/media-full-final.txt), [signed216](evidence/2026-10-28-live-media-retirement/signed-http-full-final.txt), [admin216](evidence/2026-10-28-live-media-retirement/admin-tests-final.txt), [browser216](evidence/2026-10-28-live-media-retirement.md), [database215](evidence/2026-10-28-expired-media-cleanup/database-full-corrected.txt)
Still open: Production provider retention/schedule/alerts, hosted process isolation and actual Android/iOS/operator interruption journeys remain open.
Next: Verify staged provider lifecycle and actual devices; historical journals never grant new cleanup authority. Owner: Boniface + Codex.

### AC-006 — authentication UI

**R-006 · not_run · GAP-AC-006**
Original finding: Admin password visible by default.
Expected: Masked initially; named toggle/state; no secret logs or evidence capture
Observed: No replacement production password UI has been accepted.
Evidence: No product execution pass attached.
Still open: Provider login/reset/reveal UI and keyboard/screen-reader checks remain open.
Next: Choose the controlled identity integration and test only dummy passwords. Owner: Boniface + Codex.

### AC-007 — boot/recovery

**R-007 · partial · GAP-AC-007**
Original finding: Startup module failures.
Expected: No module/syntax errors in normal load; bounded loading, useful failure/retry and safe correlation reference, no endless blank page
Observed: Current web/admin routes and builds run; local API errors fail safely; mobile controller fallback and Android export pass.
Evidence: [search210](evidence/2026-10-28-search-and-enquiry-acceptance.md), [operations212](evidence/2026-10-28-operations-overview.md), [mobile211](evidence/2026-10-28-mobile-offline.md), [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt)
Still open: Cold native/deep-link/chunk-failure recovery across actual devices and a second browser remains unverified.
Next: Run the complete boot/deep-link/recovery matrix on the release applications. Owner: Boniface + Codex.

### AC-008 — amount validation

**R-008 · partial · GAP-AC-008**
Original finding: Edit bypasses minimum sale price.
Expected: Same rule everywhere; positive safe-integer minor units accepted within ceiling; invalid numbers/zero rejected; rent period required, sale null; no historical arbitrary floor
Observed: Positive exact minor-unit, purpose/period and client/server validation have executed coverage.
Evidence: [domain212](evidence/2026-10-28-operations-overview/domain-full.txt), [api212](evidence/2026-10-28-operations-overview/api-full.txt), [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt)
Still open: The full normalized import and every create/edit/UI/direct-bypass combination has not been accepted.
Next: Complete ordinary normalized catalogue/import then execute every boundary entry point. Owner: Boniface + Codex.

### AC-009 — price matching

**R-009 · partial · GAP-AC-009**
Original finding: Strict Over bands include threshold.
Expected: Closed min/max include exact boundary; Over excludes equal, includes +1 minor unit; invalid range rejected; period segregated
Observed: Actual browser and SQL/API strict Over, inclusive endpoints and one-cent rental/sale neighbours verified.
Evidence: [search210](evidence/2026-10-28-search-and-enquiry-acceptance.md), [api212](evidence/2026-10-28-operations-overview/api-full.txt), [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt)
Still open: Native UI/device and final deployed catalogue range acceptance remain open.
Next: Repeat the same boundary triplets on native devices and release deployment. Owner: Boniface + Codex.

### AC-010 — navigation

**R-010 · partial · GAP-AC-010**
Original finding: Selected filters disagree with results after navigation.
Expected: URL, controls, counts, pagination and result predicates agree; no stale selected chips over unfiltered result
Observed: Actual web filters/pages/detail-back/refresh/reset preserved; mobile saved-filter and race handling tests passed.
Evidence: [search210](evidence/2026-10-28-search-and-enquiry-acceptance.md), [mobile211](evidence/2026-10-28-mobile-offline.md)
Still open: Actual native force-quit/relaunch, company switch and device back behavior remain unverified.
Next: Run persisted native filter restart/clear/back checks on an available device. Owner: Boniface + Codex.

### AC-011 — exact display

**R-011 · partial · GAP-AC-011**
Original finding: Exact prices hidden by card rounding.
Expected: Distinct exact localized prices and currency/period; abbreviated price never sole comparison label
Observed: Exact web/admin KES and period presentation observed, including connected public base/recurring/deposit/initial figures at320px; domain money rules tested.
Evidence: [search210](evidence/2026-10-28-search-and-enquiry-acceptance.md), [operations212](evidence/2026-10-28-operations-overview.md), [domain212](evidence/2026-10-28-operations-overview/domain-full.txt), [browser217](evidence/2026-10-29-public-gallery.md), [web217](evidence/2026-10-29-public-gallery/web-full-final.txt)
Still open: Favourites and actual mobile exact-price presentation are incomplete or unverified.
Next: Build favourites and verify the neighbouring prices in every listed surface. Owner: Boniface + Codex.

### AC-012 — charges

**R-012 · partial · GAP-AC-012**
Original finding: Extra charges and totals are unclear.
Expected: Sale known1,001,499; rent recurring21,000 and initial41,500 with deposit separated. Blank rows rejected; unknown mandatory fee prevents all-in claim. V2 preserves explicit quote-required null amounts and undeclared/incomplete coverage through shared rules, SQL snapshots and API/client; verify the rendered journey separately
Observed: Exact fee/period/quote-required contract, submitted review and connected public named fees/deposit/initial subtotals are verified locally, including320px disclosure.
Evidence: [domain212](evidence/2026-10-28-operations-overview/domain-full.txt), [api217](evidence/2026-10-29-public-gallery/api-full.txt), [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt), [operations212](evidence/2026-10-28-operations-overview.md), [browser217](evidence/2026-10-29-public-gallery.md), [web217](evidence/2026-10-29-public-gallery/web-full-final.txt)
Still open: Native full fee disclosure and normalized authoring/import acceptance remain open.
Next: Repeat all known/unknown fee cases through normalized authoring and actual native devices. Owner: Boniface + Codex.

### AC-013 — canonical labels

**R-013 · partial · GAP-AC-013**
Original finding: Type/purpose columns use wrong values.
Expected: Purpose and type retain correct distinct values/labels; unknown source quarantined; shared vocabulary has no accidental substitution
Observed: Canonical types/purpose and synthetic public/ordinary staff data are validated.
Evidence: [domain212](evidence/2026-10-28-operations-overview/domain-full.txt), [api212](evidence/2026-10-28-operations-overview/api-full.txt), [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt), [search210](evidence/2026-10-28-search-and-enquiry-acceptance.md)
Still open: Ordinary normalized location/catalogue promotion and import unknown-type handling are not fully accepted.
Next: Complete normalized catalogue/default-path authoring and all-type import/display scenarios. Owner: Boniface + Codex.

### AC-014 — exact/grouped rooms

**R-014 · partial · GAP-AC-014**
Original finding: Bedroom and bathroom model loses detail.
Expected: Exact matches preserve detail;7+ contains7,8,9,10; unknown not0; private/shared distinct and numeric bathroom filter excludes unknown
Observed: Actual exact7/8/9/10 and7+ search, studio0 and distinct private/shared bathroom results verified.
Evidence: [search210](evidence/2026-10-28-search-and-enquiry-acceptance.md), [api212](evidence/2026-10-28-operations-overview/api-full.txt), [domain212](evidence/2026-10-28-operations-overview/domain-full.txt)
Still open: Native device controls and all create/edit/import routes still need the complete matrix.
Next: Verify retained numeric room data through normalized authoring/import and native journeys. Owner: Boniface + Codex.

### AC-015 — normalization

**R-015 · partial · GAP-AC-015**
Original finding: Phone normalization fails.
Expected: Equivalent Kenya numbers yield one E.164 value; invalid rejected with field error; no blind+254 duplication; labels do not imply ownership verification
Observed: Shared validation/normalization contracts have executed test coverage.
Evidence: [domain212](evidence/2026-10-28-operations-overview/domain-full.txt), [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt)
Still open: Real business contact ownership and actual call/WhatsApp handoff across devices are unverified.
Next: Verify the approved company destination and device handoff without sending unsolicited messages. Owner: Boniface + Codex.

### AC-016 — snapshot states

**R-016 · partial · GAP-AC-016**
Original finding: Moderation states mislead owners.
Expected: Pending never called live; rejected edit preserves old approved price/photos; pause excludes discovery; reason private; stale decision conflicts, state/history consistent
Observed: Guarded review/version rules and an actual deliberate rejection/readback/queue refresh observed.
Evidence: [api212](evidence/2026-10-28-operations-overview/api-full.txt), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt), [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt), [operations212](evidence/2026-10-28-operations-overview.md)
Still open: Full deployed image-backed operator decision matrix and real pooled races remain open.
Next: Repeat approved-snapshot/edit/rejection/pause/conflict journeys with verified image bytes in staging. Owner: Boniface + Codex.

### AC-017 — full viewing

**R-017 · partial · GAP-AC-017**
Original finding: Viewing/booking unavailable.
Expected: Durable ordered transitions, requested≠confirmed, cancelled reminders suppressed, old token invalid, delivery retry visible; no payment/booking ledger claim
Observed: Current authorized Nairobi calendar and fresh inspection links verified through reschedule, renewed phone agreement, cancellation, six retained states, unscheduled request/proposal and reassignment. Capture-only uncertainty recovers the original record without sending; external delivery is explicitly unavailable.
Evidence: [api212](evidence/2026-10-28-operations-overview/api-full.txt), [signed214](evidence/2026-10-28-viewing-calendar/signed-http-full-current.txt), [admin214](evidence/2026-10-28-viewing-calendar/admin-tests.txt), [calendar214](evidence/2026-10-28-viewing-calendar.md), [operations212](evidence/2026-10-28-operations-overview.md)
Still open: Outbound provider/consent/cadence/failure reconciliation and native/operator acceptance remain open; capture records are not delivered notifications.
Next: Integrate the controlled notification provider and verify failed/delayed/suppressed delivery with an approved test destination, then complete native/operator journeys. Owner: Boniface + Codex.

### AC-018 — image-count boundary

**R-018 · partial · GAP-AC-018**
Original finding: Minimum photo rule inconsistent.
Expected: Draft may save incomplete; submit4/12 succeeds,3/13 fails everywhere with matching text; cover/order preserved
Observed: Actual signed/native0/3/4/12/13 and duplicate-finalize checks passed. Browser0/3 submission refusal, four and twelve decoded images, disabled thirteenth selection and twelve-image pending confirmation observed.
Evidence: [media216](evidence/2026-10-28-live-media-retirement/media-full-final.txt), [signed217](evidence/2026-10-29-public-gallery/signed-http-full.txt), [admin216](evidence/2026-10-28-live-media-retirement/admin-tests-final.txt), [browser216](evidence/2026-10-28-live-media-retirement.md), [api217](evidence/2026-10-29-public-gallery/api-full.txt), [browser217](evidence/2026-10-29-public-gallery.md)
Still open: Actual native devices, hosted concurrent catalogue/gallery changes and operator acceptance remain open; no browser4-image submit in this run is claimed.
Next: Repeat the photo boundary/recovery matrix on release devices and staging; retain independent API thirteenth refusal. Owner: Boniface + Codex.

### AC-019 — hostile media

**R-019 · partial · GAP-AC-019**
Original finding: Invalid-image selection accepted.
Expected: Invalid rejected before publication with per-file error; safe derivatives re-encoded/metadata stripped; private media inaccessible cross-tenant
Observed: Actual codec format/metadata/corrupt/dimension/byte caps and upload recovery passed. Public bytes now require current approved/fresh publication and matching native seals before/after I/O; four actual anonymous WebPs decoded and pause denied later access.
Evidence: [media216](evidence/2026-10-28-live-media-retirement/media-full-final.txt), [signed217](evidence/2026-10-29-public-gallery/signed-http-full.txt), [admin216](evidence/2026-10-28-live-media-retirement/admin-tests-final.txt), [browser216](evidence/2026-10-28-live-media-retirement.md), [api217](evidence/2026-10-29-public-gallery/api-full.txt), [database217](evidence/2026-10-29-public-gallery/database-full.txt), [browser217](evidence/2026-10-29-public-gallery.md), [authorizationReview223](evidence/2026-10-30-authorization-review.md), [authInventory223](evidence/2026-10-30-listing-reports/authorization-inventory.txt), [authRoles223](evidence/2026-10-30-listing-reports/authorization-role-tenants.txt), [authStorage223](evidence/2026-10-30-listing-reports/authorization-storage.txt), [browserReport223](evidence/2026-10-30-listing-reports.md), [signedReport223](evidence/2026-10-30-listing-reports/signed-http-lost-results.txt)
Still open: Production object provider access and actual device interruption/oversized-selection matrix remain open.
Next: Verify deployed object isolation and complete invalid/oversized device selections with approved test bytes. Owner: Boniface + Codex.

### AC-020 — feedback author/content

**R-020 · not_run · GAP-AC-020**
Original finding: Blank signed-in feedback persisted.
Expected: Empty rejected and counter unchanged; auth/tenant/actor enforced; valid once, trimmed; report/enquiry separate guest flow remains usable
Observed: Guest enquiry validation is a separate implemented feature and is not signed-in feedback acceptance.
Evidence: No product execution pass attached.
Still open: Signed-in feedback author binding, blank refusal and counter behavior remain unimplemented or unverified.
Next: Implement scoped feedback if retained in launch scope and execute the separate acceptance case. Owner: Boniface + Codex.

### AC-021 — contact and triage

**R-021 · not_run · GAP-AC-021**
Original finding: Contact/reporting gaps.
Expected: Correct encoded HTTPS/tel destination and visible fallback; report durable/private/rate limited; accessible receipt and audit resolution
Observed: No claim of verified call/WhatsApp ownership or an implemented fake-listing report/triage loop.
Evidence: No product execution pass attached.
Still open: Business contact handoff, durable report receipt and admin resolution remain open.
Next: Build and test a private rate-limited report/triage loop plus approved contact destinations. Owner: Boniface + Codex.

### AC-022 — deferred money module

**R-022 · deferred · GAP-AC-022**
Original finding: Commission taxonomy and currency differ.
Expected: No active payment/commission action or dollar earnings placeholder; intentional unavailable response; canonical KES/type contracts remain consistent. Ledger tests deferred, not passed
Observed: Payments, transaction booking and commission ledgers are intentionally outside the recorded pilot scope.
Evidence: No product execution pass attached.
Still open: No ledger/payment/commission functionality or nonzero transaction test is claimed.
Next: Retain truthful unavailable navigation and future acceptance criteria; obtain explicit scope change before implementing money flows. Owner: Boniface + Codex.

### AC-023 — operational queue

**R-023 · partial · GAP-AC-023**
Original finding: Admin modules blank.
Expected: Clear distinct states, useful actions and retry, tenant scope; no blank body; paid ads hidden/deferred
Observed: Operations empty/populated queues, current authorized actions and generic denial/unavailable states are implemented and locally observed.
Evidence: [operations212](evidence/2026-10-28-operations-overview.md), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt)
Still open: Report/support queue and complete unavailable-module navigation audit remain open.
Next: Build retained support/report workflows and verify their empty/loading/error/disabled states. Owner: Boniface + Codex.

### AC-024 — accessible journey

**R-024 · partial · GAP-AC-024**
Original finding: Keyboard and accessible controls incomplete.
Expected: Named controls, logical visible focus, operable chips/dialogs, labels and announced errors/progress; record WCAG2.2AA audit gaps and device evidence
Observed: Main/search/native approach focus corrected and observed;13-control keyboard sequence, form/gallery/navigation and320/390/1280 reflow complement connected boundary/gallery evidence.
Evidence: [keyboard222](evidence/2026-10-29-public-keyboard.md), [web222](evidence/2026-10-29-public-keyboard/web-tests-complete.txt), [search210](evidence/2026-10-28-search-and-enquiry-acceptance.md), [operations212](evidence/2026-10-28-operations-overview.md), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt), [mobile211](evidence/2026-10-28-mobile-offline.md), [browser217](evidence/2026-10-29-public-gallery.md), [web217](evidence/2026-10-29-public-gallery/web-full-final.txt)
Still open: No complete WCAG2.2AA, assistive-technology, 320px/200% text or Android/iOS process audit has passed.
Next: Run and remediate the complete accessibility/browser/device matrix. Owner: Boniface + Codex.

### AC-025 — finished policies

**R-025 · not_run · GAP-AC-025**
Original finding: Terms contain unfinished copy.
Expected: Reviewed company-specific text, correct contacts/links/version; no placeholders/editorial tails; release blocked until reviewer recorded
Observed: Company policy approval is not inferred from a configured text or notice-version field.
Evidence: No product execution pass attached.
Still open: Reviewed finished company-specific policies, contacts and accountable reviewer remain open.
Next: Obtain approved policy content and verify every page/link/form notice version. Owner: Boniface + Codex.

### AC-026 — enquiry durability and abuse

**Additional replacement gate · partial · GAP-AC-026**

Expected: Guest sends without account; valid channel and nonblank message required. Repeated idempotency key yields one record; retry after lost response works. Limit breach returns429/retry time, no secret/PII leakage. No false delivery-success claim
Observed: Guest/staff enquiry validation, idempotency/recovery, denial and rate-control suites pass locally.
Evidence: [api212](evidence/2026-10-28-operations-overview/api-full.txt), [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt), [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt)
Still open: Production distributed abuse control and hosted durable delivery/operator acceptance remain open.
Next: Verify the configured distributed rate provider and persistent staging enquiry receipt under lost responses. Owner: Boniface + Codex.

### AC-027 — lead state and assignment

**Additional replacement gate · partial · GAP-AC-027**

Expected: Agent sees assigned only; admin reassigns to active tenant member; inactive/cross-company assignment rejected. Active post-contact lead has next action; close/reopen reason/history retained. Closed_won does not create payment
Observed: Actual assignment, contact, follow-up reschedule/closure and role-limited queue journeys verified.
Evidence: [search210](evidence/2026-10-28-search-and-enquiry-acceptance.md), [api212](evidence/2026-10-28-operations-overview/api-full.txt), [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt)
Still open: Production identity/persistence, operator review and native journeys remain open.
Next: Repeat assignment/history/closure on the release candidate with a Realtime operator. Owner: Boniface + Codex.

### AC-028 — brand reproduction

**Additional replacement gate · partial · GAP-AC-028**

Expected: Onboard synthetic second agency via validated configuration; company logo/colors/domains/contact/policies render across web/mobile/admin. No code fork or A content/contact/cache/storage/notification appearing in B
Observed: Two synthetic company contexts and shared configuration are exercised; no code fork required.
Evidence: [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt), [mobile211](evidence/2026-10-28-mobile-offline.md)
Still open: Full web/mobile/admin identity/contact/storage/cache/notification second-brand acceptance remains open.
Next: Run the entire configured second-brand flow including notifications and device storage separation. Owner: Boniface + Codex.

### AC-029 — availability freshness

**Additional replacement gate · partial · GAP-AC-029**

Expected: Advance clock around21/30days; prompt correctly, exclude stale at cutoff, reconfirm restores only eligible approved available stock. Pause/unavailable/archive precedence preserved
Observed: Availability guards,720-hour stale queue and public image SQL eligibility distinguish fresh/paused/stale/foreign stock. Actual browser pause removes newly requested bytes/public page; resume restores four decoded images.
Evidence: [domain212](evidence/2026-10-28-operations-overview/domain-full.txt), [api217](evidence/2026-10-29-public-gallery/api-full.txt), [signed217](evidence/2026-10-29-public-gallery/signed-http-full.txt), [operations212](evidence/2026-10-28-operations-overview.md), [database217](evidence/2026-10-29-public-gallery/database-full.txt), [browser217](evidence/2026-10-29-public-gallery.md)
Still open: The complete21/30-day prompt/public exclusion/reconfirmation matrix on deployed applications remains open.
Next: Verify exact cutoff neighbours and restoration/pause/archive precedence in current UI and staging. Owner: Boniface + Codex.

### AC-030 — privacy lifecycle

**Additional replacement gate · partial · GAP-AC-030**

Expected: Only public projection exposed; admin-only audited export; retention dry-run reviewed; deletion covers active/derived data and restore re-deletion. Logs contain no passwords/tokens/message body; reviewed hold prevents accidental deletion
Observed: Private/public projection and current role restrictions have bounded executed evidence.
Evidence: [api212](evidence/2026-10-28-operations-overview/api-full.txt), [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt), [media213](evidence/2026-10-28-upload-acceptance/media-full.txt), [authorizationReview223](evidence/2026-10-30-authorization-review.md), [authInventory223](evidence/2026-10-30-listing-reports/authorization-inventory.txt), [authRoles223](evidence/2026-10-30-listing-reports/authorization-role-tenants.txt), [authStorage223](evidence/2026-10-30-listing-reports/authorization-storage.txt)
Still open: Audited export, retention dry-run/holds, deletion and restore re-deletion are incomplete.
Next: Implement scoped lifecycle/export controls and execute reviewed dry-run plus restore re-deletion. Owner: Boniface + Codex.

### AC-031 — migration reconciliation

**Additional replacement gate · not_run · GAP-AC-031**

Expected: Authorized staging import twice produces no duplicates; unknown/invalid quarantined; no UAT fixtures/plaintext credentials. Counts/checksums/mappings reconciled; unpublished stock requires confirmation; rollback restores known state
Observed: A read-only synthetic import preview does not establish a staged migration.
Evidence: No product execution pass attached.
Still open: Authorized source export, durable idempotent import, checksum/count reconciliation and rollback remain open.
Next: Resolve source rights/account access and perform an isolated approved staging rehearsal. Owner: Boniface + Codex.

### AC-032 — restore and failure recovery

**Additional replacement gate · partial · GAP-AC-032**

Expected: Restore database plus media/config into isolated environment from independent backup; verify scoped records, image access and policy versions; record recovery duration/data-loss point against agreed RTO/RPO
Observed: Same-device source bundle, fresh clean clone and fsck passed for checkpoint212; source history only.
Evidence: [backup212](evidence/2026-10-28-operations-overview/publication.json)
Still open: Independent database/media/config restore, agreed recovery targets and recovery timing remain open.
Next: Create an approved independent backup and restore the complete staged platform into isolation. Owner: Boniface + Codex.

### AC-033 — budget and operations

**Additional replacement gate · not_run · GAP-AC-033**

Expected: Meter per-company bytes/listings/emails/staff and cost; validate alerts70/85/100% and optional-cost throttle. KES10,000 ceiling is not asserted as measured cost or unlimited service
Observed: KES10,000 remains a planning/client price baseline, not measured cost or profit.
Evidence: No product execution pass attached.
Still open: Per-company metering,70/85/100% alerting and throttles remain unimplemented or unverified.
Next: Implement measured usage and test budget alerts without purchasing services. Owner: Boniface + Codex.

### AC-034 — public/private performance

**Additional replacement gate · partial · GAP-AC-034**

Expected: Profile realistic cold/warm listing/search and slow network media recovery; record mobile/desktop separately. Field CWV requires real traffic; proposed p75 LCP≤2.5s,INP≤200ms,CLS≤0.1 is a target, not current result
Observed: Actual1000-listing/two-company loopback lab measured48 reads/4 clients, p95=536.007ms; current production demo web warm p95 headers<=44.437ms. Original five-second cold failure retained; limits fixed before measurement.
Evidence: [apiLab222](evidence/2026-10-29-performance/api-final.json), [webLabFailed222](evidence/2026-10-29-performance/web-initial.json), [webLab222](evidence/2026-10-29-performance/web-complete.json)
Still open: Actual media/slow-network, private workload, hosted PostgreSQL/provider capacity and field Web Vitals remain unmeasured.
Next: Repeat the bounded lab in approved staging with actual media/private workloads and collect consented field metrics before a production capacity decision. Owner: Boniface + Codex.

### AC-035 — concurrency and integrity

**Additional replacement gate · partial · GAP-AC-035**

Expected: Race revisions/approval/reassignment/viewing updates; only matching version succeeds. No lost update, conflicting published snapshot, duplicate lead, orphan publicly accessible image or notification sent for rolled-back transaction
Observed: Exact-version commands, once-only attempts, stale/refusal/uncertainty and immutable-history guards execute locally.
Evidence: [api212](evidence/2026-10-28-operations-overview/api-full.txt), [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt), [media213](evidence/2026-10-28-upload-acceptance/media-full.txt), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt), [authorizationReview223](evidence/2026-10-30-authorization-review.md), [authInventory223](evidence/2026-10-30-listing-reports/authorization-inventory.txt), [authRoles223](evidence/2026-10-30-listing-reports/authorization-role-tenants.txt), [authStorage223](evidence/2026-10-30-listing-reports/authorization-storage.txt), [browserReport223](evidence/2026-10-30-listing-reports.md), [signedReport223](evidence/2026-10-30-listing-reports/signed-http-lost-results.txt)
Still open: True independent PostgreSQL connection races, crash recovery and production notification rollback remain open.
Next: Run independent pooled-session races and rollback/delivery integrity cases on approved staging. Owner: Boniface + Codex.

## Fixed defects and bounded retests

- **FIX-216-01** (AC-005, AC-030): Retired byte handler parsed route/identity before refusing new admission. Retest: [signed216](evidence/2026-10-28-live-media-retirement/signed-http-full-final.txt); retested_in_stated_environment. [Initial failure](evidence/2026-10-28-live-media-retirement/pipeline-focused.txt). Outer fence now refuses before body/identity/SQL; production hosting/retention remains open.
- **FIX-216-02** (AC-005, AC-019): Failed native conversion PUT described confirmed failure while original GET described processing. Retest: [signed216](evidence/2026-10-28-live-media-retirement/signed-http-full-final.txt); retested_in_stated_environment. [Initial failure](evidence/2026-10-28-live-media-retirement/native-photo-boundaries.txt). Matching retained failure facts are descriptive only; no new launch/deletion authority and no unknown-containment success.
- **FIX-210-01** (AC-010, AC-024): Invalid GeoJSON disabled the interactive Clear area control. Retest: [search210](evidence/2026-10-28-search-and-enquiry-acceptance.md); retested_in_stated_environment. Full device/assistive-technology acceptance remains open.
- **FIX-211-01** (AC-003, AC-009, AC-030): Ordinary property assignment dropped or reinterpreted an own __proto__ query key before validation. Retest: [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt); retested_in_stated_environment. No privilege compromise is asserted; production security matrix remains open.
- **FIX-212-01** (AC-002, AC-003): Initial overview implementation queried a viewing table denied to the runtime role. Retest: [api212](evidence/2026-10-28-operations-overview/api-full.txt); retested_in_stated_environment. [Initial failure](evidence/2026-10-28-operations-overview/initial-direct-read-denied.txt). Fixed through a narrow SQL function; raw-table denial retained. No wider grants added.
- **FIX-212-02** (AC-007): New admin imports lacked extensions required by the test compiler. Retest: [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt); retested_in_stated_environment. [Initial failure](evidence/2026-10-28-operations-overview/admin-tests.txt). Full native/startup/device acceptance remains open.

## Maintenance

Update the reviewed scope statements and source commits in `scripts/acceptance-status.mjs` only after inspecting executed results. Run `node scripts/acceptance-status.mjs --write`, then `node scripts/acceptance-status.mjs`. The check verifies exact original finding/case coverage, report hashes, declared pass counts, no skipped/failed cases in those named suites, source ancestry and retained failure/retest links. A suite pass never automatically closes an acceptance case or release gate. Preserve older raw evidence and state exactly what a new run changes.
