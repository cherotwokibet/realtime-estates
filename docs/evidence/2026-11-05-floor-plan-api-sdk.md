# Floor-plan API and shared client checkpoint 364

5 November 2026 EAT. Owner Boniface + Codex.

Authenticated floor-plan attachment/recovery, saved metadata and private image routes now have shared client support and bounded client metadata. All 25 focused API/SDK checks passed. Progress remains 54/97 (56%).

Implementation

The domain package adds strict floor-plan attachment commands, sanitized attachment/state/image metadata and original-result validation. The shared SDK now saves an attachment command, reads the exact original with GET and reads saved floor-plan state. It snapshots inputs, uses bounded no-store credential-free transport and marks malformed committed replies uncertain without repeating POST. Recovery binds the complete original command.

The API adds explicit synthetic-private-floor-plan-v1 opt-in, rejected in production and unavailable by default. Authenticated operations, revision metadata and operation-bound private image routes reuse the existing server identity verifier and transaction context. Company comes from server configuration and actor from verified identity. Caller context headers, cookies, queries, duplicate/unknown fields, changed targets and conditional/range requests are refused. Restricted SQL functions enforce current staff role and listing authority. Raw processing, source and store identities stay server-side; the DTO contains the stable operation/request identity and bounded image facts.

Image delivery additionally requires an explicitly configured trusted image-read capability. Before invoking it, SQL gallery read checks current authority and attachment operation. Its returned target/version/operation and image role/manifest/actual byte hash must match that metadata. A second SQL gallery read must match before returning bytes. Missing/replaced/removed attachments refuse delivery. Valid bytes return image/webp, private no-store, Authorization variance, nosniff and a fixed inline filename. Unavailable backend facts use the existing generic503 refusal response, never image bytes or internal diagnostics. The capability must be bound to the authenticated server context when composing the actual durable reader.

Verification

Domain, API and shared-client TypeScript builds passed. `node --test --test-concurrency=1 apps/api/tests/floor-plan.test.mjs apps/api/tests/listing-video.test.mjs apps/api/tests/media-gallery.test.mjs packages/api-client/tests/listing-video.test.mjs` passed25 tests with zero failures/skips, about13.1seconds. Eight new floor-plan tests use actual isolated registration/lease/seal/attachment SQL under restricted API context with in-process Request/Response routing. They verify closed/production gates, stable attach/recovery and sanitized metadata, malformed/spoofed input before DB, verified customer denial, agent/admin image reads and headers/hash, removal during provider IO/corrupt image refusal, SDK-to-real-handler transport, and committed-response uncertainty with GET-only recovery and one POST. Existing17 video/gallery/SDK regressions passed. Raw log floor364-api-sdk.txt. Earlier fixture output is retained in floor364-api-first.txt. Fixture corrections included HTTPS, exact staff options and the existing503 backend-failure mapping before the final pass.

Tests use actual lossless conversion and SQL receipts but explicitly simulate the trusted image-read provider. They launch no native child, real HTTP listener or browser. Native/durable/gallery proof from checkpoint363 is separate and was not rerun at this checkpoint. There is no signed-provider/device/operator/production claim.

Limits

This is maintained synthetic opt-in API/client code. It installs no SQL, grants no production capability and enables no route by default. File upload/preparation and original preparation recovery still need authenticated transport before a complete author UI. Session BFF/browser UI, actual image-provider deployment composition, approval/public/successor snapshots, hosted concurrency, physical mobile and UAT remain open. Task06-4 remains unchecked,54/97(56%),0/14 gates accepted.

Next, implement guarded floor-plan file preparation/upload and original preparation recovery through the authenticated API, then connect session-bound BFF routes and author/reviewer screens. Follow with approval/public snapshots and successor-copy rules under task06-4.

KES10,000 total monthly per realtor remains. Vendor resources and old live system stay available. No GitHub Actions execution, provider purchase, credits or account plan change.
