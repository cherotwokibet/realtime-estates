# Installable Android preview — checkpoint468

20 November2026 EAT. A real ARM64 Android APK built successfully, and Android's apksigner verification passed. This is an INTERNAL SYNTHETIC PREVIEW with generated debug signing, not a production/store release. Hosted account mode remains off. No phone/emulator is connected, so installation, navigation, rendering, accessibility and device/network behavior remain unverified.

## Artifact

- App: Realtime Estates Ltd Preview 0.1.0.
- Package: com.boniface.realtor.preview.realtime.estates; ARM64 arm64-v8a only, Android API24+ (Android7.0+), targetSDK36.
- APK: 27408221 bytes; SHA256 2aa39f81bb55de28e964ea1aad77ecab1715b7e5e82df124a77c8aed708e7498.
- Download ZIP: 14894185 bytes; SHA256 581b93bc2767e769fe663bac79f68bea140e896ef73aacb1ec522d6a36c4d005. Extract it and open the APK on an ARM64 Android device. ZIP round-trip preserved the exact signed APK hash. The download is published only on the existing owner-private dashboard.
- Release-mode bundle, Android debuggable flag false; signature scheme v2 passed with Android Debug certificate SHA256 fac61745dc0903786fb9ede62a962b399f7348f0bb6f899b8332667591033b9c. Debug signing is for internal review only.
- Embedded Hermes bytecode bundle verified (2199760 bytes, correct bytecode header), so the app includes its JavaScript bundle. Embedded app.config is synthetic Realtime Estates; nativeFirebase/mobileReference overrides are absent. No real account/provider configuration was enabled. No signing key or rehearsal preload is packaged.

Local artifact path, inspection fields and archive details: android468-artifact.json. Verification script: android468-inspect.py. Raw Android tools: android468-badging.txt and android468-signature.txt. The APK and ZIP are preserved with hash-named filenames in .staging-artifacts/deliverables; no earlier artifact/export was overwritten.

## Build evidence

The final :app:assembleRelease succeeded:277 actionable tasks,25 executed/252 up-to-date on the final retry. Earlier successful ARM64 C++, Kotlin/Java and690-module bundling are retained in build-short-early.txt. Final settings: cached Temurin17.0.21+9, Gradle9.3.1,768MiB heap/512MiB metaspace,1 Gradle worker, no parallel/file watcher and one C++ compile/link worker. SDK dependency downloads used existing accepted licenses. No EAS/cloud build or purchase was used.

All65 isolated mobile source files and the lockfile matched the maintained source. Source41c6b4abc89dad5ce0de14beb5dd6b7210f1691c retains complete seven-job CI44599488054/mobile94 passes/no skips from checkpoint467; this APK build is new local native evidence, not a repeated remote/device test. Exact hashes/dependency versions are in android468-source.json. No maintained application source changed during the native build; only generated native Gradle/cache settings and an isolated Metro dependency adapter were added and retained as evidence.

Retained failures: JDK25 native-access warnings broke prefab; switching to cached JDK17 fixed that. Ninja then rejected paths longer than260 characters; short workspace cache roots fixed that after registering the generated Gradle settings early enough. A384MiB metaspace cap failed in release lint. The failed daemon retained a cache lock; its ownership/parent chain and PID matched this exact failed build before only that daemon was stopped. The512MiB retry completed with lint/checks enabled. No user app or unrelated process/cache was stopped/deleted. No system Java defaults, old app, legacy signing or vendor/live resource changed.

## Remaining work and next action

Device testing is UNRUN; ADB reported0 ready devices/emulators. This preview demonstrates a packaged internal build, not verified login, enquiries, bookings, push, deletion, accessibility or device rendering. Full native09-1/09-2 acceptance and all14 launch gates remain open. Preserve55/97 full deliverables, KES10,000 total monthly baseline and1012 saved notes/manual fields. Do not inflate completion for a compile-only result.

Next: run this APK on an owned ARM64 Android device when available and record actual launch/navigation/rotation/background/keyboard/accessibility/network behavior; fix observed issues. Continue useful local customer journey work while device evidence is pending, prioritizing the existing enquiry/viewing contracts over further status-only checks. Keep hosted identity and synthetic catalogue modes separate. Boniface explicitly selected KEEP BILLING DISABLED; do not provision paid services, use credits, change plans or re-ask that spending decision. Public provider/workload/managed SQL/UAT/restore/cutover remain open. Private dashboard publication and browser/export replay are recorded separately; actual browser download verification is pending.
