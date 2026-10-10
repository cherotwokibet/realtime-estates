# Local experimental synthetic image codec and storage

`@realtor/media` provides a Node-only byte converter, disposable local store, Windows supervisor and separate restricted processing database adapter, independent of the vendor's code and images. It does not accept production uploads, mark media accepted, save production listing objects or connect a provider. The codec/store alone create no database records. `synthetic-codec-v1` identifies this experimental pipeline, not a production approval.

```ts
import { convertSyntheticImage } from '@realtor/media';

const { data, manifest } = await convertSyntheticImage(syntheticInputBuffer);
// data is a NEWLY encoded WebP Buffer, kept in this process.
// manifest describes the actual input snapshot and returned bytes.
```

The fixed policy allows static JPEG/PNG/WebP input Buffers of at most 10 MiB, 40 million header pixels, and 16,384 pixels per source axis. Container preflight rejects PNG animation/control chunks, WebP animation flags/chunks, malformed chunk lengths, and JPEG MPF/concatenation/trailing bytes. Chunk and signature names compare literal bytes without masking high bits. The JPEG preflight is a bounded marker walk, not a replacement for the decoder. Sharp then parses and decodes with `failOn:'warning'` and the 40 MP pixel limit; multi-page metadata and emitted warnings are rejected. The input is copied synchronously before the first await so ordinary caller mutation cannot change the hash/decode pair.

Sharp 0.35.5 auto-orients pixels, resizes inside 1920×1920 without enlargement, strips source metadata by default, and freshly encodes WebP at quality 82/effort 4. The immutable manifest contains source format, input SHA-256/input byte count, output SHA-256/width/height/actual byte count, pipeline operations, and Sharp/libvips versions. SHA-256 is an identity check, not authorization or malware detection. The returned Buffer remains mutable; callers must not change it after using its manifest. A trusted local caller may lower `maxOutputBytes` from the fixed 10 MiB cap; no policy can be raised through that option. The output cap is checked **after** encoding and is not a native allocation limit.

Run from the repository root after dependencies are installed:

```sh
npm run test --workspace @realtor/media
npm run typecheck --workspace @realtor/media
```

The test command builds first and runs test files sequentially. Tests create original synthetic pixels in memory. `tests/fixtures.mjs` independently constructs PNG/APNG chunks using Node zlib and a bit-at-a-time CRC; JPEG/WebP fixtures and output decoding use the same Sharp/libvips build as the codec, so they are not independent decoder verification. Forged large-dimension PNG headers prove early rejection without allocating a 40 MP fixture; they are explicitly not valid large decoded images. No external images or provider resources are used.

Converter boundaries: the complete input already exists in memory; copying and native decoding/encoding allocate additional memory. Pixel/header checks, JS heap settings and post-encode limits do not impose an OS/native-memory or wall-clock bound. SharedArrayBuffer concurrency is outside the converter caller contract. Sharp selects its installed native binding/libvips packages.

## Disposable local storage

The separate `@realtor/media/local-store` subpath imports only Node built-ins and the fixed policy. `createLocalSyntheticStore(trustedAbsoluteParent)` creates a fresh generated directory with distinct quarantine/output directories. It accepts no client filename, object key or URL. `ingest(asyncByteSource, {signal})` bounds streamed bytes to 10 MiB; `read(handle)` rechecks the captured file identity, actual length and SHA-256; `publish(buffer)` snapshots ordinary bytes immediately and exclusively creates a fresh output. Receipts contain a frozen in-memory handle, kind, length and hash. A copied/serialized or other-store handle cannot read an object.

This is storage byte identity, **not image acceptance**. A caller must separately run the codec and compare its input/output facts. Storage alone can hold arbitrary bounded bytes, creates no SQL record and supplies no durable job, lease, intent, authorization, retry receipt or public delivery. A demonstration integration test uses synthetic streamed PNG → captured read → actual codec → separate output → verified read; execution results are recorded separately in the evidence document.

