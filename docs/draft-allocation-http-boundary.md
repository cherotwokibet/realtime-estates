# Draft allocation compatibility: HTTP boundary — 16 October 2026

Ordinary draft edits now require a positive expected version. Both v1/v2 PUT draft routes reject zero before opening a mutation transaction; the v2 SDK rejects the string `"0"` before transport. Positive-version edits retain typed SQL parameters and current tenant/actor authorization. This removes the direct HTTP save-to-allocate shortcut. Use `createListingV2` for a new listing or `startListingRevisionV2` for an approved/rejected predecessor, retain the original operation, and read current authority before editing.

This intentionally changes compatibility in the independently owned replacement, which has not cut over. It does not change the vendor system. SDK validation failure is definite and never dispatches; HTTP rejection uses the existing safe 400 invalid-input response. Successful save/submit uncertain-result handling and explicit recovery are unchanged.

The database transition remains open. SQL `app_api.save_draft` and `save_draft_v2` still accept zero for legacy callers and internal guarded creation/successor commands. This checkpoint does not claim exclusive allocation at the SQL privilege boundary. The original scan found 27 literal zero-version fixture/preview/test sites. Three service test arrangements now explicitly initialize historical SQL fixtures so those tests can verify HTTP denial without pretending they used guarded HTTP allocation. A client/service integration case instead creates a separate unfinished listing through guarded creation, then edits it with a positive saved version and verifies incomplete submission remains refused.

Evidence is in sibling `rebuild-preservation/2026-10-12-source/draft-allocation-http-*`. The new boundary regression verifies both contracts reject zero/string-zero/negative versions before any mutation call, then verifies typed positive-version updates and trusted actor/tenant context. Service tests retain identity, assignment/company, stale-version, safe failure and Unicode body-limit coverage. The signed preview checks direct zero-version successor allocation returns 400 and leaves the exact listing/predecessor unchanged, then completes guarded allocation, uncertain-result recovery and normal editing. Full affected totals are recorded at publication. No browser/device/production/cutover or new SQL migration pass is claimed.

Next migration:

1. Inventory v1/v2 functions, dynamic/literal callers and `0022`/`0023` internal dependencies. Include fixture startup and tests that deliberately allocate later legacy revisions.
2. Put allocation implementations behind private helpers with no PUBLIC/runtime execute grants. Keep public edit wrappers positive-version-only; update guarded creation/successor functions to use private helpers. Do not use a caller-controlled bypass setting.
3. Convert fixture initialization to guarded creation/reassignment or trusted bootstrap setup never exposed through runtime grants. Preserve actor, tenant, version/audit expectations deliberately.
4. Prove legacy SQL allocation/private access denied, guarded operations preserved, no duplicate allocation/audit on replay, normal edits versioned and failure rollback atomic. Run full database and affected signed suites before claiming completion.

Progress remains 19/97 tasks, 0/14 accepted gates. KES 10,000 is the total monthly client price. Rights/accounts/retention/devices/operator UAT/cutover remain open; synthetic data and the old live system are preserved.
