# Signed admin command verification

Recorded 4 November 2026 EAT. Final maintained test execution occurred 3 November 2026 EAT.

| Command | Signed entry point | Verified behavior |
| --- | --- | --- |
| Company settings approval | POST /v2/staff/company-settings/operations/{operation} | Current company admin required. Original read and replay retain the receipt and one audit event. Malformed authority, stale or changed replay, and peer or foreign access leave records and audits intact. |
| Listing availability | POST /v2/staff/listings/{listing}/availability-operations/{operation} | All five availability targets exercised through the shared SDK. Original actor, company, record, operation, version and HTTP correlation are checked. Conflict receipts survive later changes. |
| Listing publication | POST /v2/staff/listings/{listing}/publication-operations/{operation} | All three targets exercised. Assigned agents can pause an eligible listing. Current role, assignment, company and original requester are rechecked. Denials preserve listing, snapshot, receipt and audit state. |

Injected audit insertion failure rolled back settings approval and both listing control kinds. The original read returned 404 before a deliberate retry succeeded. The SDK reports the failed control submission as uncertain and preserves the original operation for recovery.

The final maintained run passed 19 of 19 checks with fresh domain, API and SDK builds. Seven are new signed command scenarios. The earlier run in audit323-maintained3.txt failed to parse an await inside a test callback. The corrected final run is audit323-maintained5.txt.

Evidence comes from ephemeral RS256/JWKS, HTTP and disposable PostgreSQL-compatible storage with restricted transaction roles. Task 08-7 remains open for the remaining command families, including draft and moderation mutations, enquiries and staff administration.
