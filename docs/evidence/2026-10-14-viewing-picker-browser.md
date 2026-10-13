# General-enquiry viewing selection and exact replay — 13–14 October 2026

Boniface + Codex. Synthetic loopback development only; independent source. Work began13October23:55EAT and crossed midnight. No vendor/live change or paid service. KES10,000totalmonthlyprice,16/97broadtasks,0/14gates preserved.

## Property selection

General enquiries now offer an explicit property dropdown backed by the existing fixed-company eligible public catalogue. Fixed BFF GET `/api/enquiry-preview/{actor}/viewing-properties?limit=25` validates preview origin/instance/headers and rejects caller authority/query/body overrides. Upstream SDK performs public GET only,omits staff bearer/cookies and refuses redirects. Full public property contracts are validated before projecting only ID,title,locality,purpose. No private address,photos,credentials or prospect fields are returned. Selection does not grant eligibility: SQL rechecks current enquiry/staff/company/listing availability at save.

Browser validators enforce bounded unique IDs,exact fields,immutable choices and truthful possible truncation (when25items loaded,more may exist;this endpoint cannot assert exact catalogue completeness). No implicit first choice,no manual ID entry,no automatic replacement on refresh. Selected label/ID are retained until deliberate change/clear;request captures exact original ID. Linked enquiries retain their fixed listing and do not expose a property override. General enquiry remains general;viewing carries selected listing. Current access denial hides choice UI with saved details while retaining local original input.

## Verification

136/136admin tests passed,including3new contexts for hostile/duplicate/public-label contracts,bounded source-free browser read and fixed public-catalogue BFF projection/authority rejection. Initial run135pass/1fail because test fixture omitted the4reviewed photo metadata rows required by the existing public API contract. Corrected fixture only;final136pass. Earlier133overlap,not additive. Admin typecheck and production build passed. Logs viewing-picker-admin-tests-final.txt,viewing-picker-types.txt,viewing-picker-build.txt. No SQL/API/shared SDK change in this slice,so prior backend suites were not rerun.

Actual browser launched `node scripts/enquiry-preview.mjs --web --invalid-first-viewing-reply`. Both admin and assigned agent selected general enquiry00000000-0000-4000-8000-000000000701,workingversion2. Dropdown showed one eligible fictional studio and save disabled before selection. Admin selected by descriptive label,typed draft and refreshed choices;selection and notes remained. Screenshot viewing-picker-selected.png. Cleared admin draft before the agent scenario.

Agent selected studio00000000-0000-4000-8000-000000000400 and saved exact notes `  Fictional general enquiry viewing\nRecover exact original.  `. One-shot invalid reply after normal commit retained original operation56333c6a-c741-4453-89e0-e4812f752ff5,expectedEnquiryVersion2,empty preferredSlots. Admin reassigned topeer12,enquiryversion3. Agent explicitly read original receipt and received denial;private saved details/feed/activity/choices hidden,raw61-character notes retained,uncertain status and disabled discard retained. Screenshot viewing-picker-recovery-denied.png.

Admin explicitly checked/adoptedversion3 and restoredagent11,enquiryversion4. Agent explicitly clicked Replay exact original viewing save;original receipt returned applied. Agent separately checked/adoptedcurrent enquiry4 and refreshed viewingfeed:exactly1viewingc9c0a824-ae8f-4264-aedc-62f39b1f054d,viewingversion1,original author/notes. Expanded original still showed expectedEnquiryVersion2 and same operation/selectedlisting. Saved enquiry detail still General enquiry · no property attached. Screenshot viewing-picker-replayed.png. This establishes actual browser exact replay after denial/restoration without duplicate or silent working-version adoption. It simulates invalid committed replies,not literal socket loss. No simultaneous PostgreSQL race/390px/native device/UAT/production pass.

Temporary preview tabs closed and owned preview processes stopped. Browser tracker exported before publication;unsaved note empty. Same-device source preservation is not off-device backup.

## Next

Agreement evidence and proposed→confirmed transition need a strict shared contract and durable original receipts,then protected API/SDK/BFF/UI. Define explicit customer agreement/channel/time/private note and staff authority;confirmation must not be inferred from a proposal. Cancellation/decline/rescheduling/completion/no-show,resource overlap,reminders,real-device/UAT and production controls remain open. Follow docs/business-rules.md section6;do not overwrite approved proposals or silently carry agreement into a changed slot.
