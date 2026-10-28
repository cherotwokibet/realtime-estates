# Checkpoint209: current company-context/API acceptance

**Date:** 28 October2026 (Africa/Nairobi). Accepted local implementation05-4/05-5; see `../api-foundation-acceptance.md` for criterion mapping and remaining gates.

- `npm run test --workspace=@realtor/api`: build and **293/293 passed**,0 failed/skipped/cancelled. This includes three new general-budget cases and current actual SQL/service, signature/host, public search, private draft/media/enquiry/viewing contracts.
- `node --test --test-concurrency=1 apps/api/dev/staff-preview.test.mjs database/tests/foundation.test.mjs`: **30/30 passed**,0 failed/skipped/cancelled. These are10 actual signed loopback HTTP tests and20 restricted SQL tests against disposable PGlite/default migrations. The run was repeated after the budget change; the retained log is the final current run.
- Focused formatting and git diff checks passed. No provider, live database, independent PostgreSQL concurrency, real domain, browser/mobile, operator UAT or hosted CI check was performed.
- Initial audit before the change passed290 API cases and30 signed HTTP/SQL cases. The common-budget gap was then implemented and the current complete runs above passed. No failed check was disabled or counted as passed.
- Physical memory was about1.1–1.8GB during testing; virtual headroom was about20–21GB. This improved headroom allowed actual database tests. It does not establish native emulator/device capacity or retroactively pass checkpoint205's separate mobile failure.

Raw final logs: `2026-10-28-api-foundation/api-tests.txt` and `signed-http-sql.txt`. No bearer tokens or real client data are included.

Status:33/97 tasks (34%rounded),0/14 gates.16 more complete tasks are needed to cross50%. Production routing/identity/distributed limits and complete security/session/device/UAT/cutover gates remain open. Next: dedicated synthetic public-search and admin follow-up browser acceptance. Owner: Boniface + Codex.
