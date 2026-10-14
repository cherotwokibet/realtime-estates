# Atomic synthetic reminder attempts — 15 October 2026

Migration 0021 adds an immutable private attempt ledger and exact original recovery for SQL-only synthetic captures. The fixed `capture-only-v1` mode has no recipient, provider, network call or delivery claim. Eligible work becomes a synthetic capture in the same transaction; this is not a leased remote job.

Current tenant/staff/assignment and the admission's original requester are required. Enquiry, viewing and listing locks follow the existing order. The decision clock is chosen after acquiring all authoritative locks. Authority is checked again before recording, and an insert guard rechecks scope, current state and a fresh clock. New attempt timestamps must belong to the current statement. These guards prevent a backdated capture from bypassing expiry or a changed viewing.

Every fresh attempt evaluates the immutable candidate against current version/cycle/slot/agreement, due/expiry/slot start, enquiry closure and listing eligibility. Waiting and suppressed outcomes are durable; replaying one never upgrades it. A deliberate new operation may retry after real time or state changes. The partial unique index permits one captured row per admission; later eligible operations return the original capture as duplicate evidence. Original operations recover before fresh eligibility checks after current access/requester checks, preserving history after cancellation or rescheduling.

The ledger is forced-RLS and has no direct runtime table access. Composite foreign keys bind admission identity and duplicate capture provenance. Update/delete guards protect evidence even from ordinary owner writes. Rollback removes the synthetic capture, attempt and audit together. Only a new capture emits a minimized audit; duplicate/read/replay does not emit another capture. Enquiry and viewing versions remain unchanged.

Strict shared command/receipt validators accept operation-only capture commands and bind original admission, requester, target, fixed kind/mode, expected/observed version, capture provenance and time boundaries. Captured, duplicate, waiting and suppressed originals are separate shapes. Validators detach/freeze facts and reject getters or hidden authority without executing them.

## Verified checkpoint

167 domain checks passed (6 new capture contexts). The focused SQL run passed 22 contexts: 11 existing admission checks using the extracted fixture plus 11 new capture contexts, with actual SQL receipts validated by the domain. This covers exact original recovery, duplicate capture, operation/admission binding, refused-admission denial, real one-second waiting→new-operation capture, unchanged waiting originals, full rollback, forced RLS/private-helper denial, backdate rejection, foreign/inactive/assignment denial and restoration, withdrawal/restoration, replacement proposal/new phone agreement, closure/cancellation and completion/no-show suppression.

The waiting test used real elapsed time; no clock was changed. Completion/no-show cases used fictional saved 2020 admission/viewing history seeded through normal constraints, followed by actual current SQL outcome writes and fresh suppressed attempts. They are not past HTTP execution or real attendance/delivery. The shared test/development fixture is a separate helper, not an imported test module.

Initial SQL used an ambiguous local `receipt` variable; it was renamed and the query qualified. A domain negative fixture accidentally reused its original enquiry ID; corrected to a different ID. Failed logs remain. The final full database run passed all 213 checks, including the 22 focused admission/capture contexts. All 66 existing signed integration checks, eight workspace typechecks and package builds passed. Existing signed checks prove compatibility; no capture HTTP route or signed capture scenario exists yet. Focused counts overlap the final database suite rather than adding to it.

## Exact next HTTP/SDK integration

Add an explicit server-side capture-only feature mode, disabled by default. Fixed protected admission POST carries only operation/version/due/expiry, and its original GET binds enquiry/admission operation. Fixed capture POST carries only its operation ID under an admission path; original capture GET binds that admission and operation. Caller clock, mode, recipient, credentials and authority are forbidden.

Expose a strict self-contained admission snapshot validator that revalidates its exact original facts and optionally binds expected route IDs. The capture API transaction should read the immutable original admission under current access, then execute capture and validate the receipt against that admission. SDK capture takes a validated retained admitted receipt, performs one POST, and validates exact returned evidence; original recovery performs GET only, with no automatic write retry. Keep all old endpoint/receipt contracts compatible.

Add meaningful command/path/authority/malformed-reply/uncertainty tests and one signed HTTP restricted-SQL scenario for committed capture reply loss, exact original GET/replay, deduplication, waiting/suppressed history, current access loss/restoration and late lifecycle suppression. A literal network failure, real PostgreSQL race, browser/device/UAT or provider delivery is separate evidence.

Then server BFF capture may read the immutable admission before one upstream capture POST; recovery performs upstream reads only. Browser transport/retained attempts keep exact admission and operation, clear private feeds on denied reads, block uncertain discard and never adopt another viewing/version automatically. Use an explicit synthetic preview mode and a targeted first-captured-reply fault before actual two-tab browser proof. Never accept browser-supplied actor/company/mode as authority.

Before any remote adapter: controlled service identity, recipient/channel/consent, approved cadence/budget, bounded lease/recovery/provider idempotency and real hosted concurrency. SQL-only atomic capture does not prove those. No transaction may span remote I/O, and no recall is promised after a provider accepts a message.

Checklist16/97; accepted gates0/14; KES10,000 total monthly price; vendor resources and old live system preserved. Rights/accounts, private off-device source destination/push access, native/device/operator UAT, hosted verification and cutover approval remain pending.
