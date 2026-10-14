# Private SQL reminder suppression — 15 October 2026

Additive migration 0019 supplies two private planning primitives: strict candidate validation and a decision against an already-loaded authoritative viewing row. The decision matches the domain predicate for target/version/cycle/slot/agreement changes, non-confirmed states, enquiry/listing eligibility, record clock, due/expiry and slot start. Normal saved outcome rows suppress earlier confirmed candidates.

Both functions are owned by `realtor_owner`, pin `search_path` to `pg_catalog`, and revoke execution from PUBLIC and `api_runtime`. There is no new runtime API, security-definer entry point, table, queue, claim, lease, provider adapter or external send. Passing a row and eligibility booleans to a pure helper does not itself establish authorization or current tenant scope. Future protected claims must load and lock authoritative rows, derive scope and eligibility themselves, and supply the server clock. No public endpoint may accept a caller-selected clock.

The candidate validator requires exact keys, canonical string UUID/version/time facts, valid Nairobi slot and ordered agreement/confirmation/due/expiry. A review tightened both domain and SQL candidate IDs/versions against trailing line breaks; dedicated regression cases reject them rather than normalizing them. The domain suite now has 155 passing checks. Eight focused SQL contexts passed: boundary parity, changed-fact and eligibility suppression, distinct later cycle, invalid/null data, trailing-line regressions, persisted first/later outcomes and runtime privilege denial. The initial privilege fixture omitted `SET ROLE api_runtime` after entering its NOINHERIT login; corrected fixture checks the actual role and denial of owner escalation. Failed diagnostic log remains.

The final unchanged-input run passed all 191 database checks, including these eight focused contexts; all 66 signed integration checks, package builds and eight workspace typechecks also passed. An earlier broad run overlapped the canonical-token review edit and is retained as diagnostic evidence, not the final acceptance run. No real PostgreSQL concurrency, native/device/operator UAT, hosted account, delivery or cutover acceptance is implied.

## Next durable admission and claim contract

Add private immutable original candidates/admission receipts and attributable append-only claim/attempt evidence. Bind tenant/enquiry/viewing/requester and exact explicit policy window; recover exact originals independently from fresh eligibility. Protect runtime tables with forced RLS and no direct DML.

Admission and claim must lock enquiry then viewing in the same order used by lifecycle writes, and check listing eligibility under a compatible lock. Recheck current version/cycle/slot/agreement and terminal state before claim. A reminder cannot claim using an old confirmation after a replacement proposal/ending/outcome has committed. Record waiting/suppressed decisions without changing viewing/enquiry versions.

Use only a capture-only synthetic adapter while provider ownership, recipient/channel/consent, cadence and budget remain unresolved. Define durable claim idempotency and bounded lease semantics before an adapter exists. Never hold a SQL transaction over a provider request or promise recall of a message already accepted by a provider. A later real PostgreSQL race test remains distinct from PGlite serialization.

Checklist16/97, accepted gates0/14, total monthly price KES10,000 and vendor/old-live preservation remain unchanged. Independent off-device source backup and rights/accounts/device/UAT/hosted/cutover evidence remain pending.
