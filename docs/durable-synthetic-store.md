# Restart-readable synthetic object storage — 11 October 2026

Stage06 work started: replace the previous test-only UUID→opaque-handle Map with immutable, restart-readable private object identities. This is a storage-only dependency for later bounded orchestration. The contract below is agreed before implementation; executed evidence is recorded separately. No production durability, worker recovery or accepted-media claim follows from this design.

## Frozen interface

Separate Node-only `@realtor/media/durable-store`, importing no runtime decoder or database:

```ts
type DurableSyntheticReference = {
  readonly jobId: string;
  readonly objectId: string;
  readonly generationId: string;
  readonly kind: 'quarantine' | 'output';
};
type DurableSyntheticReceipt = DurableSyntheticReference & {
  readonly version: 1;
  readonly storeId: string;
  readonly bytes: number;
  readonly sha256: string;
};
// createDurableSyntheticStore(trustedAbsoluteParent) creates a fresh root.
// reopenDurableSyntheticStore(trustedAbsoluteRoot, expectedStoreId) reopens it.
// Returned store: storeId, rootDirectory, install(reference, Buffer),
// read(reference) -> { receipt, data }, close().
```

References and locations come from trusted server configuration/persisted SQL jobs, never posted browser names/paths/URLs. UUIDs are validated and canonicalized before awaits. Reference objects have exactly their four data properties; unknown fields, accessors, symbols and shared-memory buffers fail. The input snapshot is bounded to1 byte–10MiB and taken before disk/queue awaits. One operation active plus one queued is permitted per instance; admission precedes copying. Receipts and returned wrappers are frozen, but returned byte buffers remain mutable caller-owned copies. Canonical JSON serialization ends with one newline; receipt field order is version, storeId, jobId, objectId, generationId, kind, bytes, sha256; marker order is version, storeId.

Fresh roots contain a canonical `store.json` marker `{version:1,storeId}` and direct `objects` directory. The trusted reopening configuration must supply both root location and expected store UUID. Target objects use only `<root>/objects/<jobId>/<kind>` with fixed `data.bin` and `receipt.json`; object/generation UUIDs are immutable receipt bindings. A different generation or object cannot reuse the same job/kind path. Independent instances serialize installation through exclusive directory creation, without PID expiry/lock stealing. This is not a cross-process work scheduler.

## Installation and recovery rules

Create a fresh object directory exclusively, then data.bin with exclusive/no-follow flags where available. Bound actual bytes, write fully, sync and close; revalidate actual length/hash and regular-file/link identity before writing the receipt LAST. The small canonical UTF8 receipt is exclusively created, synced and closed; reread the completed pair before returning. No overwrite rename, mutation, recursive removal or collision cleanup exists. File sync does not establish Windows directory-entry/power-loss durability.

An existing object directory is read-only to retries. Exact reference plus identical snapshotted content recovers the original receipt after actual readback; changed binding or content conflicts. Missing receipt means INCOMPLETE: retain it and expose no bytes. Malformed/noncanonical/oversized receipt, unexpected entries, missing/linked data, identity changes detected during checked operations, changed length/hash or indirect directories fail integrity checks and remain untouched. A completed-looking payload alone is never accepted. Incomplete status cannot prove that another writer is dead; do not repair, overwrite, delete or automatically retry its installation.

The job/kind reservation is permanent in this slice. A retained incomplete output blocks later SQL attempts too; a new lease cannot reclaim the path. A committed output binds its original generation and cannot be replaced by attempt2/3. Explicit recovery or a fresh authorized registered job may be required later; this adapter provides neither. Root/target entry checks use bounded enumeration; the objects collection is not globally scanned.

Targeted read/reopen validates the expected store marker and directory ancestry, canonical bounded receipt, exact trusted reference and actual file length/hash. It does not scan an unbounded root or silently discover/select an object by filename. Direct ancestor/file identity checks and best-effort no-follow reduce accidental substitution; trusted stable local NTFS and same-user access remain assumptions. Fresh reopening anchors current identities: a byte-identical replacement before reopening is indistinguishable. No hostile same-user race resistance, Windows ACL boundary, network filesystem guarantee, signed receipt or root provenance beyond trusted configuration is claimed.

`close()` stops new admission and drains all already admitted work, including the queued operation, without deleting retained files. There is no disposal, garbage collection, aborting native I/O, retention policy or production directory sweeper. Unexpected/incomplete objects are retained for explicit inspection. Tests clean only their explicitly owned, inspected fixtures nonrecursively; this is not an application cleanup feature.

## Verification and next dependency

Verify fresh-instance and actual new-process reopening, exact replay and conflicting generations/bytes, partial/malformed commits, actual tampering and link/junction substitution, byte/reference bounds, admission and close behavior. A trusted writer fixture may stop after reporting a committed receipt; this proves recovery after a process exit, not power loss or every mid-install crash. Manually seeded partial crash-point fixtures must be described as such. Join actual supervised codec output and restricted SQL seal to these stored receipts without an in-memory UUID/handle mapping, then reopen/revalidate both objects and historical SQL facts.

This slice intentionally supplies no durable worker-attempt journal, automatic reconciliation loop or resumption authority. SQL lease expiry is not native job_empty proof. Unknown process attempts remain retained/blocked; starting a new process or reopening this store must never clear that condition. The integration reads private SQL object IDs through privileged fixture bootstrap before restoring the restricted login; no runtime lookup/grant exists. PGlite stays alive while storage reopens; database crash/restore is unproved. Next design explicit attempt journaling/admission and startup reconciliation with a reviewed private job-context lookup, then authenticated exact-version attachment intents/finalize/remove/reorder and provenance gates. Public upload transport/quotas, real PostgreSQL concurrency, production filesystem/network/CPU/memory isolation, providers, retention/audit, devices/operator UAT and all release gates remain open. Synthetic data only, vendor originals/live untouched, KES10,000 total monthly baseline unchanged.

## Filesystem references

The pinned [Node24 filesystem flags](https://nodejs.org/download/release/v24.19.0/docs/api/fs.html#file-system-flags) document exclusive creation and its network-filesystem caveat. [Open constants](https://nodejs.org/download/release/v24.19.0/docs/api/fs.html#file-open-constants) describe O_NOFOLLOW and the available Windows subset. [FileHandle.sync](https://nodejs.org/download/release/v24.19.0/docs/api/fs.html#filehandlesync) requests an OS/device-specific descriptor flush. These references support the implementation choices; the broader durability/isolation limits above remain unproved.
