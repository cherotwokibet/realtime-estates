# Search and enquiry implementation acceptance — 28 October 2026

Checkpoint 210. Independent synthetic replacement code only. No vendor system or real prospect was changed. This accepts implementation tasks 07-2 and 08-2, while production provider, device, operator UAT and release gates remain open.

## Public search — task 07-2

Executed the current source through a disposable restricted SQL/API preview and the actual Next web UI in the in-app browser on loopback port 3104. The explicit public-search-v1 fixture contains 32 approved fictional listings. Browser evidence is in `2026-10-28-search-browser/`.

- Traversed 12/12/8 result pages and refreshed page three; count and URL persisted.
- Price filtering without rent/buy produced the explicit validation error. Monthly inclusive KES20,000 returned five exact-price rows; strict Over with equal maximum returned zero; increasing maximum to20,000.01 returned the two next-cent rows. Sale apartment strict Over10,000,000 through10,000,000.01 returned exactly sale28.
- Seven-plus bedrooms returned four rows; exact7,8,9,10 each returned their own row. Studio0 returned four rows and excluded unknown land. Shared-bath minimum2 returned one row; adding private-bath minimum2 returned zero, proving shared baths do not satisfy the private minimum.
- Global county choice returned the stock beyond the original first page. Saved county and amenity conjunctions, land type, unavailable text location, ascending and descending price and title order returned the observed exact lists. Descending filtered pages retained24 matches across12/12; detail and browser Back restored page2 and its filters. Keyboard Clear filters restored32.
- A development-only local coordinate grid makes no external tile request. Pointer draw3, undo to2, add/finish, keyboard cancel restoring the previous polygon, URL submission and refresh were observed. The polygon returned zero because this fixture does not disclose public coordinates; the actual API inside/boundary/outside/null geometry checks remain separately recorded. This is no cartographic/provider approval.
- Invalid GeoJSON exposed a real bug: the interactive Clear area button was disabled. It now tracks nonempty text separately from valid polygon state. Actual browser regression cleared malformed text and restored the same24 filtered matches, preserving other filters. Start/Clear remain disabled until editor initialization.
- At390x844, document width375 did not exceed viewport390; price inputs fit, keyboard focus was visible. PNGs and final DOM were saved. This is a responsive browser check, not a physical device or full WCAG audit.

Full web suite101/101, test compilation, web TypeScript, final full Next16.4.2 production build with TypeScript and one worker, and diff checks passed. Raw logs retained. Initial GridLayer protected-method TypeScript error was corrected with a proper subclass before the final passes. Several early observations raced navigation; labels 'exact bedrooms9/10' in raw observations are superseded by explicit completed-navigation observations and are not counted. An initial role-label locator and several early click timing attempts failed; keyboard submission plus observed URL/render readiness completed the checks. No console errors/warnings were returned by the final inspected tab.

## Admin and agent enquiries — task 08-2

Executed the current actual admin UI against disposable enquiry-queue-v1 SQL/API on3114. Initial admin60/agent53 rows were fictional. Evidence is in `2026-10-28-enquiry-browser/`.

- Admin traversed50+10; older overdue work became reachable through the server overdue queue. It showed two overdue leads, distinct from today's queue.
- Saved a fictional completed call at08:00 Nairobi with a note explicitly saying no person was contacted. Observed immutable receipt, then explicitly refreshed the contact history and saw one saved record. Contact save retained workflow version3.
- Rescheduled the overdue lead to18:30 Nairobi. Historical receipt reported version4 and15:30Z. Checking current details retained original working input until explicit adoption. Refresh removed this lead from overdue and included it in today's queue.
- Closed that lead as lost with a fictional reason. Receipt/current read/adoption reached version5, no scheduled follow-up; refreshed today queue no longer contained it.
- Selecting another lead with retained local input displayed an explicit discard guard. After deliberate discard, assigned a new lead to the active agent; saved version2 and agent owner were observed.
- Separate agent workspace saw the newly assigned lead,50+4 rows after assignment, and only its own one due-today lead. The peer-agent due lead visible to admin was absent. Agent action choices excluded staff assignment. The closed lead remained historical with no active reminder.
- At390x844, document width375 and follow-up input bounds32.8–342.4 fit the viewport. Saved screenshot/DOM and keyboard interaction evidence; no operator/device/full accessibility pass is inferred.

Current complete admin test command passed437 logic/boundary tests plus28 UI tests, with test compilation. Existing current API293 and actual signed HTTP/SQL30 passes are checkpoint209 evidence, not newly rerun here. These tests do not establish real notification delivery, production distributed enforcement, physical-device acceptance or operator UAT. Both owned preview processes/tabs were closed; intentional process interruption is not a test failure. Generated next-env files are preserved unstaged. No GitHub push/Actions rerun or spending occurred.

## Acceptance and next steps

The whole literal07-2 and08-2 implementation scopes now have current browser, keyboard, narrow layout, data-boundary and regression evidence. Operator UAT remains task12-7 and its stage gate; no stage is accepted. Canonical checklist becomes35/97 (36% rounded),0/14 gates. Fourteen more whole tasks are needed to reach at least50% (49/97). Publish the same owner-private dashboard, preserve browser notes, then continue native search/device readiness and dependency-ready implementation. Rights/accounts, production hosting/media provider, factual content, migration/restore, operator UAT, cutover and handover require their own evidence.
