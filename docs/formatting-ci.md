# Formatting and CI maintenance — 16 October 2026

Prettier 3.9.10 is pinned as a development-only dependency, with its npm lock integrity. Local registry metadata confirmed version/engine compatibility; its installed package declares the MIT licence. Installation added one package with lifecycle scripts disabled, no dependency-version overrides or paid services. The formatter changes the layout of maintained TypeScript/TSX/JavaScript/CSS/JSON/Markdown/YAML source. It does not claim to format SQL, PowerShell or other unsupported file types.

Run npm run format to apply the baseline and npm run format:check to verify it. Shared editor configuration uses two spaces, UTF-8 and LF. Generated outputs, framework-generated declarations, original evidence/audit reports and append-only continuation journals are excluded deliberately. Journal/evidence exclusions preserve at-time records; current application and test source remains checked. Formatting is a separate mechanical baseline from the functional CI changes, to keep review possible.

Official references reviewed: https://prettier.io/docs/install, https://github.com/actions/checkout, https://github.com/actions/setup-node, https://github.com/actions/runner-images. The exact v7 action tags were resolved through the official Git endpoints and their raw action metadata verified Node 24 runtime:

- checkout: 3d3c42e5aac5ba805825da76410c181273ba90b1
- setup-node: 949feb2413d6458794dcd2491c4babbbce0c15c1

CI pins ubuntu-24.04 and Node 24.19.0, grants contents read only, disables checkout credential persistence, and runs formatting before tests/typechecks/web-admin builds/Android export. It triggers for main pushes and pull requests. Superseded runs can be cancelled per ref. Changes limited to the two append-only checkpoint journals skip repeated unchanged-code jobs; all application/config/workflow/test changes continue to require CI. No external collaborator/access or production resource is changed.

The earlier green 0058473 run proves the previous pipeline only. Local full verification and the actual new pull-request/CI result must be recorded before closing task 04-4. Formatting output alone, a submitted workflow or an Android export cannot be called device/UAT/launch acceptance. Exact logs and commit/run IDs will be recorded at the completed checkpoint; failures remain evidence rather than being erased.

Local verification completed: all 1,360 checks passed across the ten full npm test batches (184 domain, 5 demo, 191 API, 212 SDK, 69 signed integration, 225 database, 26 web, 212 admin, 42 development preview and 194 media). All eight workspace typechecks, web/admin production builds, Android export and final format check passed. The 391 pre-existing maintained files match the exact formatter transformation of base 20bcd59a0e4dc4a3790b63f8440760a15d411c2b, with zero mismatches; formatter baseline is separate commit d1a2ab26e13630bda38b422ae6b3b9310d53ec28. Logs and the mechanical review manifest are retained in rebuild-preservation/2026-10-12-source under format-ci-*. Actual new pull-request CI is still pending; task 04-4 and all launch gates remain open.
