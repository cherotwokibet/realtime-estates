# Rebuild foundation — 9 October 2026

10 October storage update: the separate local-store subpath now verifies streamed quarantine/output storage, cancellation and integrity readback using synthetic bytes.32 focused media tests and all eight typechecks passed; see evidence/2026-10-10-media-storage.md. Storage receipts are not image/SQL acceptance, and disposable cleanup is not a production retention sweeper. Next implement/test the Windows supervisor in processor-containment-plan.md, then authenticated media intents/provenance. Earlier checkpoints below remain historical evidence; all stage/release gates stay open.

10 October codec update: packages/media now performs actual local synthetic static-image conversion; 14 focused tests and all eight workspace typechecks passed. See evidence/2026-10-10-media-codec.md for exact limits. This is not upload/storage/SQL acceptance or a combined rerun of the earlier 265 platform tests. Next private storage and an isolated processor harness, then authenticated media commands.

10 October moderation update: the local authenticated admin queue/detail/decision journey is implemented; see moderation.md and evidence/2026-10-10-moderation.md. Final 265-test rerun, all seven workspace typechecks and the admin production build passed; see CONTINUATION.md and completed logs. Trusted photo storage, isolated processing and attachment remain the next implementation tasks; see trusted-media-plan.md, trusted-media-commands.md and trusted-media-runtime.md. The new media documents are proposed contracts, not implemented upload evidence. No stage/release gate is accepted.

## Verified work
The local vendor resources, UAT folder and two delivery media folders were inventoried and snapshotted. SHA-256 hashes of every archived file were verified by reading the snapshots back. Generated build/cache directories and Git internals are excluded and listed in the manifest. Original files were not edited. Read-only snapshot copies live outside this repository in ../rebuild-preservation/2026-10-09. This is a same-device recovery copy, not an independent disaster-recovery backup.

Remote Figma and Miro documents are references, not fully preserved exports. Obtain owner exports/history before declaring design preservation complete. The supplied PDF/proposal are included in the vendor snapshot. Additional media not in the listed source roots must be inventoried before migration.

## Proposed pilot scope
Responsive public website, Android/iOS application, admin portal, shared identity, property catalogue and resilient media, search, favourites, agent contact, viewing requests, moderation, lead assignment/status, simple operational reporting and configuration for a second realtor. Deliver and verify a listing-to-enquiry vertical slice before expanding. Payments, paid ads, commission settlement, AI recommendations and advanced marketplace growth are later scope. No synthetic UAT listings enter real stock.

## Architecture decisions — provisional until Stage 01 review
One TypeScript monorepo now implements apps/web (Next.js), apps/admin (Next.js), apps/mobile (Expo/React Native), apps/api (modular TypeScript service), packages/domain, packages/demo, packages/api-client and the Node-only experimental packages/media. V2 pricing/location inputs now converge across shared validators, revision storage, reviewed snapshots, API and public client; public web now deliberately connects to v2 through server-only configuration with exact disclosure; local authenticated existing-draft editing now uses raw v2 inputs and recoverable optimistic saves. The local synthetic admin review queue/detail/decisions are implemented; real sessions, full navigation/pagination, native operational integration and legacy staff contract convergence remain follow-up work. See moderation.md and staff-drafts.md. Shared business contracts and semantic brand configuration support platform-appropriate UI. Exact versions and compatibility reasons are recorded in development.md and package-lock.json. PostgreSQL with PostGIS remains the production target; current tested migrations use bounded coordinates without the extension. Object storage/media processing and providers are not provisioned.

Tenant identity is resolved and authorized on the server; every tenant resource, object-storage path, query, job and audit event is scoped. Include automated cross-tenant denial tests. Company name, logo, colors, domains, contact details, feature switches and policies are validated configuration. New client onboarding must pass a two-tenant reproduction test. Separate deployments/databases remain an option for contractual isolation.

## Ownership and access register
| Asset/account | Current evidence | Required next step | Owner |
|---|---|---|---|
| New source | Local separate repository on Boniface computer | Choose Boniface-controlled private remote and independent backup | Boniface |
| Vendor source/assets/design | Files supplied; rights not verified | Review contract/licences and asset permissions; write replacement code independently | Boniface |
| Customer data | No authorized production export inspected | Approve field mapping, lawful migration and retention; exclude passwords/test fixtures | Boniface + realtor |
| Firebase/hosting | Existing URLs known; account control unverified | Inventory owner/admin access and export capability | Boniface/vendor |
| Domains/DNS/email | Unknown | Confirm registrar/admin control and intended domains | Boniface |
| App stores/signing | APKs available; signing credentials/control unknown | Confirm publisher accounts, signing lineage and update-versus-new-app strategy | Boniface/vendor |
| Figma/Miro | Links supplied; full exports pending | Obtain owned exports and reusable brand assets | Boniface |
| Replacement providers | Not selected | Compare recurring cost, backups, region, portability and support | Engineering + Boniface |

## Repository and contribution rules
Treat new source as private pending an explicit licensing decision. No open-source licence is granted by this document. Contributors must have agreed rights to contribute. Do not copy vendor implementation into replacement code. Preserve requirements and permitted assets separately. Never commit secrets, signing keys, credentials or customer exports. Review dependency licences before adoption. Use reviewed changes and CI before production; keep schema migrations reversible where practical. Remote repository and access policies remain pending; a local Git repository alone does not establish legal ownership.

## Proposed success and release gates
The realtor can publish accurate stock, receive and assign enquiries, schedule viewings and follow up without a parallel unmanaged spreadsheet. Establish baseline and target measures with the realtor: enquiry response time, listing freshness, lead follow-up completion and weekly active staff. No numeric business claims until agreed. Release requires role/tenant/ownership denial tests, upload recovery, exact pricing, device and accessibility checks, end-to-end UAT, backup restore rehearsal, migration reconciliation and rollback rehearsal.

## Open decisions
Builder confirmed: Boniface with Codex. Total recurring service-price baseline: KES 10,000 per realtor per month; see service-budget.md. Weekly availability remains unknown. Broad approval permits the provisional implementation defaults in business-rules.md and acceptance-catalogue.md. Operator validation, permitted asset/data reuse, account/store control and reviewed policies remain open. Staff publish after moderation; visitors enquire; payments remain deferred. On 9 October Boniface explicitly requested UI/UX informed by supplied Figma/Miro/apps or better and authorized design improvements using research and judgment; see design-resource-register.md and ux-blueprint.md.

## Commercial and delivery baseline
See [service-budget.md](service-budget.md) for confirmed staffing/price, sourced candidate costs, proposed limits and solo delivery sequence. Allocations are estimates; no suppliers provisioned.

## Next
Use CONTINUATION.md for the latest implementation/test checkpoint and next actions. Continue reversible work with synthetic data while obtaining design exports, account/rights evidence and independent backup/private remote. Stage 01 and release gates remain open. No live changes or vendor retirement occurred.
