# Capture-only reminder admission — 15 October 2026

Migration 0020 adds private immutable original reminder admission decisions. Fixed privileged SQL functions admit a candidate or recover its exact original receipt; they derive tenant and staff from the verified transaction context and require current enquiry assignment. Admission locks enquiry, then viewing, then listing eligibility in the same order as existing scheduling operations. Original replay precedes fresh state/clock/listing checks, after current access and original requester checks.

Each decision retains the exact expected viewing version and explicit due/expiry request. Successful candidates bind current target, slot cycle, exact slot and phone agreement times. The mode is fixed to `capture-only-v1`; it is not caller-selected. A unique partial index and serialized viewing lock prevent a second admitted candidate for the same viewing version and exact window. This is admission deduplication, not provider delivery deduplication.

Stale versions conflict. Closed enquiries, unavailable stock, non-confirmed states, future record clocks, started slots, expired windows, windows before confirmation or beyond the slot, and already-admitted facts refuse fresh work. Valid business decisions are durable. Malformed commands fail before ledger insertion. No viewing or enquiry version increments, slot changes or phone-evidence changes occur.

The ledger uses forced RLS, tenant-bound foreign keys, strict receipt constraints and immutable update/delete guards. A composite foreign key binds tenant, enquiry, viewing and its exact listing together; another valid property in the same company cannot be substituted. Runtime roles have no direct table access. Audit events record only the operation, fixed mode and existing viewing version; a rolled-back admission leaves no receipt, candidate or audit event. Original reads require current staff/company/assignment and the original requester.

Shared domain command and receipt validators preserve exact historical facts without reapplying the current clock. They bind operation/target/kind/mode/version/window, freeze detached candidates and reject hidden/executable fields or altered candidate chronology. The receipt is historical evidence, not current permission to capture or send.

## Verified checkpoint

161 domain checks (6 new admission contexts) and 11 focused SQL contexts passed, including actual SQL-to-domain receipt parity, exact replay, duplicate prevention, durable stale/window refusals, receipt validation independent of unique-index rejection, immutable forced-RLS storage, full transaction rollback, exact property binding, foreign company/inactive role/current assignment denial/restoration, replacement cycle with its own agreement, cancellation and closed/unavailable cleanup. A membership-revocation test initially omitted required `revoked_at`; the fixture was corrected and its failed log retained. Review added the composite property binding; its first regression fixture needed explicit UUID casts, then passed with the expected foreign-key denial. The initial broad run was intentionally interrupted before this final constraint revision.

The final full database suite passed all 202 checks. All 66 existing signed integration checks passed after the property-binding revision, as did eight workspace typechecks and package builds. The first full run caught the old security test's expected table inventory missing the new ledger; that inventory now includes the ledger and its forced-RLS checks passed in the complete run. The 11 focused admission contexts and one focused foundation check overlap the full 202. Evidence logs in sibling preservation use the `viewing-reminder-admission-` prefix. These signed integration checks cover existing workflows; no admission HTTP route exists yet.

## Exact next work

Add durable capture-only claims/attempts and original recovery. Every fresh claim must lock the same authoritative enquiry/viewing and recheck current slot cycle/version/agreement, closure, availability, due/expiry and current authorization. Admission alone never authorizes a later attempt after cancellation, reschedule or an outcome commits.

Keep original admission evidence immutable. Bind attempts to the admission and operation/requester; prevent duplicate synthetic captures transactionally and recover exact attempt outcomes after an unusable reply. Waiting or suppressed decisions must not change enquiry/viewing versions. A capture-only adapter has no external recipient or provider request. Define bounded lease/recovery semantics before adding any adapter that performs remote I/O; never hold transaction locks over remote I/O or promise recall after provider acceptance.

Only after durable contracts: protected HTTP/SDK/BFF/read-only operator evidence and signed synthetic recovery, then hosted PostgreSQL races/device/operator UAT. Recipient/channel/consent, approved cadence/budget/provider ownership, rights/accounts, independent off-device source backup and cutover approval remain pending. No admission HTTP route, SDK write, operator form, claim, capture attempt, message or provider delivery is implemented by this storage slice.

Checklist16/97; accepted gates0/14; KES10,000 total monthly client price; vendor resources and old live system remain preserved.
