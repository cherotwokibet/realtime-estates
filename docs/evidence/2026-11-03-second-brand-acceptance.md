# Synthetic second-brand acceptance — 3 November 2026

Literal task10-5: Launch a synthetic second brand and verify distinct identity, contacts, inventory and notifications. This item is accepted as a local synthetic demonstration, not a hosted release or native-device launch.

- Identity: scripts/second-brand-preview.mjs launches the same web application sequentially for realtime-estates and sample-homes on an owned loopback port3136. Names, manifest tenant IDs and palettes differ. Existing actual Expo configuration test confirms distinct Android/iOS identifiers and icons; no native build/install claimed.
- Contacts: actual browser contact pages show realtime-preview@example.invalid versus sample-homes@example.invalid. No mail/call/WhatsApp action was opened. Config-only fixture telephone values are synthetic; public company contact uses email only.
- Inventory: actual signed SDK/HTTP/JWKS/restricted SQL reads return disjoint approved stock; browser home property links differ, own Sample Homes detail renders, and foreign details in both directions show unavailable.
- Notifications: each signed company workflow requests/proposes/confirms a synthetic viewing, admits its reminder and captures a company/actor/enquiry/viewing/operation-bound record. Exact GET readback matches; foreign original access is denied. This is capture-only-v1, providerDelivery:false, zero real sends.

Maintained npm run test:second-brand: fresh API/SDK build and web test compilation,3/3 passed with zero failures/skips (brand309-final3.txt). Earlier signed2/native-config results overlap and are not additive. brand309-signed1.txt retains the initial missing required manifest phone failure; fixed in synthetic configuration without exposing callable public contact. Initial launcher shutdown helper name corrected; final owned launches exited cleanly and3136 had no listener. Generated next-env restored. No product schema/default/authorization broadened.

Actual DOM observations: brand309-browser.json; launch logs brand309-realtime-preview.txt and brand309-sample-preview.txt. Screenshot API failed for full/viewport/native including visible tab; no screenshot or visual layout pass claimed. Browser user tabs retained and owned test tabs closed.

Only task10-5 closes.52/97 broad deliverables (54% rounded),0/14 exit gates. Full AC-028 still partial: hosted identity/storage/cache/provider/device acceptance remains open. No production deployment, provider delivery, physical device, operator UAT, rights/account-control, cutover or recovery gate inferred. KES10,000 total monthly per realtor; old live/vendor resources preserved.
