# GitHub Actions usage policy —29October2026

Boniface requested efficient Actions usage and then explicitly requested local development before1November2026. Keep application/CI source local and do not dispatch/rerun workflows before that date. No automatic push on the date is configured or promised; review the then-current account state and one verified source snapshot first. No budget, plan, payment method, repository visibility, credentials or spending limit was changed.

The supplied screenshot shows Actions spending **US$8.60 of US$10.00**, leaving **US$1.40 against that pictured budget**, rather than US$2.40. It is a supplied snapshot, not a live billing balance or a guarantee that spending will stop at that amount. The1November timing comes from Boniface; the account's current reset date was not independently verified. No paid service, credit/reset purchase or new account is used.

## Observed waste and prepared changes

The existing `.github/workflows/ci.yml` ignored only `docs/**/*.md` and `README.md`. JSON/HTML acceptance indexes, screenshot/log evidence and checkpoint tooling could therefore start the full test/type/build/Android-export pipeline. The root test command already builds shared packages; the previous following root typecheck/build wrappers rebuilt them again.

The prepared local workflow now:

- Keeps one `verify` job and its required-check identity. An internal dependency-free Git-diff planner chooses expensive steps, rather than skipping the entire workflow through path filters. Documentation/tracker-only updates explicitly report that application tests and builds were not run.
- Runs the full application test suite and all workspace typechecks for every runtime change. No suite, authorization test or failure is suppressed. Only unchanged frontend production builds are omitted: web, admin and Android are selected by affected paths; shared packages, dependencies, workflow/tooling or unknown paths select all three.
- Uses the whole available base-to-HEAD diff, including deleted paths and every commit, with renames disabled for planning. A renamed runtime file cannot hide in `docs/`. Missing, invalid, unrelated or shallowly unavailable base history selects full verification. It never guesses from the final commit alone.
- Preserves pinned action SHAs, read-only repository permission, disabled credential persistence, npm dependency caching and cancellation of superseded runs. Adds a30-minute job timeout and explicit manual full verification. It does not add schedules, matrices, automatic retries, deployments, cached credentials or a self-hosted runner on Boniface's machine.
- Installs dependencies without the informational audit/funding requests, then uses the same existing tests and typechecks. Shared packages built by `npm test` are reused instead of repeating the root build wrappers. Security dependency auditing remains a separate intentional activity; `--no-audit` is not a claim of a clean dependency audit.

Two shallow Git commits are checked out. If a multi-commit push's base is unavailable, the conservative result is a full run; this may cost extra, but cannot incorrectly skip runtime verification. Pull requests and main pushes still receive their existing coverage. Batch locally verified application changes rather than pushing every checkpoint, and do not rerun billing-blocked jobs repeatedly. A manual full run remains the release-candidate verification path after account capacity is confirmed.

Only the `cherotwokibet/realtime-estates` workflow present in this checkout was changed locally. The connected GitHub tool returned404 for the two private workflow paths in this session; no live workflow, branch protection, current run list, current billing setting or separate Flutter `realtor-platform` workflow was changed or verified. Do not describe these edits as deployed account-wide savings.

## Executed verification and limits

`node --test scripts/ci/plan.test.mjs`: **7/7 passed**, including real temporary Git repositories, multi-commit ranges, deletion/rename protection, documentation formats, affected frontend selection, conservative fallback and the retained workflow contract. Prettier parsed/formatted the YAML and scripts; focused `git diff --check` passed. See [raw local proof](evidence/2026-10-29-ci-efficiency/local-planner-tests.txt).

No hosted Actions run, actual dollar saving, remote workflow activation, runner timing or release gate is claimed. These changes do not complete another97-task checklist item. The canonical baseline remains43/97 (44% rounded),0/14 release gates.

GitHub documents that workflow-level path filtering can leave required checks Pending, which is why this change keeps the job and plans its steps internally: [trigger filtering](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow). Cancellation follows [workflow concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency); retained npm caching follows [dependency caching](https://docs.github.com/en/actions/concepts/workflows-and-actions/dependency-caching). Official references inspected29October2026. No exact runner price or savings estimate is inferred.

Next: keep developing and validating locally, complete the current approved-company settings editor/public readback/browser/build evidence, then remaining catalogue/native work toward49/97. On or after1November, independently read account capacity and remote source/check state, keep the new current source separate from historical runs, and run one planned verified batch only when capacity and repository access permit.
