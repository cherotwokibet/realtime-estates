# Existing staff membership administration

Checkpoint248, 2 November 2026. Independently written local synthetic candidate; task08-4 remains incomplete.

`database/proposals/staff-membership-changes.sql` is isolated from normal migrations. It changes existing agent/admin memberships only, preserves their rows and operational foreign keys, and never creates staff, converts customers, assigns branch authorization or redeems an invitation.

Every command includes a new operation UUID, target member UUID, expected positive safe version, requested agent/admin role, active flag and bounded plain reason. A configured-company current admin is required. Tenant locking precedes actor revalidation and target locking. All self-target commands are refused so the operator retains current-admin original recovery. An explicit last-admin guard also protects demotion/revocation. Applied changes increment the version and append a safe audit summary; no-op and stale-version conflict results are durable originals without another change.

Original receipts are immutable and accessible only to their current authorized original actor. Identical replay returns the original; changed facts or actor are refused. Current projections omit operation actor/reason. Existing administrative changes outside this candidate must follow its serialization/version protocol before any production promotion; PGlite proof does not establish hosted concurrency.

Explicit API option `staffMembershipMode: 'synthetic-existing-members-v1'` is refused in production. Omission returns404 before identity/database work. Routes:

- POST/GET `/v2/staff/memberships/operations/{operationId}` — save or recover an original.
- GET `/v2/staff/memberships/{memberId}` — current existing-staff state.

Company and actor are server-owned, bodies are bounded and duplicate-aware, and exact projections are validated before transaction commit. Typed SDK methods are `saveStaffMembership`, `getStaffMembershipOperation` and `getStaffMembership`; strict8KiB JSON/status validation and no automatic replay preserve uncertainty. `startStaffPreview` enables the isolated proposal only with that explicit mode. Optional `membershipReplyFault: 'invalid-first-membership-result-v1'` corrupts the first committed successful result for GET-only recovery verification.

See [execution and browser evidence](evidence/2026-11-02-staff-management.md). Next: bounded membership directory, BFF/controller/UI and actual browser role-loss/recovery, then recipient-verified single-use invitation redemption. Delivery, provider/devices/operator acceptance and release/cutover gates remain separate.
