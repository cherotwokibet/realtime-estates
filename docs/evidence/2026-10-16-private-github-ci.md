# Actual private GitHub source and CI evidence

Observed 15–16 October 2026 in Boniface's authenticated GitHub browser. Repository: https://github.com/cherotwokibet/realtime-estates. Settings report Private repository and **0 collaborators; only you can contribute**. No collaborator invitation, public exposure, paid upgrade or account-plan change was made. Access DOM/JPEG retained outside source as github-private-source-access.txt/.jpg. Boniface explicitly completed browser and Git Credential Manager authorization; source/history push and fresh matching clean/fsck remote clones are recorded in source-backup-next.md and dated recovery manifests.

Foundation CI run #7 for exact source **0058473007a5debb9e5f0bc5db13c7807203732b** succeeded:

https://github.com/cherotwokibet/realtime-estates/actions/runs/38802146440

Job: https://github.com/cherotwokibet/realtime-estates/actions/runs/38802146440/job/116653651635

Visible job steps completed: fresh checkout, Node setup, npm ci, npm test, npm run typecheck, npm run build:web and npm run export:android --workspace=@realtor/mobile. Run duration 9m21s; job 9m15s. DOM/JPEG: github-ci-0058473-job.txt / github-ci-0058473.jpg. This proves that exact prior checkpoint's Linux CI pipeline, not the uncommitted operator changes or any installed native device/store release.

The successful run includes a warning about actions/checkout@v4 and actions/setup-node@v4 targeting deprecated Node 20 and being forced onto Node 24, plus notice of a forthcoming ubuntu-latest label migration. Formatting enforcement and reviewed runner/action maintenance remain next work; the broad formatting/CI task is not closed merely because this run succeeded.

Source access/contribution/licence rules and onboarding/release/architecture documentation now exist in contributing.md, architecture.md, development.md and release-workflow.md. Source remains private with no external reuse grant pending a deliberate licence decision. Broader vendor/client rights, production account control, database/media restore and release acceptance remain open; these observations do not establish legal ownership of vendor assets or accept a launch gate.
