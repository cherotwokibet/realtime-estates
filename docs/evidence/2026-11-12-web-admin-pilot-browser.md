# Browser rehearsal for the web and admin pilot

Checkpoint 431, 12 November 2026 EAT. One command starts the public and staff browser apps against the same disposable synthetic database. The public app has catalogue search, gallery and guest enquiry enabled. The staff app has listing and moderation controls and separate admin and agent enquiry workspaces.

From the platform root on Windows, run:

```powershell
$env:ENQUIRY_UI_PORT='3071'
$env:ENQUIRY_API_PORT='0'
$env:TENANT_SLUG='sample-homes'
npm run dev:enquiry-preview -- --pilot
```

Open the local routes printed by the launcher. Type `quit` to stop the apps. Use `realtime-estates` for the second rehearsal. The pilot uses the existing Windows synthetic photo processor and its local PowerShell runtime.

The Sample Homes browser run created and saved a new studio at KES 20,000.01 per month, attached four verified synthetic PNGs and confirmed the public catalogue was empty before approval. Availability was confirmed before the revision was approved. The public site then showed the listing, its open-plan room and four gallery photos. The browser loaded the first three images and loaded the fourth after expanding the gallery. The private address was absent from public details.

A guest enquiry from that listing reached the admin inbox. The admin assigned the exact enquiry to the synthetic agent. The agent opened it in a separate tab, requested a viewing, proposed 13 November 2026 at 10:00–11:00 EAT, recorded fictional phone agreement and refreshed the saved viewing at version 3. The listing and enquiry IDs matched across the handoff. Eight launcher tests passed. The Realtime brand passed the prior API journey and still needs the browser rehearsal.

Two operator instructions came from the run. Confirm availability from the listing queue before approving the submitted revision. After assignment, read and adopt the saved version. The action form retains its input and can keep role navigation disabled, so open the agent workspace in a separate tab for the rehearsal. Listing and moderation screens shared the synthetic admin identity in this run. The separate listing-author role was covered by the checkpoint 430 API test.

Next, run the Realtime browser journey, then hand the local rehearsal to an operator and record the steps they can complete independently. Review whether the availability and role-switch handoffs need clearer links or fewer clicks before operator acceptance. Tasks 12-3 and 12-7 remain open. Tracker progress is 55 of 97 verified.
