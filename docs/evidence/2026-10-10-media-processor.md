# Local Windows image-worker lifetime proof — 10 October 2026

Independently authored synthetic-only work, verified on Windows10.0.26200 x64, Node24.19.0/libuv1.52.1, PowerShell7.6.5/.NET10.0.11. Vendor originals/live systems remain untouched. No dependency, package version, provider or recurring budget changed. This is a local processor experiment, not production upload acceptance or a release gate.

## Implemented boundary

`packages/media/runtime/windows-supervisor.ps1` compiles the owned C# Win32 binding. It creates an unnamed, noninherited Job Object with kill-on-close and an active-process ceiling. JOB_LIST associates the new Node process atomically during suspended creation; membership is checked before its thread resumes. Real codec jobs permit one process; four is reserved for the trusted three-level descendant fixture. No breakaway flag is allowed.

The supervisor holds the actual job/process handles. A bounded wall deadline or cancellation requests job termination; job accounting must then report zero active processes and the direct handle must be signalled before a `job_empty` receipt is emitted. Direct exit alone is insufficient. A250ms accounting grace after direct exit still checks cancellation and the original deadline; lingering descendants are terminated and must pass the same zero-count barrier. The termination verification window is5s. Unconfirmed outcomes remain unknown and never authorize cleanup.

The separate Node adapter admits one active run, snapshots trusted arguments/signals, checks stable paths, prohibits reused attempt directories and permanently blocks its instance after an unknown outcome. It launches only a fixed absolute supervisor script with shell disabled and hidden windows. Config is capped at16KiB; each diagnostic pipe at8KiB. The overall watchdog includes30s startup + configured child deadline +8s termination allowance. Cancellation has its own8s allowance. A watchdog signals only its owned ChildProcess handle and reports unknown, never pretends that process exit certifies the job.

The adapter explicitly neutralizes Windows/libuv automatically supplied profile/account variables. The native worker environment is rebuilt from five OS/path/temp values plus UV_THREADPOOL_SIZE=1; bearer, SQL, cloud secrets and Node preload variables are not forwarded. This limits environment inheritance, not Windows account permissions or APIs that can derive account information independently.

`src/codec-worker.ts` reads only fixed `source.input` in a fresh owned attempt, bounds the actual opened file, runs the existing codec and exclusively writes/syncs `converted.webp` and a <=4KiB canonical manifest. It emits only a generic failure exit. The coordinator imports no Sharp: `process-readback.ts` snapshots ordinary bounded buffers, rejects shared memory/invalid UTF-8/ambiguous JSON, and compares actual hashes, lengths and selected static WebP headers/dimensions with the exact pipeline/encoder. This is not an independent entropy decoder or a provenance/authorization/SQL receipt. The caller must establish termination before readback/publication.

## Executed results

**51 focused media tests passed; zero failures, skips or cancellations. All eight workspace typechecks passed.** See media-processor-tests.txt and media-processor-types.txt. The run includes14 codec,15 local-store,3 earlier store/codec integration,5 pure readback,11 supervisor/protocol and3 actual child-codec/store tests. Earlier265 moderation tests/admin build remain separate; no combined full-platform run, new application production build, remote CI, device or operator UAT is claimed.

Executed native cases include exit0/17, hanging and JS-busy deadline termination, cancellation/repeated abort, one-job admission and fresh-attempt enforcement, invalid signal/config refusal, stripped synthetic environment sentinels and quoted arguments. The descendant fixture deliberately uses detached child and grandchild with ignored pipes; after root exit the native supervisor detects their remaining membership, terminates the owned job and proves zero. The grandchild heartbeat remains unchanged after the receipt. Actual child decoding → bounded parent readback → separate store publication passes; corrupt input and an exclusive sidecar collision cannot publish. Partial files are removed only after a confirmed barrier.

A deliberately misconfigured owned supervisor (copied trusted Node binary rejecting PowerShell flags) yields no native receipt, stays unknown and blocks reuse. Its attempt/tooling are intentionally retained. This is **not** a native supervisor-crash/OS-failure injection. Raw logs and exact retained fixture paths are outside checkout in rebuild-preservation/2026-10-10-source.

Early probes failed and are preserved there: an immediate post-exit accounting sample misclassified ordinary exits; a subsequent run exposed libuv-managed descendant death and automatic profile-variable supplementation. The bounded accounting grace, surviving descendant fixture and explicit environment entries corrected those observed failures before the completed rerun. Failed logs are historical evidence, not passing checks.

## Limits and next work

Job lifetime accounting is not a security sandbox. Restricted tokens/ACLs, filesystem scope, hostile reparse races, network denial, native CPU/memory quotas, pathological real-image measurements and deployment-OS compatibility remain unproved. Supervisor crash/parent loss/OS API failure recovery and durable fenced jobs require separate evidence. Header checks do not prove entropy validity; encoder versions are fixed to this experimental lockfile. No accepted listing media, upload UI, SQL provenance migration, authenticated attach intent, retained-object cleanup or public delivery is supplied here.

Next implement narrow registered media jobs, sealed output provenance and explicit authenticated attach-intent/finalize/remove/reorder operations using trusted-media-commands.md. Preserve the API's lack of arbitrary media DML and test historical receipt reconciliation/current authorization. Do not expose this local synthetic worker to untrusted production uploads. KES10,000 total monthly client price remains unchanged; production processor hosting/cost is still a measured decision.

## Primary-source checks

Microsoft documents [JOB_LIST process attributes](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute) and [Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects). Those contracts informed the implementation; local executed tests provide the evidence above.

The pinned [libuv1.52.1 Windows process source](https://github.com/libuv/libuv/blob/v1.52.1/src/win/process.c) supplements selected missing environment variables and gives nondetached children its own kill-on-parent-exit job. Its detached mode skips that helper job without requesting Windows job breakaway. These details explain the observed test defects and the corrected fixture/environment choices. [Google's WebP container specification](https://developers.google.com/speed/webp/docs/riff_container) supports the selected framing/dimension checks; full bitstream validation is outside their scope. Sources checked10October2026.
