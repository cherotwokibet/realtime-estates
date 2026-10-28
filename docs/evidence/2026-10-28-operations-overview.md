# Actionable admin operations overview — checkpoint 212

28 October 2026, Africa/Nairobi. Independently written replacement code; disposable synthetic data only. The vendor resources and old live system remain intact. KES 10,000 remains the total recurring price per realtor per month.

Completed implementation task **08-6**, covering stale available stock, pending submissions, overdue enquiries and ended confirmed viewings awaiting a reported outcome. The canonical checklist becomes **36/97 (37% rounded), 0/14 accepted stage gates**. Thirteen more complete tasks are needed to cross 50%. This acceptance concerns the implemented and locally verified capability; it does not establish production identity, operator acceptance, device testing, external notifications or cutover readiness.

## Implemented behavior

- `GET /v2/staff/operations/overview` returns one fresh statement snapshot. Each queue contains at most ten oldest items and an explicit `hasMore` indication. Displayed item counts are never presented as company totals.
- Additive migration `0032_operations_overview.sql` implements a narrowly granted, fixed-search-path, owner-defined SQL function. Current active admin membership is checked both in the API transaction and inside SQL. Company context is server-owned. No raw viewing-table read permission is added.
- Stale stock means published, available stock with no confirmation or one older than 720 hours. Pending reviews exclude archived stock. Overdue enquiries are open with a saved next action before the snapshot. Outcome work includes ended confirmed slots, including the current reschedule cycle; attendance is never inferred.
- The exact domain/SDK contract excludes messages, contact channels, private addresses, reasons and image provenance. Invalid rows fail closed. Reads reject posted identity, company, role, query/body, precondition, cookie and version authority. There is no overview write or automatic retry.
- `/operations` renders actual authorized summary data, safe links, explicit snapshot time and empty/unavailable states. Server credentials never reach the browser. Refresh makes another read. Unavailable enquiry navigation is hidden in the review-only preview.
- Enquiry and viewing links load the exact current authorized target, including targets outside a queue page. Viewing entry prepares an outcome form with blank evidence fields; it does not save. Review links fetch the exact submitted revision and retain the existing explicit inspection, acknowledgement, reason and version controls. URL targets cannot select an upstream identity or company.

## Executed verification

Raw results are in [the checkpoint evidence directory](2026-10-28-operations-overview/).

| Check | Observed result |
| --- | --- |
| Full API suite | 297/297 passed, zero skipped/cancelled |
| Full declared SDK suite | 300/300 passed, zero skipped/cancelled |
| Full domain suite | 296/296 passed, zero skipped/cancelled |
| Full admin suite | 437 boundary/logic + 30 UI checks passed |
| All signed development HTTP suites | 89/89 passed, serial execution, including default-schema startup and both companies |
| Admin typecheck | Passed |
| Admin production build | Passed, including TypeScript and route generation; process-local one-worker cap restored afterward |
| Focused new contract/API/signed tests | 8/8 passed; overlap with the full suites above |
| New restricted SQL scenario | 1/1 passed; included in the full API suite above |

The restricted SQL scenario creates guarded drafts and SQL-only media metadata, then confirms/submits/approves synthetic listings. Explicitly dated read fixtures distinguish stale, fresh, paused and foreign stock; this is not proof of past business commands or real image bytes. Twelve properly recorded enquiry histories per company prove ten-item truncation, oldest-work selection and `hasMore`. Customer, agent, inactive and foreign-admin contexts are denied. An admin still cannot directly select the raw viewing table. Reads leave audit counts unchanged and transaction context clears. Revoked admin membership is denied on the next read.

## Browser observations

All interactions used the disposable local launcher `scripts/operations-preview.mjs` on port 3116. The two preview processes and agent-created tabs were closed afterward; interruption exit codes are intentional cleanup, not test failures.

1. Enquiry/outcome preview: overview showed two overdue enquiries and two ended confirmed viewings, with empty stock/review queues. The due follow-up link opened enquiry `…702`, current version 3, through the authorized detail read.
2. Outcome link opened enquiry `…701` and viewing `…900`, version 3, with blank occurrence and evidence fields. Keyboard focus reached “Record completed viewing.” No mutation occurred on navigation.
3. A deliberately entered fictional completion produced an applied historical receipt. Explicit viewing-feed refresh showed viewing version 4, the staff-recorded outcome, original confirmation and fictional evidence. After clearing local work and refreshing the overview, the outcome queue decreased from two to one, retaining only `…901`.
4. Foreign target `…802` returned no record in the current company. The workspace hid saved private details, queue and assignee data and disabled private forms; the error remained generic.
5. Review-only preview: overview showed the two current pending submissions. Its link opened listing `…400`, revision 1, revision version 3 and listing version 2. Approval/rejection controls were disabled until explicit acknowledgement. A fictional reason plus acknowledgement followed by deliberate rejection produced a rejected readback. Fresh overview then showed only pending listing `…402`. No real property decision or publication occurred.
6. At an explicit 390×844 viewport the document client/scroll widths were both 375 pixels; all four queue cards remained within approximately x20–355. Tab navigation showed a solid visible focus outline. [Verified narrow screenshot](2026-10-28-operations-overview/narrow-overview-verified.jpg) and before/after DOM snapshots are retained. This is a browser viewport check, not physical-device or full accessibility acceptance.

The stale-stock positive and truncation paths are proved by restricted SQL and rendered-link tests, rather than a positive stale-row browser fixture. The browser stock queues in these two fixtures were empty. Existing stock-control workflows remain separately guarded. The browser review fixture has accepted SQL metadata but no image bytes; verified gallery fetch was unavailable, and no image-quality or rights acceptance is inferred.

## Failures corrected or bounded

The first direct viewing-table query was denied by the runtime role. The implementation was corrected to the narrow SQL function, preserving raw-table denial; the initial failure log is retained. Initial admin test compilation failed on missing relative import extensions; explicit TypeScript extensions fixed it. A browser wait used “staff-reported” instead of the actual feed label “staff-recorded outcome”; the current feed was inspected and the correct state verified. A default screenshot failed, and an early `screenshot()` capture was scaled/clipped; only the subsequent inspected `getScreenshot()` narrow JPEG is claimed as visual evidence.

## Checkpoint and next steps

Checkpoint 211 private dashboard version 198/source `eaf99bfd59648dfd72c9109a3e8587557aaecb2b` succeeded. Its same-device source bundle and fresh-clone/fsck verification are recorded in [the publication journal](2026-10-28-mobile-offline/publication.json). No GitHub source push or Actions rerun occurred while quota was exhausted.

Publish checkpoint 212 to that same owner-only dashboard, preserving all existing notes and local browser edits. Keep generated `apps/admin/next-env.d.ts` unstaged. Then continue dependency-ready media lifecycle/cleanup and remaining web/admin/native implementation. Real account control/rights, hosted provider configuration, off-device backup, native devices, operator UAT and cutover approval remain separate open requirements. Owner: Boniface + Codex.
