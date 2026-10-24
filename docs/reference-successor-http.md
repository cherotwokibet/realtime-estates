# Opt-in reference successor HTTP and SDK

Checkpoint 159, 24 October 2026. The shared successor contract is connected to a separately default-off service route and SDK methods. SQL remains an explicitly installed isolated synthetic candidate. Default migrations, normal production configuration, operator UI and mobile UI are unchanged.

Enable `referenceSuccessorMode: 'synthetic-reference-successor-v1'` only together with the existing reference draft and moderation modes, against a database where the reference successor proposal has deliberately been installed. Invalid or orphan modes reject service construction. The mode does not install SQL or imply that a production schema is compatible. Reference creation mode is independent and is not required.

## Route and transactions

`POST /v3/staff/listings/{listingId}/reference-successor-operations/{operationId}` accepts the full retained command from `reference-successor-domain.md`. `GET` at the same route observes only the completed original. There is no allocation GET or automatic retry. Disabled routes return 404. Only GET/POST are supported, with canonical route IDs and no query, fragment, authority headers, cookie or unsupported request framing.

The service obtains actor identity from its configured authorization verifier and opens a tenant-scoped restricted transaction. Current SQL membership, role and listing assignment govern authority; browser-supplied role/company facts cannot grant access. POST loads the selected immutable catalogue version, validates full content, predecessor and response capacity, invokes `start_synthetic_reference_successor`, then validates both returned originals before commit. SQL requires the active catalogue for a new adoption but permits exact historical replay. A malformed SQL result or cancellation before commit rolls back the successor, listing version, audit and originals. Base stale-predecessor/refusal errors retain the SQL rollback behavior.

GET calls `read_synthetic_reference_successor`, derives the retained command from the base original's request and reference selection, loads the original catalogue version from retained attributes, checks route IDs and verifies both originals against the current actor. This cannot manufacture completion from independent legacy operations or infer current editorial state from original versions 2/3. Customer, wrong requester/company, revoked membership and reassigned-agent checks apply to both recovery and matching replay.

## SDK

`startSyntheticReferenceSuccessorV3(command, originalCatalogue, expectedActorId, options)` validates and captures the command before one POST. `getSyntheticReferenceSuccessorReceiptV3(...)` uses one explicit GET with no body and matches its result to that retained command. Both use existing staff bearer options and omit browser credentials; no new account authority is granted.

Malformed/lost success or a timed-out POST is submission-uncertain and triggers no hidden replay or recovery. GET failures are not marked as uncertain writes. Successful composed responses receive the dedicated 262272-byte allowance, while each validated component stays within 131072 bytes and HTTP error bodies retain the ordinary 131072-byte limit. Streamed reads reject oversized declared/actual bodies, compression, malformed UTF-8, duplicate keys and noncanonical integer tokens; stalled or oversized bodies are cancelled. Unrelated routes keep their existing limits.

## Verification and limits

All 259 API, 270 SDK and 105 SDK/service integration checks passed, zero failures/skips. The focused successor subset passed 17 checks, including actual service/restricted PGlite transactions, rollback after an altered SQL original, uncertain post-commit reply with explicit recovery, historical replay after activation/later edits, stale catalogue/predecessor rollback, current access changes, large Unicode composites and cancellation after SQL execution. All eight workspace typechecks and repository formatting/whitespace checks passed.

The new integration fixture uses an explicitly synthetic authorization verifier. Guarded creation, submission and administrator rejection establish predecessors through actual restricted SQL commands; sealed media history is a privileged disposable fixture with no image bytes or decoder. This does not establish new signed-issuer HTTP preview, real media, hosted PostgreSQL concurrency, browser/operator, native device, UAT or release acceptance. SQL and the default migration order were unchanged; the full database suite was not rerun. Its preceding checkpoint result remains 327 passed.

The first focused run used an obsolete creation SQL name in its test fault hook. Correcting that fixture made its intended successor corruption/cancellation faults execute; no product validation was weakened. The failed log is retained. Evidence is in sibling `rebuild-preservation/2026-10-12-source/reference-successor-http-{focused,api,sdk,integration,types,format}.txt`.

Next: a retained operator successor controller, followed by authenticated BFF/UI and a signed disposable preview. Preserve the exact operation, predecessor, content, selection and original catalogue before POST; lock replacement/departure while sending or uncertain; offer explicit original recovery and storage-verified reload, then read fresh current draft state before editing. Keep default schema/import compatibility, hosted account/media/device/UAT/cutover gates open. KES 10,000 remains the total monthly client price per realtor; preserve vendor resources and the old live system.
