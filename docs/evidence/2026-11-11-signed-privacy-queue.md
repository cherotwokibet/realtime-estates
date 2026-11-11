# Signed synthetic privacy queue, 11 November 2026

Designated company reviewers can list eligible synthetic deletion requests, record a hold or a decision to review a processing plan, and recover the original signed receipt. The queue returns at most 50 rows per page and excludes a reviewer's own triage or return and requests with a saved privacy decision. Current designation governs each read and write. The service requires an explicit synthetic mode. The shared SDK verifies the company, reviewer and request before returning a receipt.

Domain, API and SDK builds passed. Eight focused checks passed across the signed privacy and return journeys and database follow-up. The new HTTP check verifies default-off behavior, customer denial, independence, pagination, exact recovery after a lost committed response, conflicting decisions and revoked reviewer access. See [focused checks](deletion405-checks.txt).

Next, connect a dedicated reviewer screen in the admin preview and verify confirmation and recovery in a browser. Task 09-3 remains open. Production retention approval, deletion execution, provider processing, restore and operator/device verification are pending.
