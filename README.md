# Realtor Platform

Latest checkpoint: [staff enquiry operations](docs/enquiry-operations.md), with [actual signed HTTP/restricted SQL evidence and remaining limits](docs/evidence/2026-10-12-enquiry-operations.md). Staff inbox UI and operator acceptance are next.

## Earlier checkpoints — historical next steps

Earlier checkpoint: [private saved admin gallery images](docs/private-gallery-images.md), with [703 affected checks, actual desktop evidence and remaining limits](docs/evidence/2026-10-12-gallery-images.md). Enquiry assignment and dated follow-up were the next operational slice; production and launch gates remained open.

Earlier checkpoint: [private saved-photo backend access](docs/private-media-preview.md), with [630 affected checks and actual signed HTTP/native byte evidence](docs/evidence/2026-10-12-private-preview.md). Shared binary client and displayed admin gallery photos were next; production and launch gates remained open.

Earlier checkpoint: [local admin photo upload and attachment](docs/admin-photo-upload.md), with [627 affected checks, desktop upload/conflict proof and remaining limits](docs/evidence/2026-10-12-admin-photo.md). Saved private image previews were next; production and launch gates remained open.

Latest local checkpoint: optional authenticated loopback photo transport with original-status recovery. 551 affected tests, shared package/API builds and eight typechecks passed. See [transport contract](docs/development-streaming-uploads.md) and [executed evidence](docs/evidence/2026-10-11-streaming-upload.md). Default server composition, browser uploads/image delivery, production/devices/operator UAT and all release gates remain open.

Independent replacement for Realtime Estates Ltd, designed for additional realtor businesses. Foundation work started 9 October 2026. Local web/admin/mobile previews, shared domain rules, JWT verification, PostgreSQL policies and an API slice are implemented. Production integration and release acceptance remain open.

See docs/START-HERE.md and docs/requirements-traceability.md. Existing vendor applications stay operational until replacement acceptance and rehearsed cutover. The shared API client now validates public catalogue/enquiry transport; previews remain synthetic until the secure connected journeys are implemented.

Run `npm ci`, `npm test`, `npm run typecheck` and `npm run build:web` from this directory. Setup and precise verification limits are in docs/development.md. Current work and exact next steps are in docs/CONTINUATION.md. Design sources and the improved UX plan are in docs/design-resource-register.md and docs/ux-blueprint.md.

## Connected enquiry inbox checkpoint — 12 October 2026

800/800 affected tests, shared package/API builds, admin test compilation/production build and eight workspace typechecks passed on 209 frozen source hashes; zero failures/skips/cancellations/todos. Opt-in synthetic admin/assigned-agent inbox now connects server-only identities to assignment, contact and Nairobi follow-up, separate historical receipt/current comparison and explicit adoption. Actual desktop handover and stale admin conflict retained raw reason and exact follow-up timestamp. See enquiry-inbox.md and evidence/2026-10-12-enquiry-ui.md. Earlier755 backend evidence remains separate; focused counts overlap.

Next connect reviewed public/protected-staff enquiry intake with notice/idempotent original capture recovery; then attributable contact history and separate viewing scheduling. Browser lost-reply/reload/physical/narrow/operator/accessibility proof, production identity/persistence, real PostgreSQL concurrency, independent backup/private platform remote, rights/accounts and all launch gates remain open. Preview identities expire30min and data is disposable; tab-local drafts/uncertain commands are not crash-persistent. KES10,000 total monthly price, checklist13/97, gates0/14 and originals/live preserved. Never rerun historical checkpoint generators.
