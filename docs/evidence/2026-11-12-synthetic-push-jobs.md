# Durable synthetic push jobs

12 November 2026 EAT, checkpoint 416. An owner-only disposable queue stores the company, operation, customer, registration, expected preference version and due time. Exact resubmission preserves the schedule and changed inputs conflict. A due run locks the job and calls the existing consent and ownership check. The synthetic capture and job completion commit in the same transaction. A completed job points to the original attempt, so repeats return its original outcome.

The test restored a queued job from a database snapshot, aborted its first run, confirmed there was no saved capture, then retried successfully. A second restore preserved the completed result without another capture. Jobs suppressed after consent withdrawal or deletion intake stayed suppressed on retry. The test also verified an early run, conflicting schedules, runtime denial and company isolation. [Twelve focused checks](push416-checks.txt) passed.

Next connect one synthetic viewing event to enqueueing, then verify that changed viewing state suppresses its obsolete notification before capture. This exercise uses a fixture clock and SQL capture. Actual provider delivery, device interaction and task 09-3 acceptance remain open.
