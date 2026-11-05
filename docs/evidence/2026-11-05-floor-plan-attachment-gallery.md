# Floor-plan attachment and private gallery checkpoint 363

5 November 2026 EAT. Owner Boniface + Codex.

Floor plans now attach, replace and remove through versioned commands, with private gallery bytes checked against current attachment and access before and after storage reads. All 30 focused checks passed, including the actual native-worker-to-gallery flow. Progress remains 54/97 (56%).

Implementation

database/proposals/floor-plan-attachment.sql adds isolated forced-RLS immutable attachment history, current private gallery metadata and original-command recovery. Complete normalized commands bind listing/revision, stable operation ID, expected revision token and sealed request or explicit removal. Each new command increments the shared revision token once and atomically records its result, sealed-output snapshot and attributed audit. Exact replay returns the original result without restoring removed/replaced content or changing a later draft. Membership/company locks and listing/revision serialization protect new writes. Current role, tenant and assignment control writes, history and gallery reads. Fresh writes require a latest nonarchived draft and a sealed output from that listing/revision with unchanged registered assignment.

One effective floor plan is selected from the latest operation result for the saved revision. Replacement and removal preserve earlier originals. Floor plans never enter revision_media or photo count calculations. The API runtime receives narrow command/read execution; raw attachment history remains inaccessible. Authorized current admins and newly assigned agents can read the current listing gallery even when another agent prepared the output, while original-command recovery remains bound to its author. Pending/archived history remains readable with current authority, but new writes are refused.

packages/media/src/floor-plan-output.ts now has optional trusted current-gallery reading and readAttached. It snapshots current company/actor/listing/revision and validates the gallery/command/result/output/source identities before private storage reads. The durable intent binds store identities and the selected original source. The service independently verifies source/output hash, manifest and SQL receipt, then checks the same current gallery again before returning copied private bytes. Removal, replacement, version/scope changes or access loss during IO refuse byte return. Missing current attachment returns missing without loading old bytes. No decoder, SQL mutation, store install or public URL is created by gallery reading.

Verification

Media TypeScript build and targeted formatting/whitespace checks passed. Final command `node --test --test-concurrency=1 database/tests/floor-plan-attachment-candidate.test.mjs database/tests/floor-plan-output-candidate.test.mjs packages/media/tests/floor-plan-output.test.mjs` passed30 tests, zero failures/skips, about53.2seconds. Raw log floor363-attachment.txt. Seven new SQL checks cover attachment/version/audit, replace/remove/replay history, sealed same-scope output and token refusal, tenant/role/assignment, malformed commands, audit rollback/immutable grants and pending/archive rules. Eight output SQL regressions and15 media delivery/gallery checks passed. Five new private-byte checks cover removal/rebinding during reads, membership revocation during reads, wrong scope/origin before byte reads and corruption without repair.

The maintained actual Windows integration now continues from confirmed native processing through durable output, SQL seal and listing attachment to private gallery metadata and actual verified bytes. It matches the gallery pointer/nonce/hash to stored bytes and confirms photo count remains0. Both the assigned agent and a current admin read the same private bytes. The other existing SQL/native integration also passed. Mock processor/fault tests remain explicitly distinct from native termination evidence. Initial fixture issues involving an unexported ID, an actor argument and missing revoked_at in the revocation fixture were corrected before the final passing run. Earlier fixture failures are retained in floor363-attachment-first.txt.

Limits

Maintained local synthetic backend only. The SQL proposal is explicitly installed by tests; normal migrations remain unchanged. No application HTTP/BFF, author/reviewer browser UI, approval/public/successor-floor-plan snapshot integration, hosted PostgreSQL race, physical mobile, operator UAT or cutover is accepted here. Permission checks are point-in-time before/after storage IO, not continuous network-transmission authority. Existing photo rules, vendor resources and old live system remain preserved. Task06-4 stays open,54/97(56%),0/14 release gates accepted.

Next, connect floor-plan attachment recovery, saved gallery metadata and verified private bytes to the authenticated API and author/reviewer screens. Then add approval snapshots, successor-copy rules and approved public delivery under task06-4.

KES10,000 total monthly per realtor remains. No GitHub Actions execution, paid provider, credits or account plan change.
