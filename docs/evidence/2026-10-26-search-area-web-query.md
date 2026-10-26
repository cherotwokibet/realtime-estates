# Web URL handoff for drawn-area search — 26 October 2026

## Delivered in this slice

- The web catalogue parses a bounded GeoJSON Polygon query into the shared domain contract and rejects repeated, malformed, or over-8-KiB values.
- Connected global search passes the validated polygon to the v2 or synthetic-reference v3 API client. The existing pager URLs and ordinary search form preserve the polygon; Clear filters removes it.
- Demo and connected loaded-list modes fail with a configuration message instead of silently returning a broader result when an area is requested.
- No map, polygon draw/edit/clear control, coordinate preview, or pointer/keyboard acceptance was added. This is URL/API wiring only; task07-2 remains open.

## Verification

- `npm run test --workspace=@realtor/web` — passed, 87 tests, 0 failures. This includes area parsing bounds and rejection, no-fallback behavior in unsupported modes, and v2/v3 SDK request plus next-page URL round trips.
- The web test compilation (`tsc -p tsconfig.tests.json`) is included in that command and passed.
- No complete application typecheck/build, browser or device verification, deployment, GitHub workflow, or release gate was run.

## Remaining scope and risks

- Users still cannot draw an area through the page. A URL containing a valid polygon can now reach the API; this is not an end-user map feature.
- Polygon coordinates in a URL may be large and are limited by the bounded parser. No private or unapproved location fields are introduced; search uses only existing public coordinates.
- Work is local. Source Actions quota remains exhausted, and the private dashboard hosting tool is unavailable in this session; dashboard source files can be updated locally only. Browser notes were not touched.

## Exact next actions

1. Implement an accessible draw/edit/clear control that emits the validated polygon contract, with explicit empty-area and unsupported-mode UI.
2. Verify keyboard and pointer interaction and URL restore/reset behavior in a browser when memory allows; do not infer success from component tests.
3. Then run the full web typecheck/build, update evidence, and re-evaluate task07-2 only against its checklist and acceptance gates.
