# Signed synthetic push queue summary

12 November 2026 EAT, checkpoint 420. A default-off signed GET returns the synthetic push queue summary for the API's configured company. The database verifies current admin membership and timestamps the read with its statement clock. The route refuses request overrides and returns only aggregates with no-store caching. The shared SDK validates the company, counts and timing before returning the summary.

The listening HTTP test used separately signed company previews with distinct backlogs. It checked the database timestamp, rejected a caller-supplied clock and tenant header, and verified denial for anonymous callers, customers, agents, foreign tokens and an admin whose membership was revoked. It also verified default-off routing and the SDK's company check. The domain, API and SDK builds passed alongside the [focused regression checks](push420-checks.txt).

Next connect the signed read to the synthetic admin screen and verify refresh and access revocation in the browser. Provider delivery, physical devices and task 09-3 acceptance remain open.
