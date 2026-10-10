# Windows image processor containment review

Reviewed: 10 October 2026. Scope: the next **local, synthetic-only** image-processing experiment for this rebuild. This is a design review, not an implementation or termination-test report.

## Decision for the next checkpoint

Proceed with a storage-only checkpoint. Keep the existing buffer codec separate from API upload acceptance, database media finalization and a production storage provider. A processor wrapper can follow as a separately reviewed milestone after its Windows process-lifetime guarantees are demonstrated. Do not issue a trusted processing receipt, reuse an attempt directory or delete its files while decoder termination is unconfirmed.

The source reviewed was `docs/trusted-media-runtime.md`, `docs/trusted-media-commands.md`, and `packages/media/src/{index,containers}.ts`, with the codec tests and README. The codec has bounded inputs, static-container checks, fresh WebP encoding and server-computed output metadata. Those controls do not establish a subprocess sandbox, native-memory ceiling, network isolation or crash-safe process-tree cleanup. The runtime document records the root agent's separate codec verification; this review did not execute or repeat it.

## Local facts established by read-only inspection

| Item | Observed value |
| --- | --- |
| Windows version | `10.0.26200.0` |
| Operating system / inspecting process | Both 64-bit |
| Current PowerShell | `7.6.5`, `FullLanguage` |
| Current .NET runtime | `10.0.11` |
| Resolved Node executable | `C:\Program Files\nodejs\node.exe`, file version `24.19.0` |
| Bundled Node executable | `C:\Users\BONIFACE\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe`, file version `24.19.0` |
| Bundled PowerShell executable | `C:\Users\BONIFACE\.cache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe` |
| Windows PowerShell executable | `C:\WINDOWS\System32\WindowsPowerShell\v1.0\powershell.exe`, file version `10.0.26100.8875` |
| taskkill executable | `C:\WINDOWS\system32\taskkill.exe`, file version `10.0.26100.1` |

These are tool availability and version facts, not proof that native interop, Job Objects, nested-job compatibility or termination work here. No decoder was launched, no process was killed, no native helper was compiled, and no dependency/provider was installed in this review. No credentials or environment-variable values were collected for the report.

## Why a direct child or taskkill is insufficient

Node's `kill()` result and `killed` property concern signal delivery. They do not establish completed termination. The `exit` event reports the direct child's exit; `close` additionally reports closure of that child's standard streams. A descendant can redirect or close those streams and continue after its parent exits. Therefore neither event is an empty-process-tree barrier. An absolute executable path, `shell: false` and controlled arguments remain necessary, but do not add containment. [Node 24 child_process documentation](https://nodejs.org/download/release/v24.3.0/docs/api/child_process.html).

Microsoft documents `taskkill /T` as terminating a specified process and processes it started. It does not provide a durable ownership handle or an atomic launch-and-containment protocol. If the root exits before the command runs, its PID no longer anchors a live process; PID reuse also makes later PID-based recovery unsafe. A command exit code cannot establish that every former descendant is gone. This is a design inference from the command's documented interface, not a reproduced failure on this machine. [Microsoft taskkill documentation](https://learn.microsoft.com/en-us/windows-server/administration/windows-commands/taskkill).

Even `CreateProcess(CREATE_SUSPENDED)` followed by `AssignProcessToJobObject` has a crash window between creation and assignment: the supervisor could die and leave a suspended, unowned process. Microsoft describes the Windows 10 `PROC_THREAD_ATTRIBUTE_JOB_LIST` attribute as assigning the process to its jobs during creation, before its initial thread runs. Use that atomic mechanism rather than assigning an already spawned Node child. [Microsoft engineering explanation](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812), [UpdateProcThreadAttribute reference](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute).

## Smallest defensible follow-up implementation

Build a local supervisor for one synthetic job at a time. Node can launch a fixed, reviewed PowerShell script by absolute executable path with `shell: false`, `windowsHide: true`, `-NoLogo -NoProfile -NonInteractive -File` and fixed arguments. Never interpolate client data into PowerShell code, use `-Command`/evaluation, or permit a request-selected executable or script.

The script can compile an in-memory C# P/Invoke helper with the already available `Add-Type`. This avoids a new package but is still new native interop code requiring review and tests; availability of PowerShell is not implementation proof. [Microsoft Add-Type documentation](https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.utility/add-type?view=powershell-7.5).

The helper should implement this sequence:

