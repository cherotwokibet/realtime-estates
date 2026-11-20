# Enquiry and viewing drafts in the Android preview — checkpoint469

20 November2026 EAT. Source2cbe28776a027de8eb8550ed6f7f7ce81a992ee7 passed complete [seven-job CI44805312169](https://github.com/cherotwokibet/realtime-estates/actions/runs/44805312169): all four canonical regression groups, workspace types, formatting, Android692-module export and Linux/PostgreSQL/image checks. Mobile102/102 passed locally/remotely without skips, including8 new draft cases. Existing logged skips elsewhere remain explicit, not counted as passes.

## What you can review

Open a property → Prepare demo enquiry → choose availability or a viewing preference → enter a message and preferred day → Save local draft → Review draft in Profile → remove it. The form shows local-only confirmation, not an enquiry receipt or appointment confirmation. It does not request separate contact details. Custom message text survives changing the question type; untouched prompt text follows that choice. Profile lists the property, message and preferred Nairobi day. Unsaved form state closes on back/background; all saved drafts clear when the app backgrounds/unmounts.

This is an internal SYNTHETIC PREVIEW. No enquiry is sent, receipt created by a server, contact submitted or viewing booked. Hosted accounts are off. The draft model has no transport/storage API, and the feature mounts only in the default demo branch; protected Firebase/reference modes remain separate. Demo listing aliases never become hosted listing UUIDs or caller-selected actor/company authority.

The controller binds each draft to a property in its own allowlisted demo company, validates exact plain input fields without invoking getters, bounds messages to1000 characters and saved drafts to10, validates real preferred calendar days against Nairobi's current day, and freezes snapshots. Repeated taps return one original local object; changed intent, duplicate generated reference or a stale handle after background/removal cannot overwrite or resurrect it. Tests cover these boundaries, the second company, invalid clock and exact input/authority-extra refusal.

## Actual Android artifact and checks

- App Realtime Estates Ltd Preview0.1.0; package com.boniface.realtor.preview.realtime.estates, ARM64/API24+ (Android7+), target36.
- APK 27418325 bytes; SHA256 a3e829ef708cd0397de354ce142367e3c19dbe1b29de6402258f6ad9e45179a7.
- ZIP 14900316 bytes; SHA256 1d31a03c2c4762f26d2dc0fd16799512cc6f9113e80ba035ddd5ad73ce71e167. Extract ZIP and open its APK. Round-trip hash matched the verified signed APK. APK468/its existing download remain preserved.
- Android apksigner v2 verification passed with the same DEBUG certificate; release-mode, Android non-debuggable package. Embedded Hermes bytecode, preview app.config and the new enquiry/review labels were inspected. Hosted account overrides/signing keys/rehearsal preload are absent.
- Local assembleRelease passed in1m50s:277 tasks,10 executed/267 up-to-date.692-module JS bundling completed. All68 isolated mobile files matched the maintained source; native SDK/generated build adapters were reused without modifying old/live/vendor/signing resources.

Artifact metadata and immutable local path: android469-artifact.json. Exact source file hashes: android469-workspace.json. Inspection script: android469-inspect.py; native build/signature/aapt logs: android469-*.txt. This is compilation/static package evidence; device installation, rendering, taps, keyboard, accessibility and lifecycle behavior on a handset/emulator remain UNRUN. ADB reported0 devices. Do not infer device proof from tests or labels in bytecode.

## Other verification and next work

Current-source Linux passed20 real PostgreSQL TCP/TLS cases,14 existing HTTP/SSR profiles,5 synthetic Next native gateway profiles with fixture exclusion and3 nonroot images/SDK imports. Actual API image sha256:2afa293c6d3f1bddccfee967fa023cd183f8dfff3bd68e6ae3e3c54474c6cfdc retained certificate-verified PostgreSQL TLS, privileged-login refusal,512MiB/1CPU,4 health cases and graceful SIGTERM/SQL drain; configured web/admin container profiles passed2. Exact receipts: ci469-run.json,ci469-container-receipt.json,ci469-detached-receipt.json. API481 passes/3 skips, database477 passes/1 skip, admin564 passes/1 skip, previews129 passes/16 skips and media240 passes/26 skips remain explicit in the raw ci469-* logs.

Next: actual owned-device review and observed UI fixes. Continue local default-off enquiry intake integration against the existing HTTP/SQL contracts while device evidence is pending: require authoritative published listing UUIDs, explicit notice/contact inputs and original-attempt recovery; never send demo aliases/local draft references as production authority. No actual provider/booking/push/UAT/restore/cutover acceptance is inferred. Keep billing explicitly DISABLED; no EAS purchase/plan/credits or paid cloud provision. Preserve55/97 full tasks/all14 gates,KES10,000 baseline,1012 saved notes/manual fields and earlier exports. Private publication/export replay are recorded separately; actual browser download/device review remain pending.
