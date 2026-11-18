# Feedback when a property stops taking enquiries

Checkpoint 438, 18 November 2026 EAT. If a buyer submits an open property enquiry form after staff withdraw the listing, a definite unavailable response disables the form and offers a link back to the catalogue. When a previous submission still has an uncertain result, the form keeps the original attempt available for recovery.

Both local synthetic pilots returned 404 with the expected unavailable code for a fresh enquiry after pausing a listing. The original receipt was still recoverable. All 14 focused pilot, SDK and transport checks passed, and local web and admin production builds passed. Browser interaction and operator acceptance are pending.

Next, open a fresh enquiry form before pausing the listing in the Realtime walkthrough. Verify the stale form shows the unavailable message and the catalogue link, then confirm that the original viewing still appears in the agent workspace. Tasks 12-3 and 12-7 remain open.

[Local tests](pilot438-checks.txt)
