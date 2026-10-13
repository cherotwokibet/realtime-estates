# Viewing proxy and operator browser evidence — 13 October 2026

Boniface + Codex, independently written synthetic local preview. Existing live/vendor resources and price baseline KES 10,000 per realtor/month preserved. This is a request/first-proposal slice, not viewing lifecycle acceptance.

## Implemented boundary and UI

Fixed server BFF routes perform current signed staff API requests, bounded body/response handling and immutable original-fact validation. Browser never receives JWTs or chooses actor/company authority. Recovery POST keeps private original facts in a body and issues upstream GET only. Request/proposal writes dispatch once; malformed successful replies stay uncertain. Retained controller blocks concurrent dispatch, automatic retries and replacement of originals. A failed recovery read cannot discard an uncertain save.

Admin form requests a viewing for its saved property-linked enquiry with private notes and zero or one preferred slot. General enquiry property selection is still pending. Proposal deliberately selects a requested viewing snapshot/version from an independent 25-item feed. Refresh never adopts another version; new commands require explicit clearing/repreparing. Times use Nairobi inputs and preserve seconds/milliseconds. No customer agreement, confirmation, calendar reservation, invitation, reminder or reschedule exists. Draft/original memory is tab-only, explicitly warned.

Workspace contact and viewing guards are independent and aggregated for enquiry/role/link navigation and beforeunload. Current access denial hides saved detail, feed and activity while keeping local raw draft/original mounted. Selected viewing ID/version is retained local context, not an authorized current read.

## Actual browser checks

Launched `node scripts/enquiry-preview.mjs --web` using loopback RS256/JWKS, actual BFF/API and restricted synthetic SQL. No real property/prospect data.

1. Created fictional property enquiry 772e7eaf-40bc-4300-be33-96588552bb1f from the public catalogue property 00000000-0000-4000-8000-000000000400. Admin requested viewing 1b41427d-4502-49de-9cac-f6d8236cc11f with exact leading/trailing spaces and newline. Original operation 85f5df0e-4431-44de-9038-7109b25dfe36 returned requested. Refreshed feed showed exactly one version1 record and original notes.
2. Clearing contact input then clicking another enquiry left the viewing draft and selected enquiry intact, verifying independent dirty guards in the actual browser.
3. Two admin tabs deliberately selected viewing version1. First proposal operation 79ac7f88-b7f2-4f32-96d6-9da741297df7 saved 14 October 11:00–12:00 EAT. Second tab retained 14:00–15:00/version1 even after its feed read version2. Its operation adeadcf0-9301-409a-baca-02da9d37e200 returned VERSION_CONFLICT and left the first time unchanged. Screenshot viewing-browser-conflict.png. This is sequential stale-session conflict proof, not simultaneous PostgreSQL concurrency proof.
4. Admin assigned enquiry to agent11 (enquiry2), then reassigned to peer12 (enquiry3). Agent's viewing-feed read returned denied; saved email, feed and activity disappeared. Exact unsaved viewing notes remained, disabled for new save. Screenshot viewing-browser-access-denied.png. No identity expiry/revocation/browser race injection claim.
5. Restarted disposable preview with `--web --invalid-first-viewing-reply`. One-shot process-only flag commits normally, then corrupts the first applied viewing response. New fictional enquiry 93ee724d-1581-4bd4-8d66-a2b94bf2cfbb retained original operation e8c6c7a9-0c39-4a6c-906b-3c386dc17371 and raw notes when UI showed uncertain; discard was disabled. Screenshot viewing-browser-uncertain.png. Explicit Read original viewing result recovered requested receipt, viewing2becb1f1-4bcc-476b-b64a-750de3eb71f9. Feed showed one record with exact original notes. Screenshot viewing-browser-recovered.png. No command replay was clicked in this browser run; exact replay is verified by controller and signed preview tests. Invalid-reply simulation is not literal network/socket-loss proof.

Screenshots are native JPEG full-page captures1264pixels wide at the desktop in-app browser viewport;the earlier .png filenames were retained as evidence paths. They do not establish390px/device coverage. Evidence lives in rebuild-preservation/2026-10-12-source. Temporary browser tabs closed, owned preview processes stopped after testing.

## Automated verification

133/133 admin tests passed: prior121 regression contexts plus6 proxy contexts and6 browser transport/controller tests. Tests include raw safe version tokens/duplicate fields/authority refusal/body limits; fixed server credentials and actor receipts; read-only recovery vs uncertain writes; immutable exact originals and concurrent dispatch lock; durable conflicts/refusals and altered receipt denial. Earlier121/127/133 logs overlap, not additional counts.

14/14 signed enquiry-preview checks passed, including one new fault scenario: explicit enquiry+catalogue opt-in, unknown fault refusal, denied/conflict/read not consuming fault, commit then invalid reply, exact original receipt read/replay, one record, normal subsequent saves. Existing13 overlap prior checkpoint. API production service/SQL unchanged; prior139SQL/88domain/157API/180SDK/62integration coverage is earlier backend evidence, not rerun here.

Admin typecheck passed; final production build passed after the access-denial copy adjustment. Logs viewing-ui-admin-tests.txt, viewing-ui-preview-regression.txt, viewing-ui-types.txt, viewing-ui-build-final.txt. No new dependency or paid service.

## Exact next work

General enquiry eligible property picker; actual browser exact replay after uncertain viewing save; denied original-recovery while reassigned and explicit restoration; narrow/native device checks. Define agreement evidence and confirmed/cancelled/declined/rescheduling transitions as separate original-receipt guarded operations before UI. Real PostgreSQL race/overlap rules, UAT and launch gates remain open. Keep16/97 broad tasks and0/14 gates.
