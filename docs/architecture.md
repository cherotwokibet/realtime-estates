# Maintained platform architecture

Boniface maintains one private TypeScript monorepo for configurable realtor companies. The current gross recurring baseline is KES 10,000 per realtor/month; service-budget.md separates operating allowances from verified supplier costs. Production hosting and identity remain unprovisioned gates. The static delivery dashboard is a separate repository and is not the platform API host.

[Deployment and client exit arrangements](deployment-and-exit-arrangements.md) define the proposed shared and dedicated options, account and credential control, company data export specification, offboarding and continuity. The document distinguishes existing source recovery from export/restore capabilities still to be implemented and accepted.

| Workspace           | Responsibility                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------- |
| apps/web            | Public catalogue, discovery and enquiry experience; explicit demo/connected configuration       |
| apps/admin          | Staff draft, moderation, enquiry and viewing operations; current authenticated local previews   |
| apps/mobile         | Configurable Expo/React Native application; native connection/device/store verification pending |
| apps/api            | HTTP authorization, fixed trusted-company routing, bounded input and transaction orchestration  |
| packages/domain     | Shared business types, exact money, normalized commands and receipt validators                  |
| packages/api-client | Bounded transport, strict response contracts and deliberate original-operation recovery         |
| packages/demo       | Fictional company brands and inventory; never an implicit persistent fallback                   |
| packages/media      | Node-only synthetic byte processing and supervised conversion; not browser/native code          |

Identity is verified by the API against its configured issuer, audience and JWKS. Company selection comes from trusted deployment/hostname configuration. JWT role claims, browser actor fields and request-selected companies do not grant membership. Transactions install verified company/subject context locally, then use restricted PostgreSQL roles and current database membership/assignment. Security-definer command functions apply current authorization; private tables force RLS. The runtime login must not own tables, inherit privileged roles, be superuser or bypass RLS.

Listing identity and its mutable availability/publication version are separate from versioned editorial revisions. Public catalogue reads use only the selected approved immutable snapshot; unfinished drafts cannot silently replace it. Accepted media needs its own verified processing/provenance evidence. Exact integer KES minor units, explicit charge declarations and public/private location separation are shared contracts. Unknown facts stay unknown.

Durable operations retain exact originals and validate receipt/command correlation before the API transaction commits. A lost reply is not permission to allocate again or adopt later versions. Read recovery is explicit; current access can hide an original until restored. Creation reserves operation identity before a listing exists and must commit with a complete result or roll back. Viewing agreement, cycle, attendance and synthetic reminder capture have separate commands and immutable history. Reminders do not send messages or imply provider/consent readiness.

Local synthetic staff boundaries use short-lived server-only identities and fixed loopback adapters. They deliberately refuse production mode. Browser controls retain uncertain originals in memory and block unsafe discard/navigation; they are not durable cross-tab storage. PGlite serial policy tests and signed loopback HTTP provide local evidence, not hosted PostgreSQL races, production sessions, native-device or operator acceptance.

Migration order is explicit under database/migrations. database/test-helpers/migrations.mjs is a disposable test harness, not a production deployment runner. Staging deployment, real PostgreSQL/PostGIS tests, migration/restore rehearsal, distributed limits, production retention, provider composition and physical devices remain open. See START-HERE.md for historical decisions and CONTINUATION.md for current checkpoint; newest evidence supersedes at-time progress notes without erasing them.
