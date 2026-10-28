# Checkpoint215 — expired-byte cleanup foundation

28 October2026. Independently authored local code and disposable synthetic SQL/filesystem fixtures only. No vendor assets, old live system, customer media or external account changed. KES10,000 remains the total monthly client service-price baseline.

## Implemented

- Dedicated NOLOGIN/NOINHERIT `media_maintenance` role and two fixed SECDEF functions, owned by realtor_owner with pg_catalog-only search path. No raw tables, capture/lease/seal/attachment or API privileges.
- Configured-company, bounded25-default/100-maximum UUID pages, explicit pagination and original operation recovery; no company total or deletion-completed claim.
- Immutable authorization for jobs at least one hour past their24-hour expiry. All verified jobs and all attach references are retained, even when no current gallery entry exists. Exact operation replay preserves the original receipt; crossed/replaced operations conflict.
- Before-each-transaction privilege checks, two-second SQL timeout, exact response parsing, no automatic retry and explicit uncertain-COMMIT outcome.
- Internal original-store maintenance capability. Preflight both exact siblings before mutation, verify ancestry/identity/receipt/hash/links, sync a permanent fence before unlinking only known data.bin payloads. Preserve all receipts/directories/metadata and other jobs. Partial payloads without receipts are supported. Reopen and explicit replay retain the fence and remove only remaining bytes. No recursive deletion or path supplied by a browser.

See [maintenance contract and limits](../expired-media-cleanup.md). This is not yet a whole-pipeline sweeper. The caller must positively establish offline quiescence/confirmed live process termination. A historical journal observation never supplies new cleanup authority. Current preview/server composition does not invoke cleanup; unknown containment and temporary decoder workspaces are retained.

## Executed evidence

Evidence folder: [2026-10-28-expired-media-cleanup](2026-10-28-expired-media-cleanup/).

- Full media suite: **205/205passed,0fail/skip**, fresh TypeScript build included. `media-full-current.txt`. Includes actual Windows codec/supervisor and restricted SQL paths as well as contract doubles; suite counts overlap other earlier suites.
- First full default-schema database run:347/350passed,3 failures including a failed parent. The two underlying failures were expected inventories missing the new forced-RLS table and two maintenance functions. Assertions now include the table and explicitly distinguish seven processing permissions from two maintenance permissions, preserving API/public denial. Both affected files then passed31/31 in `schema-inventory-focused.txt`. A complete corrected350-case rerun is still pending at this feature commit; it is not claimed passed here.
- Subsequent complete corrected database rerun: **350/350passed,0fail/skip**, at unchanged feature/test source0595a6f, in `database-full-corrected.txt`. The earlier failure and focused correction are retained. The corrected inventory still checks every private table for forced RLS and explicitly denies maintenance execution to API/processing roles.
- Prior focused role/SQL/filesystem overlap:33/33passed in `adapter-sql-corrected.txt`. The later full media run additionally includes the deliberately lost committed-maintenance reply case.
- Real restricted SQL admission drove actual deletion in a fresh owned store. An intentionally lost COMMIT acknowledgement prevented any physical cleanup; a later candidate read recovered the original operation, then explicit exact admission readback allowed deletion. Original registration/job/receipt history survived.
- Verified old output with no current gallery association was refused. API/coordinator/raw-table access, wrong company, not-yet-due jobs, reused/crossed operations and late processing claims were denied. Maintenance permission widening or additional API membership stopped the adapter before BEGIN/business SQL.
-101 eligible jobs paged100+1 without foreign/recent jobs; read/admission did not fabricate a staff audit action. Immutable maintenance receipts provide their own attributable worker-operation record.
- Filesystem tests covered two payloads, partial input, absent-job fence, same-store/other-job isolation, copied-capability denial, nonquiescent refusal, unknown entries, hardlinks, replay/reopen and a manually arranged interrupted-cleanup state after one unlink. The last is a crash-state fixture, not an actual killed-process/power-loss test.

Initial TypeScript compilation correctly rejected forwarding a new destructive store method through existing processing interfaces. Maintenance was moved to a module-private WeakMap capability; existing read/install snapshots retain exactly their prior interface. Retained failed focused logs also show fixture errors: unused SQL placeholders, numeric-vs-string count assumptions, restricted reads while unknown entries existed, and a fixture session-reset shortcut. Those were corrected without weakening product guards. The final full media suite passed. Early compiler failure details are in the tool transcript; no nonexistent saved compiler log is claimed.

## Progress and exact next step

Task06-3 remains open: whole-pipeline quiescence and eligible incomplete decoder-workspace cleanup, controlled entry point, approved schedule/alerts and actual-pipeline interruption/recovery still need work. Task06-7 also remains open for the image-backed0/3/4/12/13 and interrupted file3/4 browser/device matrix. No new whole task closes at215. Canonical baseline remains **38/97(39%rounded),0/14gates**, with11 more whole tasks required to cross50%.

Next: back up this bounded implementation, refresh the canonical tracker and publish the same owner-private dashboard while preserving browser notes. Continue with a live supervisor retirement/quiescence capability and exact owned incomplete-attempt workspace cleanup, then the image-backed boundary/recovery browser matrix and connected public gallery. Do not use a historical termination journal as a new deletion permit. Production retention/storage, hosted concurrency, provider delivery, devices, operator UAT, rights/account facts, off-device recovery and cutover remain open. No GitHub push/Actions rerun, paid credits/reset or plan change. Owner:Boniface+Codex.
