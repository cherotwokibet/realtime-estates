# Private saved-photo access

12 October 2026. This boundary belongs to the explicit local synthetic media composition. It is a read-only backend boundary; the admin gallery still shows its existing honest preview-unavailable state until shared binary transport and browser rendering are connected and verified. No production provider, account or live catalogue changed.

## Current viewer and saved association

The additive `app_api.read_private_media_preview(listing, revision, media, expectedVersion)` function authorizes the current active company administrator or currently assigned active agent. It does not reuse processing history's original-uploader authorization: an old uploader's later revocation/reassignment must not hide an eligible saved association from a current viewer. Existing processing and original-operation recovery guards are unchanged.

The eligible association must be an accepted sealed photo on the exact current draft revision and saved version, joined to its immutable applied attachment, original verified output, capture and exact processing lease/job. Legacy/SQL-only metadata cannot establish a stored image. The current assignment and viewer role are returned only as server-side authorization facts, so a changed assignment/role can be detected on the second read. Foreign, missing, removed, unauthorized, non-draft and incomplete associations are indistinguishable not-found results; only an otherwise eligible photo exposes a stale-version conflict.

## Exact private request

The opt-in development HTTP hook accepts the exact raw target `GET /v2/staff/listings/{listingId}/revisions/{revision}/media/{mediaId}/preview` and canonical `X-Revision-Version` header. It matches the raw target before URL normalization and before consuming a request body. Alias/query targets cannot enter the hook. The handler validates the configured loopback host/company, verified bearer identity and exact resource/version. Cookies, body framing, content type/encoding, Expect, ranges and conditional requests are refused. The default API executable and metadata-only staff preview do not enable this hook.

The browser supplies no job/output/store identity, object key, filesystem path or root. All such facts come from the authorized association and configured server resources. A read authenticates nobody by itself; the development launcher still uses ephemeral local signed RS256/JWKS identity and a disposable database.

## Verified output bytes

After the first authorized SQL read, resolve the original processing request and seal from the configured processing-request store. Match the request/seal store identity, captured job/claim/input generation and input checksum/length, exact lease/output generation, pipeline and manifest to the SQL facts. Preserve the SQL manifest hash as an authoritative SQL fact; JSON serialization does not replace that hash. Resolve output through the configured durable photo store, then independently verify the actual bounded bytes, receipt identity, SHA-256, length and WebP container against the seal and SQL manifest.

Repeat the current SQL authorization/association/version/state/assignment/role read after I/O. A changed or revoked resource returns no image. Successful delivery is private `image/webp`, uncached and `nosniff`, with no public URL, public cache, storage key/path or processing capability. Reads neither finalize nor attach, alter order/version/receipts, retry work, launch a codec, repair files or rotate roots. Closing the preview drains its admitted reads before caller-owned stores are closed; it does not own or delete those stores.

This is a bounded in-memory local response, not a CDN delivery or global memory/quota proof. The second SQL read establishes authorization immediately before response creation; no distributed lock or guarantee of revocation during network transmission is claimed.

## Verification and next boundary

See the dated private-preview evidence for the executed test counts and actual signed HTTP/native byte proof. SQL/double tests and actual native integration have distinct scopes. Existing admin browser photo/conflict evidence remains its earlier checkpoint, not a browser image-preview pass.

Next connect a strict bounded shared binary preview client, server-only admin proxy and gallery rendering with explicit stale/unavailable states, Blob URL revocation and preserved raw text edits. Then verify desktop image appearance and remove/stale/access-denial behavior before physical/narrow device/accessibility/operator UAT. Durable production identity/storage/database composition, real PostgreSQL concurrency, crash/all-store restart, production isolation/retention/global limits, independent backups, rights/account evidence and launch gates remain open. KES 10,000 total monthly client-price baseline and the existing live system remain unchanged.
