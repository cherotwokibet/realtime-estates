# Search-area map drawing undo — 27 October 2026

## Change

Added an “Undo last point” control while a new boundary is being drawn. It is disabled before any points exist; removing a point updates the count and redraws the remaining sketch. This complements Finish and Cancel and uses a copy-producing helper, so undo never mutates the prior input list. The map's underlying GeoJSON parser still gates finalization.

## Verification

- `npm run test --workspace=@realtor/web`: passed 93/93, including test TypeScript compilation. Added helper checks for removing the last point from populated and empty lists and preserving the original list.
- `npm run typecheck --workspace=@realtor/web`: passed.
- `npx prettier --check` on the changed editor/helper/test and `git diff --check`: passed before this evidence/tracker update; rerun after edits.
- `npm run build --workspace=@realtor/web` with process-local `CIRCLE_NODE_TOTAL=2` (one Next build worker): passed compile, TypeScript, static generation and optimization.
- The first suite run failed only because the SSR assertion expected a draw-mode-only Undo button in the initial idle markup. The control is intentionally rendered only during drawing; the incorrect assertion was removed and the full suite passed afterward. No application behavior was changed for this correction.
- No interactive browser, tile request, keyboard/pointer usability, responsive/device, operator or release-gate check was run.

## Status and next action

Partial task 07-2 progress only. The checklist remains 29/97 tasks (30% rounded), 0/14 gates. Keep the task open until browser verification covers drawing, undo, finish, invalid-drag rollback, cancel/clear, URL restoration and preservation of the other filters. Keyboard area entry is available through the textarea; map-control accessibility and mobile layouts still need real-browser checks. Owner: Boniface + Codex.

The owner-private delivery dashboard update is recorded after checkpoint 201 publication. Browser notes, vendor resources and the old live system were not changed. Source code remains in the independent repository; do not push the source repo or trigger CI while Actions minutes are exhausted.

Private delivery dashboard Site version 188 deployed successfully from dashboard source commit `6451060d7e7996b289adb94e4c1bae7b2e8d98f9`; deployment `appgdep_6ae0c394ab6481919ac07448a8909089` succeeded. The custom access policy remains owner-only (one owner, no external users or workspace/tenant groups). Browser notes were preserved.
