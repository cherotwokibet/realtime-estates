# Approved historical public reference reads — 23 October 2026, checkpoint 147

The synthetic public listing read now carries approved location and amenity snapshots through the SQL projection, API, SDK and an explicit website preview adapter. Legacy listings keep an explicit absent reference pair. Production/default-schema activation, a new public browser journey and mobile integration are not claimed.

## Contract and privacy

`GET /v3/properties?limit=1..100` requires the existing separate synthetic reference moderation mode. The response policy is `synthetic-reference-public-v1`. Each normal public listing has a narrow `reference` object containing `attributes` and `revisionVersion`. Both are null for unadopted legacy listings. The tenant is fixed by server configuration, and the database transaction uses an anonymous actor. Only canonical page limits are accepted; unsupported context queries, duplicate limits and writes fail.

The isolated SQL proposal's security-barrier view retains base publication, approval, availability, tenant and coordinate-coarsening rules. An adopted row must match its immutable approved sidecar and current approved editorial version. Its historical validation catalogue is selected by the saved version, never the current pointer. SQL projects only the three selected location ancestors and selected amenities, including their original property-type restrictions. Unselected catalogue rows are excluded, avoiding a full catalogue copy per public listing.

The API validates that original subset against the saved attributes and actual property type before transaction commit. Its internal validation context is bounded to 128 KiB per listing and is removed from the response. The row mapper rejects unexpected root/photo fields, nested executable properties, malformed scalar/numeric values, repeated or unsafe photo keys, inconsistent historical location labels and precise coordinates in an area-only listing. No private address, review body, rejection reason, actor or internal catalogue is transported. Responses are bounded to 3 MiB and the declared page size; errors are sanitized.

The shared public snapshot wire validator checks exact own data fields, canonical IDs/versions, location ancestry, labels, amenity codes/order and explicit legacy absence, returning detached frozen values. This is structural wire validation. Historical membership and property-type compatibility come from server validation against stored catalogue rows and the approved SQL projection, rather than a client's guessed current catalogue.

The SDK uses one anonymous GET with omitted browser credentials, no-store and rejected redirects. It strictly validates the public listing, exact money/disclosure, historical labels and extension. This route uses the bounded streamed parser, duplicate-key/noncanonical-number checks, strict UTF-8/framing, cancellation and deadlines. It does not retry or fall back to v2/demo data. Existing v1/v2 and 128 KiB moderation transports retain their previous bounds.

## Website preview

Set trusted server environment `WEB_CATALOGUE_REFERENCE=synthetic-reference-public-v1` only with connected catalogue mode, synthetic data declaration and development/test environment. Other values, production, demo mode or unspecified data fail configuration before requests. Omitting the flag preserves the existing v2 loader.

The website adapter keeps the approved snapshot and original IDs, maps its exact amenity labels and preserves exact pricing. An adopted empty amenity selection is known empty; a null legacy reference remains unknown. The detail page uses stable amenity IDs for reference-backed list keys and shows an explicit empty-list statement. Failed or malformed reference reads remain errors and never substitute demo listings or newer labels.

## Verification and remaining work

Full domain 269, API 259, SDK unit 259, SDK integration 84, database 309, web 30 and canonical admin reference integration 13 checks passed, with zero failures/skips. All eight workspace type checks and formatting passed. New cases include two domain snapshot cases, one expanded API public case, four SDK transport cases and four web adapter cases. The existing SDK/API integration now verifies anonymous public output after explicit publication. Final 36 focused checks after the additional page/getter guards overlap these suites. Earlier 49/36 focused and four SDK checks also overlap. They verify historical labels after activating newer catalogues, pause exclusion, anonymous tenant isolation, selected-only validation subsets, explicit legacy absence, and failure before commit on corrupted public projections. Exact source/restore/publication identifiers are recorded in the continuation journal.

Initial diagnostics are retained. An explicit unknown location was incorrectly expected to fail in one new test; that fixture was changed to an orphan child. A legacy public fixture used a stale listing version after approval; it now reads the actual version. Validation and optimistic concurrency were preserved.

This is in-process restricted PGlite/API/SDK/web-adapter proof. No new signed public HTTP relay, actual public website browser, native/mobile/device test, production Next build, hosted PostgreSQL race, full-root suite, operator UAT or cutover acceptance is claimed. The SQL proposals remain outside default migrations. The previous checkpoint's actual private reviewer rejection/reload/recovery proof is separate evidence. All release gates remain open, KES 10,000 remains the complete monthly client price, and vendor/old live resources are untouched.

Next: an independently isolated public reference preview and actual website browser verification; shared mobile read integration without invented unknown facts; creation/successor/import reference conversion and compatibility before default-schema activation. Rights/accounts, real media, retention, hosted infrastructure, physical devices, operator acceptance and controlled cutover still require their own evidence. Logs are in sibling `rebuild-preservation/2026-10-12-source/reference-public-*`.
