# Search area invalid-query recovery — 27 October 2026

## Change

The connected public search now presents an area-only recovery link when the submitted GeoJSON polygon is malformed. It removes only the invalid area value, resets to page one, and retains validated filters such as the selected purpose. The link remains hidden for unrelated filter validation errors so this recovery path cannot bypass them.

## Verification

- [1m[0m`npm run test --workspace=@realtor/web` passed: 88 tests, 0 failures, including TypeScript test compilation.
- Prettier check for the changed web component and catalogue tests passed.
- [1m[0m`git diff --check` passed before tracker updates; it was rerun after tracker updates with no whitespace errors.
- No full application typecheck/build, browser/device acceptance, map-source integration, deployment of the realtor app, or release gate was run.

## Dashboard publication

The existing owner-only dashboard was published successfully as Site version 185 (deployment `appgdep_6ae0985ac20c8191a95f6b905f30c202`) from source commit `3a00a7e1d6a2e26fc3d67c33e705de13323a1218`. Its custom owner-only access policy was preserved (one owner, zero external visitors). Browser notes and exports were not changed.

## Status and next steps

This is partial checklist item 07-2 progress only. The canonical checklist remains 29/97 tasks (30% rounded), 0/14 gates. It does not provide a basemap, visual polygon preview, pointer drawing, or browser acceptance. Next: choose an approved map/data-source or safe no-provider interaction, implement visible draw/edit/clear with accessible controls and URL restoration, then verify the complete flow in a browser once adequate memory is available. Owner: Boniface + Codex.
