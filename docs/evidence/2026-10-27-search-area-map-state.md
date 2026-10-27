# Search-area map state validation — 27 October 2026

## Change

Extracted URL/text boundary restoration and vertex-drag validation into pure helpers used by the Leaflet editor. Restored boundaries omit their GeoJSON closing duplicate for editing. Drag validation operates on a copy and commits only if the shared polygon parser accepts the result; invalid, self-intersecting, out-of-range and invalid-index moves return no update, so callers can retain the previous boundary.

## Verification

- `npm run test --workspace=@realtor/web`: passed 92/92 (including TypeScript test compilation); added assertions for boundary restoration, invalid text, valid drag, self-intersection, out-of-range index, and no mutation of the original vertices.
- `npm run typecheck --workspace=@realtor/web`: passed.
- `npx prettier --check` for the changed component/helper/test and `git diff --check`: passed before this evidence/tracker update; rerun after edits.
- `npm run build --workspace=@realtor/web` with process-local `CIRCLE_NODE_TOTAL=2` (Next.js ran one page-data/build worker): passed compilation, TypeScript, static generation, and route optimization.
- No browser, pointer/keyboard interaction, actual tile request, device, operator, or launch check was performed. This is code-level verification only.

## Status and next step

Partial task 07-2 progress only; the checklist remains 29/97 (30% rounded), 0/14 gates. Keep 07-2 open until browser acceptance covers drawing, editing, invalid-drag rollback, cancel/clear, URL restoration and form/filter preservation; mobile/keyboard/responsive checks also remain in 07-7. Owner: Boniface + Codex. Continue with local implementation and tests until the machine can support browser QA; keep production map-provider selection separate from this local/manual OSM opt-in.

Source changes are local and committed in the independently owned source repository. The source repo is not pushed and CI was not triggered. Keep vendor resources and the old live service intact.

The owner-only delivery dashboard was published as Site version 187 from dashboard source commit `900cd7734e69a4f9ef0a0782733ca93666704024`; deployment `appgdep_6ae0b507c9188191838f1f2fb7e23b43` succeeded. Its custom access policy remains owner-only (one owner; zero external users and zero workspace/tenant groups). Existing browser notes were not changed.
