# Floor-plan preparation coordinator checkpoint 365

5 November 2026 EAT. Owner Boniface + Codex.

Floor-plan preparation now joins registration, source admission, deterministic claiming, fixed processing and sealing in one server coordinator, with read-only original recovery. All 13 focused checks passed, including an actual Windows-worker preparation run. Progress remains 54/97 (56%).

Implementation

packages/media/src/floor-plan-preparation.ts adds a server-only coordinator for a complete preparation target and bounded raster source. The target and bytes are snapshotted before asynchronous work. Size, shared-buffer and container checks run before registration. Server source facts derive from actual bytes. The original registration must match current company/actor/listing/revision/expected-version/request and declared source facts before immutable source admission. Source admission repeats fresh SQL preflight before storing its original.

The preparation request UUID is the deterministic claim identity within the same tenant. SQL still creates the lease nonce and output object identity; the claim ID grants no access by itself. This avoids manufacturing a different claim during original recovery. Current lease facts are checked against source before the supplied fixed processing/output-delivery composition runs. Only its sealed result becomes a compact prepared DTO. Worker, source, generation, claim/nonce, store and actor/company identities do not appear in that DTO.

Only the explicit FloorPlanPreparationUncertainError classification permits one read of the matching original registration or claim after an uncertain acknowledgement. Commands are not reissued. Generic failures stop before later stages. Missing/partial original facts stay blocked. Recover authenticates original SQL registration/lease reads, verifies retained source, then invokes read-only sealed-output reconciliation. It does not register, persist source, claim, decode or seal. Source-admission validation was extracted into one shared helper and reused, preserving the existing source facade behavior. Close fences new work and drains the current operation; supplied resources stay caller-owned.

Verification

Media TypeScript build passed. `node --test --test-concurrency=1 packages/media/tests/floor-plan-preparation.test.mjs packages/media/tests/floor-plan-request.test.mjs` passed13 tests, zero failures/skips, about17seconds. Six new coordinator checks cover actual native Windows full preparation and read-only recovery, uncertain register/claim acknowledgement readback, generic failure/wrong registration, source persistence failure and missing lease, snapshot/singleflight/close drain, and a different claim response/unavailable original. Seven existing source/request regressions passed after helper extraction. Raw log floor365-preparation.txt.

The first new integration uses actual isolated SQL, source/request/output/metadata stores, journal/worker admission, fixed Windows supervisor and decoder, byte readback and SQL seal. The remaining new tests explicitly simulate the trusted processor with actual lossless conversion and SQL, injecting controlled failures. They claim no additional OS termination evidence. Known-uncertain cases issue each registration and claim once; recovery counters prove no later command/source/native/seal writes.

Limits

This is reusable server composition, not HTTP ingress. The caller must provide a target from verified server identity and trusted authenticated SQL callbacks. It does not authenticate a browser, parse HTTP streams, deploy an image provider or create an upload route. No upload/BFF/browser/mobile/operator/production acceptance is claimed. No SQL is installed by this module, and normal migrations remain unchanged. Task06-4 remains open,54/97(56%),0/14 accepted gates.

Next, expose guarded bounded file upload/preparation and original preparation recovery through the authenticated HTTP API, using verified server identity and early current-draft authorization. Then connect BFF and author/reviewer screens, followed by approved/public/successor snapshot rules under task06-4.

KES10,000 total monthly per realtor remains. Vendor resources and old live system stay available. No GitHub Actions execution, paid provider, credits or account plan change.
