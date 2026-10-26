# Search-area polygon kernel — 26 October 2026

## Delivered

- Added a bounded GeoJSON WGS84 polygon parser for the draw-an-area search foundation.
- The supported first slice accepts one closed exterior ring with 3–100 edges, rejects holes, malformed/out-of-range coordinates, degenerate rings, excessive vertices and antimeridian-crossing edges.
- Added point-in-polygon matching with an explicit `[longitude, latitude]` contract and boundary-inclusive behavior.
- Added focused Node tests for valid inclusion/exclusion, polygon edges/vertices, invalid query points and malformed polygon cases.

## Verification

- `npm run build --workspace=@realtor/domain` — passed.
- `node --test packages/domain/tests/search-area.test.mjs` — 4 passed, 0 failed.
- Prettier on changed TypeScript/JavaScript files — passed.
- No web map UI, map-provider integration, property-coordinate persistence, API query integration, browser test or deployed behavior is claimed. Checklist task 07-2 remains open.

## Next

Integrate this parser into a public search contract and listing-location query only after location-coordinate semantics, precision disclosure and query bounds are covered by API tests. Then add accessible draw/edit/clear UI and run browser acceptance when the workstation has adequate free memory. Keep location disclosure coarse and never expose private coordinates.
