# PostgreSQL foundation

This is independently written replacement code. It creates no cloud resources, reads no vendor database and carries no production credentials. The executable suite uses a new **in-memory PGlite database per test**. Its successful checks are PostgreSQL policy/constraint evidence, not Supabase integration, authenticated HTTP tests, a backup/restore exercise or a production security sign-off.

From the monorepo root, after installing the root development dependencies:

```powershell
node --test database/tests/*.test.mjs
```

`migrations/0001_foundation.sql` is a one-time transactional bootstrap for a fresh dedicated database. It deliberately fails if its roles/schemas already exist; it is not a migration-history runner. A migration administrator must be permitted to create roles, create schemas owned by `realtor_owner` and set that role. No deployment has been attempted on a managed service. Test its actual provider permissions, PostgreSQL version, role behavior, transaction pool and backups in a separate nonproduction environment before deployment. Never run bootstrap through an application login.

## Data included

Eight private tables hold companies, memberships, stable listings, revision content, media-processing metadata, public snapshots, enquiries and audit events. Tenant-owned relationships use **composite company/object foreign keys**, including listing assignments, publication revision references and the exact revision contacted by an enquiry. `created_by_id` records attribution while `assigned_agent_id` controls operational access.

`amount_minor` is positive `bigint`, capped at `100000000000000`, and `currency` is always `KES`. Rental periods are `day/week/month/year`; sale rejects a rental period. Canonical property types, exact bedroom counts, null bathroom counts, paired valid coordinates and area/exact public precision have database constraints. Incomplete drafts are allowed; submission requires complete content and 4–12 accepted media rows. `private_address` never enters the public snapshot. Area precision omits stored coordinates from the public snapshot.

The shared TypeScript contract is authoritative at application boundaries. A future trusted adapter maps `KesMoney.minorUnits` to SQL `amount_minor` and the internal `save_draft` JSON key `amountMinor`; it maps shared `rentalPeriod` to SQL `rent_period` and internal JSON `rentPeriod`. Those internal JSON keys are not a new browser API. Adapters must validate against the shared contract first, bound `bigint` values before number conversion and map snake_case rows explicitly rather than spreading private rows into public responses.

`public_snapshots` is separate from working revisions. `app_api.public_listings` exposes only that reviewed projection for the current configured company, available published stock, enabled companies and availability confirmations newer than 30 days. Draft edits and rejected revisions leave the existing publication untouched. Approval and snapshot replacement occur in one function transaction; approval of an older revision after a newer published revision is rejected. Approval preserves an operational pause or archive, including its archive timestamp: the new approved snapshot stays private until an administrator explicitly restores publication. Approved/rejected content, submitted media and audit rows cannot be changed through ordinary updates. A rejected revision is retained; corrections use a new sequential draft. A pending revision can be withdrawn to a draft with an audit event. Admin self-approval is permitted and explicitly recorded.

The media table is **metadata storage only**. Tests insert synthetic accepted metadata as the bootstrap administrator to represent a trusted processor. The application runtime has no write permission for it. No file decoding, checksumming, object-storage authorization, processor role or worker integration is implemented here. Never set `accepted=true` from a visitor payload; add a narrowly scoped worker command only after the upload/processing service proves signature, decode, size, metadata removal and tenant/object checks.

## Trust boundary and roles

All eight tables enable and **FORCE row-level security**. `api_runtime` has `NOLOGIN`, `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`, no membership in `realtor_owner`, no table DML and no general private-helper execution. It can read private rows allowed by RLS, read the public projection and execute the narrow commands in `app_api`. The nonlogin `realtor_owner` owns objects and has an explicit owner policy; fixed-`search_path` security-definer command functions act as that owner after checking context, current company/membership, role and assignment. Audit writes are internal to these commands. Function default execution privileges are revoked from `PUBLIC`.

This is a **trusted server connection model**. Company/actor settings are context, not authentication. Anyone with a usable database connection authorized to set the runtime role could set arbitrary context values. Therefore no database password, direct SQL endpoint or broad SQL runner may be exposed to web/mobile/admin clients. It is not a JWT policy for direct browser-to-Supabase table access.

