# CI trigger scope and current account restriction

Recorded 25 October 2026, Africa/Nairobi.

Documentation-only pushes and pull requests now skip Foundation checks when every changed path is Markdown under the root `docs/` directory or the root `README.md`. The previous filter exempted only `docs/CONTINUATION.md` and `docs/START-HERE.md`; publication journal commit `280ede0d7792bc2e3c0ae4d6aaa9204f5e474ad1` also changed two other documentation files and therefore triggered the complete workflow.

`docs/**/*.md` is GitHub's documented pattern for Markdown anywhere under the root documentation directory. Any changed path outside these two patterns still requests the same complete verification job, including changes to application code, SQL, tests, workflow files, package manifests, lockfiles, configuration, and non-Markdown files within `docs/`. Mixed documentation and code changes request the full job. No job step, assertion, runner, permission, cache, or concurrency setting changed. See [GitHub's path filtering and pattern reference](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#onpushpull_requestpull_request_targetpathspaths-ignore).

## Current failures

Read-only GitHub REST inspection confirmed that [realtime-estates run 126](https://github.com/cherotwokibet/realtime-estates/actions/runs/40171719212), for commit `280ede0`, failed before its `verify` job started executing steps. Its annotation reports an account payment or spending restriction. [realtor-platform run 62, attempt 2](https://github.com/cherotwokibet/realtor-platform/actions/runs/40166408984), for commit `cc1fbc6`, has the same annotation on its two initial jobs; the eight dependent jobs were skipped. These runs provide no code-test failure result. The annotation alone does not distinguish failed payments from a spending restriction, although the supplied screenshot also shows GitHub's included-minutes exhaustion notice.

Skipping documentation-only CI reduces unnecessary future requests. It does not fix or bypass the account restriction, restore included minutes, or make the current source verified by hosted CI. No workflow was manually rerun, and no billing, plan, payment, credit, or spending setting was changed. Normal local verification remains available while hosted capacity is unresolved.

## Validation and limits

Lightweight local validation passed: YAML parsed; the complete job, permissions, concurrency and branch settings matched `HEAD`; 18 representative path checks passed; mixed documentation/code changes request verification. All 238 currently tracked exempt files are documentation Markdown, and no tracked executable or non-Markdown path is exempt. The four documentation paths changed by `280ede0` now match the filter. Targeted Prettier and `git diff --check` passed. The local proof is retained in sibling `rebuild-preservation/2026-10-12-source/ci-trigger-scope-2026-10-25.json`. No application test or production build was rerun for this configuration-only change.

GitHub documents that path-filtered workflows may leave required pull-request checks pending. Existing filters already had that behavior; this expands the documentation scope. Branch protection was not inspected or changed. Before requiring this workflow for a documentation-only pull request, review the repository's required-check policy. Local path examples do not claim that an actual hosted event passed or was skipped. GitHub also applies its documented changed-file comparison limits; this change does not alter them.
