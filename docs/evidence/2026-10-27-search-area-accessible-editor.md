# Accessible polygon query editor — 27 October 2026

## Delivered

- Added a labelled, keyboard-editable GeoJSON polygon textarea to the connected public search form. It explains the single closed WGS84 ring contract and 100-edge limit, retains URL state, marks malformed area input invalid, and includes a clear-area link that keeps the other validated filters.
- Kept the editor out of demo and loaded-list-only modes. The loader guard returns a configuration error rather than widening the search.
- This does **not** include a map, pointer drawing, point dragging, basemap, or visual polygon preview. Users enter or edit GeoJSON text. Task07-2 remains open.

## Verification

- `npm run test --workspace=@realtor/web` — passed, 88 tests, 0 failures; TypeScript test compilation passed.
- Component markup test checks the accessible field description, length limit, clear-area preservation and unsupported-mode omission.
- Prettier checks on changed web files and `git diff --check` — passed.
- Full application typecheck/build, browser/device interaction, and deployment were not run. Free physical memory at start of this checkpoint was about 460 MB.

## Next

1. Provide a visual drawing/editing experience only after selecting an approved map/data source or defining a safe no-provider map approach. The current editor is an accessible precision fallback, not a map replacement.
2. Once the interaction is implemented, exercise pointer/keyboard draw, edit, clear, URL restore/reset in a browser with adequate free memory.
3. Run full web typecheck/build and update checklist only if all acceptance criteria pass. Keep task07-2 and stage gates open meanwhile.
