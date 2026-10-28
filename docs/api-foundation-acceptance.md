# Company context and API foundation acceptance

Checkpoint209 — 28 October 2026 (Africa/Nairobi).

This accepts local implementation items05-4 and05-5 against the current source and executed replacement tests. It does not accept a production deployment, real DNS ownership, identity-provider lifecycle, distributed enforcement or a release gate. This follows the existing implementation/gate distinction in `progress-audit.md`.

| Item | Implemented boundary | Current proof | Separate open work |
| --- | --- | --- | --- |
|05-4 company context|`createTenantResolver` accepts only explicit, unique, immutable configured hostname mappings. The API fixes tenant context in trusted service options; request body/query/token role/company claims cannot grant access. The verifier extracts a signed subject, and SQL rechecks current membership/assignment under transaction-local tenant/actor context.|Auth tests reject unknown/suffixed/wildcard/colliding/malformed hosts and mutated configurations. Current signed HTTP/SQL tests deny customer, revoked and other-company actors, reject posted scope, and read Sample Homes without the Realtime fixture. SQL tests verify cross-company composite keys and cleared context on connection reuse.|Actual hosted-domain ownership/TLS, provider provisioning and deployment routing remain04-5/13-4 gates. Hostnames choose a context; they never grant membership. Account login/reset/deletion remains05-1.|
|05-5 API contracts and controls|Maintained v1/v2 and default-off candidate v3 boundaries have typed contract/domain parsers, bounded raw JSON/version validation, controlled errors/private projections, immutable audited commands and idempotent recovery. General request and stricter enquiry budgets apply before business work.|Current full API build/suite293/293 and signed HTTP/default SQL30/30 passed. New budget tests prove pre-database/pre-identity denial, company/trusted-peer separation, hostile-header irrelevance, safe retry headers and malformed/failing-provider denial. Existing actual SQL/API cases cover validation, audited writes/replays and sanitized errors.|Production HTTP adapter, distributed limiter backend, independently hosted PostgreSQL races, provider guarantees, capacity/load and the full evolving cross-application security matrix remain open. All stage gates stay unaccepted.|

## General request budget

The audit found enquiry-specific throttling but no common API-service request budget. The service now consumes a separate company/trusted-peer budget before route parsing, database work or identity verification. The process-local development default is240 requests per60 seconds and at most1,000 live peer keys per service; it fails closed at capacity. The existing stricter10/minute enquiry budget remains additional. These are internal development protections, not agreed client allowances or a provider spending cap.

`requestLimiter` is injectable so a production adapter can supply distributed atomic enforcement. Its result must contain a boolean decision and a safe retry interval (zero when allowed,1–3600 seconds when denied). Invalid results or dependency failures return sanitized503 without business IO. Denial returns429/Retry-After with no-store. The peer selector is trusted socket/proxy configuration and evaluated once; arbitrary forwarded/company headers are not authority. The supplied HTTP entrypoint continues to refuse production startup pending its proper adapter and provider verification.

The acceptance does not close05-6's complete security/export matrix or05-7's logout/session-cache behavior. It does not reclassify isolated reference proposals as active production schema. No existing task is split or removed, and no old vendor UAT pass is counted.

Raw evidence is in `evidence/2026-10-28-api-foundation/`. Checklist becomes33/97 (34%rounded),0/14 gates.16 additional complete items are required to cross50%. KES10,000 total per realtor/month, vendor resources and the old live system remain unchanged. Source remains local while Actions quota is exhausted.

Next: verify current public filter/map and admin follow-up queue journeys in a disposable browser preview, then assess07-2/08-2. Continue missing media/gallery/account functionality and its separate device/provider/operator gates. Owner: Boniface + Codex.
