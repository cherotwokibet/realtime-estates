# Floor-plan worker admission checkpoint 359

5 November 2026 EAT. Owner Boniface + Codex.

Floor-plan leases now bind retained source bytes to the actual durable worker slot and one-use attempt journal. All 47 focused checks passed. Progress remains 54/97 (56%).

Implementation

packages/media/src/floor-plan-admission.ts adds trusted server-only preparation, arming and cancellation. It snapshots the complete original binding before asynchronous work. Fresh authenticated SQL preflight runs before source reading, again after retained source IO, and immediately before arming. Receipt validation binds all original company/actor/draft/version/request/job/generation/source identities, exact source length/hash/container, floor-plan role and pipeline, claim, nonce, fixed output identity and bounded expiry. Wrong role, changed output identity, stale draft, malformed/accessor receipt and expired lease are refused.

Preparation uses the existing actual durable worker slot and journal with attempt1. Arming consumes the existing live journal ticket exactly once. Historical inspection and reopen never recreate that ticket. A denial before arming releases only the known unlaunched worker slot. Cancellation also releases that slot while preserving the immutable journal intent. An interrupted/unknown attempt remains blocked for inspection rather than being replaced. The facade owns no supplied store or process, and closing fences later calls while retaining any prepared reservation.

Verification

Media TypeScript build passed. Final command `node --test --test-concurrency=1 packages/media/tests/floor-plan-admission.test.mjs packages/media/tests/floor-plan-request.test.mjs packages/media/tests/worker-admission.test.mjs packages/media/tests/attempt-journal.test.mjs` passed47 tests, zero failures/skips. Seven new integration checks use actual isolated floor-plan SQL proposals in PGlite, durable source/request stores, attempt journal and worker admission. They cover exact lease/source binding, consumed ticket, reopen refusal, draft changes during IO and before arm, altered role/output/source bytes, malformed/accessor/expired receipts, busy and closed fencing, input snapshot and explicit cancellation. Existing40 tests cover source-store and journal/worker regressions. Raw log floor359-worker-admission.txt. Initial TypeScript narrowing errors and a test reopen call missing its expected store ID were corrected before the final passing run.

Limits

These checks launch no child process and make no OS termination claim. A prepared or armed slot is not proof of native decoding or completed processing. Secure attempt-directory source staging, supervisor composition, termination/readback, SQL output seal, attachment/gallery and application HTTP remain open. The authenticated SQL callback and supplied stores are trusted server configuration. Its SQL locks end before file IO. All data are synthetic, normal database migrations unchanged. Task06-4 stays open and all14 release gates remain unaccepted.

Next, securely stage the retained source in the reserved attempt directory, run the fixed floor-plan child through the existing Windows supervisor, record confirmed termination, and verify actual output readback. Then add SQL output sealing and separate attachment/gallery/approval/public consumers under task06-4.

No GitHub Actions execution, account/plan change, credit purchase or provider provisioning occurred. KES10,000 total monthly client baseline and vendor/old-live preservation remain.
