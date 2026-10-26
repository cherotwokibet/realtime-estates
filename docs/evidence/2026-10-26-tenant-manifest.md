# Tenant manifest verification — 26 October 2026

Checkpoint 191. Implemented `TENANT_MANIFEST_JSON` as an optional server deployment document bound to the already selected `TENANT_SLUG`. The exact versioned envelope validates a full existing `TenantBrandConfig`, presentation-only advisor/contact flags, and optional same-company public content. The shared byte/depth/duplicate-key JSON parser and existing exact content and brand validators are reused. Semantic theme tokens/CSS and the configured web brand identity are derived only after validation. Invalid configured manifests fail closed; absent manifests preserve the existing compatibility path. Feature flags only suppress public presentation and cannot enable enquiries, authorization, data selection, payments, or other services.

Verification recorded for the source at this checkpoint:

- `npm run test:compile --workspace=@realtor/web` — passed.
- `node --test --test-concurrency=1 apps/web/tests/tenant-manifest.test.mjs` — 5/5 passed (after final schema shape).
- `npm run typecheck --workspace=@realtor/web` — passed.
- `node --test --test-concurrency=1 apps/web/tests/*.test.mjs` — 86/86 passed.
- Prettier check on changed TypeScript, tests, JSON config, and manifest documentation — passed.
- `git diff --check` — passed.

An earlier typecheck correctly caught a missing computed header initial; deriving the initials from the validated configured company name fixed that type error. The complete checks above were rerun after the fix. These are local web compile/type/unit checks, not a Next production build, deployed manifest exercise, browser/device accessibility review, deployment/account verification, service activation, operator UAT, or launch/cutover evidence. Example values remain synthetic; no real contacts/assets or content approval are asserted. The manifest does not yet resolve per-company protected API/data namespaces or tenant onboarding.

Task 10-1 is accepted narrowly on this implementation and verification. Stage 10 remains in progress, and its gate and the other 13 stage gates remain open. Task 10-2 onboarding, account control and quotas are not inferred complete.
