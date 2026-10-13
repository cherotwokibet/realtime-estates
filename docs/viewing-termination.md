# Durable viewing cancellation and decline — 14 October 2026

## Stored workflow

Migration0015 adds immutable terminal history to the existing private viewing and operation ledger. Current active staff/company/enquiry assignment is required for execution and original recovery. Cancellation is allowed from requested/proposed/confirmed; decline only from requested/proposed. Explicit ending remains possible when the enquiry is closed or the listing is paused, withdrawn or otherwise unavailable. It does not change enquiry status/version or send customer messages.

Each applied ending increments only the viewing version and records exact raw reason, ending kind, previous status, previous updated time and server-derived actor/time. Original request preferences/notes, proposed slot and phone agreement—including its original confirming staff and recorded time—remain intact. Terminal history cannot be edited, reverted or deleted. Cancellation after the slot starts is a provisional engineering default until operator review and completion/no-show are implemented.

Shared company/operation serialization and enquiry/viewing row locks protect the original receipt. Lookup of matching requester, kind, target, version and exact reason precedes new state/time checks. Stale commands conflict first. Already-terminal or confirmed-decline commands refuse; a server clock before the previous saved record also refuses. Durable decisions cannot be upgraded by replay. Current access loss conceals originals; restoring access permits exact replay of the same original facts. Same-device PGlite verification does not establish real PostgreSQL simultaneous race behavior.

The protected API adds POST /v2/staff/enquiries/{id}/viewings/{viewingId}/cancellations and /declines. Body is exactly operationId, numeric expectedVersion, reason. Kind comes from the fixed route; actor/company come from verified server context. Duplicate JSON fields, unsafe raw number tokens, unknown authority fields, unsupported query/method and invalid reasons fail before dispatch. Existing requester-private GET /viewing-operations/{operationId} reads original ending receipts without reason in the URL.

SDK terminateViewingV2 and getViewingTerminationReceiptV2 require the exact original kind/target/command. Writes dispatch once; lost or malformed successful replies remain uncertain. Recovery performs only GET and cannot become a write. Terminal schedule/detail/feed validators retain earlier confirmation metadata separately from ending attribution. The admin feed has compiled read-only terminal labels and evidence; cancellation/decline BFF, forms and actual browser ending checks are next.

There is no reminder queue or dispatcher yet. No dispatched-job suppression pass is claimed. A future dispatcher must check current state/version immediately before sending, suppress terminal viewings and invalidate superseded slot tokens. Rescheduling requires a new proposal/agreement; existing agreement cannot silently transfer.

## Verification

Focused corrected viewing SQL:27/27; focused API/SDK:21/21; signed SDK/service HTTP:3/3. Focused counts overlap full suites and must not be added. The new signed scenario deliberately discards a committed cancellation HTTP reply, recovers/replays one cancelled viewing4, retains original phone/proposal/request receipts and confirmation metadata, denies original recovery after reassignment, restores exact replay, and executes a separate requested→declined2 through its fixed route. Enquiry versions change only in the deliberate reassignment operations.

158/158 database,110/110 domain,163/163 API,186/186 SDK,64/64 SDK/service integration,145/145 admin and15/15 signed preview checks passed. All8 workspace typechecks and admin production build passed. Focused27 SQL/21 API+SDK/3 signed HTTP checks overlap these suites;not additive. Logs viewing-termination-*-tests.txt,workspace-types-final.txt and admin-build.txt in rebuild-preservation/2026-10-12-source. Two initial SQL runs used a fixture availability enum unavailable, which is not supported. Fixture corrected to withdrawn; final focused27 all passed without weakening production validation. Prior failure logs retained. No terminal browser/native device/operator UAT/hosted provider/production acceptance.

## Next

Fixed cancellation/decline BFF routes with body-only original recovery to upstream GET; source-free browser transport; immutable selected-viewing/version/reason attempt; explicit reason forms and current access guards. Verify uncertain original recovery, stale conflict, access loss/restored replay and unchanged phone evidence in actual browser. Then rescheduling/new agreement, completion/no-show, reminders, mobile/device/UAT/release. Synthetic-only; vendor/live preserved. KES10,000 total monthly client baseline;16/97 tasks,0/14 gates.

<details><summary>Earlier domain foundation checkpoint</summary>

# Reasoned viewing cancellation and decline — 14 October 2026

## Current domain-only slice

Started from6c904f0operator checkpoint with no active preview. Canonical business-rules.md section6 permits decline/cancel from requested/proposed and cancel from confirmed,requires cancellation actor/reason,retains history and suppresses future reminders. First implementation is a strict command and pure first execution plan;no terminal SQL/API/operator action exists yet.

