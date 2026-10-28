# Checkpoint 207: bounded mobile storage waits

**Date:** 28 October 2026 (Africa/Nairobi)

Saved-search load, save and clear now bound the caller's wait to three seconds. A stalled restore returns the existing unavailable state, so the UI can start a session search and show its storage notice. A timed-out save or clear returns false and cannot claim persistence succeeded.

The native operation is not cancelled. It stays in the shared queue until it actually settles, keeping any later clear after an earlier write even when both UI waits time out. Late completion does not deliver restored filters a second time. If the native backend remains stuck, persistence can remain unavailable; session search remains usable.

## Verification

- Focused storage/filter/catalogue suite: **13/13 passed**. Two added tests use deferred storage promises and short test deadlines: restore returns unavailable and delivers once after the late read; timed-out writes remain before clear across separate controllers and the final record is absent. Existing company/origin isolation, malformed records, failure recovery and SDK boundary tests also passed.
- Test TypeScript compilation, mobile typecheck, changed-file Prettier formatting and git diff checks passed.
- These are controlled JavaScript storage tests. No actual native backend timing, Android/device, browser, export/build, operator or full database-backed integration check ran. Free memory was about 889 MB initially and 1,023 MB at final verification; checkpoint205's database allocation failure remains unresolved.

## Delivery and next action

Tasks09-2 and09-5 remain partial. No offline catalogue cache is implemented by this change. Checklist stays **30/97 (31% rounded), 0/14 gates**. Source stays local while GitHub Actions quota is exhausted. KES10,000 total per realtor/month remains the baseline; vendor assets and the old live system were untouched.

At >=2 GB free, rerun the full mobile suite and verify Android normal restore/restart/clear, actual storage failure/stall fallback, company/origin isolation and network interruption. Continue the remaining native account/gallery/favourites/enquiry/viewing journeys. Owner: Boniface + Codex.

## Publication checkpoint

Checkpoint207 publication: private dashboard version194 deployed successfully from898f30f7714a2a9474f7107d788d1c5c35431b99 (deployment appgdep_6ae179c4f808819193a523c9c2089698). Access rechecked owner-only:one owner,zero external visitors,zero groups. Dashboard baseline/browser-state checks2/2passed;675stage notes retained/appended. Feature source42ff01c remains local; no GitHub push/hosted CI rerun. Generated admin next-env.d.ts preserved unstaged.13focused mobile checks passed; no actual native timeout/device/build/full-database pass.30/97tasks(31%rounded),0/14gates. Exactnext:full mobile suite and Android storage/restart/clear/network checks at>=2GBfree; continue dependency-ready local work meanwhile. Owner:Boniface+Codex.
