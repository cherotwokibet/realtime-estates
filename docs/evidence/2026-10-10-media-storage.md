# Disposable local streamed storage proof — 10 October 2026

Verified on pinned Node 24.19.0, Windows x64. Independently authored code and synthetic bytes only; original vendor resources and live services remain untouched. This checkpoint establishes local storage behavior, not production uploads, image acceptance, listing attachment or a release gate.

## Implemented behavior

The Node-only `@realtor/media/local-store` subpath creates a fresh directory under an existing trusted absolute local parent. Quarantine and output are separate; object names are generated UUIDs. The API accepts no filename, storage key or URL. Frozen in-memory object handles are checked against the issuing store's private WeakMap; serializing a handle does not preserve its authority.

`ingest()` consumes an asynchronous Uint8Array source sequentially, rejects empty/invalid/shared-memory chunks, snapshots each exact view, checks actual accumulated bytes before writing and stops at the first chunk exceeding 10 MiB. `publish()` admits at most two total operations (one active, one queued) before copying its bounded ordinary Buffer. It snapshots synchronously and creates a new output exclusively; no API can overwrite an existing output. Duplicate bytes may create different objects: this is not duplicate-image detection or idempotent attachment.

Receipts describe kind, actual length and SHA-256. Before issuing a receipt or returning a read, the adapter checks regular-file/link-count/identity, reads bounded actual bytes, verifies length and hash, and closes its descriptor. Source and result Buffer mutation cannot change captured storage bytes. A storage receipt does not prove those bytes are an image: `publish()` deliberately supplies no codec-origin or SQL-acceptance attestation.

Abort races a blocked producer `next()`, closes/deletes the partial owned file, requests `return()` once and consumes late producer failure. It cannot force arbitrary producer code to stop; an uncooperative `return()` is not awaited indefinitely. Disposal rejects new/queued work and cancels active adapter work before cleanup. It checks known identities, refuses unknown entries and deletes only owned files followed by empty known directories, with **no recursive fallback**. This method is exclusively for disposable local stores, never a sweeper for retained listing objects or backups.

## Executed verification

- `npm run test:media`: **32 passed**, zero failed, skipped or cancelled, including a successful media TypeScript build. The run comprises the existing 14 codec tests, 15 storage tests and 3 codec/storage integration tests. Log: [media-storage-tests.txt](media-storage-tests.txt).
- `npm run typecheck`: **all eight workspace typechecks passed**, after shared package builds. Log: [media-storage-types.txt](media-storage-types.txt).
- Actual streamed 10 MiB acceptance and first-excess-chunk rejection, producer failure, pre-abort, blocked `next()`, nonsettling `return()`, late rejection, admission/reuse, immediate publication snapshot and per-view snapshots passed.
- Forged/serialized/cross-store/disposed handles, independently changed/truncated stored bytes, file-open fault cancellation, unknown-entry cleanup refusal and relative/non-directory parent refusal passed. The Windows junction case **ran without skipping** and preserved the outside sentinel while refusing traversal/cleanup.
- The integration flow streamed independently constructed PNG, read captured bytes, actually decoded/re-encoded with the codec, stored a separate output, checked its manifest/hash/dimensions and retained unchanged quarantine bytes. A failed decode created no output. A scope test confirms that byte publication alone supplies no accepted-media flag.

Node reports about 5.77 seconds for the focused test run; this is not a throughput or resource guarantee. PNG fixture construction is independent of Sharp; output inspection still uses the same Sharp/libvips build, so no independent decoder proof follows. The junction test proves one deliberate substitution, not resistance to hostile racing reparse points.

Two independent read-only reviews caught an initially unbounded admission queue and a file-open failure outside producer cleanup. Both were corrected before the executed final run. A further abort check prevents a scheduled `next()` call after cancellation. No dependency or existing version changed; no install, fresh registry audit, paid service or provider provisioning was needed. The previously recorded dependency/licence findings remain open.

The earlier complete 265-test moderation run and admin production build remain separate evidence. This checkpoint did **not** rerun the full platform, SQL, application builds, browser/device journeys or remote CI. The root test runner already includes this expanded media suite for a future justified integrated run.

## Limits and exact next step

The parent/filesystem must remain trusted and stable. Node's documented Windows mode behavior does not provide owner/group ACL isolation, and exclusive creation has network-filesystem caveats. Path and identity checks cannot close hostile same-user symlink/reparse races; local file modes are not a security sandbox. These are design limits informed by the [Node 24 filesystem documentation](https://nodejs.org/docs/latest-v24.x/api/fs.html#file-system-flags), alongside the executed local cases above. No crash/power-loss durability, full-disk recovery, multi-process admission or wall-clock bound on filesystem calls is established. File and directory fsync/atomic durable promotion need a separate production design.

The decoder still runs in the test process. No process supervisor, empty-process-tree barrier, OS/native-memory or CPU quota, credential/network isolation, durable job/lease/fencing, authenticated intent/finalize/remove/reorder, provenance migration, receipt reconciliation or approved public delivery is implemented. Metadata-only listing fixtures retain that label. Disposal has no retained-reference policy and cannot be used to remove production media.

Next implement and test the one-job Windows supervisor in [processor-containment-plan.md](../processor-containment-plan.md): atomic Job Object association, minimal environment, bounded protocol/deadline, cancellation and verified `ActiveProcesses == 0` before cleanup or retry. Direct-child exit or `taskkill /T` alone is insufficient proof; the review is a proposed design, with no termination test yet run. Then connect the reviewed authenticated media commands and explicit provenance migration. Production worker/provider compatibility, photo quality, complete costs, real devices, operator UAT and all release gates remain open. KES 10,000 total monthly client price, 13/97 checklist tasks and 0/14 accepted gates are unchanged. Owner: Boniface + Codex.
