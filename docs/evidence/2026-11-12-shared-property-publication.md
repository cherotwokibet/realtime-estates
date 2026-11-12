# Shared property links after a publication change

Checkpoint 424, 12 November 2026 EAT. The local integration test now opens an approved listing from its canonical synthetic URL using the mobile SDK and web detail loader. For each of two synthetic companies, an authenticated admin paused the listing over HTTP. Both fresh reads then reported it unavailable. Republish restored the same listing at the same URL. The second company could not retrieve the first company's listing through either lookup, even when its identifier was supplied on the second company's origin.

Ten focused tests passed. The integration test used the actual HTTP service, a signed synthetic admin, and restricted SQL. The first test attempt asked the draft read for the listing version. The corrected test takes it from the review response, which exposes the current publication version. Web checks exercised the detail loader over HTTP to the API. Checkpoint 422 covers actual listing HTML fallback with a built Next server.

ADB listed no device. Available physical RAM was approximately 0.8 GiB, below the smaller emulator's configured 2 GiB guest memory. The emulator was left off.

Next, install the synthetic Android preview on a local test device or emulator when resources permit. Use a package-targeted Android VIEW intent to check cold and warm delivery and capture the visible listing, then repeat with the listing paused. Verify OS association separately using the authorized HTTPS host and signing fingerprint, and confirm that an untargeted link opens in the browser when the app is absent. iOS installed and browser fallback checks still need an authorized signing identity and device. [Android App Links verification](https://developer.android.com/training/app-links/verify-applinks)

Task 09-4 remains open. Tracker progress is 55 of 97 verified with 0 of 14 launch gates.
