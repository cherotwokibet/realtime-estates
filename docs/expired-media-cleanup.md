# Expired unverified media: offline maintenance foundation

28 October2026. Independent local implementation, exercised only with synthetic disposable SQL/filesystem fixtures. No vendor/live system, production media, account or hosted worker was changed. This is not an enabled production sweeper or an accepted retention policy.

## Boundaries

Migration0034 adds a dedicated non-login `media_maintenance` role with exactly two owner-defined commands under a fixed `pg_catalog` search path. It has no raw private table, API, capture, lease, seal or attachment permission. Neither `api_runtime` nor `media_coordinator` receives maintenance execution. A real deployment would need a separately controlled NOINHERIT login belonging only to this role.

`MediaMaintenanceDatabase` binds one trusted configured tenant at construction; browser-selected actor/company/role/paths are absent. Its privilege/ownership/grant guard runs before every transaction. Unexpected functions, role membership, owner/API membership, table/column privileges, grant options and unsafe function definitions fail closed. Commands are fixed/parameterized with a transaction-local two-second timeout. No SQL or filesystem command is automatically retried.

`candidates(after,limit)` returns a bounded UUID-ordered page, at most100 jobs plus hasMore. The default page is25. It includes only the configured tenant's unverified jobs at least one hour past their24-hour registration lifetime, and excludes every verified output, attach intent or attachment. Already admitted operations appear with their original operation ID for explicit recovery. A page is an observation; authorization rechecks the current job under lock. It does not report a company total, a completed deletion or a production storage inventory. Restart pagination from the beginning on a later sweep to catch subsequently expired lower UUIDs.

`authorize(jobId,operationId)` commits an immutable admission receipt only when the exact tenant/job is due, no active lease exists and no verified/reference record exists. Every verified job is retained, including unattached, removed or rejected images. Original capture/lease/registration/attachment metadata is never deleted or rewritten. Original operation replay returns the original authorization; changed operations or crossed jobs conflict. Job expiry already prevents new capture/claim/seal authority; existing metadata readback remains possible. SQL admission is not proof of physical cleanup.

The shared authorization parser snapshots exact data fields without running getters, rejects proxies/private additions/identity collisions, and preserves UTC microseconds when checking the one-hour grace. The database adapter validates the returned company/job/operation before COMMIT. If a COMMIT response is lost, the result is uncertain, the connection is destroyed and no authorization is returned to a physical-cleanup caller. A later candidate read exposes the original ID; deliberate exact authorization readback can recover it.

## Owned local byte store

`retireExpiredDurableJob(originalStore,committedAuthorization,confirmQuiescent)` is an internal maintenance capability, never an HTTP route. Only the original live store object created/reopened by this module is accepted. Ordinary five-method store snapshots given to upload/request/processing components carry no maintenance capability. Authorization shape validation alone does not authenticate SQL: callers must obtain the receipt from the restricted database adapter, never a browser/post body, disk upload or arbitrary JSON.

The caller must fence admission, drain all writers/readers/processing for this configured root, and positively confirm live process containment/termination before returning true from `confirmQuiescent`. A historical journal observation, expired SQL lease, `close()` on an admission journal, or absence of a known handle is insufficient. Unknown containment must return false and retain bytes. This foundation does not yet build that whole-pipeline capability automatically; no current preview/server invokes it.

The store preflights the exact job's quarantine/output siblings before mutation. It refuses unexpected entries, symbolic links, hardlinks, replaced directories, invalid receipts, mismatched object identity/hash and oversized payloads. It uses verified absolute root ancestry and only explicit known file paths. A canonical, synced `expiry.json` fence is written before unlinking either `data.bin`. It removes no directories or receipt files and never uses recursive deletion. Partial uploads without receipts can be removed after the same admission/quiescence checks. A previously absent job is fenced so a late ordinary install cannot recreate bytes under this store capability.

Receipts remain byte-for-byte unchanged. Reads/installs of a fenced job return RETIRED across reopen. An explicit same-admission replay removes only remaining known payloads; counts describe this attempt, not a cumulative total. Corrupt/incomplete fence persistence retains payloads and requires investigation; it is not auto-repaired. Unknown directories are never scanned or traversed. Other jobs remain readable. Filesystem assumptions remain a trusted stable local volume and a controlled offline caller; hostile same-user races and directory/power-loss durability are not established.

This affects only the configured durable input/output store. Request/attempt/worker journals, temporary decoder workspaces, unknown roots, all verified media, vendor/live files and production object storage are outside deletion scope. Retaining accepted output here is deliberate; an approved public/historical-media retention policy needs its own design.

## Remaining delivery work

Task06-3 remains open: implement the whole-pipeline quiescence capability and safe cleanup of eligible owned incomplete attempt workspaces without treating historical termination records as new deletion authority. Connect a controlled offline maintenance entry point, document the approved retention schedule/alerts and verify interruption/recovery through the actual pipeline. Unknown/unconfirmed process containment must retain all related resources. Production/provider isolation, object quotas/retention and off-device recovery remain release work.

Task06-7 remains open for the full image-backed0/3/4/12/13 browser matrix and interrupted file3/4 recovery. No browser/device/operator or release gate is inferred from SQL/filesystem test results. KES10,000 remains the total recurring client price baseline.
