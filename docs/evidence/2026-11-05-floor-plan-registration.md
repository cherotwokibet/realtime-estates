# Floor-plan registration foundation

5 November 2026. Checkpoint356. Owner Boniface + Codex.

Floor-plan SQL registration now binds the current company, staff member, draft version and declared source facts to an immutable original. All 23 focused database checks passed, including five new floor-plan tests. Verified progress is 54/97 (56%).

The isolated proposal adds register_synthetic_floor_plan and read_synthetic_floor_plan_registration. Registration validates source hash, declared length (1–10 MiB), jpeg/png/webp format, operation UUID and safe revision/version bounds. It locks the listing and revision, serializes the original operation, then locks and rechecks the current actor membership and enabled company through commit. The server generates job, generation and input-object identities. The returned binding matches the existing floor-plan request storage contract. Source facts are declarations awaiting worker byte verification.

A registration preserves the draft version and photo tables. Its separate floor_plan.registered audit records the original actor, listing, version, request and generated job. The immutable registration stores source facts and registered assignment for later fresh-work preflight. Exact retries recover the original facts after later edits or archive. Changed requests conflict. Reads require current listing access and the original actor. Runtime roles have function execution only, with forced row security and immutable private rows. An audit failure rolls back registration.

Executed node --test database/tests/floor-plan-registration-candidate.test.mjs database/tests/media-upload-context.test.mjs database/tests/media-upload-preflight.test.mjs. All23 passed, zero skips. Five are the new floor-plan tests. The same log includes existing photo context and preflight regression checks. Prettier and Git whitespace checks passed for changed files. Evidence [floor356-registration.txt](floor356-registration.txt).

The proposal is installed explicitly in disposable PGlite tests and remains outside normal migrations. No application upload or worker admission uses it yet. Task06-4 remains open for preflight, lease and actual source verification, output sealing, attachment, approval and public/native rendering. Hosted concurrency and database/provider acceptance remain at their release gates.

Next, add fresh-work preflight that checks current authority, original assignment, expiry and exact source facts before connecting the existing immutable source store and fixed floor-plan worker. Then implement separate output sealing, attachment and gallery consumers under task06-4.
