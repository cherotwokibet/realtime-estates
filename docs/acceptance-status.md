# Replacement acceptance status and defect/retest index

Updated 2026-11-03. All 24 substantive vendor findings plus reserved R-001 and all 35 replacement acceptance cases are linked below. This is maintained traceability, **not release acceptance**. No legacy PASS is imported as a replacement PASS.

Case states deliberately distinguish partial evidence, not run, deferred and the reserved header. Every unresolved case has a named gap and next action. Test counts overlap and must not be added into a platform completion figure.

## Execution records

| ID | Evidence at source commit | Actual scope |
| --- | --- | --- |
| videoDomain287 | [evidence/video287-domain-final.txt](evidence/video287-domain-final.txt) · 2741c50 | 349 passed; Full current domain; six new private-video validation/original/state checks overlap the full suite. |
| videoSdk287 | [evidence/video287-sdk-final.txt](evidence/video287-sdk-final.txt) · 2741c50 | 337 passed; Full current SDK unit suite; four new video snapshot/uncertainty/GET/no-store checks overlap. No automatic write retry. |
| videoApi287 | [evidence/video287-api-final.txt](evidence/video287-api-final.txt) · 2741c50 | 358 passed; Full current compiled API suite; three new default-off/context/input/response checks overlap. |
| videoSql287 | [evidence/video287-sql-final4.txt](evidence/video287-sql-final4.txt) · 2741c50 | 3 passed; Restricted synthetic private-video candidate SQL: exact replay/clear/stale denial, assignment/company/revocation, logical rollback, raw table denial, decided-revision/public preservation. No hosted races or durable host restart. |
| videoSigned287 | [evidence/video287-signed-final4.txt](evidence/video287-signed-final4.txt) · 2741c50 | 2 passed; Actual loopback signed HTTP/JWKS/SDK/restricted SQL: consumed committed reply/loss, explicit GET same original, deliberate replay/stale conflict/clear; invalid signature/unknown target/omitted mode refused. No application browser or provider request. |
| videoPreview287 | [evidence/video287-preview-final.txt](evidence/video287-preview-final.txt) · 2741c50 | 13 passed; Existing ordinary signed staff preview/session/protocol compatibility; no provider or new native device acceptance. |
| videoTypes287 | [evidence/video287-types-final.txt](evidence/video287-types-final.txt) · 2741c50 | All eight workspace typechecks on current shared exports and SDK/API changes. No new production Next build. |
| videoFormat287 | [evidence/video287-format-final.txt](evidence/video287-format-final.txt) · 2741c50 | Changed TypeScript/JavaScript formatting check passed; SQL proposal not handled by Prettier. |
| videoEvidence287 | [evidence/2026-11-03-private-listing-video.md](evidence/2026-11-03-private-listing-video.md) · 2741c50 | Connected default-off private-video preparation only. Author browser retention/BFF/UI, review/approved public/native display and floor-plan assets remain incomplete.06-4 and all gates stay open. |
| catalogueAudit284 | [evidence/2026-11-03-catalogue-implementation-acceptance.md](evidence/2026-11-03-catalogue-implementation-acceptance.md) · 38ae2a2 | Literal06-1 local synthetic implementation review. Complete listed data capabilities mapped to connected maintained paths and dated browser evidence. Only local build06-1 accepted; deployment controller/schema rollout, complete release cases and all14 gates remain open. No new application code or browser/device test. |
| catalogueBuild284 | [evidence/catalogue284-builds.txt](evidence/catalogue284-builds.txt) · 38ae2a2 | Fresh shared domain, SDK and API compilation. No new Next production build or provider deployment. |
| catalogueDomain284 | [evidence/catalogue284-domain.txt](evidence/catalogue284-domain.txt) · 38ae2a2 | 343 passed; Fresh full shared domain regression, including exact KES, catalogue hierarchy/amenity selection and complete property validation. Overlaps focused checks. |
| catalogueSdk284 | [evidence/catalogue284-sdk.txt](evidence/catalogue284-sdk.txt) · 38ae2a2 | 333 passed; Fresh full SDK unit regression; strict saved data and command/recovery contracts. Separate service composition listed independently. |
| catalogueApi284 | [evidence/catalogue284-api.txt](evidence/catalogue284-api.txt) · 38ae2a2 | 355 passed; Fresh full compiled API suite. Synthetic restricted fixtures; not hosted pool/concurrency evidence. |
| catalogueSql284 | [evidence/catalogue284-sql.txt](evidence/catalogue284-sql.txt) · 38ae2a2 | 73 passed; Seven reference SQL/admission files with current reviewed defaults through0037 and six opt-in proposals. Restricted PGlite, plus labelled query-adapter admission-policy checks. No installed deployment controller or hosted races. |
| catalogueComposition284 | [evidence/catalogue284-composition.txt](evidence/catalogue284-composition.txt) · 38ae2a2 | 34 passed; Four current reference combined-draft/moderation/creation/successor SDK/API service-integration files. Synthetic SQL originals, exact context, rollback and authority/recovery checks; not provider/native-device acceptance. |
| catalogueWeb284 | [evidence/catalogue284-web.txt](evidence/catalogue284-web.txt) · 38ae2a2 | 114 passed; Fresh full public web test compilation and model/contract suite. No fresh browser or full production build. |
| catalogueMobile284 | [evidence/catalogue284-mobile.txt](evidence/catalogue284-mobile.txt) · 38ae2a2 | 24 passed; Fresh full native model/preview suite and test compilation including shared web compile. No emulator, physical Android/iOS, export or operator test. |
| submissionAdmin281 | [evidence/submission281-admin-final5.txt](evidence/submission281-admin-final5.txt) · 435c49c | 515 + 42 passed; Full admin library/BFF/model515 and rendered42 regression on the connected author transition source. Counts overlap focused retention. |
| submissionReference281 | [evidence/submission281-reference-final3.txt](evidence/submission281-reference-final3.txt) · 435c49c | 16 passed; Signed reference composition group includes new author loader/client/BFF through real loopback HTTP/RS256/JWKS/PGlite. Lost committed withdrawal/original read/fresh resubmission and no-photo nonwrite refusal verified. |
| submissionRetention281 | [evidence/submission281-retention-final2.txt](evidence/submission281-retention-final2.txt) · 435c49c | 18 passed; Focused author/reviewer original storage tests;7 new author checks plus11 existing retention checks overlap full admin515. Includes reciprocal preparation locks and durable nonwrite refusal. |
| submissionBrowser281 | [evidence/2026-11-03-reference-submission.md](evidence/2026-11-03-reference-submission.md) · 435c49c | Actual assigned-agent Next/browser: pending withdrawal502, SAME original after reload, explicit recovery200/draft5, fresh submit200/pending6/unpublished; no-photo422 refusal survives reload and explicit acknowledgement, unchanged draft3;390px focus/wrapping. Synthetic metadata photos only. |
| submissionBuild281 | [evidence/submission281-next-final4.txt](evidence/submission281-next-final4.txt) · 435c49c | Current full admin production build including dynamic /drafts/[id]/[revision]/submission. No production/provider deployment or stage gate inferred. |
| catalogueBrowser278 | [evidence/2026-11-03-catalogue-workflow.md](evidence/2026-11-03-catalogue-workflow.md) · 32d08cf | Actual owned catalogue creation, complete property/reference review-revise-send, committed-reply loss/reload/same-original recovery and exact-price/current-ID readback; fixed fee form verified at390px. No submission/withdrawal UI, default-schema or production release acceptance. |
| catalogueRendered278 | [evidence/catalogue278-rendered-tests.txt](evidence/catalogue278-rendered-tests.txt) · 32d08cf | 39 passed; Current rendered admin UI/page regression after fee label/grid correction; test TypeScript compilation also passed. Not the full admin library suite or production build. |
| recipientDomain275 | [evidence/recipient275-domain.txt](evidence/recipient275-domain.txt) · d4e9b3c | 343 passed; Full shared domain including strict identity-only recipient session. No membership inferred from identity. |
| recipientSdk275 | [evidence/recipient275-sdk.txt](evidence/recipient275-sdk.txt) · d4e9b3c | 333 passed; Full SDK regression including bounded no-store recipient session read. |
| recipientAdmin275 | [evidence/recipient275-admin-final2.txt](evidence/recipient275-admin-final2.txt) · d4e9b3c | 504 + 39 passed; Full admin library/BFF/controller and rendered UI regression. No actual device/operator acceptance. |
| recipientApi275 | [evidence/recipient275-api.txt](evidence/recipient275-api.txt) · d4e9b3c | 355 passed; Full compiled API regression including signed nonmember recipient session without SQL grant. |
| recipientFocused275 | [evidence/recipient275-focused.txt](evidence/recipient275-focused.txt) · d4e9b3c | 22 passed; Combined22 focused checks comprise7 domain,7 SDK and8 HTTP; all overlap their full suites. |
| recipientConnected275 | [evidence/recipient275-connected-final2.txt](evidence/recipient275-connected-final2.txt) · d4e9b3c | 12 passed; 6 BFF plus3 retained-controller units overlap admin504;3 actual signed HTTP/JWKS/PGlite compositions prove grant, wrong recipient refusal, lost committed reply and replay after revocation without reactivation. |
| recipientPreview275 | [evidence/recipient275-preview.txt](evidence/recipient275-preview.txt) · d4e9b3c | 22 passed; Existing disposable preview and owned child lifecycle checks. Synthetic only. |
| recipientBrowser275 | [evidence/2026-11-02-invitation-recipient-acceptance.md](evidence/2026-11-02-invitation-recipient-acceptance.md) · d4e9b3c | Actual owned Next/browser: separate verified recipient, committed reply loss, GET-only recovery/reload, used state, admin revocation, existing inactive member refusal,390px wrapping/focus. No physical device/provider/hosted races or actual browser expiry pass. |
| recipientBuild275 | [evidence/recipient275-next-final.txt](evidence/recipient275-next-final.txt) · d4e9b3c | Current complete admin production build including recipient acceptance page and guarded session/operation routes; no production deployment. |
| staffIssueDomain272 | [evidence/staff-issue272-domain.txt](evidence/staff-issue272-domain.txt) · d21eb4d | 342 passed; Current shared domain, including issued/used current-state acceptance. No provider/device acceptance. |
| staffIssueSdk272 | [evidence/staff-issue272-sdk.txt](evidence/staff-issue272-sdk.txt) · d21eb4d | 332 passed; Current SDK regression with extended current-state validation; no new recipient UI proof. |
| staffIssueAdmin272 | [evidence/staff-issue272-admin-final.txt](evidence/staff-issue272-admin-final.txt) · d21eb4d | 495 + 38 passed; Full admin library/BFF/controller and SSR UI regressions, including8 focused issuance checks. Not actual device/operator acceptance. |
| staffIssueApi272 | [evidence/staff-issue272-api.txt](evidence/staff-issue272-api.txt) · d21eb4d | 353 passed; Full compiled API regression on the current isolated invitation SQL proposal. |
| staffIssueSql272 | [evidence/staff-issue272-sql.txt](evidence/staff-issue272-sql.txt) · d21eb4d | 33 passed; Five isolated staff SQL suites; includes current issued/used directory regression and unchanged historical capture. No hosted multi-session race proof. |
| staffIssueConnected272 | [evidence/staff-issue272-connected-final.txt](evidence/staff-issue272-connected-final.txt) · d21eb4d | 2 passed; Retained browser client/controller and BFF through SDK, signed loopback HTTP/JWKS and PGlite. Lost committed issuance recovery and known duplicate refusal; no recipient UI. |
| staffIssuePreview272 | [evidence/staff-issue272-preview.txt](evidence/staff-issue272-preview.txt) · d21eb4d | 17 passed; Three existing disposable preview regression suites. New issuance opt-in separately exercised by connected integration tests. |
| staffIssueBrowser272 | [evidence/2026-11-02-staff-invitation-issuance-ui.md](evidence/2026-11-02-staff-invitation-issuance-ui.md) · d21eb4d | Actual owned Next/browser: corrupt committed reply/original GET, navigation lock, permitted reload retains SAME issue, keyboard one-time reveal/discard,390px wrapping/focus and explicit revoke/current readback. No actual recipient acceptance, expiry or mid-request access-loss browser proof. |
| staffIssueBuild272 | [evidence/staff-issue272-next-final.txt](evidence/staff-issue272-next-final.txt) · d21eb4d | Current full admin production build including separately enabled issuance operation/state routes. No production deployment/provider release acceptance. |
| staffHttpDomain269 | [evidence/staff-http269-domain.txt](evidence/staff-http269-domain.txt) · 39d8e8e | 342 passed; Full shared domain regression including6 strict single-use invitation contract checks; no UI/device/provider acceptance. |
| staffHttpSdk269 | [evidence/staff-http269-sdk.txt](evidence/staff-http269-sdk.txt) · 39d8e8e | 332 passed; Full SDK regression including6 bounded private invitation transport checks; no automatic write retry or secret recovery. |
| staffHttpApi269 | [evidence/staff-http269-api.txt](evidence/staff-http269-api.txt) · 39d8e8e | 353 passed; Full compiled API regression including6 new signed HTTP checks and prior programmatic invitation checks. Actual local loopback HTTP/SDK/JWKS/PGlite, no production identity or hosted race acceptance. |
| staffHttpFocused269 | [evidence/staff-http269-focused.txt](evidence/staff-http269-focused.txt) · 39d8e8e | 6 passed; Focused signed synthetic invitation HTTP/SDK/actual SQL checks: connected grant, original recovery, lost disclosure, replay without reactivation, malformed input and rollback. Counts overlap the full API suite; no BFF/UI/device/operator acceptance. |
| staffRedemptionApi264 | [evidence/staff-redemption264-api-final.txt](evidence/staff-redemption264-api-final.txt) · ddaa4e4 | 347 passed; Full compiled API regression including6 signed synthetic invitation/actual SQL checks. Isolated programmatic candidate only; no HTTP/SDK/BFF/UI/provider or hosted multi-session acceptance. |
| staffRedemptionSql264 | [evidence/staff-redemption264-sql-final.txt](evidence/staff-redemption264-sql-final.txt) · ddaa4e4 | 32 passed; Five isolated staff SQL suites including9 single-use issuance/redemption checks; wall-clock negative control reproduced. No hosted concurrency/lock-wait/deadlock/race proof. |
| staffDecisionSql261 | [evidence/staff-lock261-sql.txt](evidence/staff-lock261-sql.txt) · 8e9355b | 23 passed; Four isolated staff SQL suites including real delayed-statement expiry/lifetime and single-session authority-loss injection. No hosted multi-session lock/deadlock/race, new API/browser/build or recipient redemption proof. |
| staffMembershipBrowser258 | [evidence/2026-11-02-staff-membership-browser.md](evidence/2026-11-02-staff-membership-browser.md) · 9f1516a | Actual owned Next/in-app browser: fresh versioned membership revocation, committed corrupt-reply GET recovery, reload retention, explicit reactivation/promotion, self-change absence and390px keyboard/wrapping. No mid-request admin access-loss, cross-instance recovery, physical device/operator or invitation redemption claim. |
| invitationSecurity254 | [evidence/staff-recipient254-final.txt](evidence/staff-recipient254-final.txt) · e5122c8 | 25 passed; Existing auth plus compiled one-reveal secret and signed synthetic verified-recipient primitives; no endpoint, SQL grant or provider activation. |
| staffDirectoryDomain251 | [evidence/staff-directory251-domain-full.txt](evidence/staff-directory251-domain-full.txt) · 85a1689 | 336 passed; Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof. |
| staffDirectorySql251 | [evidence/staff-directory251-sql.txt](evidence/staff-directory251-sql.txt) · 85a1689 | 7 passed; Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof. |
| staffDirectoryApi251 | [evidence/staff-directory251-api.txt](evidence/staff-directory251-api.txt) · 85a1689 | 9 passed; Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof. |
| staffDirectorySdk251 | [evidence/staff-directory251-sdk-full.txt](evidence/staff-directory251-sdk-full.txt) · 85a1689 | 326 passed; Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof. |
| staffDirectoryAdmin251 | [evidence/staff-directory251-admin-full.txt](evidence/staff-directory251-admin-full.txt) · 85a1689 | 487 passed; Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof. |
| staffDirectoryUi251 | [evidence/staff-directory251-ui-full.txt](evidence/staff-directory251-ui-full.txt) · 85a1689 | 38 passed; Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof. |
| staffDirectorySigned251 | [evidence/staff-directory251-integration-verified.txt](evidence/staff-directory251-integration-verified.txt) · 85a1689 | 8 passed; Local synthetic membership directory/workspace verification; named scope only, counts overlap. No new actual Next browser or production build proof. |
| staffDomain248 | [evidence/staff-membership248-domain-full.txt](evidence/staff-membership248-domain-full.txt) · 44e30ad | 333 passed; Full domain regression including existing-staff administration contracts |
| staffSql248 | [evidence/staff-membership248-sql-final.txt](evidence/staff-membership248-sql-final.txt) · 44e30ad | 5 passed; Restricted isolated SQL proposal with exact shared-contract outputs, current authorization, self/last-admin protection and immediate existing-resource denial; not hosted concurrency |
| staffApi248 | [evidence/staff-membership248-api-full.txt](evidence/staff-membership248-api-full.txt) · 44e30ad | 328 passed; Full API regression including default-off membership routes and actual restricted SQL rollback validation |
| staffSdk248 | [evidence/staff-membership248-sdk-full.txt](evidence/staff-membership248-sdk-full.txt) · 44e30ad | 323 passed; Full standard SDK regression including bounded membership writes/current/original and no automatic retry |
| staffSigned248 | [evidence/staff-membership248-signed.txt](evidence/staff-membership248-signed.txt) · 44e30ad | 14 passed; Signed JWT/JWKS HTTP and restricted SQL membership/branch/invitation regression, including committed reply corruption and GET-only recovery |
| staffAdmin248 | [evidence/staff-workspace248-admin-full.txt](evidence/staff-workspace248-admin-full.txt) · 44e30ad | 475 passed; Full admin server/model/controller regression after Next metadata and invitation selection fixes |
| staffUi248 | [evidence/staff-workspace248-ui-full.txt](evidence/staff-workspace248-ui-full.txt) · 44e30ad | 36 passed; Full admin SSR/model UI checks; actual browser scope recorded separately |
| staffBoundary248 | [evidence/staff-workspace248-focused.txt](evidence/staff-workspace248-focused.txt) · 44e30ad | 9 passed; Next Node loopback metadata and unavailable branch selection regression; no production proxy authority |
| staffPreview248 | [evidence/staff-preview248-lifecycle.txt](evidence/staff-preview248-lifecycle.txt) · 44e30ad | 5 passed; Owned child retirement and unconditional fixture shutdown using fakes; actual harness lifecycle separately observed |
| staffBrowser248 | [evidence/2026-11-02-staff-management.md](evidence/2026-11-02-staff-management.md) · 44e30ad | Actual owned Next/in-app browser branch/capture/revocation corrupted-reply GET recovery, reload retention, unavailable selection and separate agent denial; no membership UI or recipient redemption |
| invitationDomain225 | [evidence/staff-invitation-domain225.txt](evidence/staff-invitation-domain225.txt) · 3d67007 | 317 passed; Full domain regression including exact capture/state/revocation records and bounded parsing |
| invitationApi225 | [evidence/staff-invitation-api225-full.txt](evidence/staff-invitation-api225-full.txt) · 3d67007 | 318 passed; Full API regression after default-off non-production invitation routes; no provider or UI claim |
| invitationSdk225 | [evidence/staff-invitation-sdk225-full.txt](evidence/staff-invitation-sdk225-full.txt) · 3d67007 | 311 passed; Full SDK regression including explicit invitation methods and lost/malformed-write uncertainty |
| invitationApiWire225 | [evidence/staff-invitation-api225-final.txt](evidence/staff-invitation-api225-final.txt) · 3d67007 | 6 passed; Focused API boundaries plus actual SDK-to-service Request and restricted SQL; synthetic identity mapping, not signed HTTP |
| invitationSqlWire225 | [evidence/staff-invitation-sql225-initial.txt](evidence/staff-invitation-sql225-initial.txt) · 3d67007 | 7 passed; Isolated SQL candidate output bound to shared domain validators and C1 control refusal; first extended run passed |
| staffWorkspaceUi246 | [evidence/staff-workspace246-ui-full.txt](evidence/staff-workspace246-ui-full.txt) · e87a612 | 36 passed; Full admin SSR/model UI regression including staff workspace; not actual browser interaction |
| staffWorkspaceWire246 | [evidence/staff-workspace246-integration.txt](evidence/staff-workspace246-integration.txt) · e87a612 | 5 passed; Signed HTTP/restricted SQL BFF/browser adapter integration including fresh server loader session scope and agent/foreign refusal; no actual Next/browser HTTP claim |
| staffController245 | [evidence/staff-controller245-full.txt](evidence/staff-controller245-full.txt) · 85d084e | 470 passed; Full admin server/transport/model/controller regression; no mounted UI or actual browser proof |
| staffBrowser243 | [evidence/staff-browser243-full.txt](evidence/staff-browser243-full.txt) · 543a681 | 460 passed; Full admin server/transport regression including current-instance staff browser client; no actual browser UI proof |
| staffBrowserWire243 | [evidence/staff-browser243-integration.txt](evidence/staff-browser243-integration.txt) · 543a681 | 5 passed; Browser adapter function to BFF functions and SDK over signed JWT/JWKS HTTP/restricted SQL; no actual browser or Next HTTP claim |
| branchBff240 | [evidence/staff-branch-bff240-full.txt](evidence/staff-branch-bff240-full.txt) · 2182f01 | 454 passed; Full admin server regression after current-instance branch BFF command and shared identity guard |
| invitationBff241 | [evidence/staff-invitation-bff241-full.txt](evidence/staff-invitation-bff241-full.txt) · 2182f01 | 456 passed; Full admin server regression after invitation BFF and shared bounded command body parser |
| staffBffHttp241 | [evidence/staff-invitation-bff241-integration.txt](evidence/staff-invitation-bff241-integration.txt) · 2182f01 | 4 passed; BFF functions to SDK over signed JWT/JWKS HTTP and restricted SQL; branch/invitation committed corrupt replies recovered by GET only; no Next/browser HTTP proof |
| directoryBff238 | [evidence/staff-directory-bff238-full.txt](evidence/staff-directory-bff238-full.txt) · f8593ef | 452 passed; Full admin server regression including current-instance directory BFF; no UI/Next production build claim |
| directoryBff239 | [evidence/staff-directory-bff239-integration.txt](evidence/staff-directory-bff239-integration.txt) · f8593ef | 2 passed; Actual directory BFF function to shared SDK over signed local JWT/JWKS HTTP and restricted SQL; synthetic actor/tenant denials, not browser/Next HTTP proof |
| branchDomain234 | [evidence/staff-branch-domain234-full.txt](evidence/staff-branch-domain234-full.txt) · 9f66380 | 325 passed; Full domain regression including exact branch command and original receipt contracts |
| branchSql234 | [evidence/staff-branch-sql234-final.txt](evidence/staff-branch-sql234-final.txt) · 9f66380 | 3 passed; Restricted isolated branch SQL outputs bound to original command and actor; no migration promotion |
| branchApi235 | [evidence/staff-branch-api235-final.txt](evidence/staff-branch-api235-final.txt) · 9f66380 | 9 passed; Focused branch/directory/invitation API projection and original authority checks; not full API suite |
| branchSdk236 | [evidence/staff-branch-sdk236-full.txt](evidence/staff-branch-sdk236-full.txt) · 9f66380 | 317 passed; Full standard SDK regression including exact branch save and GET original/current |
| branchHttp236 | [evidence/staff-branch-http236-initial.txt](evidence/staff-branch-http236-initial.txt) · 9f66380 | 3 passed; Actual signed JWT/JWKS HTTP/restricted SQL and SDK committed corrupt branch reply recovery by GET only; synthetic fixture |
| directoryDomain230 | [evidence/staff-directory-domain230-full.txt](evidence/staff-directory-domain230-full.txt) · 09e489e | 321 passed; Full domain regression including private branch and invitation page contracts; no UI/provider claim |
| directorySql230 | [evidence/staff-directory-sql230-final.txt](evidence/staff-directory-sql230-final.txt) · 09e489e | 3 passed; Isolated restricted SQL directory projections bound to shared validators; no migration promotion |
| directoryApi231 | [evidence/staff-directory-api231-final.txt](evidence/staff-directory-api231-final.txt) · 09e489e | 8 passed; Focused invitation and directory API regression; configured company and verified subject with fail-closed projections |
| directorySdk232 | [evidence/staff-directory-sdk232-full.txt](evidence/staff-directory-sdk232-full.txt) · 09e489e | 314 passed; Full standard SDK regression including strict bounded private directory reads |
| directoryHttp232 | [evidence/staff-directory-http232-final.txt](evidence/staff-directory-http232-final.txt) · 09e489e | 8 passed; Actual SDK and signed JWT/JWKS HTTP/restricted SQL private directory pages and role/tenant denials; disposable synthetic fixture only |
| invitationHttp227 | [evidence/staff-invitation-http227-final.txt](evidence/staff-invitation-http227-final.txt) · 83a5f73 | 6 passed; Disposable signed JWT/JWKS HTTP and restricted SQL invitation capture/revocation original GET-only recovery, role/tenant/signature/authority denials; no provider identity, grants or UI |
| invitationRecords225 | [evidence/staff-invitation-records225.txt](evidence/staff-invitation-records225.txt) · 3d67007 | 7 passed; Exact immutable receipt/state/outcome and duplicate/rounded JSON contract checks |
| invitationDomain224 | [evidence/staff-invitation-domain224.txt](evidence/staff-invitation-domain224.txt) · dfe694b | 310 passed; Full domain regression including capture-only invitation intent; no invitation delivery or access grant |
| branchCandidate224 | [evidence/staff-branch-sql224-final.txt](evidence/staff-branch-sql224-final.txt) · dfe694b | 3 passed; Explicit isolated branch SQL proposal in restricted PGlite; durable originals/conflict/noop and two-company/current-admin fences; not a normal migration or hosted locking proof |
| invitationCandidate224 | [evidence/staff-invitation-sql224.txt](evidence/staff-invitation-sql224.txt) · dfe694b | 5 passed; Explicit isolated capture-only invitation/revocation SQL in restricted PGlite; historical expiry fixture, no mail/token/redemption/membership grant or UI/provider acceptance |
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
Observed: Current signed customer, revoked and foreign actor denials; server-owned staff access and guarded listing commands. Separate default-off signed invitation HTTP/SDK now connects to isolated SQL, with metadata-only lost disclosure recovery and no membership reactivation on replay. Separately enabled admin issuance now has verified BFF/controller and actual browser reveal/discard, retained recovery/reload, revocation and current issued/used state reads. Separately signed nonmember acceptance now connects through identity-only session, strict BFF/controller/UI and GET recovery. Actual browser used-state, revocation and existing-member refusal plus signed replay-without-reactivation composition are verified locally.
Evidence: [videoSql287](evidence/video287-sql-final4.txt), [videoApi287](evidence/video287-api-final.txt), [videoSigned287](evidence/video287-signed-final4.txt), [api212](evidence/2026-10-28-operations-overview/api-full.txt), [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt), [staffSql248](evidence/staff-membership248-sql-final.txt), [staffApi248](evidence/staff-membership248-api-full.txt), [staffSigned248](evidence/staff-membership248-signed.txt), [staffBrowser248](evidence/2026-11-02-staff-management.md), [staffHttpDomain269](evidence/staff-http269-domain.txt), [staffHttpSdk269](evidence/staff-http269-sdk.txt), [staffHttpApi269](evidence/staff-http269-api.txt), [staffHttpFocused269](evidence/staff-http269-focused.txt), [staffIssueAdmin272](evidence/staff-issue272-admin-final.txt), [staffIssueSql272](evidence/staff-issue272-sql.txt), [staffIssueConnected272](evidence/staff-issue272-connected-final.txt), [staffIssueBrowser272](evidence/2026-11-02-staff-invitation-issuance-ui.md), [staffIssueBuild272](evidence/staff-issue272-next-final.txt), [submissionAdmin281](evidence/submission281-admin-final5.txt), [submissionReference281](evidence/submission281-reference-final3.txt), [submissionBrowser281](evidence/2026-11-03-reference-submission.md), [recipientDomain275](evidence/recipient275-domain.txt), [recipientSdk275](evidence/recipient275-sdk.txt), [recipientAdmin275](evidence/recipient275-admin-final2.txt), [recipientApi275](evidence/recipient275-api.txt), [recipientFocused275](evidence/recipient275-focused.txt), [recipientConnected275](evidence/recipient275-connected-final2.txt), [recipientPreview275](evidence/recipient275-preview.txt), [recipientBrowser275](evidence/2026-11-02-invitation-recipient-acceptance.md), [recipientBuild275](evidence/recipient275-next-final.txt), [authorizationReview223](evidence/2026-10-30-authorization-review.md), [authInventory223](evidence/2026-10-30-listing-reports/authorization-inventory.txt), [authRoles223](evidence/2026-10-30-listing-reports/authorization-role-tenants.txt), [authStorage223](evidence/2026-10-30-listing-reports/authorization-storage.txt)
Still open: Production identity, native route bypass and deployed storage permissions still require verification.
Next: Complete the real identity/browser/native denial matrix on the release candidate. Owner: Boniface + Codex.

