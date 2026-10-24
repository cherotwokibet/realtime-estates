# Ordinary allocation recovery foundation — checkpoint 166

24 October 2026. Independent source and synthetic data. This is infrastructure for the maintained ordinary creation/successor flow; its screens and stale-scope BFF guard are still pending. Task 06-2 remains open, with 23/97 tasks verified (24%) and 0/14 exit gates accepted.

## Verified current identity

`GET /v2/staff/session` returns only the `current-staff-session-v2` policy, configured tenant UUID and verified actor UUID. Every call verifies authorization and checks the current restricted database staff role. Customers, revoked members and actors outside the configured company are refused. The route is read-only, no-store, body-free and rejects query/fragment aliases, cookies, framing, conditional and caller-authority headers. It requires no isolated reference mode or reference SQL proposal.

The SDK uses one authenticated request with credentials omitted, redirects refused, cancellation, strict JSON/UTF-8 and an 8192-byte streamed response limit. It rejects malformed, duplicate or extra identity fields. There are no automatic retries. The development relay supports this canonical path without enabling reference features. `readStaffAllocationScope` combines this verified server read with the configured preview instance. No bearer enters its returned projection or browser storage.

## Retained original primitives

`allocation-recovery.ts` provides creation and successor sessions keyed by instance, tenant and actor; successors also bind the fixed listing. Creation opens without generating a new listing or operation UUID. The canonical stored envelope contains the full original validated command, including exact costs and private synthetic facts. Bounds, strict duplicate-key parsing, exact scope/schema/target and canonical byte checks fail closed without deleting corrupt originals. Existing entries cannot be overwritten, and write/readback must succeed before transport.

Attempts retain detached immutable commands, bind their transport methods, and permit explicit original GET or exact replay only after uncertainty. Reload restoration performs no network call and generates no UUID. Denied recovery cannot erase previous uncertainty. Wrong-actor or malformed successful receipts, cancellation and changed bytes in flight cannot authorize a draft handoff. Sending/uncertain attempts cannot be discarded. A confirmed receipt exposes only listing/revision identity for a fresh authoritative draft read; its initial version is never edit authorization. Clearing requires the matching stored original.

Successor entry restores the original before considering current terminal-state eligibility. Thus an earlier committed operation whose current latest revision is already a draft still has a recovery shell. Fresh successor allocation requires a current approved/rejected predecessor; current draft state blocks a new operation before UUID generation.

## Verification and practical limits

Focused new checks: 3 API session checks, 4 SDK session checks, 2 actual signed ordinary-session preview checks, and 13 admin scope/storage/controller checks. The signed fixture uses real loopback HTTP, ephemeral RS256/JWKS, API/SDK and restricted disposable SQL with two synthetic companies. It verifies current agent/admin identities and rejects customers, revoked and foreign-company actors without reference schema. Admin checks cover retained-byte readback before POST, quota/readback failure, competing prepared attempts, full reload reconstruction, exact replay, denied recovery, changed scope/storage, malformed/wrong-actor receipts, cancellation and current-draft successor restoration. A first test fixture attempted to mutate already-frozen normalized input; corrected to a detached mutable caller fixture. No runtime guard was weakened.

Full-suite results and source restore proof are recorded in the dated continuation and sibling `rebuild-preservation/2026-10-12-source/allocation-recovery-*` logs. No new browser screen, Next production build, default-schema migration, native device, real media provider, hosted operation, operator UAT or cutover acceptance is claimed by this foundation.

## Exact next work

1. Bind ordinary browser adapters/BFFs to the captured instance/tenant/actor projection. A fresh server-side current-staff read must compare that projection before forwarding POST/recovery; a browser-selected header is never authority. An actor change must fail before mutation, rather than merely rejecting a wrong-actor reply afterwards. Keep all existing origin, framing, strict-body and route guards.
2. Wire the ordinary creation and successor pages/components to server scope and these retained entries. Restore before fresh IDs or successor eligibility, show the full retained original and explicit recovery/replay, block unsafe departure, support verified full reload and capture destination identity before clearing.
3. Test current-draft recovery shell, actor/tenant/instance changes, concurrent tabs/controllers, storage failure, denied GET, explicit exact replay and fresh-current-version edit. Run actual Next/browser signed fixture before accepting task 06-2; keep isolated proposals default-off and legacy record-only compatibility intact.

Vendor resources and the old live system remain intact. KES 10,000 is the total recurring client monthly price per realtor. External rights, accounts, media, hosting, device, operator review and approved cutover remain separate delivery work.
