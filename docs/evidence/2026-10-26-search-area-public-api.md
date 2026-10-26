# Public draw-area search API slice — 26 October 2026

## Delivered

- Added an `area` option to anonymous public property search v2 and synthetic-reference v3. The client validates the bounded polygon before serializing it; the API validates it again and fails closed for malformed, repeated or oversized input.
- The API binds ring coordinates as numeric parameters, bounds candidates to the polygon’s longitude/latitude envelope, and includes points on polygon edges. Listings without approved public coordinates do not match. Search remains limited to the public listing views, so this filter does not grant access to private listing fields or exact addresses.
- The implementation uses the existing public latitude/longitude columns and does not add a database extension or schema change.

## Verification

- `npm run build --workspace=@realtor/domain` — passed.
- `npm run build --workspace=@realtor/api` — passed.
- `npm run build --workspace=@realtor/api-client` — passed.
- `node --test apps/api/tests/public-search.test.mjs` — 8 passed, 0 failed. PGlite exercised both v2 and v3 public views and returned the inside and boundary points while excluding the outside and coordinate-null rows.
- `node --test packages/api-client/tests/public-search.test.mjs` — 13 passed, 0 failed, including URL serialization and rejection checks for v2 and v3.
- Prettier checks for changed source/tests and `git diff --check` — passed.

## Scope still open

This is server/client search filtering only. There is no interactive or accessible map drawing/edit/clear UI, no browser acceptance, no current-device verification and no deployment. Checklist task07-2 remains open. This is local synthetic implementation evidence, not a live-system replacement or release gate.

## Next

Implement an accessible draw/edit/clear interaction that emits this polygon contract, add URL-preserved state and visible handling for unsupported/empty areas, and verify keyboard and pointer behavior in a browser. Continue protecting the legacy live system and use only public/coarsened listing coordinates.
