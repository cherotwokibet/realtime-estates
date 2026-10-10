# Local moderation journey

10 October 2026, Africa/Nairobi. Independently authored code, synthetic stock and disposable local storage only. The existing vendor applications and original resources remain unchanged.

## Run and inspect

From the repository, use the pinned Node runtime and run:

```powershell
$env:STAFF_PREVIEW_ACTOR='admin'
npm run dev:staff-preview
```

Open the printed moderator URL, normally http://127.0.0.1:3001/reviews. The trusted launcher selects an ephemeral signed admin identity and two submitted fixture revisions for the configured company. One is available/unpublished; the other is available/paused. Default agent startup still opens the existing draft editor without seeding submitted reviews. Set TENANT_SLUG=sample-homes before startup for that synthetic company's configuration.

This is a development-only identity adapter, not sign-in or a production session. The server retains its bearer token in process memory. There is no credential endpoint, client-selected actor/company or media-write endpoint. Identity expires after 30 minutes. Stopping the preview destroys the local data. Use the direct URL; the overview remains a separate read-only demo, not a live operations dashboard.

## API and shared client

Authenticated `/v2/staff/reviews` GET returns the first pending revisions, ordered by submission time. Limit is 1–100, default50. The client exposes `listReviewsV2`; the local UI requests100 and discloses possible truncation. Cursor pagination, search and totals remain open.

`GET /v2/staff/reviews/{listingId}/revisions/{revision}` returns the exact saved content, raw pricing/location, ordered accepted photo references and review/publication metadata. `getReviewV2` validates the DTO, versions, identities, timestamps, money and content. Detail permits all four revision states for reconciliation. Private address and rejection reason are admin-only and remain excluded from public catalogue responses. Photo keys are metadata, not arbitrary image URLs rendered by this screen.

`POST .../decision` accepts only `{expectedVersion,decision,reason}`. The SDK `decideReviewV2` takes a canonical version string and converts only safe integer values to the existing numeric wire contract. The API independently rejects fractional/exponent version tokens and duplicate decoded JSON keys before parsing can round them. Decision bodies are bounded at8KiB. Approval requires an explicitly null reason. Rejection requires a trimmed, nonblank, control-free reason of at most1,000 Unicode code points; unpaired surrogates are rejected. The UI explains the one-paragraph requirement before dispatch.

Current active admin membership is checked on each read and decision. The database locks the listing/revision and requires the exact pending revision version. Approval atomically selects the exact reviewed snapshot, including original v2 charges/location. Rejection retains any existing approved snapshot. Paused or archived publication state is preserved. Fresh available stock is required for approval. Self-approval is explicitly audited by the SQL command. No schema migration was needed for these routes.

Revision version and listing version are separate concurrency tokens. Approval can change both; rejection changes the revision. Neither token is inferred from the other. The decision receipt confirms the revision state/version only. Read the saved detail for actual publication/availability state; an approval does not establish public visibility.

## Review interaction and recovery

The admin chooses a pending revision, reviews property fields, named charges and exact known subtotals, then reads the photo/publication record. Unknown costs remain unknown; incomplete cost disclosure does not invent quote-required charges. An explicit checkbox acknowledges the currently displayed revision version and the synthetic photo limitation before deciding.

Rejection notes stay in open-tab memory. Notes or acknowledgement prevent switching to another revision until explicitly cleared or the review finishes. Dirty or blocked reviews warn before leaving. Closing/reloading can lose local notes; no localStorage, sessionStorage, private export or durable crash recovery is implemented.

Every failed decision blocks subsequent decisions until a successful `Check latest review`. The screen retains the local reason, reads the actual saved state and resets acknowledgement. A different pending version must be inspected again. A decided revision becomes read-only. No automatic approval/rejection retry occurs. If the response was lost after a commit, the client marks uncertainty and a later GET reconciles the recorded decision. A rejected revision requires a new sequential draft; this queue does not yet create one.

## Boundaries still open

Accepted photos are seed metadata without image bytes, decoding, storage or advertising-rights evidence. Four metadata rows do not establish four distinct images. The schema currently allows duplicate object keys/checksums at different positions. Trusted processing must bind uploads to company/listing/revision, verify actual bytes, remove unsafe metadata, deduplicate, handle retries and freeze the accepted set before a real publication gate can pass.

Production identity/session/logout/revocation, hosted database/transport, real upload delivery, full keyboard/assistive-technology/device review, operator UAT and cutover approval remain separate tasks. This milestone provisions no services and keeps the KES10,000 total monthly client-price baseline.

See [dated evidence](evidence/2026-10-10-moderation.md), [staff drafts](staff-drafts.md) and [next contracts](contracts-roadmap.md).
