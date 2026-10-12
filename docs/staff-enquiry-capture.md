# Protected staff enquiry capture - 13 October 2026



POST /v2/staff/enquiry-captures is an authenticated command. The server fixes company from deployment, actor from verified identity and origin to staff. Caller origin/actor/company/requester fields and query overrides are rejected. Active admin/agent authorization is checked in the same restricted transaction as record_enquiry. Current privacy notice acknowledgement and canonical contact validation match public intake. Public intake still accepts only web/mobile.



The existing SQL command binds the original idempotency key to canonical body and authenticated requester; exact replay returns the original ID without another audit/write, while a changed body or different actor conflicts. Public and each verified staff actor have separate rate-limit namespaces. No database schema or dependency was added.



Verification: final API build and 151/151 API tests passed, plus 8/8 signed-JWT actual loopback HTTP/restricted SQL integration checks (includes parent test). See evidence/staff-capture-api-tests-final.txt and staff-capture-integration-final.txt. New assertions verify persisted origin/requester, stable replay counts, changed-body/different-actor conflicts, missing authentication and customer/foreign/inactive denial. Initial API attempt conflicted with existing collection POST=405 expectations; a distinct capture command route preserves that contract. Initial integration reached the shared guest rate limit; actor/public namespaces fixed that issue. Earlier failed logs are preserved. Counts overlap historical suites; do not add them to cumulative totals.



This is backend foundation only: no shared staff SDK method, original-attempt state machine, preview allowlist/BFF, staff form, browser/device/UAT or production acceptance is claimed. Next implement the typed staff capture method and immutable explicit replay helper, then protected server-only preview proxy and form. Ensure prospect notice handling is operator-attested rather than falsely presented as prospect consent. Current staff authorization must remain required on every replay. Broad lead checklist remains open,16/97 tasks and0/14 gates. KES10,000 monthly client price, vendor resources and old live systems preserved.


## Shared client - 13 October 2026

Typed staff capture and immutable explicit replay now snapshot raw input/key/identity, lock concurrent writes, preserve uncertainty after later denial and prevent received resubmission. Final173 client checks,8 signed-identity HTTP/restricted-SQL integration checks and8 workspace typechecks passed; see staff-capture-client-tests-verified.txt, staff-capture-client-integration-verified.txt and staff-capture-client-types.txt. Initial option allowance/201 status issues corrected and test file added to suite. Failed logs preserved. Memory-only state and captured-token expiry remain limits. Next protected server-only preview BFF/form and attributable receipt UI; no browser/device/UAT/production pass claimed.

## Protected preview proxy - 13 October 2026

Fixed /api/enquiry-preview/{admin|agent}/capture routes now use server-only signed synthetic identities and the shared bounded16KiB/15-second handler. Exact loopback Host/Origin/instance, no browser bearer/cookie/authority headers, scalar/duplicate-key validation, fixed notice and general-only listing context are enforced. Staff source is never caller-supplied. Guest mode remains guest-only. The disposable signed preview explicitly allows the capture command; production remains disabled.

Final24 affected admin boundary checks,10 actual signed preview API checks,173 shared client checks and26 web checks passed; all8 workspace typechecks and admin production build passed. See staff-capture-proxy-{tests,preview-api-tests,client-tests,web-tests,types,build}.txt (API log is staff-capture-preview-api-tests.txt). No browser staff form/physical device/UAT acceptance claimed. Tests cover both server credentials, forged context, production/cross-origin denial, duplicates/oversized bytes, lost reply without automatic replay and actual original actor-bound receipt recovery.

Next build the staff-facing general capture form using a strict source-free same-origin client with original attempt retention and explicit recovery; do not put real or placeholder bearer credentials in browser code. Show fixed synthetic actor attribution and notice attestation by the operator, without claiming prospect consent. Agent-created new/unassigned records are not currently visible in the assigned-only inbox; preserve a truthful saved receipt and review the follow-up assignment workflow before enabling operational use. Memory-only recovery, token expiry, persistent production identity and operator validation remain open. Checklist16/97,gates0/14,KES10,000 price and old resources/live preserved.
