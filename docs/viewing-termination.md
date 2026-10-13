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
