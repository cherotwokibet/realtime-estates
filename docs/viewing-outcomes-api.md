# Completion/no-show API and SDK — 14 October 2026

Protected POST routes `/v2/staff/enquiries/{id}/viewings/{viewingId}/completions` and `/no-shows` fix the outcome kind. Strict body contains only operationId, numeric expectedVersion, canonical occurredAt and raw private reason. Caller kind/actor/company/cycle/evidence fields, duplicate keys, ambiguous version tokens, unsupported query/method and oversized input are refused. Seven typed SQL arguments reach migration 0018; applied/refusal/conflict receipts are validated against exact command and verified staff actor. Existing SQL current authorization, immutable evidence, original requester lookup and stale/time policy remain unchanged.

Exact original viewing-operation GET now dispatches complete/no_show through strict receipt validation while preserving every old kind branch. It is a read, never another outcome write. SDK recordViewingOutcomeV2 sends one fixed-kind POST and marks an unusable committed reply uncertain; getViewingOutcomeReceiptV2 performs one exact original GET. Time/reason never appear in URLs. Validation happens before dispatch, recovery failures remain read-only, and no hidden retry or automatic version adoption occurs.

The explicit synthetic preview allowlist now permits these protected routes. Its ordinary future appointment fixture refuses premature completion/no-show durably and returns the exact original refusal through GET/replay without changing confirmation evidence. No outcome operator BFF/form or actual outcome browser session is implemented yet.

## Signed HTTP and restricted SQL evidence

A new permanent integration scenario uses actual RS256 verification/loopback JWKS, actual HTTP, all migrations and a restricted api_runtime login with serialized disposable PGlite transactions. Owner setup seeds coherent historical 2020 first- and later-cycle states/receipts through normal insert/update guards and constraints; no trigger or server clock is bypassed. The enquiry is general, with historical viewings linked separately to synthetic stock. Owner fixture setup is not past HTTP execution or proof of real prospect attendance.

The first completion commits at viewing version four, then its successful reply is deliberately discarded. SDK reports uncertainty after one write; original GET and explicit replay return the same saved result. A competing stale admin command yields a durable conflict; changed kind and different original requester are denied. Reassignment removes original receipt/history access, restoration permits exact original replay, and the old confirmation receipt remains unchanged. A later-cycle no-show saves version six after explicit enquiry closure and listing withdrawal, without altering enquiry version. Six saved states retain distinct first- and second-slot agreements. Exactly two applied attendance receipts and two outcome audits exist for the two viewings.

This is synthetic signed HTTP/restricted SQL recovery evidence, not literal socket loss, hosted PostgreSQL simultaneous race, actual browser/device/UAT or production acceptance. Reminder dispatch and customer messaging remain absent.

## Verification and initial corrections

173/173 API tests (three new outcome contexts), 196/196 SDK tests (three new), 18/18 signed preview checks (one new refusal context), package/API builds and all eight workspace typechecks passed. The signed attendance scenario also passed standalone. Full integration suite result is recorded at the final checkpoint; the standalone scenario overlaps that suite once registered.

Initial fixture issues were corrected without relaxing guards: the oversize API case expected 400 where the existing body limit correctly returns 413, and a historical enquiry attempted to reference listing revision one before a revision existed. The fixture now uses a valid general enquiry. The new integration file was initially absent from the package's explicit test list; it was added to that list before the final full run. Teardown explicitly closes both the adapter and disposable database. Failed/intermediate logs remain preserved.

Logs viewing-outcomes-api-tests-final.txt, viewing-outcomes-sdk-tests.txt, viewing-outcomes-preview-tests.txt, viewing-outcomes-api-workspace-types.txt, viewing-outcomes-signed-focused-final.txt and final viewing-outcomes-integration-suite-final.txt are retained under ../rebuild-preservation/2026-10-12-source. Prior database/domain/admin passes are historical and not claimed as fresh runs for this API slice.

Next: fixed outcome BFF and body-only recovery POST-to-upstream-GET, source-free browser transport, immutable retained original kind/target/version/occurrence/reason, explicit operator forms and a clearly labeled disposable historical browser fixture. Test denied recovery/restoration, stale conflict, exact replay and preserved history in the actual browser; do not infer attendance. Then current-cycle/version reminder suppression before any dispatch. Checklist 16/97, gates 0/14 and total recurring client price KES 10,000 remain; vendor/live/resources, unresolved ownership/account/off-device backup, devices/UAT and approved cutover gates remain protected.

## Final full integration result

66/66 permanent integration tests passed with the new signed attendance file included in the explicit package test list. The earlier65 runs excluded that new file; standalone1 overlaps final66. All final API173/SDK196/preview18/typecheck8 results were observed separately.

## Outcome API checkpoint publication — 14 October 2026

API source2a85cadfd3a407cfbd8fcb1324ad6dd111e52fd7 bundled/verified/freshmatchingclone/fsckpassed same-deviceonly SHA256f332d72cf9dff26506be1f10de07e014aa949323fe1e4e781166f9b98ead623b. Existingowner-private dashboard65 source32e64f129c27a312d8cdf13c32d88383d84893f2 deployedappgdep_6acfdef06c00819180b731d17881378e succeeded.252canonicalnotesretained/0browserextras/4added=256. BrowserreloadverifiedAPIrecoverybanner/173API196SDK66integration18preview8types andexplicitpendingoperatorbrowser; screenshotviewing-outcomes-api-dashboard.jpg retained. No activepreview/live/vendor/providerchanges.

Next exact checklist docs/viewing-outcomes-operator-next.md: fixed kind BFF/recoveryPOST→upstreamGET,source-freebrowsertransport,immutableoriginalattempt,explicitoccurrence/reasonform,normalguarded opt-inhistoricalfixture,targetedoutcomereplyfault andactualtwo-tabstale/access/replay/historybrowserproof. Do not import test modules into preview;extract pureseedhelper. Thenreminder currentcycle/version suppression beforedispatch;no actualoutcomebrowser/device/UAT/production acceptanceyet.16/97tasks,0/14gates,KES10,000totalmonthlyclientprice.
