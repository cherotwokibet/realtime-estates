# Synthetic mobile build-profile checks — 26 October 2026

Implemented preview-only native app configuration for the two existing synthetic demo tenants. `apps/mobile/eas.json` defines development, Realtime preview, and inherited Sample Homes preview profiles with internal distribution and `credentialsSource: "remote"`. It contains no signing secrets or project ID. `app.config.ts` selects separate 1024×1024 launcher/adaptive icon paths, tenant-branded preview name/scheme, and non-colliding native identifiers; the package and bundle IDs preserve the tenant slug separators as valid dotted segments. SVG source marks and PNG assets are checked in under `apps/mobile/assets/icons/`.

Verification:

- `node --max-old-space-size=192 --test --test-concurrency=1 apps/mobile/tests/reference-build-config.test.mjs` — passed 1/1. The test resolves both actual Expo configs, checks distinct native IDs, names/schemes, icon PNG signatures/dimensions and SVG sources, profile inheritance, remote credential policy, and absence of credential-like profile values.
- `npm run typecheck --workspace=@realtor/mobile` — passed.
- Prettier check for the changed TypeScript, JSON and Markdown files — passed. `git diff --check` — passed. (The repository's Prettier has no SVG parser; SVG sources use ordinary indented XML.)

No EAS CLI/cloud build, signing credential provisioning, Expo owner/project link, store registration, device install, production identifier or release was exercised. Production identities and approved customer logos remain intentionally absent pending owner approval and controlled account setup. This verifies the synthetic preview-profile implementation only; it does not complete onboarding, account ownership, app-store distribution, physical-device QA or the Stage 10 exit gate.
