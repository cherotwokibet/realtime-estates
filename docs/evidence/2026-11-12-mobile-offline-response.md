# Mobile offline catalogue response handling

Checkpoint 428, 12 November 2026 EAT. A temporary refresh failure can still show the previous public results for the same company and query within the existing age limit. An access denial, missing catalogue, redirect or invalid API reply now clears that response. A later disconnect cannot bring it back. This prevents obsolete listings from appearing after the service declines or can no longer validate a fresh result.

The mobile adapter classifies network errors, timeouts and validated transient HTTP errors without passing transport details to the UI. The session keeps the existing timestamp and retry/clear controls. It continues to issue one request per attempt and does not write catalogue results to disk.

All 51 mobile tests and the mobile type check passed. The new regression runs a successful read, a validated 503 response, then a 401, 403, 404, redirect or invalid success reply. A final network error verifies that the cleared result stays unavailable. Existing tests cover different queries, age limits, cancellation and late responses. ADB found no connected device, so this is controller and SDK evidence.

Next, use the connected synthetic catalogue on a test device. Load results, disconnect, retry and inspect the previous-result timestamp and disabled paging. Reconnect, exercise a denial followed by another disconnect, and confirm the old list stays hidden. Finally restore access and confirm that a new read repopulates the catalogue. Task 09-5 remains open. Tracker progress is 55 of 97 verified with 0 of 14 launch gates.
