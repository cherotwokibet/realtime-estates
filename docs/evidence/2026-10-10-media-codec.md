# Local static-image codec proof — 10 October 2026

Verified on pinned Node 24.19.0, Windows x64. This independently authored Node-only eighth workspace is an experimental synthetic-byte converter. It is not an upload endpoint, trusted acceptance receipt, storage adapter or release gate. Vendor sources, images and live systems were not touched.

## Implemented behavior

`packages/media/src/index.ts` copies an ordinary caller-owned Buffer before the first await, validates its actual length and container, decodes pixels, auto-orients, resizes inside 1920×1920 without enlargement and freshly encodes WebP at quality 82 / effort 4. Source metadata is stripped. The frozen manifest describes the input snapshot and output at return time: SHA-256 hashes, bytes, format, dimensions, pipeline operations and encoder versions. The returned output Buffer remains mutable; changing it invalidates that manifest.

The fixed source ceiling is 10 MiB, 40 million header pixels and 16,384 pixels per axis. Actual output must fit 10 MiB; a trusted test caller can only lower that cap. Container parsing rejects APNG controls, WebP animation flags/chunks, malformed lengths/CRC, JPEG MPF, concatenated JPEGs and trailing data. Native decoding uses warning rejection and its pixel limit. Format names compare literal bytes, including high-bit lookalikes. These checks are layers, not a complete hostile-file security boundary.

## Executed verification

- `npm run test:media`: **14 passed**, zero failures, skips or cancellations; includes a successful TypeScript build. Log: [media-codec-tests.txt](media-codec-tests.txt). Test-run duration reported by Node was about 684 ms; this is not a production throughput or resource guarantee.
- `npm run typecheck`: **all eight workspace typechecks passed**, after domain/demo/client/media builds. Log: [media-codec-types.txt](media-codec-types.txt).
- Offline dependency linking completed with lifecycle scripts disabled. Sharp 0.35.5 was already pinned/installed transitively through Next; the new workspace declares it exactly. Lockfile review found only the workspace link/manifest and promotion of Sharp/@img/colour from optional to required. No existing package version changed.
- Fresh root registry audit still reports **22 propagated entries: 7 moderate, 15 high**, with no Sharp entry. This does not establish absence of vulnerabilities. Raw report remains outside checkout in `rebuild-preservation/2026-10-10-source/dependency-audit-media-codec.json`; unresolved advisory handling is in [dependency-review.md](../dependency-review.md).
- Two read-only source reviews identified a JPEG first-scan gap and ASCII high-bit aliasing. Both were fixed before execution; regressions include progressive/inter-scan MPF, concatenation and trailing payload ending in EOI.

Tests exercise actual PNG/JPEG/progressive JPEG/static and animated WebP bytes, output pixels/hashes, EXIF orientation, ICC/EXIF/XMP removal, alpha, resize/no enlargement, ordinary Buffer mutation, byte/pixel/axis/output caps, unsupported/spoofed signatures, truncated/corrupt PNG/zlib/RIFF and APNG. PNG/APNG fixtures are independently constructed with Node zlib and a separate CRC implementation. JPEG/WebP encoding and output inspection share the same Sharp/libvips build; no independent decoder verification is claimed. Oversized header fixtures are deliberately forged, not valid large decoded images.

The earlier complete platform run passed 265 tests, seven then-existing workspace typechecks and the admin production build; see [moderation evidence](2026-10-10-moderation.md). The unchanged API/SQL/web/admin runtime was not rerun for this isolated codec addition. **There was no new combined 279-test run.** Root `npm test` now includes the media suite for the next justified integrated run. Remote CI, Linux/native deployment and physical devices remain unrun.

## Remaining work and exact next step

The entire input and output exist in memory. The output cap is post-encode; header checks do not bound native allocations, CPU or wall time. There is no subprocess, process-tree termination proof, OS sandbox, network denial, streamed upload, private filesystem/object storage, lease/fencing, authenticated attachment intent, SQL finalization, duplicate-output storage constraint, receipt or retention cleanup. No real listing can acquire accepted media through this package.

Next implement a local private quarantine/output adapter and single-job processor harness: server-generated paths, actual streamed input cap, minimal child environment, process-tree termination/reaping and cancellation/cleanup proof using synthetic bytes. Keep that local harness separate from a production isolation claim. Then implement the reviewed narrow media SQL/API commands and provenance migration before upload UI or a complete publication journey. Do not reinterpret metadata-only fixture rows as decoded outputs.

Exact codec configuration is an experimental starting point; property-photo visual quality, native resource limits, the chosen production host and complete service costs still require measurement. The installed native dependency includes bundled licence notices that need artifact-specific redistribution review; see [inventory](../media-dependency-inventory.md). No paid provider, account change or budget increase occurred. Monthly client price remains KES 10,000; tasks remain 13/97 and accepted stage gates 0/14. Owner: Boniface + Codex.
