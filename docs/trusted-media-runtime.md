# Trusted media runtime review

10 October 2026. Preparatory review completed while moderation verification ran. No package installed, codec executed, provider selected or application runtime/schema changed. This document does not establish a passed upload, production compatibility, budget or release gate.

## Documented constraints

The current [Sharp installation guide](https://sharp.pixelplumbing.com/install/) requires a Node-API v9 compatible runtime, gives Node.js >=20.9.0 as an example and publishes Windows x64 binaries. The pinned local Node24 runtime meets that stated Node version requirement; actual installation and decoding remain unrun. The guide warns about npm lockfiles shared across platforms. Its WebAssembly variant requires multithreaded Wasm and does not support single-threaded environments or browsers. Optional dependencies must be retained.

Cloudflare's [Node compatibility guide](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) distinguishes working APIs from importable nonfunctional stubs. The current [compatibility flags documentation](https://developers.cloudflare.com/workers/configuration/compatibility-flags/) explicitly identifies child_process and worker_threads as stub modules. Therefore importing a package, enabling nodejs_compat, or bundling its Wasm is insufficient evidence for Sharp execution or an isolated Node child process on Workers. This is an inference from documented requirements and limitations, not an executed compatibility test. The current default Node compatibility date behavior must not be mistaken for full native Node support.

Keep the object adapter, upload coordinator and decoder separable. Prove a local Node-only decoder first. A production decoder service/managed transform/Wasm alternative is still a measured deployment decision. Do not silently add an always-on paid server or promise the whole stack fits the KES10,000 total service price before accounting for compute, storage, backups and support.

## Minimum local decoder boundary

Only a server-generated private quarantine path and a server-generated output path enter the decoder; no user-supplied filename/path/URL, shell text, SQL connection, bearer token or tenant decision enters it. Use a minimal environment and argument list, with shell execution disabled. The coordinator owns current authorization, immutable operation identity, private storage and finalization.

Use one processing job at a time on the current constrained host. Bound actual streamed input bytes, permitted formats, decoded dimensions/pixel count, output bytes and wall time independently. Static JPEG/PNG/WebP are the initial proposed allowlist; reject unsupported formats and animation. Do not trust MIME headers, metadata inspection alone, claimed dimensions, client checksums or accepted=true. Decode pixels, orient and re-encode a new WebP, then derive its actual SHA256, dimensions and byte length. Source/output policy and decoder version must be recorded with the job.

Node process separation provides failure containment; it does not by itself provide a security sandbox. A wall-clock timeout or V8 heap limit does not prove a bound on native decoder allocations. On timeout, invalidate the lease and terminate/reap the actual decoder process tree before retry or cleanup; an abandoned decoder must not continue writing into paths being reused or deleted. The operating-system termination mechanism still needs platform-specific proof. Production memory/CPU limits, filesystem scope, network denial and process termination need separate proof. Numeric resize/quality/decode deadlines remain proposed until synthetic fixtures establish image quality and resource behavior. The current SQL upper limits are not a promise that every valid image at those bounds can be safely processed by the selected host.

## Implementation evidence before adopting a decoder

1. Select an exact supported version; inspect upstream security/release notes and direct/transitive licences. The [Sharp project](https://sharp.pixelplumbing.com/) declares Apache2.0, but bundled libvips/codecs and notices need their own inventory. Do not equate one direct licence with all transitive obligations.
2. Generate independent fixture bytes. Prove valid conversion, orientation, metadata removal, actual output hash/dimensions/size, static-only enforcement, spoofed MIME, unsupported signatures, corrupt/truncated bodies, excessive bytes/pixels and pathological aspect ratios. Keep failing inputs out of public delivery.
3. Prove streaming cancellation, interrupted worker recovery, bounded output, timeout and cleanup without deleting referenced outputs. Record measured peak memory/CPU/time on the chosen runtime. No such result exists yet.
4. Run on each intended deployment OS/architecture with the exact lockfile and native dependencies. Successful local Windows execution will not establish Linux/Workers/device compatibility.
5. Production delivery must expose only verified outputs referenced by approved snapshots. Source quarantine and verified-but-unpublished drafts stay private; no arbitrary storage-key proxy or uploaded source passthrough.

## Next

Review this together with trusted-media-commands.md and trusted-media-plan.md. Implement and test a narrow local byte-to-verified-output slice before wiring upload UI, cloud storage or production media. All references above were read on10October2026; no runtime result is inferred from them.