1. Create a fresh, unnamed Job Object with a non-inheritable handle. Set `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`; leave both breakaway flags disabled. The supervisor stays outside its decoder job and owns the sole job handle. Children normally remain associated unless breakaway is allowed. Closing the last job handle is a crash fail-safe, not a coordinator-observed completion receipt. [Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).
2. Create the decoder with `CreateProcessW`, `STARTUPINFOEX` and `PROC_THREAD_ATTRIBUTE_JOB_LIST`. Supply the absolute Node executable separately as `lpApplicationName`; implement correct Windows argument quoting for fixed arguments. Optionally retain `CREATE_SUSPENDED` for a pre-resume verification step, with job association already atomic. Explicitly restrict inherited handles to intended standard-stream handles; never inherit the job handle. [Process attribute reference](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute).
3. Fail closed if job configuration, attribute setup, process creation or membership verification fails. Never retry with plain `spawn` as a fallback. Existing jobs imposed on this host can affect assignment and must be tested. Keep process handles, not recycled PIDs, as ownership evidence. [AssignProcessToJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-assignprocesstojobobject).
4. For the actual codec, start with an active-process limit of one: Sharp uses threads and does not need arbitrary subprocesses for this slice. Test descendant containment separately with a trusted fixture configuration allowing a small process tree. These settings are supervisor policy, never request input.
5. Enforce a monotonic wall deadline independently of the decoder's JavaScript event loop. Observe cancellation and coordinator-disconnect signals. Count helper startup/compilation in the coordinator's overall deadline as well. Bound and drain protocol/stdout/stderr data; an unbounded diagnostic pipe must not become a memory or deadlock route.
6. On timeout, cancellation, decoder failure or unexpected remaining processes, invalidate the attempt lease, call `TerminateJobObject`, and retain the job handle for verification. The function is intended to terminate job members and nested jobs; its return must not replace a completion check. [TerminateJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-terminatejobobject).
7. Before reporting an empty-job barrier, query that owned job until `ActiveProcesses == 0`, and collect the direct process's exit status. `ActiveProcesses` is the current membership count, not a historical total. Query failures or an expired verification deadline produce an unconfirmed outcome. [Job accounting structure](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_basic_accounting_information), [QueryInformationJobObject](https://learn.microsoft.com/en-us/windows/win32/api/jobapi2/nf-jobapi2-queryinformationjobobject).

Normal exit also needs step 7. A successful decoder message does not override a nonempty job. If the supervisor crashes, kill-on-close provides a useful fail-safe, but Node's observation of supervisor `close` does not itself prove the job has drained. Without an independently owned observation handle, record `containment_unknown`, retain the attempt directory and stop automatic retries/cleanup. Do not claim that this failure path is proven until tested.

## Environment, paths and storage ownership

Construct a new environment allowlist rather than spreading `process.env`. Permit only measured OS/runtime requirements: trusted `SystemRoot`/`WINDIR`, one explicit trusted `PATH` if needed, and `TEMP`/`TMP` pointing to a generated attempt-private directory. Avoid duplicate environment names differing only by case. Exclude database/cloud/JWT credentials, browser auth, `NODE_OPTIONS`, `NODE_PATH`, inspector/preload settings and user profiles. Choose the exact Node executable once in trusted server configuration. A sentinel-only test must demonstrate that inherited values are absent.

The coordinator owns input snapshots, output promotion and eventual deletion. It generates a unique job ID and a new attempt ID for every retry, constructs absolute paths under a private storage root, and never accepts paths from a client. The decoder receives only its bounded source and destination protocol, not tenant/actor identity, SQL credentials or storage-provider keys. It writes an attempt-local partial WebP and partial manifest; it cannot select a public object key.

Path prefix checks alone do not solve symlink/reparse-point races or interference from another process running as the same Windows user. Private directory ownership, safe creation/open semantics, collision rejection and reparse-point handling require separate storage tests. Do not assume the repository's OneDrive location supplies those guarantees. Snapshot input bytes before processing; do not decode a file that an upload writer can still replace.

After the empty-job barrier, the coordinator reads bounded actual output bytes and independently checks length/hash and bounded format/dimension metadata against the codec receipt before promotion. No client-supplied MIME, byte count, hash or `accepted` flag is authoritative. Parent-side readback must not silently repeat an unrestricted native decode and defeat process separation. Atomic promotion, durable receipt storage and crash recovery remain separate storage work; this plan does not implement them.

