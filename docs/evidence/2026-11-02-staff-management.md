# Staff management checkpoint248 — 2 November 2026

Local, independently authored replacement code with synthetic fixtures. Task08-4 remains open. No release gate, invitation delivery/redemption, customer conversion or production access grant is accepted.

## Implemented and executed

- The development staff BFF now accepts only complete, canonical loopback metadata injected by the installed Next Node adapter. Host/current-instance checks still run first; forwarded values never select company, actor or bearer and never reach the upstream API. Incomplete, foreign, chained and authority headers are rejected.
- An invitation's selected branch must still be active and visible on the reviewed directory page. A removed/inactive selection stays explicitly unavailable and disables preparation until the operator chooses another branch or company-wide. Acknowledgement clears completed form facts; branch edits require fresh adoption.
- Owned preview cleanup now shares one shutdown promise, attempts API closure even after child retirement failure, observes child exit before replacement and handles asynchronous cleanup failures.
- New isolated existing-staff administration candidate: exact versioned agent/admin and activation commands, immutable actor-bound originals, current state, tenant-row serialization, current-admin recheck, self-change refusal and an explicit last-admin guard. It never creates memberships, converts customers or assigns branch authority. Legacy active rows may retain historical revocation timestamps in storage; the current projection reflects active state without rewriting history.
- Guarded default-off non-production API plus typed SDK expose membership save/original/current. The SQL proposal installs only in an explicitly enabled disposable preview. Normal migrations/startup remain unchanged. Invalid result projections roll back the transaction. Unknown writes remain uncertain; recovery reads never replay writes.

## Test evidence

| Scope | Result | Raw evidence |
| --- | ---: | --- |
| Full shared domain |333/333|[Domain](staff-membership248-domain-full.txt)|
| Isolated restricted membership SQL |5/5|[SQL final](staff-membership248-sql-final.txt)|
| Full API |328/328|[API](staff-membership248-api-full.txt)|
| Full standard SDK |323/323|[SDK](staff-membership248-sdk-full.txt)|
| Signed HTTP membership/branch/invitation regression |14/14|[Signed HTTP](staff-membership248-signed.txt)|
| Full admin server/model/controller |475/475|[Admin](staff-workspace248-admin-full.txt)|
| Full admin SSR/model UI |36/36|[UI](staff-workspace248-ui-full.txt)|
| Focused Next metadata and branch selection |9/9|[Focused](staff-workspace248-focused.txt)|
| Owned child/fixture lifecycle |5/5|[Lifecycle](staff-preview248-lifecycle.txt)|

Counts overlap and do not represent separate deliverables. Test TypeScript builds and domain/API/SDK builds passed. The current full admin production build also passed, including `/staff` and its routes: [raw build log](staff-workspace248-next-build.txt).

The initial Next-shaped request regression returned403 instead of200 against the prior compiled boundary: [failure](staff-boundary248-before.txt). The final focused suite passes. Initial membership SQL run passed4/5: the new test incorrectly expected the existing admin-only import-stock function to remain readable after demotion. Its established P0002 refusal was correct; the test now expects that refusal. The assigned enquiry remains readable after demotion and denies42501 immediately after revocation. [Initial SQL result](staff-membership248-sql.txt) is retained alongside the corrected final5/5.

## Actual owned browser observations

Owned Next development preview on127.0.0.1:3124 with signed ephemeral API identity and first committed reply faults; user dashboard tab preserved.

1. Branch operation `e7590e20-64fb-41a8-b599-561fe2739870`: one POST returned502 after commit; uncertain state disabled replacement/discard, an internal navigation attempt was blocked, and explicit GET recovered the applied original. Acknowledgement reset the branch draft; first-page refresh showed active version1.
2. Invitation `329f6519-8b00-44e0-b7dc-49f52af10492`: selected visible branch, reviewed, submitted once, received uncertain state after corrupt committed reply and recovered by GET. Reload retained this exact operation, conservatively restored uncertain state, and another GET recovered the same original. Delivery remained not attempted and membership not granted.
3. Revocation `f0af6319-ac19-45bb-8db3-195dd98e78cb`: read current invitation, prepared exact revocation, one POST returned502, GET recovered revoked original, acknowledgement/queue refresh showed revoked.
4. Fresh adoption and normal branch update `ad2e3a57-6d50-4a80-ae62-a53a627d07b1` deactivated the branch at version2. The retained invitation branch selection became an explicit unavailable option and preparation stayed disabled. Explicit company-wide selection enabled preparation. No replacement invitation was submitted.
5. A separate owned agent preview displayed “Staff operations unavailable”; no private directory/forms appeared.

Evidence: [AX observations](staff-workspace248-browser-ax.txt), [agent denial](staff-workspace248-agent-denial.txt), [recovered branch](staff-branch248-recovered.png), [uncertain invitation](staff-invitation248-uncertain.png), [blocked unavailable branch](staff-selection248-blocked.png). Browser displayed a571px-wide viewport; no390px override, physical device, complete accessibility, browser replay, mid-request role-loss, popstate or scope-change acceptance is inferred. A Playwright label lookup for Branch initially found no match; the observed combobox role selected it successfully. That automation selector failure was not an application submission.

Both owned tabs were closed. Both harnesses exited0 after quit, port3124 had no listener and the development lock was absent. Only generated Next development type paths were restored. No user app/process, vendor original, old live service, credential, plan, credit or GitHub Actions run was changed.

## Exact next steps

Boniface + Codex: add bounded private membership directory and connect the membership BFF/retained controller/UI. Verify current-role changes and uncertain original recovery in the actual browser. Design and implement recipient-verified, single-use invitation redemption with explicit existing-membership policy, expiry/revocation races and safe role assignment before declaring08-4 complete. Provider identity/delivery, hosted multi-connection concurrency, native devices, operator UAT, rights/account evidence and all14 release gates remain open. Preserve source and publish this checkpoint to the existing private dashboard without changing browser edits. Keep Actions conserved; no November quota reset is assumed or used.
