# Synthetic reference draft persistence candidate

Checkpoint129, 23 October 2026. This is executable SQL in `database/proposals/listing-reference-draft.sql`, explicitly loaded only into disposable candidate test databases. It is absent from the default migration list and has no HTTP, SDK, editor or mobile caller. Task06-1 remains open. No hosted database, real reference dataset, device, operator acceptance or production result is claimed.

## Chosen compatibility boundary

Use a combined versioned draft command, rather than an independently versioned attribute side table. The candidate accepts an existing draft's exact normalized v2 content, an explicit reference selection, the current editorial revision version and a request UUID. It validates the selected chain and applicable amenities against owner-installed synthetic tables. The full content and server-derived attribute snapshot are retained in one UPDATE; the existing revision trigger increments the editorial version exactly once. No draft allocation, free-text-to-ID inference or implicit clearing of selected amenities occurs.

The existing v2 disclosure must explicitly equal the selected labels (`county/town/area` corresponding to county/locality/neighbourhood). All-null selection requires all-null disclosure. Legacy `locality` remains an independent existing field; no meaning is inferred from it. A future contract must decide whether to remove or explicitly constrain that duplicated field. Full content validation and existing table constraints apply atomically with the selected attributes.

After adoption, a legacy content change fails with “Reference-aware combined command required.” Only the new combined command changes the private operation marker; runtime has no direct table write or private helper grant. The marker is a stored command fact, never a caller-settable session flag. Replaying an unchanged legacy save may advance the editorial version but cannot change content or attributes. A new combined command must use a distinct operation UUID and current editorial version.

Adopted drafts **cannot submit**: the candidate trigger explicitly rejects any non-draft state until reference-aware review exists. The submission test supplies complete content and four sealed SQL-only media fixtures and checks the exact candidate rejection, so a missing-photo error cannot masquerade as proof. This deliberate development boundary prevents the existing review projection from authorizing attributes it cannot display. It is a reason this candidate must remain outside default migrations, not a launch-ready workflow.

## Active call graph inspected

| Boundary             | Current implementation                                                                                                                  | Transition required before activation                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Save                 | `apps/api/src/service.ts` v1/v2 draft handler calls `save_draft/save_draft_v2`;0024 wrappers delegate to private internal v1/v2 helpers | Add explicit v3 command/DTO and original recovery. Preserve v2 refusal after adoption.                                                |
| Create               | API creation handler calls `create_listing_draft_v2`;0024 allocates through `save_draft_internal_v2` with expected0                     | Existing unadopted creation remains valid. Define explicit reference-aware creation or subsequent adoption; never silently infer IDs. |
| Successor            | API successor handler calls `start_listing_revision_v2`;0024 allocates via the private v2 helper                                        | Define explicit successor selection and frozen snapshot provenance before adopted revisions can reach terminal state.                 |
| Import               | 0028 exposes `read_listing_import_stock` only; API import preparation and guarded create/successor paths use existing exact v2 content  | Version the import plan/content explicitly. A stock read is not an attribute write or import acceptance.                              |
| Submit               | API calls `submit_revision`;0001 validates current version/media and advances state                                                     | Candidate blocks adopted submission until the review read, submit and decision contracts all carry the same saved attributes/version. |
| Review               | API v2 review projections, metadata and `decide_revision`;0001 checks pending state/current version                                     | Add reference-aware projections and stale-review tests; never permit invisible attributes to be approved.                             |
| Approved public data | 0001 copies the approved revision;0002 trigger copies exact pricing/location; public API selects `public_listings_v2`                   | Add immutable approved attribute copy and explicit public DTO; never join newer catalogue labels into historical approvals.           |

This inventory identifies inspected active boundaries. It is not an exhaustive dynamic caller trace or hosted concurrency proof.

## Authorization, durability and evidence

Write and original-read functions check current staff role, tenant and assignment through the existing listing lock. The append-only receipt table binds tenant, actor, listing, revision, expected version, exact content and selection. Identical original replay returns the original receipt before checking later catalogue currency. Changed payload or requester conflicts. Recovery is original-actor-only and rechecks current access. The receipt is inserted in the same transaction as the revision update and audit. The receipt table is forced-RLS and inaccessible directly to runtime. Catalogue tables are global synthetic reference data, owner-managed and inaccessible to runtime writes.

Nine candidate checks (parent plus eight bounded subtests) passed with zero failures/skips. They exercise one-version atomic save, original replay/GET, payload conflict, legacy edit refusal, exact submission refusal, stale core/catalogue rejection, wrong-parent and incompatible/duplicate amenity rejection, explicit disclosure mismatch, assignment/customer/other-tenant/other-actor denial, revoked membership, direct DML denial, whole-transaction rollback, receipt immutability, detached historical labels after a newer catalogue, explicit unknown selection and preserved unadopted v2 submission. Media fixtures are fabricated relational test records; no actual image decoder or upload ran. PGlite tests do not establish real multi-connection locking behavior.

The complete database suite and formatting outcome are recorded in CONTINUATION.md and sibling `listing-reference-draft-*` logs. No package code changed, so earlier package/domain/type/browser/device results are not claimed as rerun here.

## Exact next work

1. Add an explicit catalogue manifest/activation transaction. Current candidate “highest installed location version” policy is development-only and cannot support an intentionally empty current catalogue. Enforce full catalogue parity (NFC labels, global location/amenity ID uniqueness, duplicate type rejection and size bounds) at ingestion; never claim the owner-curated SQL fixtures are a complete validated production dataset.
2. Add strict shared v3 command/receipt/read DTOs, API/SDK bounded recovery and a reference-aware draft editor. Decide explicit legacy-locality compatibility and listing-operation locking/idempotency outcomes; run restricted-role tests against hosted PostgreSQL before concurrency claims.
3. Extend submit/review reads, current revision decisions, immutable approved snapshots and public projections together. Remove the submission block only after stale review, mutation denial, snapshot isolation, rollback and original recovery tests pass.
4. Convert create/successor/import callers deliberately; preserve unknown facts and synthetic-only mode. Review all default migration consumers before registration. Obtain authorized reference data and operator/device evidence separately.

The old live system/vendor resources, optional module deferrals and KES10,000 gross monthly total/client baseline remain unchanged.
