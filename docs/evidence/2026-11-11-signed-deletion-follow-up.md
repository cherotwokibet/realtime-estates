# Signed synthetic deletion follow-up reads

11 November 2026 EAT, checkpoint 400. A separate development flag enables the two read endpoints. The company admin can request one bounded disposition queue through GET /v2/staff/customer-deletion-follow-up. The signed customer can read current progress through GET /v2/customer/deletion-progress. The disposable preview installs the follow-up SQL only when explicitly enabled.

The SDK validates the staff page against the expected company, disposition, limit and cursor. Customer progress is scoped to the signed customer and company and carries only the request ID and status alongside the scope fields. The original intake endpoint remains available for exact recovery, with the original receipt preserved after triage.

All seven focused checks passed with zero skips. They cover default-off and missing prerequisites, signed staff and customer access, separation of dispositions, revoked access, ordering and scope mismatch, duplicate filters, preserved intake receipts and customer privacy. Domain, API and SDK builds passed. See deletion400-checks.txt.

Next add an opt-in admin BFF and read-only follow-up views, plus current progress refresh in the signed mobile screen. Verify actual browser and device paths separately. Individual assignment, return to review, privacy approval and retention remain open before processing. Task 09-3 remains open at 55/97 tasks and 0/14 stage gates. The recurring baseline is KES 10,000 per realtor per month.
