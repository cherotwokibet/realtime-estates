# Floor-plan processing lease checkpoint 358

5 November 2026 EAT. Owner Boniface + Codex.

Floor-plan processing now retains one immutable lease per registration, with a fixed claim, output identity and deadline. All 12 focused database checks passed. Progress remains 54/97 (56%).

The isolated SQL proposal adds forced-RLS immutable leases and coordinator-only claim, history and fresh-worker-preflight functions. Each registration keeps its first claim, server output identity and a deadline capped at five minutes and the registration expiry. Exact retries recover that original without renewal. A different claim is refused. Fresh preflight checks current company, membership, original actor and assignment, draft version, request identity, nonce and time. Claim audit and insertion are atomic. Ordinary API runtime cannot execute processing functions or read raw lease rows.

Verification

`node --test --test-concurrency=1 database/tests/floor-plan-processing-candidate.test.mjs database/tests/floor-plan-registration-candidate.test.mjs` passed 12 tests with no failures or skips. Five processing checks cover default-off installation, exact replay and audit, changed access and nonce refusal, historical recovery after expiry or draft changes, audit rollback, claim collision and restricted grants/immutability. The seven existing registration tests also passed. Raw log in floor358-processing-lease.txt. Disposable PGlite with explicit restricted roles only.

Limits

This is SQL authority and a fresh admission predicate. It does not yet bind the native worker or attempt journal and does not prove at-most-one actual process launch. No native codec, HTTP, device, hosted concurrency or launch gate check was run at this checkpoint. Normal migrations remain unchanged. Source IO and processing happen outside these SQL locks. Post-IO authorization, output seals and application consumers remain open. Task06-4 remains unchecked, with all 14 release gates open.

Next, bind the fixed floor-plan worker and durable attempt journal to fresh lease admission and the retained source. Then implement lossless output sealing and separate attachment, gallery, approval and public consumers under task06-4.

KES 10,000 total monthly per realtor. Synthetic data only. Existing vendor resources and old live system remain preserved. No GitHub Actions run or paid service was triggered.
