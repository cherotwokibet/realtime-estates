# Reference moderation SDK — checkpoint 142

23 October 2026. Independent synthetic candidate; no schema, production startup, existing preview, default adopted-submission behavior or vendor system was activated or changed.

The SDK now exposes four methods, with the same strict bearer/signal/timeout options as existing reference draft operations:

- `getSyntheticReferenceRevisionV3(listingId, revision, expectedVersion, originalCatalogue, options)` reads the complete private versioned revision.
- `getSyntheticReferenceReviewV3(...)` uses the admin review route and requires a pending result.
- `transitionSyntheticReferenceRevisionV3(originalCommand, originalCatalogue, expectedActorId, options)` performs one submit/withdraw/approve/reject POST.
- `getSyntheticReferenceTransitionReceiptV3(...)` performs an explicit GET for that original command's operation and compares the returned receipt against the entire retained command and actor.

Each method validates and detaches the historical catalogue, command and options before the first transport await. Caller changes after dispatch cannot replace the reviewed private content, attributes, ordered photo fingerprints or original operation. Commands and receipts use the checkpoint 140 domain contracts. Read methods bind the listing, revision, editorial version and historical labels; pending review also checks state. The expected actor is a comparison fact from verified application context, never a mechanism for selecting SQL authority.

New moderation paths explicitly use the bounded reference transport. Response bytes are limited to 128 KiB, with fatal UTF-8, exact declared length, no content encoding, duplicate-key rejection, revision/position/money integer-token checks and additional nullable publication-pointer/room-count integer-token checks. Empty-frame limits, timeout, cancellation and late-response cancellation apply. The separate existing catalogue limit remains 6 MiB; ordinary reference draft receipt transport retains its prior limit. No new dependency or automatic retry is introduced.

A lost, malformed or timed-out write response remains uncertain. Recovery is an explicit GET using the retained original operation and catalogue, even after a newer catalogue becomes current. A valid GET result cannot settle a different retained command. Current access denial is still a failed recovery, and does not manufacture success or a replacement operation. Exact explicit replay is supported by SQL, but the SDK never initiates it automatically. The BFF and reviewer UI must preserve that uncertainty and retain originals until settlement; those consumers are the next work.

## Verification actually run

Six new focused SDK contract/transport checks passed with zero failures/skips. They cover all four actions, original capture during mutation, strict routes/state/version/actor/outcome binding, invalid input before dispatch, malformed original receipts, UTF-8/framing/duplicates/integer tokens, the moderation byte cap on read/write/recovery, hostile empty frames, post timeout/late response cancellation and stalled recovery.

Seven new integration checks (one parent and six subtests) passed using SDK → actual opt-in API → restricted PGlite transactions and the four explicitly installed isolated proposals. They prove lost committed submission followed by GET-only original recovery, exact replay with one revision increment, original labels after catalogue activation, a caller retained-original mismatch, malformed committed withdrawal response and recovery, resubmission/stale-review conflict, current operational pause invalidating a prior review, lost successful approval and exact recovery, private paused publication until explicit restore, original approved public attributes, current revocation and reassignment denials. Photos are synthetic sealed-metadata fixtures; this is not image/device acceptance.

The complete SDK unit and SDK integration scripts now register the new files. Their final counts, typechecks and formatting evidence are recorded in `docs/CONTINUATION.md` and sibling `rebuild-preservation/2026-10-12-source/reference-moderation-sdk-*.txt`. Focused tests overlap those full scripts and are not additional distinct tests. No actual reviewer browser, new signed loopback moderation workflow, installed device, hosted PostgreSQL concurrency, operator UAT, full root test chain or cutover acceptance is claimed.

## Exact next

Read the existing admin reference draft BFF/client/workspace and current moderation review screen before editing, including admin `AGENTS.md` and installed Next guides. Add a guarded synthetic reference moderation server adapter and BFF using fresh API-bound staff context and these SDK methods. Review loading must acquire the exact current revision and its stored historical catalogue; no automatic current-catalogue relabeling. Retain a frozen original transition in actor/tenant/listing/revision-scoped tab storage before one POST; an uncertain result locks replacement actions and offers explicit original GET recovery. A denied or malformed recovery must not discard that uncertainty. Render the complete private review content, historical attributes, ordered media and operational context; require an explicit reason for rejection. Preserve current role/assignment checks, stale versions, pause state and explicit refresh after settling. Then test connected BFF/UI flow and mount it default-off; only afterward enable the fourth proposal in an isolated explicit preview and verify browser events/reload/recovery. Public mapper integration, create/successor/import conversion and external acceptance remain open.

Keep existing old preview cleanup rejection intact and preserve the independent browser worktree and clean restore evidence. KES 10,000 remains the total monthly client price baseline. Vendor resources/old live system remain intact; checklist remains 23/97 tasks (24%) and 0/14 accepted gates until complete task evidence is met.
