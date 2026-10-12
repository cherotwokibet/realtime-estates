# Enquiry operations V2

This additive backend/SDK contract supports assigning an enquiry, recording contact or qualification, closing/reopening it and rescheduling its next action. It uses the persisted database statuses: `new`, `assigned`, `contacted`, `qualified`, `closed_won`, `closed_lost`, `spam`. The legacy domain lifecycle and legacy RPC behavior remain unchanged; the durable receipt promise applies to these new V2 commands only.

All data and verification at this checkpoint are synthetic and local. No staff CRM UI, real-device check, provider connection, production deployment or cutover is implied.

## Reads

`GET /v2/staff/enquiries?limit=50` accepts a canonical limit 1–100 and returns `{items,limit,truncated}`. Items are newest first by `created_at DESC,id ASC`. Fetching limit+1 establishes only whether this bounded result was truncated; there are no global counts or pagination completeness claims.

Each summary contains exactly `id,listingId,contactedRevision,name,origin,status,assignedAgentId,nextActionAt,version,createdAt,updatedAt`. Detail at `GET /v2/staff/enquiries/{id}` adds exactly `phone,email,message,noticeVersion,closureReason`. Nullable listing/revision are paired; the original contacted revision is retained. Reads do not join against the current public listing or require it still to be advertised. Current active admin can read tenant enquiries; active agents can read their current assignments only.

`GET /v2/staff/enquiry-assignees?limit=100` is admin-only and returns `{items:[{userId,role}],limit,truncated}` for active tenant `agent|admin` memberships ordered by user UUID. Only identifiers and actual roles exist; display names are not fabricated.

Wire versions are canonical positive decimal strings no larger than `9007199254740991`. Wire timestamps are UTC milliseconds (`YYYY-MM-DDTHH:mm:ss.sssZ`), years 0001–9999. Dates in the past remain valid for due follow-ups.

## Commands and history

POST `/v2/staff/enquiries/{id}/operations` requires exactly these seven fields:

```json
{"operationId":"00000000-0000-4000-8000-000000000001","kind":"assign","expectedVersion":1,"assignedAgentId":"00000000-0000-4000-8000-000000000002","status":null,"nextActionAt":null,"reason":null}
```

The original operation UUID and complete intent must survive an uncertain reply. The SDK accepts expected version as a canonical string and sends an exact JSON integer between 1 and `9007199254740990`, leaving room for the single version increment. Every unused field must be explicitly null.

| Kind | Required values | Effect |
| --- | --- | --- |
| assign | nonnull assignee; other values null | Admin chooses an active tenant agent/admin. New becomes assigned; other workflow fields remain. Same assignment without promotion is noop. |
| transition | target status; assigned null | assigned→contacted, contacted→qualified, qualified→closed_won; open→closed_lost/spam; closed→assigned if assigned or new if unassigned. |
| reschedule | nonnull next date; other values null | Current contacted/qualified state retains its state and changes only next date. Same date is noop. |

Transition date is required exactly for contacted/qualified, null otherwise. Reason is required exactly for closed_lost/spam or reopening to new/assigned; it must already be trimmed, control-free and 1–1000 Unicode codepoints. Other targets require null reason. Reopening stores its reason in the existing `closure_reason` column, consistent with the legacy schema; the UI should label it according to the current workflow rather than inventing a new note field. New assignment does not reset a previous follow-up or reason.

Each command returns exactly:

```text
{operationId,enquiryId,kind,expectedVersion,
 request:{assignedAgentId,status,nextActionAt,reason},
 outcome,reason,
 result:{version,status,assignedAgentId,nextActionAt,closureReason},completedAt}
```

`applied` increments expected by one; `noop` preserves expected and is possible only for assign/reschedule; `conflict` has `VERSION_CONFLICT` and a result version different from expected; `rejected` preserves expected and reports `ASSIGNEE_UNAVAILABLE` for assignment or `INVALID_TRANSITION` for transition/reschedule. Version conflict is checked before lifecycle or target eligibility. These are stored outcomes, with no enquiry mutation on conflict/rejection/noop. Malformed shapes are rejected before a receipt is installed.

GET `/v2/staff/enquiries/{id}/operations/{operationId}` is read-only original-command recovery. It requires current access, the original requester, and current admin role for an assignment receipt. Historical results do not become the current editable state. Exact POST replay returns the same original receipt after current authorization, without new updates/audit records. Reusing an operation UUID with another resource, principal or intent fails. Revocation, reassignment or admin-role downgrade can remove recovery access.

## SQL and preservation

Migration `0010_enquiry_operations.sql` exposes execute-only security-definer functions with fixed `pg_catalog` search paths:

- `app_api.execute_enquiry_operation(enquiry uuid,operation uuid,expected bigint,kind text,assigned uuid,status text,next timestamptz,reason text)`
- `app_api.read_enquiry_operation(enquiry uuid,operation uuid)`
- `app_api.list_enquiry_assignees(limit integer)`

The new owner-only forced-RLS `enquiry_operations` table has tenant-scoped enquiry/requester foreign keys, exact checked canonical payload/hash, bounded receipt and immutable update/delete triggers. Runtime has no direct table access. Resource locking precedes operation serialization and receipt installation shares the enquiry mutation transaction. Audit summaries contain only operation/kind/status/assignee identifiers; contact contents and reasons are excluded.

Authorization checks precede recovery. Missing/foreign/inaccessible resources raise unavailable (`P0002`), nonstaff raises `42501`, malformed SQL values `23514`, changed original command identity `40001`. HTTP maps these to its existing safe error projection; private row details never enter raw error messages.

`database/test-helpers/migrations.mjs` loads this migration for disposable test/dev databases, including staff-preview. It is not a production migration runner. PGlite tests are serialized and must not be described as independent-connection concurrency verification.

This uses existing hosting and storage with no provider purchase, within one maintained configurable platform and the KES 10,000 monthly client-price baseline. Staff picker labels, server-only admin transport, explicit uncertainty recovery UI and desktop/mobile UAT remain subsequent work.
