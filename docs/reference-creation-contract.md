# Guarded reference creation API and SDK

Checkpoint 151, 24 October 2026. Explicit synthetic candidate only.

Reference-aware creation now has one shared domain command and a composed receipt across the candidate SQL, API and SDK. The exact command contains policy `synthetic-reference-creation-v1`, operation ID, listing ID, slug, full canonical private content and reference selection. It derives revision 1 and expected editorial version 2 internally; the caller cannot choose an assignment, actor, state or publication pointer. Validation reuses the existing creation and combined-reference contracts and requires the selected location labels to match the explicit public disclosure.

The immutable result contains a created v2 subreceipt at initial version 2 and a reference subreceipt at adopted version 3. Both must match the retained full command, original catalogue and verified actor. These historical versions do not assert the draft's current editable state. Matching recovery after catalogue activation or later editing returns the same original. Changed actor, command, labels, selection, outcome or versions are rejected.

## API boundary

`/v3/staff/listings/{listingId}/reference-creation-operations/{operationId}` accepts one POST command or an explicit original GET. The route is separately default-off. Service option `referenceCreationMode=synthetic-reference-creation-v1` requires the existing moderation and draft modes; no startup path installs the fifth SQL proposal or enables the new option automatically.

The API verifies identity, uses only its configured company, and checks current SQL membership inside a restricted transaction. Canonical IDs, exact request schema, bounded strict JSON, supported methods and existing reference header/query/framing guards apply. New writes validate against the selected stored catalogue before SQL. Original reads derive the catalogue version from the saved receipt and load that immutable catalogue inside the same transaction. Complete result validation and cancellation checks occur before commit. A malformed SQL result rolls the allocation back; a reply corrupted after commit remains a recoverable uncertain client outcome.

## SDK and response bounds

`createSyntheticReferenceListingV3` validates and detaches the retained command/catalogue, then performs one POST. It never automatically retries or recovers. `getSyntheticReferenceCreationReceiptV3` requires that same original command/catalogue and expected actor and performs one GET. Transport failure or malformed write success remains uncertain; a failed GET does not become a write or discard the original.

Requests remain limited to 128 KiB. Each projected subreceipt must fit 128 KiB before a write can be dispatched. The composed successful response has its own 262,272-byte allowance because it retains two full originals; ordinary moderation and other response bounds are unchanged. Error responses on this path remain bounded to 128 KiB. Streamed byte limits, body deadlines/cancellation, strict UTF-8/framing, duplicate-key rejection and authoritative integer tokens apply. A valid large Unicode composite above 128 KiB passed both the SDK parser and connected service/SQL check.

## Verification

The new focused cases comprise six domain checks, five SDK checks and ten connected checks (nine subchecks plus their parent). Connected checks run in-process through Request/Response, the actual SDK/service and restricted PGlite transactions with an explicitly synthetic identity verifier. They prove allocation rollback for malformed SQL output, lost committed wire reply followed by original GET, getter-free malformed projection rejection, current role/requester/company/assignment/revocation denial, historical recovery after activation and editing, stale new creation rollback, the large composite and cancellation after SQL before commit. They are not signed network or browser proof.

Final broader suites passed: 275 domain, 259 API, 264 SDK and 94 SDK integration checks, each with zero failures or skips. All eight workspace type checks, package builds, full formatting and Git whitespace checks passed. Evidence is retained in sibling `reference-creation-contract-*` logs. The focused counts overlap their full suites. No SQL migration changed after checkpoint 150's 318 passing database checks; those database checks were not rerun here. No new full-root run, production Next build, Android export, native interaction, real-media check, hosted multi-connection race, UAT or cutover is claimed here.

Next: retain the original creation attempt in the guarded admin UI, add an explicitly configured disposable preview that loads the fifth proposal, and verify signed HTTP plus actual creation/reload/original recovery. Then finish reference-aware successor/import conversion, default-schema compatibility and remaining external acceptance. Native verification awaits sufficient memory or a test device. KES 10,000 total monthly per realtor and the old live/vendor resources are preserved. Broad checklist tasks and exit gates require their full acceptance evidence.