### AC-003 — owner/tenant denial

**R-003 · partial · GAP-AC-003**
Original finding: Cross-account owner edit accepted.
Expected: Requests denied, unchanged records/media. Server derives actor; only authorized admin reassignment succeeds; all queries/exports/subscriptions scoped
Observed: Current company/assignment checks, exact operation recovery and raw viewing-table denial.
Evidence: [videoSql287](evidence/video287-sql-final4.txt), [videoSigned287](evidence/video287-signed-final4.txt), [api212](evidence/2026-10-28-operations-overview/api-full.txt), [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt), [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt), [media213](evidence/2026-10-28-upload-acceptance/media-full.txt), [staffSql248](evidence/staff-membership248-sql-final.txt), [staffApi248](evidence/staff-membership248-api-full.txt), [staffSigned248](evidence/staff-membership248-signed.txt), [authorizationReview223](evidence/2026-10-30-authorization-review.md), [authInventory223](evidence/2026-10-30-listing-reports/authorization-inventory.txt), [authRoles223](evidence/2026-10-30-listing-reports/authorization-role-tenants.txt), [authStorage223](evidence/2026-10-30-listing-reports/authorization-storage.txt)
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
Evidence: [videoSdk287](evidence/video287-sdk-final.txt), [videoSql287](evidence/video287-sql-final4.txt), [videoSigned287](evidence/video287-signed-final4.txt), [videoEvidence287](evidence/2026-11-03-private-listing-video.md), [media216](evidence/2026-10-28-live-media-retirement/media-full-final.txt), [signed216](evidence/2026-10-28-live-media-retirement/signed-http-full-final.txt), [admin216](evidence/2026-10-28-live-media-retirement/admin-tests-final.txt), [browser216](evidence/2026-10-28-live-media-retirement.md), [database215](evidence/2026-10-28-expired-media-cleanup/database-full-corrected.txt)
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
Evidence: [domain212](evidence/2026-10-28-operations-overview/domain-full.txt), [api212](evidence/2026-10-28-operations-overview/api-full.txt), [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt), [catalogueBrowser278](evidence/2026-11-03-catalogue-workflow.md), [catalogueRendered278](evidence/catalogue278-rendered-tests.txt), [submissionAdmin281](evidence/submission281-admin-final5.txt), [submissionReference281](evidence/submission281-reference-final3.txt), [submissionRetention281](evidence/submission281-retention-final2.txt), [submissionBrowser281](evidence/2026-11-03-reference-submission.md), [submissionBuild281](evidence/submission281-next-final4.txt), [catalogueAudit284](evidence/2026-11-03-catalogue-implementation-acceptance.md), [catalogueBuild284](evidence/catalogue284-builds.txt), [catalogueDomain284](evidence/catalogue284-domain.txt), [catalogueSdk284](evidence/catalogue284-sdk.txt), [catalogueApi284](evidence/catalogue284-api.txt), [catalogueSql284](evidence/catalogue284-sql.txt), [catalogueComposition284](evidence/catalogue284-composition.txt), [catalogueWeb284](evidence/catalogue284-web.txt), [catalogueMobile284](evidence/catalogue284-mobile.txt)
Still open: Current combined exact-price/fees/reference browser save and recovery278 and connected author submit/withdraw281 are verified. Literal local catalogue build06-1 accepted after criterion mapping and fresh domain343/SDK333/API355/SQL73/composition34/web114/native-model24 checks284. Controlled configuration/schema admission and rollback, normalized import and complete create/edit/UI/direct-bypass release combinations remain open.
Next: Implement controlled release admission/upgrade and execute the complete boundary/import matrix; local build acceptance does not close this release case. Owner: Boniface + Codex.

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
Evidence: [domain212](evidence/2026-10-28-operations-overview/domain-full.txt), [api217](evidence/2026-10-29-public-gallery/api-full.txt), [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt), [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt), [operations212](evidence/2026-10-28-operations-overview.md), [browser217](evidence/2026-10-29-public-gallery.md), [web217](evidence/2026-10-29-public-gallery/web-full-final.txt), [catalogueAudit284](evidence/2026-11-03-catalogue-implementation-acceptance.md), [catalogueDomain284](evidence/catalogue284-domain.txt), [catalogueComposition284](evidence/catalogue284-composition.txt), [catalogueWeb284](evidence/catalogue284-web.txt), [catalogueMobile284](evidence/catalogue284-mobile.txt)
Still open: Local normalized authoring/fees build accepted284; full actual native fee disclosure and normalized import/release boundary acceptance remain open.
Next: Repeat all known/unknown fee cases through normalized authoring and actual native devices. Owner: Boniface + Codex.

