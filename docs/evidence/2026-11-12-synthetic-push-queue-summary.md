# Synthetic notification queue summary

12 November 2026 EAT, checkpoint 419. The offline database provides a read-only summary for one company at a specified time. It counts due, scheduled, waiting-for-retry, captured and suppressed jobs. The summary shows how long the oldest due job and oldest job awaiting or eligible for retry have been in the queue, measured from their scheduled due time. It also shows the next retry time when a cooldown is active.

The test read the summary before a worker run, during the failed job's cooldown, when the retry became eligible and after completion. It also checked that the other company's backlog and suppression counts stayed separate, repeated reads returned the same summary, and runtime callers could not read it directly. [Fourteen focused checks](push419-checks.txt) passed across the worker, viewing reminder, consent and deletion paths.

Next expose these aggregates to a signed synthetic admin preview with a server clock and verified company scope. The summary remains an offline database capability. Provider delivery, device verification and task 09-3 acceptance remain open.
