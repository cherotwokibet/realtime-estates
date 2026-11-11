# Signed synthetic deletion processing plan

12 November 2026 EAT, checkpoint 408. A designated company reviewer can read the synthetic processing plan through a separately enabled signed GET for the exact saved plan-review decision. The server and shared SDK both verify the original receipt, company, reviewer and request. The plan returns counts and pending requirements. The SDK rejects malformed counts, unexpected fields, a changed decision or request, and a response that claims a hold check is complete.

The domain, API and SDK builds passed. [Ten focused checks](deletion408-checks.txt) passed. The signed loopback test verified the plan after recovery from a simulated committed decision reply loss, the default-off route, GET-only enforcement, exact scope, denial for a customer and a different designated reviewer, hold and revocation. It also exercised strict SDK response validation. The database tests still verify scope and unchanged intake and audit records.

Next connect the admin preview to the signed read and verify the receipt-to-plan flow in a browser. The plan still requires evidence of applicable holds, retention, provider disposition, and backup expiry and restore. Production deletion and task 09-3 remain open.
