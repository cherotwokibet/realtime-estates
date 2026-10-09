# Rebuild foundation — 9 October 2026

## Verified work
The local vendor resources, UAT folder and two delivery media folders were inventoried and snapshotted. SHA-256 hashes of every archived file were verified by reading the snapshots back. Generated build/cache directories and Git internals are excluded and listed in the manifest. Original files were not edited. Read-only snapshot copies live outside this repository in ../rebuild-preservation/2026-10-09. This is a same-device recovery copy, not an independent disaster-recovery backup.

Remote Figma and Miro documents are references, not fully preserved exports. Obtain owner exports/history before declaring design preservation complete. The supplied PDF/proposal are included in the vendor snapshot. Additional media not in the listed source roots must be inventoried before migration.

## Proposed pilot scope
Responsive public website, Android/iOS application, admin portal, shared identity, property catalogue and resilient media, search, favourites, agent contact, viewing requests, moderation, lead assignment/status, simple operational reporting and configuration for a second realtor. Deliver and verify a listing-to-enquiry vertical slice before expanding. Payments, paid ads, commission settlement, AI recommendations and advanced marketplace growth are later scope. No synthetic UAT listings enter real stock.

## Architecture decisions — provisional until Stage 01 review
One TypeScript monorepo with apps/web (Next.js), apps/admin (Next.js), apps/mobile (Expo/React Native), apps/api (modular TypeScript service); packages/contracts, validation, api-client, brand and tooling. Shared business contracts and tokens; platform-appropriate UI. PostgreSQL with PostGIS for location; object storage for media. Select exact supported versions and providers at foundation implementation after current documentation checks. Do not lock costs or versions from planning assumptions.

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
Builder confirmed: Boniface with Codex. Total recurring service-price baseline: KES 10,000 per realtor per month; see service-budget.md. Weekly availability remains unknown. Confirm permitted asset/data reuse; listing permissions; minimum prices; filter endpoints; photo minimum; viewing assignment and notification flow; account/store ownership. Recommended initial assumption: realtor staff publish listings, visitors enquire, no payments. These assumptions are not accepted business rules yet.

## Commercial and delivery baseline
See [service-budget.md](service-budget.md) for confirmed staffing/price, sourced candidate costs, proposed limits and solo delivery sequence. Allocations are estimates; no suppliers provisioned.

## Next
Review scope and account/rights questions, export design references, establish off-device backup/remote, then close Stage 01 and specify Stage 02 business rules. No live changes or vendor retirement occurred.
