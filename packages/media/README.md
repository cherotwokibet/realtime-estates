# Local experimental synthetic image codec

`@realtor/media` is a Node-only byte-conversion proof, independent of the vendor's code and images. It does not accept production uploads, mark media accepted, save objects, create database records, or connect a provider. `synthetic-codec-v1` identifies this experimental pipeline, not a production approval.

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

Remaining boundaries: the complete input already exists in memory; copying and native decoding/encoding allocate additional memory. Pixel/header checks, JS heap settings and post-encode limits do not impose an OS/native-memory or wall-clock bound. There is no subprocess containment, process-tree termination, sandbox, network restriction, private filesystem/object storage, lease, authenticated intent, idempotency receipt or deletion/retention policy here. SharedArrayBuffer concurrency is outside this caller contract. Deployment architecture, licence/notices redistribution, decoder isolation/resource limits and the trusted finalize protocol still need separate implementation and verification before any real-media acceptance. This package imports only Sharp and Node built-ins; Sharp selects its installed native binding/libvips packages.
