# Phone agreement confirmation foundation — 14 October 2026

Started after property pickerb33b70e,with no active local preview. Stages02/06/08/12. Independently written synthetic domain code only. Canonical business-rules.md section6 requires recorded customer agreement;first bounded implementation models staff-recorded completed phone agreement. Other agreement channels and customer tokens are not inferred or implemented.

## Contract and first execution rules

ViewingConfirmationCommand has exactly operationId,expectedVersion,slot,channel(phone),agreedAt,notes. IDs/versions/UTC millisecond instants and15-minute..4-hour Nairobi slot use existing strict contracts. Notes preserve exact original spacing,newlines and Unicode up to2000codepoints;blank/unsafe/control text rejected. No actor/company/customerId/token/confirmed flag. Plain own enumerable data only;getters/hidden fields rejected without executing them. Immutable command validation is timeless,for later original receipt recovery after a slot passes.

Pure plan accepts a validated current ViewingDetail plus explicit execution clock. Optimistic viewing version is checked first. Only proposed state can confirm;commandslot must exactly equal current proposal. Slotstart must be future,agreedAt must be at or after proposal updatedAt and at or before executionclock. Exact boundaries accepted;changed-slot/preproposal/future agreement refused. These timebounds are provisional engineering defaults for operator review. Agreement notes are a staff assertion,not identity/phone ownership verification.

Applied plan yields a separate immutable ConfirmedViewingSchedule with statusconfirmed/version3,exactproposedslot,unchanged original request preferences and agreementfacts. It does not mutate input,enquiry or datastore;does not reserve a resource,create an appointment,send invitation/reminder,authorize a caller or retain a durable receipt. Existing ViewingSchedule/Detail/Page and ViewingOriginal/Receipt still support only requested/proposed. No live API acceptsconfirmation yet;do not render confirmed data through old validators/UI.

## Verification

95/95domain tests passed,including7new contexts for immutable evidence/authority refusal,timeless command validation,exact proposal/version3plan,stale-first and requested-state denial,slot-bound/time-bound agreement,futureagreement/startedslot denial,and accessors/hidden fields without caller execution. Initial94run overlaps final95. Domainbuild and all8workspace typechecks passed. Logs viewing-confirmation-domain-build-final.txt,viewing-confirmation-domain-tests-final.txt,viewing-confirmation-workspace-types.txt in rebuild-preservation/2026-10-12-source. Existing136admin/14preview/backend evidence is earlier work,not rerun here. No confirmation SQL/API/browser/device/UAT/production pass.

## Additive durable implementation next

Migration0014 must keep forced private RLS/no api_runtime table privileges and immutable original request/proposal payloads/receipts. Add private phone evidence with derived confirming actor and server recorded time. Only requested1→proposed2→confirmed3 transitions;existing notes/preferences/slot cannot be overwritten. First execution needs current signed active admin/assigned agent,open enquiry,eligible samecompany published/available freshlisting and exact viewingtarget/version/slot/timebounds. Lock enquiry/viewing/listing and serialize company/operation ID. Original requester lookup precedes new time/state/eligibility evaluation;changed facts/requester conflict,current denial hides receipt. Durable stale/businessrefusal receipts must have no agreement row/state mutation or enquiry version update.

Coordinate confirmed schedule/detail/feed validation,typed original confirmation receipts,protected API/SDK/BFF/UI. Preserve old requested/proposed receipt shapes and historical originals across later confirmation. Customer token flow,rescheduling/cancel/decline/completed/no-show,staff/listing overlap,reminders and device/UAT/release remain separate gates. No production/provider purchases or vendor/live changes. KES10,000totalmonthlyprice,16/97tasks,0/14gates remain.