### AC-013 — canonical labels

**R-013 · partial · GAP-AC-013**
Original finding: Type/purpose columns use wrong values.
Expected: Purpose and type retain correct distinct values/labels; unknown source quarantined; shared vocabulary has no accidental substitution
Observed: Canonical types/purpose and synthetic public/ordinary staff data are validated.
Evidence: [domain212](evidence/2026-10-28-operations-overview/domain-full.txt), [api212](evidence/2026-10-28-operations-overview/api-full.txt), [signed212](evidence/2026-10-28-operations-overview/signed-http-full.txt), [search210](evidence/2026-10-28-search-and-enquiry-acceptance.md), [catalogueAudit284](evidence/2026-11-03-catalogue-implementation-acceptance.md), [catalogueDomain284](evidence/catalogue284-domain.txt), [catalogueApi284](evidence/catalogue284-api.txt), [catalogueSql284](evidence/catalogue284-sql.txt), [catalogueComposition284](evidence/catalogue284-composition.txt)
Still open: Local normalized catalogue implementation accepted284; normal deployment/schema promotion and complete all-type import/unknown-type handling remain unaccepted.
Next: Verify controlled deployment promotion/rollback and all-type import/display scenarios against the release candidate. Owner: Boniface + Codex.

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
Evidence: [videoDomain287](evidence/video287-domain-final.txt), [videoSdk287](evidence/video287-sdk-final.txt), [videoApi287](evidence/video287-api-final.txt), [videoSql287](evidence/video287-sql-final4.txt), [videoEvidence287](evidence/2026-11-03-private-listing-video.md), [videoTypes287](evidence/video287-types-final.txt), [videoFormat287](evidence/video287-format-final.txt), [videoPreview287](evidence/video287-preview-final.txt), [media216](evidence/2026-10-28-live-media-retirement/media-full-final.txt), [signed217](evidence/2026-10-29-public-gallery/signed-http-full.txt), [admin216](evidence/2026-10-28-live-media-retirement/admin-tests-final.txt), [browser216](evidence/2026-10-28-live-media-retirement.md), [api217](evidence/2026-10-29-public-gallery/api-full.txt), [database217](evidence/2026-10-29-public-gallery/database-full.txt), [browser217](evidence/2026-10-29-public-gallery.md), [authorizationReview223](evidence/2026-10-30-authorization-review.md), [authInventory223](evidence/2026-10-30-listing-reports/authorization-inventory.txt), [authRoles223](evidence/2026-10-30-listing-reports/authorization-role-tenants.txt), [authStorage223](evidence/2026-10-30-listing-reports/authorization-storage.txt), [browserReport223](evidence/2026-10-30-listing-reports.md), [signedReport223](evidence/2026-10-30-listing-reports/signed-http-lost-results.txt)
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

