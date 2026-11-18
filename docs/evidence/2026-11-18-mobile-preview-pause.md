# Pause a listing during the Android enquiry rehearsal

Checkpoint 440, 18 November 2026 EAT. The local mobile customer preview accepts `pause` in its terminal. The command pauses the same fictional listing that the preview serves to the app. It prints a confirmation when the change is saved. The initial terminal test also found that quitting with standard input held open left the launcher running. Closing its input stream let the preview shut down without waiting for the caller to disconnect.

The subprocess test started the actual launcher, found the listing through the mobile catalogue client, sent `pause`, checked that a fresh read no longer included the listing, then sent `quit` and observed exit status zero. All three mobile enquiry checks passed. Android Debug Bridge listed no connected device, so the screen test remains pending.

For the device session, use a Windows terminal at the platform root. Set `$env:NODE_ENV = 'development'` and start `node scripts/mobile-customer-preview.mjs realtime-estates --lost-enquiry`. In a second terminal, apply the printed mobile settings to the installed development build and reverse the API port over USB using `adb -s DEVICE_SERIAL reverse tcp:PORT tcp:PORT`, substituting the connected device serial and the port from the printed API origin.

1. Open the listing and submit a fictional enquiry. Confirm the simulated lost reply offers Retry original request.
2. Type `pause` in the preview terminal and wait for confirmation. Retry the original request and record the receipt.
3. Restart the fixture without the lost-reply flag for the separate refusal check. Open a fresh enquiry form, pause the listing in the preview terminal and then send the enquiry. Verify the unavailable message, absence of a send action and Back to properties.
4. Type `quit` in the preview terminal when finished. Record the device, app build and observed results before accepting the mobile task.

[Local test output](pilot440-checks.txt)
