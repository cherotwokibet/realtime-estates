# Checkpoint 203: show every selected public-search criterion

**Date:** 27 October 2026  
**Scope:** Stage 07 public-search filter clarity; no checklist item closed.

## Change

Added visible labels to the current-filter summary for minimum private/shared bathroom counts, custom GeoJSON area, and selected saved county/locality/neighbourhood/amenity facets. If a saved option is no longer in the current public choices, the summary names the filter category without exposing an opaque ID. Existing labels for location, purpose, type, rental period, price and bedrooms remain in place. The helper returns a frozen label list.

## Verification

- `npm run test --workspace=@realtor/web`: **94/94 passed**, including test TypeScript compilation.
- `npm run typecheck --workspace=@realtor/web`: passed.
- Prettier check for the three changed source/test files: passed.
- `git diff --check`: passed.
- A first typecheck caught that an unavailable-catalogue union branch has no saved-option list. The page now supplies an empty validated option set for that branch; the final typecheck passed.
- No production build, browser interaction, viewport or device check was run. Free physical memory was about 724 MB at inspection, below the 2 GB browser-verification target.
- Private dashboard version 190 deployed successfully from commit `10189f5d94db08bf3c93c57308f75c330e637f8b`; live owner-only policy was rechecked (one owner, zero external visitors, zero groups). Existing browser notes were not edited.

## Checklist and risks

Progress stays **30/97 tasks (31% rounded), 0/14 exit gates**. Task 07-2 remains open: the combined filters/page/detail/back/refresh/reset and map-editor browser acceptance has not been recorded. The 50% target is not reached. This change does not validate provider selection, live listing accuracy or launch readiness.

## Next action

Run the combined public-search browser regression (filters, exact counts, sort, paging, detail/back, refresh, clear/reset, saved IDs and keyboard/narrow layout) after at least 2 GB of free memory is available. Owner: Boniface + Codex; production map-provider decision remains with the account owner.
