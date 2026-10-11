# Realtor Platform

Latest local checkpoint: exact-version draft photo removal/ordering and immutable historical recovery. 456 affected tests and eight workspace typechecks passed. See [gallery contract](docs/media-gallery-commands.md) and [executed evidence](docs/evidence/2026-10-11-media-gallery.md). Production, device/operator UAT and all release gates remain open.

Independent replacement for Realtime Estates Ltd, designed for additional realtor businesses. Foundation work started 9 October 2026. Local web/admin/mobile previews, shared domain rules, JWT verification, PostgreSQL policies and an API slice are implemented. Production integration and release acceptance remain open.

See docs/START-HERE.md and docs/requirements-traceability.md. Existing vendor applications stay operational until replacement acceptance and rehearsed cutover. The shared API client now validates public catalogue/enquiry transport; previews remain synthetic until the secure connected journeys are implemented.

Run `npm ci`, `npm test`, `npm run typecheck` and `npm run build:web` from this directory. Setup and precise verification limits are in docs/development.md. Current work and exact next steps are in docs/CONTINUATION.md. Design sources and the improved UX plan are in docs/design-resource-register.md and docs/ux-blueprint.md.
