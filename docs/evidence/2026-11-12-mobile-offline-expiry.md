# Expire previous results in the mobile catalogue

Checkpoint 429, 12 November 2026 EAT. A previous catalogue response could pass the existing five-minute check when a refresh failed, then remain on screen indefinitely. The connected synthetic app now expires that response at the original deadline, hides any detail opened from it, and offers a fresh retry. Returning to the foreground rechecks the deadline if the operating system suspended timers. Expiry does not make another request or affect a newer successful response.

All 53 mobile tests, type checking and the Android development bundle passed. The new tests use a controlled clock to verify exact deadline expiry without another read, a foreground recheck after time elapsed or the clock moved backwards, and cancellation when the result is replaced. ADB found no connected device. The lifecycle event still needs to be exercised on an installed app.

Next, load the synthetic catalogue on a test device, disconnect and retry, and confirm the labelled previous result clears at five minutes from the original load. Repeat with the app in the background at the deadline and verify that returning to it clears the list and any open detail. Reconnect and verify fresh results on retry. Tasks 09-4 and 09-5 remain open. Tracker progress is 55 of 97 verified with 0 of 14 launch gates.
