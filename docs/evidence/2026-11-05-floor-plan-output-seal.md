# Floor-plan output seal checkpoint 361

5 November 2026 EAT. Owner Boniface + Codex.

Floor-plan output sealing now retains one original SQL receipt, checks current authority and source/lease facts, and blocks new processing after sealing. All 20 focused checks passed, including actual Windows-worker output sealing. Progress remains 54/97 (56%).

Implementation

database/proposals/floor-plan-output.sql is isolated and requires the existing registration and processing proposals. It adds a forced-RLS immutable output ledger and coordinator-only seal/read functions. The original claim, nonce, server output identity, manifest, canonical PostgreSQL JSON manifest digest and verified timestamp are retained. Fresh sealing requires current original staff authority, assignment and company, current draft/version, registered source facts and an unexpired matching lease. Locks follow listing, revision, registration, lease order. The output row and attributed audit are atomic.

The floor-plan validator requires its own role, pipeline, countsAsPhoto false and exact lossless operations before delegating common bounded image-field checks to the maintained image metadata validator. Malformed scalar declarations return false. This does not decode bytes in SQL. The coordinator remains trusted to supply independently verified actual bytes and manifest, as exercised by the native integration check.

Exact original replay recovers the same receipt without refreshing timestamp or audit. A changed valid manifest or a wrong lease/output identity conflicts. Current-authority historical read and exact replay survive a later draft edit, while new processing preflight refuses an already sealed request. Normal photo outputs and revision photo counts are untouched. The candidate replaces the isolated worker preflight to add that sealed-result block. Ordinary runtime roles cannot execute sealing or read raw output rows.

Verification

`node --test --test-concurrency=1 database/tests/floor-plan-output-candidate.test.mjs database/tests/floor-plan-processing-candidate.test.mjs database/tests/floor-plan-registration-candidate.test.mjs` passed20 tests with zero failures or skips, about32.3seconds. Eight new output checks exercise exact receipts/audit, invalid/photo/lossy/wrong-source manifests, changed current authority/company/membership/assignment/draft and claim/nonce/output, historical recovery and conflict refusal, lease expiry, audit rollback and explicit retry, immutable rows/grants/forced-RLS and actual Windows native processing linked directly to this SQL seal. The other12 registration/lease regressions passed. Raw log floor361-output-seal.txt.

The native integration uses actual durable source/request stores, journal and worker admission, fixed Windows supervisor and floor-plan child before calling the SQL seal. Confirmed empty-job termination precedes independent output readback. Other new SQL checks use real PGlite restricted roles and actual lossless conversion manifests. There is no claim of physical mobile, hosted concurrency or operator acceptance. Initial test fixtures used the wrong audit column and a forbidden null assignee; these and SQL dollar-quote generation errors were corrected before the final passing run. Earlier fixture-failure output is retained locally in floor361-output-first.txt.

Limits

This is an explicitly installed SQL proposal tested with synthetic data. Normal migrations remain unchanged. SQL stores metadata and receipts, not media bytes. Durable verified-output storage, retained seal intent/receipt composition, lost-acknowledgement reconciliation, separate attachment/gallery/approval/public use and application HTTP integration remain open. A seal is not listing attachment or public delivery. Task06-4 stays open,54/97(56%),0/14 gates accepted.

Next, persist verified floor-plan output bytes and the original seal intent in the durable stores, bind the SQL receipt, and reconcile lost acknowledgements without decoding or writing again. Then add separate attachment, gallery, approval and public consumers under task06-4.

KES10,000 total monthly per realtor remains. Vendor resources and old live system are preserved. No GitHub Actions execution, paid provider, credits or account plan change.