Abort/disposal stops adapter writes and requests producer `return()` without waiting forever for a suspended producer. It cannot force arbitrary producer code to stop. Disposal removes only known owned files and then empty known directories, with identity checks and no recursive fallback; unexpected entries or replacement files fail closed. This method is exclusively for a disposable local store. **Never use it for referenced listing objects, backups or retention cleanup.**

The parent and filesystem must be trusted and stable. Best-effort no-follow, regular-file/link-count and identity checks reduce accidental traversal; they cannot defeat hostile same-user reparse/symlink races. Windows file modes do not establish an ACL boundary. No network-filesystem, crash-durability or filesystem-failure recovery guarantee follows from local success. Operations have bounded admission and execute sequentially; this is not a native memory/CPU quota or a wall-clock limit on filesystem calls.

Local Windows process-lifetime supervision is now implemented and tested separately; see `docs/evidence/2026-10-10-media-processor.md`. No production OS sandbox or network restriction is established. Deployment architecture, licence/notices redistribution, decoder isolation/resource limits and trusted SQL finalization still need separate implementation and verification before any real-media acceptance.

## Local Windows worker

`@realtor/media/windows-supervisor` launches the fixed owned PowerShell/C# helper for one trusted Node entry in a fresh owned direct-child attempt directory. Supply a trusted absolute PowerShell7 path and trusted attempt parent; this is not browser/API configuration. Codec work uses `dist/codec-worker.js`, fixed filenames and maxProcesses1. Only the trusted descendant fixture uses maxProcesses4.

On confirmed `job_empty`, a successful codec exit can be followed by bounded file readback and `@realtor/media/process-readback` hash/header verification, then separate storage publication. On failed exit/readback, never publish. On `containment_unknown`, retain the attempt; that supervisor instance permanently blocks further launches. Never substitute direct-process exit, kill request, stderr or a timeout for the native zero-accounting receipt. `tests/process-codec-store.test.mjs` demonstrates this synthetic sequence without loading Sharp in its coordinator.

The supervisor creates/deletes no attempt files. Its limits cover one-job admission, config/pipe sizes, a child deadline and bounded termination confirmation. They do not establish memory/CPU quotas, ACLs, network denial, hostile-filesystem safety, durable jobs or SQL acceptance. The native worker environment is separate from the supervisor environment, which explicitly neutralizes libuv's Windows profile/account supplementation. Actual results and failed-probe corrections are documented in the evidence above.

## Restricted synthetic processing records

The separate `@realtor/media/coordinator-database` entry imports no runtime decoder. Inject a trusted connection pool; `MediaCoordinatorDatabase` exposes only `captureInput`, `claimProcessing`, `sealOutput`, `readProcessing`, `checkConnection` and `close`. There is no arbitrary SQL callback, posted tenant/actor selector or automatic retry. Each checkout checks actual role/catalog privileges before opening a short transaction and selecting `media_coordinator`. The login needs only that NOINHERIT membership, with no direct private schema/table/column privileges or grant delegation. Guard lookups use `pg_catalog`, without resolving private schema names through a login that lacks schema usage. Rollback failure and uncertain COMMIT destroy the checkout; an uncertain write requires explicit readback or the same immutable command facts.

Migration0004 persists captures, stable claims (maximum three attempts, up to180 seconds bounded by job expiry) and immutable verified manifests. SQL derives authorization from the registered requester and current company/assignment. Exact historical recoveries do not renew leases or attach anything. Read state `verified` reports historical attestation even after expiry; `captured` with expired attempt3 does not authorize another attempt. Inspect the latest attempt explicitly.

`tests/coordinator-process-integration.test.mjs` joins the actual child/store/readback sequence to restricted PGlite commands. Its SQL output-id to opaque local-handle mapping exists only in memory for the test. It is not a production orchestrator, durable storage mapping or crash/restart recovery implementation. Lease expiry never proves process termination: unknown containment retains the attempt and blocks reuse, regardless of SQL time. See `docs/processing-coordinator.md` and its dated executed evidence before extending to authenticated attachment or real media.
