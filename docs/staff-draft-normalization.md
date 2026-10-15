# Shared private draft normalization — 15 October 2026

The private partial-draft normalizer and types now live in `@realtor/domain`. The SDK delegates to it and retains its existing public `validateStaffDraftContentV2` API/error categories. The field list is shared. This prepares creation/original-recovery contracts to use one normalized private input model across maintained clients.

Save remains full replacement. Omitted base fields become null/defaults; required pricing/location remain explicit. Incomplete drafts do not gain invented purpose, price, bedrooms, location or rental period. Exact KES integer minor units, Unicode codepoint limits, room/type rules, coordinate pairs, charge purpose/classification and supplied pricing arithmetic retain the prior SDK rules. Private address spacing/newlines remain original; display text uses its established trimmed form. Nested pricing/location and the returned content are detached/frozen.

Plain own enumerable data records are required. Classes, inherited data, hidden fields, symbols and getters are rejected without executing caller getters. Complete response mode additionally requires all fields, valid required defaults and defined JSON data. This hardens an earlier SDK base-content record reader that allowed accessors/hidden fields. API raw JSON parsing and SQL guards remain separate; existing draft HTTP endpoints were not changed by this extraction.

Final178domain(5new)/207SDK(1new)/200admin/68integration checks,8workspace typechecks and domain/SDK/API/admin builds passed. Focused5 domain checks overlap full178. Shared SDK regression proves malicious content fails before any HTTP write and no getter executes. Existing restricted-SQL and signed HTTP journeys passed as compatibility coverage; this slice adds no new SQL, creation operation, browser/device/UAT/provider/launch evidence. No failed tests in this slice.

Logs: `../rebuild-preservation/2026-10-12-source/staff-draft-normalization-{domain,sdk,admin,integration,types}.log` and API/admin build logs. Previous184API unit/213database/8staff-preview checks and actual operator browser evidence belong earlier checkpoints and were not rerun here.

## Exact next creation contract

Define strict creation command/original receipt around operation ID, requested listing UUID, bounded slug and this normalized private content. Derive current creator/company/assignment internally. Initial creation must allocate listing plus revision atomically and retain an exact original receipt after lost replies, without allocating another listing or adopting later draft versions. Original reads/replay require current staff membership, original requester and current assignment for successful targets. Refused duplicate slug/identity decisions must not reveal another agent's private inventory.

Concurrent same-operation creation needs a reservation even before the listing exists. Assess immutable operation reservation plus completed receipt with deferred completion linkage, or another verified PostgreSQL-compatible mechanism; do not claim row locking on a nonexistent listing solves it. SQL must guarantee complete operation or full rollback, minimize audit content and reject changed request facts under a reused operation. PGlite proofs are not real hosted PostgreSQL race evidence.

Normalize before submission and validate receipts inside the API transaction. Document bounded retention of any private request snapshot; no content in audit/logs/dashboard. Existing zero-version raw draft allocation is not durable original-operation recovery. Decide and test its transition before claiming creation is enforced exclusively through new commands. Keep old bootstrap fixture calls distinct from exposed HTTP behavior.

Successor revisions require current listing/latest revision version correlation, allowed previous state and approved-public snapshot preservation. Define content copy/input and media reset/reuse deliberately; never silently carry accepted media provenance into new work. Implement creation first, then successors, fixed SDK/BFF/operator retained attempts and signed/browser reply-loss/current-access proof. These commands remain next work, not implemented by the normalizer.

Checklist16/97; gates0/14; KES10,000 total monthly client price. Vendor resources/old live preserved. Private off-device Git destination/push access, rights/accounts, native/device/operator UAT, hosted verification and cutover remain pending.
