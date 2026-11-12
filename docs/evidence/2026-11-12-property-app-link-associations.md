# Property app link associations, checkpoint 422 — 12 November 2026 EAT

The synthetic web app serves Android Digital Asset Links at `/.well-known/assetlinks.json` and the iOS association at `/.well-known/apple-app-site-association`. Both default to 404 and publish only the configured synthetic preview application. The same HTTPS property path remains a regular web listing, with no intermediary redirect or Firebase Dynamic Links dependency.

For a synthetic build, use the same canonical HTTPS origin for `MOBILE_PROPERTY_LINK_ORIGIN` and `WEB_PUBLIC_ORIGIN`, and set the same explicit `TENANT_SLUG` in both environments. Set `WEB_APP_LINKS_MODE=synthetic-v1` on the web deployment and provide the corresponding Android certificate fingerprint in `WEB_APP_LINKS_ANDROID_SHA256` and/or Apple team identifier in `WEB_APP_LINKS_IOS_TEAM_ID`. These are public identifiers; signing keys stay out of the app and association files. Expo config consumes the existing workspace ESM package via its fallback export under the pinned Node 24 runtime.

- [Nine focused checks](links422-checks.txt) passed for association payloads, bad configuration, and synthetic public listing SEO.
- The domain and Next production builds and mobile typecheck passed. Expo's public config showed the exact Android host and `/properties/` prefix and iOS entitlement when enabled; neither appeared by default.
- A disposable Next production server returned 404 from both endpoints when disabled and 200 JSON without redirects when enabled. A listing URL obtained from the rendered catalogue still returned 200 HTML.
- ADB returned an empty device list. Installed or uninstalled OS routing, notification consent withdrawal and deletion were not verified on a physical device.

Implementation references: [Expo Android App Links](https://docs.expo.dev/linking/android-app-links/) and [Expo iOS Universal Links](https://docs.expo.dev/linking/ios-universal-links/).

Next: route cold-start and foreground links to a fresh property read after validating the configured HTTPS origin and property path. Then use an authorized host and signing identity to test installed and uninstalled behavior on Android and iOS. Device, domain and provider evidence remains open. Tracker: 55/97 verified; 0/14 launch gates.
