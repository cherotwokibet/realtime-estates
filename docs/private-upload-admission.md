# Private upload admission foundation

11 October 2026. This local synthetic slice prepares private byte transport for the existing processing pipeline. It contains a bounded byte reader and an immutable original upload request journal. HTTP authorization/routing, browser upload controls and image delivery are still separate work; neither helper accepts a user identity as proof of authorization.

## Bounded input

The Node-only `@realtor/media/upload-body` reader accepts an asynchronous byte stream. It bounds actual received input to one byte–10 MiB, checks an optional declared length, snapshots chunks before awaiting further data, and supports cancellation and a finite deadline. Empty, oversized, interrupted, invalid or mismatched input never becomes a successful body. It does not decode an image or certify its MIME type.

The next HTTP adapter must authenticate the current staff caller and validate the listing/revision/job tuple before pulling any body data. The existing development HTTP bridge buffers bodies before authentication and keeps a64 KiB general JSON cap; increasing that global cap would not establish this boundary. A narrowly routed streaming/preflight adapter is still required. Do not hold a database transaction while reading bytes or running a decoder. Per-service concurrency, aggregate quotas and production resource limits remain open.

## Immutable original request

`@realtor/media/upload-request` uses a dedicated durable store. A trusted caller supplies the previously authorized tenant, actor, listing, revision, registered job, original upload UUID and bounded input bytes. The journal computes byte length/hash itself, generates the processing claim and generation IDs server-side, and commits an immutable record before granting a live one-use ticket. Client filenames, paths, object keys, checksums, worker IDs and coordinator credentials are not input fields.

An exclusive permanent job reservation prevents another upload ID or an identical historical store receipt from creating fresh processing authority. Only a new same-instance ticket may be consumed once. Reading or reopening a record returns facts and the original binding; it does not recreate a ticket. Incomplete reservations, persistence uncertainty and conflicting records remain retained and blocked. Closing drains admitted journal work and invalidates its live authority without deleting caller-owned storage.

The journal stores upload metadata, not a second copy of the image. The existing one-attempt processor installs original bytes and its own request before capture/claim/seal commands. If execution is interrupted after upload reservation but before that processor request exists, readback can show the original binding but cannot resume or launch it. The tiny initial slice deliberately retains that unresolved state. Replacing an upload ID, rotating storage roots or treating absence of a process as permission to retry is prohibited.

## Integration and next step

A trusted adapter must consume the fresh ticket and pass the original `jobId`, `claimId`, `generationId` and input bytes to a fresh one-attempt processor sharing the existing stable worker/journal/storage roots. Reopened history may call only the processor's read-only reconciliation. Processing status is descriptive; it never proves that a recorded worker is currently live or terminated.

Processing remains separate from listing attachment. A verified output does not alter the draft version or photo set. A staff-authorized exact-version attachment intent and coordinator finalization are still required, using the existing contracts. The browser must receive only a narrow status projection, not the internal request record or private storage/process context.

Next implement authenticated loopback streaming admission and original-status readback around these helpers, then connect sequential upload/attachment to the gallery and authorized image previews. Use synthetic images while rights and account control remain unresolved. Production provider isolation, Windows ACL/network/resource constraints, hostile filesystem resistance, global quotas, retention/cleanup, power-loss and real PostgreSQL concurrency proof, native/mobile/operator UAT and all release gates remain open. The KES10,000 total recurring client price baseline is unchanged; no paid service is added.

Executed results and limitations belong in the dated evidence document; this contract alone is not a passed test or release gate.
