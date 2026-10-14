# Viewing reminder suppression foundation — 14 October 2026

The domain now prepares a detached internal reminder candidate from an already confirmed viewing and an explicit trusted due/expiry window. It retains target IDs, selected viewing version, cycle number, exact slot and attributable phone agreement times. It contains no recipient address, provider credential, message or browser-selected authority. There is no invented default reminder cadence.

The pure recheck validates both candidate and fresh saved detail, then suppresses changed target/version/cycle/slot/agreement, any non-confirmed state, closed enquiry, unavailable listing, clock before saved record, expiry and slot start. Due is inclusive; expiry and slot start suppress inclusively. Before due it waits. Completion, no-show, cancellation, decline and a replacement proposal all suppress old candidates; a later confirmed cycle requires its own candidate. Raw private history is not mutated.

154 domain checks passed (8 new reminder contexts), plus package builds and all eight workspace typechecks. Tests cover exact time boundaries, first/later cycles, terminal states, closure/availability, immutable input, malformed versions/timestamps/windows, extra authority and getters without executing them. Historical fixture timestamps are pure supplied test values; no service clock was changed. Existing 181admin/19preview/66integration/browser evidence belongs to the preceding outcome operator checkpoint and was not rerun here.

This is a planning foundation. `eligible` means only that these supplied facts satisfy this pure predicate. It is not authorization, durable queue admission, a provider send, consent, a deduplication claim or an atomic dispatch claim. No invitation, email, SMS, WhatsApp, purchase or external message occurred.

## Exact next implementation

1. Add additive private reminder candidate/attempt storage and typed privileged functions. Derive tenant, staff/service scope and current eligibility server-side; forced RLS and runtime tables remain protected. Validate exact current confirmed cycle/version/slot/agreement at admission and again when claiming work. Keep original queued facts immutable and suppressed decisions attributable. Avoid importing test helpers into production modules.
2. Serialize claims and lifecycle writes using the same viewing row lock. Never claim a stale reminder after cancellation, decline, rescheduling or outcomes commit. Check current enquiry status and listing availability under appropriate locks. Decide and document a limited claim/delivery lease; no promise of recall after a provider has accepted a send. Ordinary SQL transaction locks cannot be held over a remote provider call.
3. Bind destination, permitted purpose/consent and notification channel from controlled records; define approved cadence, delivery budget and idempotency before enabling a real adapter. All rights/account/provider control remain pending. Use a synthetic adapter and capture-only attempts while unresolved.
4. Add meaningful restricted-SQL tests for first/later agreement, suppression between admission and claim, concurrent claim/deduplication, unavailable/closed/current access, lease expiry and exact attempt recovery. PGlite cannot prove real PostgreSQL races; keep that separate hosted gate.
5. Connect explicit operator/read-only delivery evidence only after durable contracts. Recheck no outbound credentials in browser, and validate synthetic recovery before any proposed real notification enablement.

Checklist 16/97; accepted gates 0/14. KES10,000 total monthly service price, vendor preservation and old live system remain unchanged. Native/device/operator UAT, account/rights, independent off-device backup, hosted verification and cutover approval remain pending.