ViewingTerminationCommand has exactly operationId,expectedVersion,reason. Reason is nonblank private raw text,up to1000Unicodecodepoints;original spaces/newlines retained for exact idempotencyfacts. Controls/unpairedsurrogates/unknown authority/action/delete/notify fields rejected. UUID/version/plain-own-data validation reused;immutable command is time-independent for original recovery after time passes. Kindcancel/decline is a separate explicit operation argument,not a caller authority or free-formstatus.

Plan accepts a currently validated requested/proposed/confirmed ViewingDetail and executionclock. Optimistic version conflict has precedence over decline-state/record-clock rules. Cancel may apply to allthree states;decline cannot replace a confirmation. Executionclock earlierthan latestupdatedAt refuses ratherthanwriting impossiblechronology. Applied plan produces separate cancelled/declined snapshot,oneviewingversion increment,andimmutable terminationkind/fromStatus/rawreason/endedAt/previousUpdatedAt. Originalrequestpreferences,proposedslot andphoneagreementfacts preserved;currentinput—including confirmationactor/serverrecordedtime—unchanged.

Cancellation is allowed afterslotstart for an uncompletedviewing as a provisionalengineeringdefault requiring operatorreview. It records an explicit terminal decision ratherthan infercompletion/no-show. No reschedule,customercontact,deletion,authorization,SQL receipt,appointment mutation or reminder dispatch isperformedbytheplanner. Existing readvalidators remain requested/proposed/confirmed and intentionally reject terminal output until coordinated persistence/DTO integration. Alreadyterminal input iscurrentlyunsupported/failclosed,not a terminal replay capability. No resourceoverlap guarantee.

## Verification

106/106domainchecks passed,including7newcontexts:immutable rawreason/authority rejection,Unicodebounds/unsafe/lossyversions,cancelallthreewithoneincrement,declinebeforeconfirmationonly,stale-first/clockboundaries,pastslotcancellationpreservingphonefacts/input,andgetters/hiddenunsupportedfieldswithoutgetterexecution. Domainbuild andall8workspace typechecks passed. Logs viewing-termination-domain-build.txt,viewing-termination-domain-tests.txt,viewing-termination-workspace-types.txt inrebuild-preservation/2026-10-12-source. Earlier99domain/otherbackend/operator suites overlap or were not rerun. No cancellation/decline SQL/API/browser/device/UAT/release pass.

## Durable implementation next

Additive0015must preserveforcedprivateRLS/no runtime table privileges,current active admin/assigned-agent/company/enquiry access andimmutable requester receipts. Unlike new request/confirmation,explicitending mustremainpossible whenenquiryclosed orlistingpaused/stale/unavailable;otherwiseuncompletedviewings cannotbecleanedup per businessrules. Record server endingactor/time,priorstatus/updatedAt andexactreason;never overwrite originalrequest/proposal/phoneagreement or confirmingactor/time. Only open→terminal transitions;terminalhistory cannotedit/revert/delete. Declineafterconfirmation refused;cancelafterstart allowed untilcompleted/no-show lifecycle defined.

Serializecompany/operationIDs with sharedledger,lockcurrentenquiry/viewing,lookuporiginal requester/facts before new state/time evaluation,thenoptimistic version/businessdecision. Durableconflict/refusal stores no terminal mutation;changedoperationfacts/requester conflict andcurrentdenial conceals originals. Preserveoldrequest/proposal/confirmationreceiptshapes andhistoricalfacts afterending.

Coordinate strict terminal snapshot/detail/feed/receipt contracts andsafe readonlyUIlabels inthesamestorage slice;preserve previousconfirmedmetadata separatelyfromendingmetadata andtimestamp. ProtectedAPI/SDK/BFF/source-freeoriginalattempt/form thenactualbrowserconflict/denial/restoredreplay. Cancellation state mustsuppressfuture reminders;no reminderqueue exists yet,so do not claim a dispatched-job suppression pass. Anyfuture dispatcher mustcheck currentstate/version immediatelybefore send. Rescheduling needs newproposal/newagreement,retained history andoldtoken invalidation;no silent edit orconsentcarryover. Completion/no-show,customer-tokenflow,devices/UAT/production remainseparate.

Boniface+Codex;syntheticonly whileaccount/rights unresolved. Vendor/live intact,KES10,000totalmonthlyprice,16/97tasks/0/14gates unchanged.

</details>
