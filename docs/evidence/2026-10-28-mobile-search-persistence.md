# Checkpoint 206: scoped mobile search persistence

**Date:** 28 October 2026 (Africa/Nairobi)

## Implementation

The development-only connected synthetic catalogue saves validated applied search criteria through AsyncStorage. A fresh catalogue session restores them before issuing its first search, starting at offset zero. Company and API origin form the storage boundary; changing either remounts the catalogue session. Draft edits are written only when Search applies valid criteria. Clear resets the query and removes only that scope's stored record.

The exact versioned envelope has a 4,096-character bound, a filter allowlist, enum checks and existing exact KES/room-count validation. Unknown versions, mismatched company/origin, private or extra fields, corrupt JSON and invalid filters are discarded before reuse. Storage errors show generic feedback while keeping session search usable. Operations share a per-storage/per-key queue across controllers, preventing a late save from overwriting a later clear. UI callbacks ignore an unmounted session.

AsyncStorage is unencrypted local preference storage. This implementation stores public synthetic search criteria, with no tokens, accounts, contacts, catalogue records or private content. Actual native installation/restart persistence remains **unverified**. Demo-tab session favourites are unchanged.

## Dependency and verification

- Installed exact `@react-native-async-storage/async-storage@2.2.0` using npm with `--ignore-scripts --no-audit --no-fund`; three packages were added. Lockfile changes are limited to the dependency chain. The version matches the installed Expo 57 `bundledNativeModules.json` map. Expo's official [storage guide](https://docs.expo.dev/develop/user-interface/store-data/) describes the persistent key/value option. No cloud build or paid service ran.
- Final mobile typecheck and test TypeScript compilation passed.
- Focused storage/filter/catalogue suites: **11/11 passed**. Controlled memory storage tests cover fresh-controller restore at page zero, two-company/two-origin separation, scoped clear, corrupt/oversized/future/private/mismatched records, write/clear ordering across controllers and failure recovery. Existing SDK checks exercise query serialization with controlled HTTP responses. These are not tests of the native storage backend.
- Focused Prettier, dependency-to-SDK-map assertion and git diff checks passed.
- Initial separate-module test compilation rejected extensionless imports under NodeNext. Storage logic was consolidated into the existing compiled search module, the temporary file removed, and final compilation/typechecking passed.
- Free physical memory was about 800 MB initially, then 592/549 MB. No full database-backed suite retry, Android export/install/restart, production build, browser, actual native storage, accessibility or operator check ran. Checkpoint205's allocation failure remains unresolved.

## Checklist and next action

**30/97 tasks (31% rounded), 0/14 accepted gates.** Task09-2 remains partial pending device-backed persistence and remaining gallery/favourites/account/enquiry/viewing acceptance. KES10,000 total per realtor/month remains the baseline. Source is retained locally while Actions quota is exhausted; vendor resources and the old live system were untouched.

At >=2 GB free memory, rerun the full mobile suite, then verify Android apply/force-quit/relaunch/page-zero restore, clear/relaunch, company/origin isolation, storage-error feedback and stale catalogue handling. Continue the remaining native journeys with separate account/provider and operator acceptance. Owner: Boniface + Codex.

## Publication checkpoint

Checkpoint 206 publication: private dashboard version193 deployed successfully from 3abf8548b6eb04a7b7f2fb3f030f16b21cad3311 (deployment appgdep_6ae177c051c0819184447c4befa40689). Owner-only access rechecked: one owner, zero external visitors, zero groups. Embedded/downloadable baseline and preserved-browser-state checks passed 2/2, with 674 retained/appended stage notes. Source feature commit94cd78e is retained locally; no GitHub push or hosted workflow rerun. Generated admin next-env.d.ts remains unstaged. Checklist stays30/97 (31%rounded),0/14gates. No live browser/native storage/install/restart or database integration verification is implied. Final free memory986MB. Exact next: at>=2GBfree, full mobile suite then Android apply/force-quit/relaunch/page-zero restore/clear/relaunch and company/origin isolation, followed by remaining native journeys. Owner:Boniface+Codex.
