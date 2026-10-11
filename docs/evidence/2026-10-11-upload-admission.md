# Executed private upload admission evidence

11 October 2026, Africa/Nairobi. Local synthetic transport preparation; no HTTP upload endpoint or browser uploader was added. Original vendor resources and live services remain preserved.

## Executed checks

All three frozen verification commands exited0: shared package builds, all media test files, and all eight workspace typechecks. **178 media tests passed**, zero failures, skips, cancellations or todos. See [test log](upload-admission-tests.txt), [typecheck log](upload-admission-types.txt) and [build log](upload-admission-build.txt). Exact commands and runtime source hashes are retained outside the checkout in `verification-upload-admission-final-1.json`. Runtime hashes stayed unchanged throughout the run.

New test groups cover actual byte limits, optional declared length, chunk copies, shared/detached/invalid arrays, strict options, pre-abort and mid-read abort, stalled and immediately resolved producer deadlines, late failures and listener cleanup. The journal tests cover principal/resource binding, internal byte hashes, server-generated claim/generation, frozen snapshots, independent-controller contention, duplicate/altered upload IDs, one-use tickets, reopened read-only history, incomplete reservation retention, lost durable acknowledgements, canonical metadata and actual corruption. Independent controllers raced in one process; no cross-process contention or hostile filesystem proof is claimed.

Read-only review corrected two code/test mismatches before this final run: explicit null timeout and detached zero-length input now fail validation. Syntax/whitespace checks passed. Raw build/type logs intentionally retain executed trailing blank lines. No failed test run is concealed or counted as a pass.

## Actual native integration

The new integration constructs original PNG pixels, yields them in13-byte chunks, and collects them through the bounded reader. A dedicated durable upload journal commits the exact synthetic tenant/actor/listing/revision/job/upload tuple, computed byte length/hash and generated processing binding before issuing its one-use ticket.

The consumed original binding and unchanged actual bytes are passed to the existing one-attempt processor. That processor uses the real restricted coordinator login and supervised Windows codec, independently checks output bytes, installs durable input/output, and seals the result in local PGlite. The test checks its input length/hash against the upload record and verifies actual empty-process termination. SQL inspection confirms the draft remains version2 with zero photo associations; one verified output exists. Processing does not attach or publish a listing.

The successful local response is deliberately discarded. The upload journal is closed and reopened, and the exact original record is read back. Neither that record nor the old ticket grants reopened authority. Duplicate and changed-upload-ID reservations for the job remain blocked. A fresh processor instance calls only read-only reconciliation on the saved original binding. Native invocation count stays exactly1. Actual stored output data length and independently computed SHA-256 match the sealed manifest; original resource/principal metadata also matches. No new decoder launch, capture, claim, seal, attachment or token adoption is performed by recovery.

This proves local result loss and clean wrapper/store reopening while PGlite and the parent process remain alive. Separate journal tests inject a lost storage acknowledgement and a prewrite failure. It does not simulate HTTP/network loss, power failure, worker/database crash or provider failover.

## Scope and next step

The reader and journal authenticate nobody. Supplied tenant/actor metadata in this test is labelled fixture input, not a verified HTTP identity. The journal contains metadata only; original image bytes become durable when the existing processor installs them. An interruption before its request is recorded remains conservatively blocked. Reopened history never resumes processing or rotates roots.

Deadlines interrupt asynchronous waits and check elapsed time between chunks; they cannot interrupt arbitrary synchronous producer JavaScript. A trusted stable local filesystem remains a prerequisite. Service-wide concurrency/quotas, production CPU/memory/network/ACL isolation and hostile filesystem resistance remain open.

No HTTP bridge or binary SDK upload, browser gallery attachment, image preview/delivery, real session/provider deployment, remote CI, full application/API/database test run, UI build, real PostgreSQL races, device/assistive-technology/operator UAT, independent backup or release acceptance was established. Earlier272 gallery and456 backend tests are separate and are not added to this count. Checklist remains13/97 and all14 gates remain open. KES10,000 remains the total recurring client price baseline; no paid service was added.

Next: an exact loopback streaming/preflight adapter must authenticate current staff and the listing/revision/job tuple before pulling bytes, persist the original admission, expose a narrow original-status readback and invoke processing only from a fresh ticket. Preserve the64 KiB general JSON cap; hold no SQL transaction during streaming/decoding. Then connect sequential attachment and authorized image delivery to the gallery. See [admission contract](../private-upload-admission.md).
