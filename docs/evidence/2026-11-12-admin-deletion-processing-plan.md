# Admin preview of the deletion processing plan

12 November 2026 EAT, checkpoint 409. A reviewer can load a read-only plan after confirming or recovering a plan-review decision. The admin server uses its configured reviewer identity and the exact saved decision. The screen checks the returned decision against its receipt, displays counts and lists pending identity, retention, hold, provider and backup checks. A separate hold has no plan. Plan access in the admin preview requires explicit development configuration.

The local browser used the signed loopback API and disposable database. After a simulated committed 503, the plan stayed hidden until the original receipt was recovered. The reviewer then loaded the counts and pending checks. A second tab recorded a hold and showed no plan. After the reviewer was revoked, a plan refresh returned 403 and cleared the displayed plan. See the [loaded plan](deletion409-plan.png) and [revoked view](deletion409-revoked.png).

The [admin build](deletion409-admin-build.txt) and [13 focused checks](deletion409-checks.txt) passed. Next, use the disposable fixture to verify how a restore reconciles a pending deletion and withdrawn notification consent before reopening reads. Production processing still requires approved retention, provider and restore evidence. Task 09-3 remains open.
