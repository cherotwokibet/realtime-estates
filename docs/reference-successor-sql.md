# Isolated reference-aware successor SQL

Checkpoint 157, 24 October 2026. This candidate composes an existing guarded successor with explicit reference adoption in the same transaction. It is **not registered in the default migration order or exposed by the API, SDK or operator UI**.

Load `database/proposals/listing-reference-successor.sql` after the existing draft, catalogue installation, reference read and moderation proposals. The candidate test also loads reference creation to check coexistence. Only independently authored synthetic catalogue and listing data are used.

## Command and original

`app_api.start_synthetic_reference_successor(listing, operation, expectedListingVersion, predecessorRevision, predecessorVersion, predecessorState, content, selection)` requires the current assigned agent or an administrator. The predecessor must be the current latest approved or rejected revision with exactly the supplied versions. Content is explicit canonical content, including private facts and prices; references must match its public disclosure and the currently installed catalogue.

The function locks the listing, invokes `start_listing_revision_v2`, derives the allocated revision from its applied original, and calls `save_synthetic_reference_draft` at expected revision version 2. The adoption produces version 3. Its immutable JSON original has policy `synthetic-reference-successor-v1` and contains `successor` and `referenceDraft`. The initial versions 2/3 are historical receipt facts; they do not represent a later edited draft's current version.

Unknown, stale or incompatible selections, mismatched disclosure, stale predecessor and any completion failure roll the statement back, including successor reservation/result, allocated revision, listing version and audit events. A base conflict or refusal raises SQLSTATE `40001`; it cannot commit a reference-less partial result for this composed command. This matches the isolated creation convention. Callers must handle the failed transaction normally; this candidate does not introduce an automatic retry.

No predecessor media are copied. A new revision starts with an empty gallery. Existing approved publication and its public pointer stay on the approved predecessor. Starting a successor supplies no new image verification, availability confirmation, submission, approval or cutover authority.

## Recovery and access

`app_api.read_synthetic_reference_successor(listing, operation)` observes only a completed private composed marker. It locks the listing and checks the existing successor original's current requester, tenant, membership, role and assignment before returning private facts. Another agent, another tenant, a customer, a revoked requester or the requester after reassignment cannot recover or replay the original. An administrator who was not the requester cannot read another actor's private original either.

Matching explicit replay returns the stored original without saving again, including after catalogue activation and later draft edits. Changing any predecessor fact, listing version, content or reference selection under the same operation fails. The marker is immutable, FORCE RLS, and unavailable to runtime table reads and DML; it references both underlying durable originals.

Two independently executed legacy calls do not constitute a completed composed original: recovery fails until the explicit composed command itself succeeds. As with reference creation, that command may reuse both fully matching underlying originals and then append the completion marker. It cannot silently infer completion through GET or invent a different selection. This reuse policy must be retained or deliberately revised in the future domain contract before exposing the route.

## Verification and limits

The focused PGlite test exercises real guarded creation, submission and administrator decision, atomic rollback, exact replay, current access revocation/reassignment, immutable/runtime protection, approved pointer preservation, empty successor gallery, historical replay and independent-original recovery denial. Sealed media history is explicitly a privileged disposable SQL fixture with no image bytes or native decoder. The version-limit fixture temporarily disables only the disposable database's listing touch trigger to place a counter at the boundary, then immediately restores it. A separate injected marker-insert failure verifies rollback after reference adoption.

Evidence is retained in sibling `rebuild-preservation/2026-10-12-source/reference-successor-sql-focused.txt` and `reference-successor-sql-database.txt`. Passing PGlite checks do not establish concurrent hosted PostgreSQL behavior, production migration compatibility, real media, browser/operator integration, device testing, UAT or release acceptance. See the dated continuation checkpoint for actual counts and backup/publication evidence.

Next: define a strict bounded domain command/composed receipt, including historical catalogue validation, exact original matching and version relationships; then default-off API/SDK and operator recovery using this candidate. Keep default migration registration pending reference import conversion and schema compatibility checks. KES 10,000 remains the total recurring client price per realtor; vendor resources and the old live system remain preserved.
