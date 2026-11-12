# Opening shared property links in the mobile preview, checkpoint 423

12 November 2026 EAT. The connected synthetic mobile catalogue opens a canonical HTTPS property URL on startup or when it receives a new link. It accepts the configured catalogue origin and an exact lowercase listing UUID path. The app looks up that listing through the anonymous public search API without reusing the browse cache. An unavailable listing or a failed connection gets its own message. A newer link or returning to results cancels the pending read. The existing property details view renders successful results and the web URL still serves the listing.

The opt-in uses the catalogue origin configured for checkpoint 422 and requires the existing development-only connected catalogue. React Native supplies startup and foreground events through [Linking](https://reactnative.dev/docs/linking).

All 48 mobile tests passed, including four focused link checks and the existing anonymous HTTP/SQL regression. The focused checks exercised the real SDK with synthetic responses and simulated native link events. Mobile type checking, Expo public configuration, and the Android development bundle passed. The first ordinary production export rejected the development-only catalogue configuration as expected. The subsequent development export succeeded.

ADB reported no connected devices. Android and iOS operating-system handoff and signing remain unverified. Next, use a controlled HTTPS host and authorized signing identities to check installed cold and warm links, the browser fallback with the app absent, and a previously shared property after it is unpublished. Keep task 09-4 open until that evidence is available. Canonical progress is 55/97 with 0/14 exit gates.
