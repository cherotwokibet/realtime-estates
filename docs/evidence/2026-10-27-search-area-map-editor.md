# Search-area map drawing slice — 27 October 2026

## Delivered

- Added a Leaflet map editor for connected public area search. Users can start a boundary, add points, finish a closed polygon, drag individual vertices, cancel back to the previous textarea value, and clear only the area field. Geometry is serialized by the same bounded GeoJSON parser used by search. Invalid drag results restore the prior polygon.
- The existing labelled GeoJSON textarea remains available as the keyboard-editing path and for URL-restored boundaries. The map is dynamically imported on the client and is rendered only when a tile source is explicitly configured; otherwise the page explains that drawing is unavailable and retains text entry.
- The first supported tile source is an exact opt-in to OpenStreetMap Standard raster tiles, with visible attribution, no offline/bulk prefetch, normal visible-area requests, and an explicit reminder that this source is for local/manual evaluation only. No production map provider or credentials were selected. This follows the [OSM Tile Usage Policy](https://operations.osmfoundation.org/policies/tiles/) and [Leaflet Quick Start](https://leafletjs.com/examples/quick-start/) guidance; provider choice and production capacity/reliability review remain open.

## Verification

- `npm run test --workspace=@realtor/web`: passed 91/91, including test compilation and added serialization, strict opt-in, malformed input, bounded geometry, and server-rendered fallback/attribution checks.
- `npm run typecheck --workspace=@realtor/web`: passed.
- `npx prettier --check` over changed web source/tests/config and `git diff --check`: passed before this evidence/tracker update; rerun after edits.
- First `npm run build --workspace=@realtor/web`: compiled and type-checked but failed in Next page-data workers (exit code 3221226505) with seven workers on this Windows machine. Retried with the supported `CIRCLE_NODE_TOTAL=2` worker cap (one build worker); production build passed all compilation, TypeScript, page generation and optimization steps. The worker cap was process-local and no project config was changed for it.
- No browser interaction, actual tile request, pointer/keyboard usability, responsive/device check, application deployment or release gate was run. The host reported about 1.2 GB free memory during this checkpoint, below the 2 GB browser-test threshold. Unit and server-rendered checks do not establish interactive acceptance.

## Status and next steps

Partial progress on task 07-2 only. Canonical checklist remains 29/97 tasks (30% rounded), 0/14 gates. Task 07-2 remains open pending a browser check of drawing, drag validation, cancel/clear, filter preservation and URL restoration with adequate resources; review exact attribution/zoom behavior and accessibility; and settle a production map provider before enabling it outside local/manual evaluation. Keep customer listing locations generalized, preserve keyboard GeoJSON entry, and never imply OSM availability has an SLA.

The delivery dashboard was published successfully as Site version 186 from dashboard source commit `6c5bd7906bf41900b3ef12d64f109b0a852d0a08`; deployment `appgdep_6ae0a902aa448191bb99e6466cef9ddf` succeeded at the existing live URL. The returned access policy remains custom owner-only (one owner, zero external users, zero allowed workspace or tenant groups). Browser notes were not changed.

Source edits and evidence are local. Continue at checkpoint 200 after this handoff; do not push the source branch or trigger CI while GitHub Actions minutes are exhausted. Preserve vendor resources and the old live system. Interactive browser/device acceptance and release gates remain open.
