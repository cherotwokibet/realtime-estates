# Signed moderation preview and actual browser recovery — 23 October 2026

Checkpoint 146 adds an explicit disposable moderation preview and verifies the mounted reviewer in an actual browser. It does not activate a production service or accept a release gate.

## Implementation

`referenceModerationMode: 'synthetic-reference-transition-v1'` requires the existing reference-draft mode and SQL-only synthetic accepted-media fixtures. The development launcher additionally requires a separate UI port. Unsupported/orphan modes and native-upload combinations fail before listeners. Only this opt-in disposable PGlite database loads the fourth reference SQL proposal; normal migrations and ordinary previews remain unchanged.

The seeded revision is saved and submitted by the synthetic company agent; its different admin reviews it. The saved attributes use catalogue version 1, while the current pointer is version 2 with deliberately renamed labels. Context discovery therefore exercises historical facts. The optional `invalid-first-transition-v1` fault corrupts only one successful transition response after commit, leaving original GET recovery intact. Existing draft-response faults remain scoped to draft operations. Health/metadata explicitly identify the mode, and the ephemeral RS256/JWKS bearer remains nonenumerable and exclusively server-side.

The visual review found raw minor-unit amounts and a sparse layout. The reviewer now displays exact KES amounts, individual known/quote-required fees, location labels, responsive fact columns and visible uncertainty. Missing values remain unsupplied and quote-required prices are not invented. Acknowledgement explicitly includes unavailable-image warnings in the synthetic preview. It does not claim that real photos were inspected.

## Verification

- Four new signed loopback cases passed: mode refusal; historical context with corrupted committed approval and exact original recovery; rejection reason and access guards; default-off and agent reviewer denial.
- The complete API development-preview suite passed **67 checks, zero failures, zero skips**. This includes those four and existing native/signed workflows. These existing native checks do not establish native image coverage for this new metadata-only moderation fixture.
- Final full admin suite passed **338 checks plus eight markup checks**, zero failures/skips. The reviewer markup includes a new exact-cent/quote-required price case. Four focused layout cases overlap that full suite.
- Isolated checkout dependencies installed with scripts disabled; package/API builds completed. Final source formatting and additional checks are recorded in the checkpoint journal. Existing dependency advisories remain an open acceptance item; no forced audit fix or provider purchase was performed.

Actual browser work used a separate Git worktree, `realtor-moderation-preview`, its own dependencies and `.next`, detached at `441578302a9d1343975240b026234a21b9065c97`. The launcher bound UI `127.0.0.1:3005`, with an ephemeral API and a 30-minute identity. No ordinary/main/older independent runtime was controlled or overwritten.

The actual page `/reviews/00000000-0000-4000-8000-000000000400/1/references/4` loaded and hydrated. It showed saved version-one location/amenity labels, complete private content, KES 20,000 advertised price and exact fees, ordered synthetic photo metadata, and an explicit unavailable verified-photo message. Both decision buttons were initially disabled. Photo BFF 403 was expected for this metadata-only mode, not a verified image pass.

One rejection was submitted with exact reason `Synthetic review needs complete owner evidence.` and operation `4adb74c4-7c22-4418-bc3b-b12ce4930e05`. The corrupted committed reply yielded an uncertain state; both replacement decisions were disabled and only original recovery was offered. Actual reload first rendered the recovery shell, then fetched historical catalogue 1 and restored the exact original from real `sessionStorage`, including its reason and operation. It did not automatically submit or recover. Explicit original recovery returned **rejected, editorial version 5**. The reason and operation matched. Explicit settled clearing followed by another actual reload showed no pending review and no retained original, with no new-decision controls. Runtime output observed one transition POST and a later recovery endpoint POST; the connected BFF/SDK tests prove that recovery performs upstream GET only.

The first browser navigation timed out while Next compiled; binding the already-created tab showed the successfully rendered page. No product failure or fallback catalogue was inferred from that navigation timeout. Initial screenshots drove the layout correction; final screenshots and accessibility evidence were saved outside source.

## Evidence and limits

Sibling preservation files include `reference-moderation-preview-{focused,dev-tests,admin-tests,format}.txt`, `reference-moderation-browser-{install,build}.txt`, `reference-review-layout-tests-final.txt`, and `reference-review-browser-{initial,uncertain,recovered,cleared}.png`. Restored/uncertain/recovered/cleared accessibility text is retained alongside them.

This is new actual mounted browser/sessionStorage/reload/original-recovery proof for a synthetic rejection, plus signed HTTP approval/rejection proof. It is **not** a new browser approval, browser role-revocation/identity-expiry test, responsive device matrix, actual-photo inspection, hosted PostgreSQL race, production authentication, complete root suite, operator UAT or cutover approval. Metadata-only fixture bytes cannot establish owner media rights. All 14 release gates remain open. KES 10,000 remains the complete monthly price per client; vendor resources and the old live system remain available.

Next: connect the approved historical reference extension to narrow public API/SDK/web/mobile adapters, preserving nullable legacy absence and excluding private content/reasons/actor fields. Complete creation/successor/import conversion and default-schema activation only after compatibility proofs. Real media, hosted infrastructure, accounts/rights, retention, devices, operator UAT and cutover evidence remain outstanding.