An application server must validate its session/token, independently resolve an enabled company from a trusted configured domain, and use a dedicated pool login with only membership in `api_runtime`. That login must have no owner/service/admin privileges and must `SET LOCAL ROLE api_runtime` for each transaction. After identity verification, set company/actor/correlation settings **locally in that same transaction**, using query parameters. A guest has an empty actor value. Never copy caller-supplied roles or actor IDs into context. Re-check current authorization on every request; the database checks active membership for each command/private query.

The intended parameterized server transaction is:

```sql
BEGIN;
SET LOCAL ROLE api_runtime;
SELECT set_config('realtor.tenant_id', $1, true),
       set_config('realtor.actor_id', $2, true),
       set_config('realtor.correlation_id', $3, true);
-- Run a fixed, allowlisted query/command; identifiers are never caller SQL.
COMMIT;
```

Always roll back on failure and do not reuse a connection with an open transaction. The test suite verifies that local context does not carry to a later transaction. Provider-specific pooling/role reset still needs separate integration testing. Never grant the application login `realtor_owner`, database ownership, `BYPASSRLS` or broad service-role credentials. The bootstrap login is used only to create fixtures, inspect invariants and attempt explicit constraint attacks in the local suite; application acceptance operations run after `SET LOCAL ROLE api_runtime`.

## Command surface

| Command | Application permission / behavior |
|---|---|
| `create_listing` | Active agent creates assigned to self; admin may choose active company staff. Server supplies generated UUID and validated slug. |
| `save_draft` | Assigned agent/admin; only a draft, expected revision version required. Zero creates the next sequential revision. Rejects unknown fields and wrong JSON scalar types. |
| `submit_revision`, `withdraw_revision` | Assigned agent/admin; exact expected revision version and workflow state. |
| `decide_revision` | Admin only; pending exact version, nonblank rejection reason; approval requires recent availability confirmation and a nonsuperseded revision. |
| `confirm_availability` | Assigned agent/admin; exact listing version. Unavailability removes public discovery. Reconfirming availability does not resume paused publication. |
| `set_publication` | Assigned agent may pause; admin may pause/archive/restore publication if approved/available/fresh. |
| `reassign_listing` | Admin only; exact listing version and active company staff. Attribution remains unchanged. |
| `record_enquiry` | Enabled company, guest or current active member; listed property must be currently public. Immutable contacted revision and retry key retained. Equivalent retries return the original receipt; changed payload with same key conflicts. Transaction advisory lock serializes equivalent concurrent retries. |
| `assign_enquiry` | Admin only; active company staff, expected version. |
| `transition_enquiry` | Assigned agent/admin; allowed state transition, next action for contacted/qualified, closure reason for lost/spam, reopening reason and expected version. |

Runtime cannot read another agent's private listing/revisions/media/leads, or another company's private records. Customers/guests cannot create listings or read lead contacts. Audit table reads are admin-only in this foundation; the planned safe agent transition-summary projection remains to be implemented. General enquiry assignment is explicit, not visitor-controlled. Receipt IDs and idempotency keys must be cryptographically generated by the trusted API. Reject conflicts through safe, non-disclosing HTTP mappings; do not expose raw SQL errors/constraint names or database stack traces.

## Remaining delivery gates

This is the first persistence foundation, not the complete pilot schema or a connected backend. Auth/session verification, authorized API adapter, rate limiting, CSRF policy, customer receipt endpoint, cross-tab/mobile logout, identity-provider membership administration, private media URLs, scheduled freshness alerts, charge rows, complete geography/areas, viewing workflow, reports, policy versions, retention jobs and exports still require implementation and their own tests. Tenant/domain/brand provisioning currently belongs to later application integration; no runtime company/staff administration command exists here.

PostgreSQL with PostGIS remains the production target. This migration uses bounded optional coordinates without fabricated fallback pins and deliberately does not install extensions. Add a reviewed PostGIS geography migration and index only when a real PostgreSQL staging environment can exercise extension availability, area precision and geospatial query behavior; PGlite tests do not prove that integration. No live provider test, real-device check, operator UAT, authorized migration or launch gate is claimed by this directory.