- **FIX-278-01** (AC-008, AC-011): Reference creation/editing fee labels and native controls ran together at390px, obscuring exact amounts and classifications despite no page overflow. Retest: [catalogueBrowser278](evidence/2026-11-03-catalogue-workflow.md); retested_in_stated_environment. [Initial failure](evidence/catalogue278-narrow.jpg). After correction all5 fee text/select controls are separate48px-high rows within the narrow client width in both creation and editing. Physical device/AT/operator acceptance and reference submission workflow remain open.
- **FIX-261-01** (AC-002, AC-030): Staff invitation lifetime/expiry used statement start instead of the decision wall clock; branch/capture/revocation writers also lacked the coordinated post-company-lock authority check. Retest: [staffDecisionSql261](evidence/staff-lock261-sql.txt); retested_in_stated_environment. [Initial failure](evidence/staff-lock261-negative.txt). Clock-only negative control reproduces both timing failures;23 focused SQL checks pass. Authority loss is a single-session injection. Hosted concurrent lock/role/expiry races remain open. Connected synthetic recipient redemption is now verified in checkpoint275; actual browser clock crossing and production-provider identity remain open.
- **FIX-248-01** (AC-002, AC-007): Development staff BFF rejected canonical forwarded metadata automatically added by the installed Next Node adapter. Retest: [staffBoundary248](evidence/staff-workspace248-focused.txt); retested_in_stated_environment. [Initial failure](evidence/staff-boundary248-before.txt). Exact loopback metadata is transport-only; actual owned browser branch/capture/revocation GET recovery also observed. Production proxy/provider/device acceptance remains open.
- **FIX-216-01** (AC-005, AC-030): Retired byte handler parsed route/identity before refusing new admission. Retest: [signed216](evidence/2026-10-28-live-media-retirement/signed-http-full-final.txt); retested_in_stated_environment. [Initial failure](evidence/2026-10-28-live-media-retirement/pipeline-focused.txt). Outer fence now refuses before body/identity/SQL; production hosting/retention remains open.
- **FIX-216-02** (AC-005, AC-019): Failed native conversion PUT described confirmed failure while original GET described processing. Retest: [signed216](evidence/2026-10-28-live-media-retirement/signed-http-full-final.txt); retested_in_stated_environment. [Initial failure](evidence/2026-10-28-live-media-retirement/native-photo-boundaries.txt). Matching retained failure facts are descriptive only; no new launch/deletion authority and no unknown-containment success.
- **FIX-210-01** (AC-010, AC-024): Invalid GeoJSON disabled the interactive Clear area control. Retest: [search210](evidence/2026-10-28-search-and-enquiry-acceptance.md); retested_in_stated_environment. Full device/assistive-technology acceptance remains open.
- **FIX-211-01** (AC-003, AC-009, AC-030): Ordinary property assignment dropped or reinterpreted an own __proto__ query key before validation. Retest: [sdk212](evidence/2026-10-28-operations-overview/sdk-full.txt); retested_in_stated_environment. No privilege compromise is asserted; production security matrix remains open.
- **FIX-212-01** (AC-002, AC-003): Initial overview implementation queried a viewing table denied to the runtime role. Retest: [api212](evidence/2026-10-28-operations-overview/api-full.txt); retested_in_stated_environment. [Initial failure](evidence/2026-10-28-operations-overview/initial-direct-read-denied.txt). Fixed through a narrow SQL function; raw-table denial retained. No wider grants added.
- **FIX-212-02** (AC-007): New admin imports lacked extensions required by the test compiler. Retest: [admin212](evidence/2026-10-28-operations-overview/admin-tests-fixed.txt); retested_in_stated_environment. [Initial failure](evidence/2026-10-28-operations-overview/admin-tests.txt). Full native/startup/device acceptance remains open.

## Maintenance

Update the reviewed scope statements and source commits in `scripts/acceptance-status.mjs` only after inspecting executed results. Run `node scripts/acceptance-status.mjs --write`, then `node scripts/acceptance-status.mjs`. The check verifies exact original finding/case coverage, report hashes, declared pass counts, no skipped/failed cases in those named suites, source ancestry and retained failure/retest links. A suite pass never automatically closes an acceptance case or release gate. Preserve older raw evidence and state exactly what a new run changes.
