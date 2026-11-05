# Native floor-plan processing checkpoint 360

5 November 2026 EAT. Owner Boniface + Codex.

The floor-plan path now runs the fixed Windows worker from the SQL lease and durable source/journal, then verifies actual lossless output. All 45 focused checks passed with no skips. Progress remains 54/97 (56%).

Implementation

packages/media/src/floor-plan-processing.ts composes the actual isolated SQL preflight callback, immutable source store, worker slot, attempt journal and Windows supervisor. The child is the fixed package floor-plan-worker.js, executed with the current Node binary, no role or arbitrary child arguments, one process and a10-second deadline. The full target is snapshotted synchronously before asynchronous filesystem work. Secure source staging uses exclusive creation, fsync and bounded readback in the original direct-child attempt directory.

Arming consumes the original live ticket. Trusted interpreter/codec/ancestor identities are checked before and after work. The worker owns no caller-selected entry point. Confirmed termination is recorded through the existing worker/journal barrier before output inspection. Nonzero, deadline and unknown outcomes produce no verified result. Unknown or thrown supervisor acknowledgements retain the worker and immutable attempt rather than retrying.

For a confirmed zero exit, exactly source.input, converted.webp and manifest.json must be present. Source bytes must still match. Bounded independent byte/sidecar validation requires the lossless floor-plan role, pipeline, dimensions and actual hashes. Fresh SQL scope/draft/lease validation runs again before returning private readback bytes. No destructive cleanup or output promotion is performed by the processor. Close fences new calls and drains an admitted run.

Shared file checks were extracted from the existing photo one-attempt composition into attempt-files.ts. Photo code retains its existing failure codes and uses the same checked paths, exclusive source creation and bounded file readers. Shared helper extraction avoids a second diverging implementation. Existing floor-plan admission fixtures were extracted for reuse with optional native-retirement cleanup guard.

Verification

Media TypeScript build passed. Final command `node --test --test-concurrency=1 packages/media/tests/one-attempt.test.mjs packages/media/tests/one-attempt-integration.test.mjs packages/media/tests/one-attempt-database.test.mjs packages/media/tests/floor-plan-processing.test.mjs packages/media/tests/floor-plan-admission.test.mjs packages/media/tests/floor-plan-request.test.mjs packages/media/tests/floor-plan-worker.test.mjs packages/media/tests/floor-plan.test.mjs` passed45 tests, zero failures/skips, about64.5seconds. Raw log floor360-native-processing.txt. An earlier focused12-test passing run is retained in floor360-processing-first.txt. The helper extraction initially exposed a missing Identity type import, fixed before the passing build and tests.

Eight new processing checks include an actual SQL/source/journal/native Windows child run, zero exit and empty-job barrier, recorded termination, lossless raw-pixel equality and duplicate-run refusal. The other seven new checks explicitly simulate supervisor observations for lost acknowledgement, malformed output, draft edit during decoding, exclusive source refusal, deadline failure, unexpected file and busy/close-drain/input snapshot behavior. Simulated outcomes are never represented as actual OS termination evidence. Existing photo/native integration and floor-plan worker tests passed after the shared-helper change.

Limits

This verifies maintained local synthetic processing and independent byte readback. Returned readback is not a durable SQL output seal or listing attachment receipt. Output persistence and lost-acknowledgement reconciliation, separate attachment/gallery/approval/public consumption, application HTTP, hosted PostgreSQL concurrency, production resources, mobile devices and operator UAT remain open. Normal migrations and vendor/live system remain unchanged. Task06-4 remains unchecked,54/97(56%),0/14 release gates accepted.

Next, add a separate immutable floor-plan SQL output seal bound to the original lease/output identity and actual manifest. Persist verified bytes and reconcile lost acknowledgements without decoding again. Then add separate attachment, gallery, approval and public consumers under task06-4.

KES10,000 total recurring monthly per realtor remains. No GitHub Actions execution, provider purchase, credits or account plan change.
