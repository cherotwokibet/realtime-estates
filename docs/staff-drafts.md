# Local staff draft editor

10 October 2026. Existing assigned v2 drafts now support authenticated read/save/submit through the shared client. The admin editor preserves the entire raw pricing/location contract, including private address and coordinates. Saving is a full replacement with an optimistic revision version; it does not approve or publish a listing.

## Run the synthetic preview

From the repository root with the pinned Node runtime on PATH:

```powershell
npm run dev:staff-preview
```

Open the printed `http://127.0.0.1:3001/drafts/.../1` URL. Port3001 and4101 must be free. The launcher starts a disposable restricted PGlite database, ephemeral loopback JWKS/API and the Next development server. A genuinely signed RS256 token is handed to the Next child through its server environment only; the launcher never logs it or writes it to disk. It expires after30 minutes. No provider account, vendor code/customer records or real credentials are used.

For a second independently scoped synthetic company:

```powershell
$env:TENANT_SLUG='sample-homes'
npm run dev:staff-preview
```

The harness does not expose a login/token endpoint. Four accepted media metadata records are explicit seed fixtures; there are no image bytes or trusted upload processors. Submission only reaches `pending`, not publication. Stopping/restarting the launcher discards its database and credentials.

## Editing and recovery

- Change title/description, property type/purpose, room counts, exact decimal KES amounts, rental period, named charges/declaration, structured public location and staff-only address/coordinates. Blank location remains unknown. Known cost previews derive from the same shared exact-money rules used by public views. Quotes and incomplete coverage do not become guaranteed totals.
- Save writes the loaded revision version, then reads the saved revision back. The returned database version is authoritative; no client-side increment is assumed. Only state `draft` is editable.
- A409 keeps the working copy and requires a fresh read. Compare every differing field, then explicitly discard local edits or reapply the whole local draft to the latest draft version. Reapplying does not save automatically; review and save separately. This is replacement, not a field merge.
- A failed/aborted write may have committed. Further writes are blocked until readback. An exact matching read confirms the changes; unchanged data allows manual retry; different data opens comparison. No write is retried automatically.
- Recovery is in memory while the tab stays open. Nothing, including private address, is persisted to localStorage, sessionStorage or browser draft exports. A navigation warning helps with unsaved/uncertain work but cannot guarantee recovery after a browser crash or refresh. Durable browser recovery is not claimed.
- A nonsecret per-launch instance marker prevents an older tab from using a restarted preview's identity or database. A different resource/instance resets the editor state. Do not reload a tab with unsaved work without accepting its loss.

## Deliberate security boundary

`apps/admin/lib/staff-preview-server.ts` is marked `server-only`. The BFF requires explicit `STAFF_PREVIEW_MODE=synthetic`, `NODE_ENV=development`, a controlled exact loopback API origin, server bearer and per-launch instance. The incoming Host must be127.0.0.1 at the internal request port; Next may normalize its internal URL to localhost. Browser writes require an exact same-origin Origin plus JSON content type; forwarded hosts, browser bearer overrides and cross-origin requests are not trusted. Responses are no-store. The parser bounds streamed bodies and rejects lossy raw money tokens before the client sends a request.

API/SQL independently verify the signature, current company membership, current assignment, draft state and version on each request. The local BFF is a synthetic developer identity adapter, **not a production session/sign-in implementation**. It refuses production. Do not deploy the harness, expose these listeners remotely, put real data in it or describe this as hosted authentication. Production needs a reviewed provider session/BFF integration with secure cookies, logout/revocation and deployed authorization evidence; no identity provider has been provisioned.

## Current follow-up — 11 October 2026

The later [admin gallery checkpoint](admin-gallery.md) adds atomic draft/photo reads, ordering, confirmed removal and explicit conflict recovery while preserving raw local text. Separate later checkpoints implement local processing/attachment and moderator decisions; the original10 October evidence below remains historical.

Creating/listing drafts from real queues, rejected-revision successors, durable browser recovery, production sessions, public upload/delivery integration and the complete deployed publication journey remain open. Native staff flows, hosted PostgreSQL/PostGIS/TLS/pooling, real provider compatibility, mobile/assistive-technology/operator UAT and cutover approval require separate evidence. This preview adds no paid services and preserves the KES10,000 total recurring client price baseline.

See `evidence/2026-10-10-staff-drafts.md` for checks actually run and their limits.
