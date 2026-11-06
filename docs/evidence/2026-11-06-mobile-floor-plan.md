# Mobile approved floor-plan consumer checkpoint380 - 6 November 2026 EAT

Mobile property detail now has an explicit, development-only approved floor-plan consumer using shared anonymous SDK byte verification. Default builds stay off. This checkpoint implements and compiles native code; it does not prove a native device decoded the image.

## Implemented

MOBILE_CATALOGUE_FLOOR_PLAN=synthetic-floor-plan-publication-v1 requires explicit synthetic catalogue mode. Strict public build config rejects extra identity fields, accessors, unsupported modes, production and orphan flags. Floor-plan reads bind exact property/approved version, check metadata before and after image bytes, use no credentials/redirects/retries, validate bounded WebP framing and SHA256, and encode verified bytes into an in-memory data URI. Absent and unavailable states stay distinct; no file/offline cache/provider URL is introduced. Component aborts on unmount/scope change, guards late completions and shows unavailable after decoder failure. Parent key includes tenant/origin/listing/revision/version. No instant revocation of already displayed bytes is claimed.

The shared SDK accepts a trusted constructor-only SHA256 digest adapter, keeping WebCrypto as its default. Native adapter uses Expo streaming fetch and expo-crypto57.0.3, pinned to the existing Expo57 bundledNativeModules recommendation. No homemade cryptography. Expo fetch defaults include credentials, so every SDK request explicitly omits them; redirect error and cancellation are passed through. Local installed Expo source confirms request options/streaming response APIs. Expo Crypto digest API reference: https://docs.expo.dev/versions/latest/sdk/crypto/ . No library upgrade, EAS/cloud build, purchase, account change or provider provisioning.

## Checks actually run

- Full shared SDK suite346/346,0 skips: floor380-sdk.txt. New adapter case verifies correct digest without WebCrypto, wrong digest rejection and interrupted digest cancellation.
- Full mobile suite31/31,0 skips: floor380-mobile.txt. Four new tests cover actual synthetic conversion bytes into exact base64 URI, config guard/accessors, no-I/O off/preabort, explicit null/no-image fetch, changed versions, altered bytes, interrupted digest and stale completion without retry. The crypto/transport adapters in these Node tests are injected, not native execution.
- Focused11/11,0 skips (overlapping suites): floor380-focused.txt.
- Public web floor/video regression5/5,0 skips: floor380-web-regression.txt.
- SDK TypeScript build, web test compile and mobile typecheck passed; floor380-mobile-types.txt. Changed files formatting/diff checks passed.
- Actual local Expo Android export succeeded:657 modules, Hermes bundle2.2MB; floor380-android-export.txt. This is bundle generation, not APK install/emulator/device/AT/operator acceptance. Default export remains demo/off but compiles imported native component and crypto dependency. Physical/native image support and memory behavior still need actual runtime proof.

## Next work and canonical count

54/97(56%); all14 gates remain open and06-4 stays incomplete. Next successor-copy/explicit-null across adopted reference revisions, then native app image display/refresh failure and combined original-lock matrix. Inspection found attachment SQL currently enforces original command/output revision equality and has no successor inheritance row; do not weaken this binding or manufacture a new upload/receipt. Design an explicit immutable inheritance mapping authorized by successor transaction, then align gallery/public/review metadata and durable delivery verification to retain the original source creator/lease. The preview currently forbids simultaneous reference successor/public modes; safely compose only in explicit floor journey, preserving defaults. General review queue still uses earlier photo UI; reference/availability navigation also needs clarity.

Boniface + Codex own next work. KES10,000 total recurring client baseline retained. Vendor/live system untouched. No device/browser floor-plan rendering was run this checkpoint; checkpoint379 retains actual public browser proof. Dashboard publication and note preservation recorded separately.
