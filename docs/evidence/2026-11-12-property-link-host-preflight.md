# Preflight for a hosted property link

Checkpoint 426, 12 November 2026 EAT. The web workspace now has a preflight for the authorized synthetic HTTPS host. It checks that the configured Android or iOS association is available without signing in or following a redirect, identifies the expected app and public signing identity, and serves the property fallback as HTML with the correct canonical URL. It uses the repository's synthetic association format, including the iOS path scope.

Build the shared domain and demo workspaces first if their build outputs are absent. Then run `npm run verify:property-link-host --workspace=@realtor/web` from the platform root with these values:

- `WEB_PUBLIC_ORIGIN` is the controlled synthetic catalogue origin, with no trailing slash. Use the same origin for `MOBILE_PROPERTY_LINK_ORIGIN`.
- `TENANT_SLUG` matches the synthetic company configured in the mobile build and the web deployment.
- `WEB_APP_LINKS_TEST_LISTING_ID` is an approved synthetic listing UUID that can be opened on the web.
- Set `WEB_APP_LINKS_ANDROID_SHA256` to the actual build's public SHA-256 signing fingerprint, `WEB_APP_LINKS_IOS_TEAM_ID` to the public Apple team ID, or both. The command checks whichever platforms are configured. The web deployment must enable the corresponding association files using `WEB_APP_LINKS_MODE=synthetic-v1`.

All 12 focused tests passed, including redirects, an HTML sign-in page on an association path, an incorrect certificate fingerprint, a broad iOS route, and an incorrect or missing fallback. The CLI also returned exit code 1 with missing configuration. Tests used actual association handlers with simulated HTTP responses. No hosted preflight, signing verification or installed-device test ran.

ADB reported no device. Next, run the preflight against the controlled host after the synthetic preview and signing identities are available. On a test device verify the share sheet, cold and warm links, withdrawal behavior and browser fallback with the app absent. Use the OS tools to confirm association. Task 09-4 remains open. The tracker is at 55 of 97 verified with 0 of 14 launch gates.
