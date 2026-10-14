# Stored viewing rescheduling — 14 October 2026

Migration 0017 implements repeated rescheduling on the independently written synthetic platform. Only a currently proposed or confirmed viewing can receive a new, different, future Nairobi slot and an explicit private reason. Each applied command increments the viewing version once and starts a proposed cycle without customer agreement. The enquiry version is unchanged.

Original first-cycle columns and immutable applied operation snapshots retain every earlier slot, phone agreement, confirming staff and server time. Current cycle metadata identifies its proposal version, previous status/time and raw reason. A later confirmation must bind that cycle's exact slot/version and record its own agreement after the new proposal. Cancellation and decline retain the cycle actually ended. Old original receipts keep their exact historical projections and remain recoverable by their original requester, subject to current access.

Current staff/company/enquiry assignment, row locking, shared operation namespace, stale-first decisions, durable refusals/conflicts and forced RLS remain enforced in SQL. Original receipt lookup precedes fresh eligibility/time checks. New proposals require an open enquiry and eligible listing; terminal cleanup remains possible after closure or withdrawal. Runtime has protected function execution and no table DML. Trigger/audit/receipt failures roll back the operation atomically. Same-device PGlite checks do not establish hosted PostgreSQL concurrency.

Strict shared current/detail/history/receipt validators distinguish each cycle's active agreement from earlier historical evidence. History remains bounded, contiguous and immutable. Protected POST `/v2/staff/enquiries/{id}/viewings/{viewingId}/reschedules` and SDK `rescheduleViewingV2` submit one fixed command. `getViewingRescheduleReceiptV2` performs exact original GET recovery without putting the slot or reason in URLs. Unusable committed replies remain uncertain; no hidden retry or automatic version adoption occurs. Readonly admin views display cycle metadata. The reschedule BFF, retained browser attempt and operator form are not implemented in this checkpoint.

## Verification actually run

173/173 database tests (11 new rescheduling contexts), 129/129 domain, 168/168 API, 191/191 SDK, 65/65 SDK-service integration, 161/161 admin and 16/16 signed preview checks passed. All eight workspace typechecks and the admin production build passed. Focused 11 SQL, 31 combined API/SDK and four signed contexts overlap the full suites. Logs are retained as `viewing-reschedule-*.txt` in `../rebuild-preservation/2026-10-12-source`.

The signed HTTP test discarded a committed reschedule reply, recovered the exact original receipt, denied recovery after reassignment, restored access, then verified separate agreements on cycles two and three and cancellation at viewing version eight. Old confirmation receipts and all eight history states remained intact. This is synthetic signed HTTP/restricted SQL evidence, not an actual reschedule browser check or literal socket-loss test.

An initial migration SQL syntax error around a CASE comparison was corrected before the final passes; the diagnostic and failed logs remain preserved. No production guard was weakened to obtain a pass. No reschedule browser/device/UAT/production check, real PostgreSQL race, reminder dispatch, launch gate or cutover approval is claimed.

## Exact next work

Implement fixed reschedule BFF and recovery POST-to-upstream-GET, source-free browser transport, immutable retained original command and explicit new-slot/reason form. Preserve uncertain attempts and private-input scope through access denial; never adopt newer versions automatically. Add focused proxy/controller tests and a targeted synthetic corrupted reschedule reply, then verify actual browser stale conflict, access loss/restoration, exact replay, new phone agreement and saved history. Continue completion/no-show, reminder suppression/dispatch, mobile/device and operator acceptance afterwards.

Checklist remains 16/97 and accepted gates 0/14. Boniface builds with Codex; KES 10,000 is the total monthly client price. Vendor resources and the old live system remain untouched. Account/rights evidence, independent off-device backup and approved cutover remain open.
