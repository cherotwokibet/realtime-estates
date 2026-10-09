# Rebuild continuation checkpoint

Updated 10 October 2026, Africa/Nairobi. Boniface authorized continued rebuilding and best-effort scheduled continuation. The hourly continue-realtor-rebuild heartbeat stays active until the authorized rebuild and handover are complete or he cancels. Usage exhaustion interrupted the previous run; work resumed after reset. Never buy credits, consume reset credits, change plans or bypass limits. Scheduled local work requires the computer and app running.

Read START-HERE.md, service-budget.md, business-rules.md, acceptance-catalogue.md and ../realtor-delivery-dashboard/TRACKER-PROTOCOL.md. Inspect Git, collaboration status and owned preview processes before editing. Preserve original vendor sources and the old live system. Use independent code and synthetic data while rights, account control and migration evidence remain unresolved.

## Scope and decisions

Boniface builds with Codex. KES 10,000 is the total monthly service price per realtor; the proposed external-services allowance is KES 6,000. No paid services are provisioned. One configurable TypeScript monorepo maintains web, admin, mobile and API with shared business rules and server-enforced company isolation.

Stage 01 remains open. The documented dependency exception permits reversible specification, design and local foundation work while external evidence is pending; it does not waive stage or launch gates. Boniface explicitly requested UI/UX informed by the supplied Figma, Miro and apps or better, and authorized improvements using research and judgment. Operator acceptance, rights, real stock, contact/policy content and physical-device evidence are still required.

## Implemented foundation

Next.js 16.4.0 web/admin; Expo 57.0.27 with compatible React Native 0.86.3/React 19.2.3; TypeScript 5.9.3; Node 24.19.0. Seven workspaces contain the applications, shared domain, synthetic company configuration and a narrow public API client. The API includes RS256/JWKS verification, trusted hostname resolution, a restricted PostgreSQL transaction adapter and public catalogue/enquiry/staff draft routes. The migration implements company-scoped RLS and audited command functions. Web/admin/mobile previews remain explicitly synthetic and are not connected to real sessions or persistent operations.

API_MODE=demo is the default. Database mode requires controlled server configuration, reviewed notice text/version and a dedicated restricted login. The local HTTP bridge refuses production mode. Real media processing, complete DTO/fee convergence, deployed identity, production transport and provider compatibility remain open. The Workers budget candidate has not been proven to run the local Node/pg adapter; do not silently add a paid server.

## Verification and references

The latest integrated root npm test run passed 118 checks: 43 domain, 5 demo, 32 API/auth/HTTP, 19 client transport/HTTP, 1 client/service integration and 18 SQL. All seven workspace typechecks passed. Logs are docs/evidence/pricing-checkpoint-tests.txt and pricing-types.txt. Earlier 106-check evidence remains preserved. SQL uses disposable PGlite with the actual migration and restricted roles; this does not verify hosted PostgreSQL/PostGIS/TLS/pooling. CI is defined and has never run remotely.

The web/admin/mobile visual redesign is implemented with white/burgundy surfaces, readable sans-serif type, original labelled concept imagery, useful search/detail layouts, native mobile navigation and truthful admin queues. Android JS export completed with 591 modules and a 1.5 MB Hermes bundle; it is not an APK or device acceptance. See docs/evidence/2026-10-10-interface-checkpoint.md for final build/browser results and their limits. Re-run builds only after changes, not merely because a continuation starts.

Figma browser inspection exposes selected properties; the file is view-only and the connector still denied design-context/screenshot access. Both Miro read-only outlines are captured: 100 original-board and 33 updated-board top-level objects with available nested text. The original-board capture is preserved outside source in ../rebuild-preservation/2026-10-10-reference-review. Image-only frames remain incompletely inspected. A Miro editable backup requires an upgrade; none was purchased/exported. See design-resource-register.md and ux-blueprint.md. Never claim exact Figma implementation or a complete visual board audit.

Unresolved dependency audit: 22 propagated entries (7 moderate, 15 high), three root advisories; see dependency-review.md. No effective nonbreaking fix was available. Do not force a downgrade to an incompatible Expo SDK.

## Immediate continuation

1. Public web/admin readability and accessibility fixes, final production builds and bounded browser checks passed; see interface-checkpoint evidence. Source is frozen. Check actual rendered viewport size for future checks: the browser override did not apply; the revised interface has observed 1280 px and 584 px layouts. A new 390 px check must not be inferred from the older foundation screenshot. Short-height/200% text and full accessibility acceptance remain open.
2. Shared public API client is implemented, reviewed and included in the workspace/lock/test pipeline. Its 20 focused checks cover controlled malformed/error/timeout handling, real Node HTTP redirects and actual service/PGlite idempotency/tenant projection. It is not connected to the previews. Do not claim full property/fee DTO convergence or native/browser transport proof. Agent assignments for this checkpoint are finished; inspect collaboration state again before future edits.
3. The pure pricing-disclosure helper is implemented alongside the unchanged legacy helper; 43 domain checks (12 new pricing cases) and all seven workspace typechecks passed. Database/API/UI fee integration remains open. Follow contracts-roadmap.md: append a migration, preserve approved pricing snapshots and v1 compatibility, introduce explicit v2 fields/routes and deliberate county/town mapping, then connect screens with distinct demo/connected/loading/empty/error states. Implement trusted media processing before a complete publication journey; never bootstrap accepted fixture media as a production upload processor.
4. Two-company browser configuration proof passed for Sample Homes web/admin, with its own colors/catalogue and a 404 for a Realtime property. Both Expo public config exports have distinct names/schemes/platform identifiers/tenant slug. See docs/evidence/2026-10-10-reuse-and-pricing.md. This does not verify devices, hosted isolation or complete automated onboarding. Owned temporary sample dev servers/snapshot are for this checkpoint only; inspect process state before reusing them.
5. Verify a synthetic listing review to public discovery to enquiry to assignment to viewing workflow. Hosted identity/database/media/device checks need controlled accounts and separate evidence. Continue useful local work while that evidence is pending.
6. Maintain canonical dashboard JSON, dated notes and linked evidence; publish the existing owner-private site using its source helper. Preserve browser exports and merge user notes before importing the latest baseline. Do not rerun earlier checkpoint generators over later edits.
7. Commit reviewed source and verify a fresh Git bundle outside the checkout. Same-device originals and bundles are recovery copies; a Boniface-controlled private remote and independent off-device backup remain open. The previous 33c7109 source bundle/restore proof remains intact; new checkpoint evidence is recorded separately.

## Corrections to preserve

The original 25 UAT findings claim included a parsed table header. There are 24 substantive findings. R-001 is retired as a parsing artifact; stable R-002 through R-025 mappings and historical notes are retained. No release gate has been accepted. No vendor retirement or live production change has occurred.