Processing success cannot by itself authorize a media attachment. Later finalization must use the immutable job/attempt association and captured lease, then recheck current tenant membership, assignment, draft state and expected revision version. A late result from an expired/cancelled attempt is fenced out even if its bytes are valid. Retry uses a fresh attempt directory. Approved snapshots keep their referenced media, and deletion additionally requires reference-lifecycle checks.

## Proposed result contract

This describes a local experiment, not a production acceptance API:

```ts
type SyntheticProcessorOutcome =
  | { state: 'processed'; attemptId: string; termination: 'job_empty';
      outputPath: string; manifest: VerifiedReadbackManifest }
  | { state: 'failed' | 'timed_out' | 'cancelled'; attemptId: string;
      termination: 'job_empty'; safeCode: string }
  | { state: 'containment_unknown'; attemptId: string;
      termination: 'unconfirmed'; cleanupAllowed: false; safeCode: string };

runSyntheticJob(trustedAttempt: AttemptHandle, signal: AbortSignal):
  Promise<SyntheticProcessorOutcome>;
```

`AttemptHandle` is created by the coordinator and resolves owned paths and a trusted deadline. It is not a browser DTO. `VerifiedReadbackManifest` is derived from coordinator readback. Only confirmed empty-job outcomes may proceed to the separate cleanup/reference policy; no unconditional deletion belongs in `finally`. An unknown outcome blocks a new local job until recovery establishes safety. Per-attempt state transitions settle once, including cancellation racing normal completion.

## Required proof matrix for that follow-up

All rows below are proposed tests. None was run for this review.

| Test | Required evidence |
| --- | --- |
| Ordinary independently generated JPEG/PNG/WebP | Actual codec output, readback hash/size/format/dimensions, direct exit and owned job count zero |
| Hanging decoder and explicit cancellation | Deadline/cancel observed outside decoder; termination requested; count zero before cleanup or another attempt |
| Native-busy decoder | Stopping does not depend on decoder promises, event-loop responsiveness or an AbortSignal alone |
| Parent exits while descendant closes its pipes and continues | With a trusted tree-test policy, the supervisor still observes nonzero membership, terminates descendants and verifies zero |
| Production policy process limit one / breakaway attempts | Subprocess creation cannot escape the configured job; failure remains bounded |
| Supervisor crash and coordinator disconnect | No false empty-job receipt; unknown work retained; no reused paths; crash fail-safe exercised without claiming observation where none exists |
| Failures before decoder start, atomic job association and nested host jobs | No uncontained fallback; no pre-assignment process survives; native handles released on every known path |
| Oversized/malformed protocol and excessive diagnostics | Bounded buffers and generic errors; no pipe deadlock or secret logging |
| Exit/cancel/timeout races and repeated stop calls | One terminal result; no PID-based targeting; barrier precedes release/promotion |
| Input mutation, output tampering, collisions and reparse points | Unsafe files rejected; no cross-attempt replacement; readback evidence corresponds to owned bytes |
| Stale lease after otherwise valid processing | No promotion or database attachment; new attempt gets new paths and ownership |
| Environment and command injection sentinels | No inherited credential-like values, preloads or profiles; fixed executable and data-only arguments |
| Configured resource limits | Measured behavior at each limit, with accurate claims about what Windows actually accounts for |

## Explicit remaining limitations

A Job Object addresses process ownership and lifetime. It does not restrict this Windows account's filesystem access or outbound network access. A native decoder exploit could act with its token's privileges. Restricted tokens/AppContainer, filesystem ACL isolation and network policy are not supplied by this proposal. Node's permission model describes itself as a seat belt for trusted code; allowing native addons also limits its isolation value. [Node 24 permissions documentation](https://nodejs.org/download/release/v24.3.0/docs/api/permissions.html).

Input byte/pixel limits, one job at a time, Sharp concurrency settings and V8 heap flags do not establish a bound on all native allocations or machine-wide RAM. Windows exposes per-process/job committed-memory controls, but their configuration, accounting behavior and failure modes must be measured before claiming a resource ceiling. CPU/wall time and output disk usage need independent limits. [Microsoft extended job limits](https://learn.microsoft.com/en-us/windows/win32/api/winnt/ns-winnt-jobobject_extended_limit_information).

This Windows-specific local design is not proof for Linux, serverless workers, multi-tenant hostile processing, production security or a hosting cost estimate. No provider choice, paid service, real upload, API route, SQL command or production media acceptance is authorized by this document alone. The existing storage/command design and the KES 10,000 monthly business target remain constraints for later measured deployment work.
