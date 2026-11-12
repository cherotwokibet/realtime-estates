# Generated native property link configuration

Checkpoint 427, 12 November 2026 EAT. A build could previously register the catalogue's HTTPS links even when it started in demo mode and had no connected catalogue to open them. Expo config now rejects a link origin without an explicit catalogue mode. An ordinary build with no link origin still has no HTTPS property filter or associated domain.

The regression runs Expo config introspection for both synthetic brands. Each connected build produced one Android auto-verified VIEW filter with the correct HTTPS host and `/properties/` prefix. The generated main activity uses `singleTask`, and the iOS entitlement lists only the configured associated domain. The runtime receives that same origin. The default build generated neither association. [Expo config introspection](https://docs.expo.dev/config-plugins/development-and-debugging/) · [Expo iOS entitlements](https://docs.expo.dev/build-reference/ios-capabilities/)

All 50 mobile tests and the mobile type check passed. The introspection regression evaluates Expo's native config plugins in memory. There was no APK install, device handoff, signed iOS build or hosted association check. ADB found no connected device.

Next, use the connected synthetic catalogue configuration and an authorized HTTPS host to run the host preflight from checkpoint 426. Then verify OS association and the system share sheet, cold and warm opening, paused listings and browser fallback on test devices. Task 09-4 remains open. Tracker progress is 55 of 97 verified with 0 of 14 launch gates.
