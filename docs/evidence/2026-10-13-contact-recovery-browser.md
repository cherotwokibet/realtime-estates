# Contact reply corruption, access loss and recovery — 13 October 2026

Started from clean de4a83e / dashboard44 with no active preview. Work targets stages06/08/12;16/97 tasks,0/14 gates and KES10,000 monthly price unchanged.

Added optional process-only `contactReplyFault:'invalid-first-applied-v1'` to the disposable signed synthetic fixture. Launcher flag: `node scripts/enquiry-preview.mjs --invalid-first-contact-reply`. Invalid values or lack of explicit synthetic enquiry mode fail configuration; existing production refusal applies. Only the first successful applied contact POST receipt is replaced with an invalid, source-free response after its normal SQL commit. Denials/conflicts/reads do not consume the fault. No browser flag/header/route enables it; normal preview and production code paths are unchanged. This simulates loss of valid reply facts, not a literal socket disconnect.

Final13/13 signed enquiry preview tests passed, including new test proving denied/stale commands don't consume fault, committed original is recoverable, exact replay is identical, one feed row remains and enquiry version does not change. Next successful contact has a valid receipt. Invalid configuration is rejected before bootstrap. Existing119/119 admin checks also passed. Final admin typecheck/build logs are contact-access-types.txt and contact-access-build.txt.

Manual browser sequence, same disposable database and two fixed server-only synthetic identities:

1. Assigned agent opened newly assigned enquiry at version2 (three visible assigned enquiries). Submitted completed call with raw notes `  Synthetic agent contact with corrupted reply.\nOriginal notes retained.  ` and Nairobi time `2026-10-12T15:04:05.006`.
2. First committed contact returned invalid reply; browser showed Contact result uncertain, retained operation `fbd1a610-2690-4eb8-bb96-751cfd00914a`, exact input and expected version2, disabled discard and offered explicit read/replay. No automatic replay was observed or implemented.
3. Admin normal assignment moved enquiry to peer agent012, creating version3. Original agent's receipt recovery was denied. This exposed a UI defect: feed cleared but older saved private details/activity remained visible.
4. Fixed contact denial propagation to parent workspace:401/403/404 on feed or contact write/recovery now invokes its existing deny guard; saved details/current comparison/queue/directory hide and stale in-flight parent reads are invalidated. Contact stays mounted with local input/immutable attempt. Feed rendering additionally requires an available saved version; activity unmounts when saved details are hidden.
5. Repeated original-result read after the fix. DOM confirmed fictional saved email was not visible, raw notes remained exact, uncertain discard stayed disabled, saved details showed unavailable and activity was absent. Screenshot contact-access-hidden.png retained.
6. Admin explicitly compared/adopted current version3 and assigned original agent011 again, producing version4. Original agent explicitly read original contact result: Contact recorded with original/observed version2. Recovery did not restore private details or adopt version4.
7. Agent explicitly checked current enquiry and adopted version4, then refreshed contact feed. Exactly one saved contact remained with original notes/time/actor. Historical contact receipt still observed version2.

Screenshots in sibling rebuild-preservation/2026-10-12-source: contact-uncertain.png, contact-access-hidden.png, contact-recovered-proof.png, contact-recovered-full.png. Actual browser width488px only. API exact replay was tested; browser replay control was not exercised in this run. Literal disconnection, token expiry/revocation, concurrent browser stale-response injection, physical devices, operator UAT and production acceptance remain open. Existing SQL/integration checks cover additional assignment/revocation boundaries without establishing those browser passes.

Next: explicit browser exact replay after an uncertain reply, feed-denial and concurrent stale-read regressions; then separate viewing workflow. No outbound message, lifecycle change or launch gate accepted.
