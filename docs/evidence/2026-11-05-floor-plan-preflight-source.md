# Floor-plan preflight and source admission

5 November 2026. Checkpoint357. Owner Boniface + Codex.

Floor-plan source admission now checks fresh SQL authorization and matches the registered company, actor, draft and source bytes before storage. All 14 focused SQL and durable-store checks passed. Progress is 54/97 (56%).

The isolated SQL preflight returns the exact original only to its current authorized actor and company. Listing/revision locks and current membership/company share locks protect the short preflight transaction. It compares original assignment and draft version, current draft/latest revision, archive status and the 24-hour admission window using decision-time wall clock. Expired and future-dated registrations remain recoverable through the historical read. Preflight creates no registration, audit, lease or version change.

createFloorPlanSourceAdmission reuses the existing strict data/binding validators and immutable request facade. A trusted caller must supply fresh authenticated SQL preflight on every attempt. The helper snapshots target and source before awaiting it, checks the exact returned scope, fixed role/pipeline/non-photo marker, registered source hash/length/container format and timestamp envelope, then calls the existing durable record method once. Mismatches and preflight failures stop before storage. An upstream failure is returned without retry. The source copy survives caller-buffer mutation while SQL is pending.

Executed media TypeScript build and14 focused tests, zero skips, from database/tests/floor-plan-registration-candidate.test.mjs and packages/media/tests/floor-plan-request.test.mjs. The integration uses a real disposable SQL registration/preflight plus two durable stores. It verifies original bytes after store close/reopen and shows that a later draft edit prevents fresh persistence while original source remains readable. Other checks cover malformed role/scope/hash/length/format, extra fields, accessors without getter execution, stale versions, changed assignment, role loss, expiry and future clocks. Clock-boundary rows and later edits are privileged disposable fixtures. Evidence [floor357-preflight-source.txt](floor357-preflight-source.txt).

The source helper depends on a trusted preflight adapter. This checkpoint uses SQL fixtures, with application HTTP integration still open. SQL authorization locks end before source IO. Processing leases, post-IO authorization, restart composition, fixed worker admission, output seal and floor-plan attachment remain under06-4. Hosted concurrency, provider and operator/device acceptance remain under their release gates.

Next, add a separate floor-plan processing lease and worker admission that rechecks scope and binds the retained source. Then seal the actual lossless output and add separate attachment/gallery/approval/public consumers under task06-4.
