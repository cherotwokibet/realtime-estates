# Web and admin pilot rehearsal

Checkpoint 430, 12 November 2026 EAT. Boniface authorized reordering the work. The next milestone is an operator rehearsal of the web and admin journey. Mobile remains part of the full rebuild, with installed-device checks grouped into a separate test session when a device and controlled host are available. Payments, commissions and advanced growth modules follow the existing deferral. The monthly service baseline is KES 10,000 per realtor.

The repeatable local test ran for both synthetic companies. An agent created a new studio listing and verified it was absent from public search. Four synthetic photos passed the native upload and attachment pipeline. The admin approved the listing, and public search then returned the open-plan studio, the exact price and the published gallery. An anonymous WebP read returned image bytes. The web intake handler sent an enquiry for the listing and an identical retry returned the original receipt. The admin assigned the enquiry, and the agent requested, proposed and confirmed a viewing. In each database, a current admin could not read the other company's seeded draft or assigned enquiry.

Six checks passed across the new pilot and existing journey fixtures, and the existing public gallery test passed separately. This run used the real local HTTP API, signed synthetic staff, restricted database roles, the web catalogue loader and the web enquiry handler. Browser interaction, operator acceptance, and hosted staging remain to be verified. The cross-company checks cover drafts and enquiries in shared fixture data, with an additional missing-record check for the first journey from the second preview. The full security and integrated QA checklist items remain open.

Next, connect the web and admin browser launchers to one disposable pilot instance. Rehearse the sequence below, record the first blocking step for each company, then prepare the operator session. Keep a record of what the operator can complete without assistance and retest their blocking issues before accepting the pilot.

1. Create a draft as the agent, attach four synthetic photos and submit it. Confirm the unpublished listing stays hidden.
2. Switch to the admin, confirm availability and approve it. Open the public site and locate the studio. Check price, beds, gallery and that private address details stay out of the page.
3. Submit a guest enquiry. Assign it as the admin, switch back to the agent and arrange a confirmed viewing. Check that the listing, enquiry and viewing references match.
4. Repeat under the second brand and confirm a foreign draft and enquiry are unavailable. Record operator feedback and any errors against tasks 12-3 and 12-7. Track the wider isolation matrix under tasks 05-6 and 10-6.

The private delivery tracker remains at 55 of 97 verified with 0 of 14 launch gates. The old system remains available until replacement verification and cutover approval.
