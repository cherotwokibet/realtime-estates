# Synthetic viewing reminders through the push queue

12 November 2026 EAT, checkpoint 417. The synthetic push queue accepts an admitted viewing reminder and derives its recipient from the enquiry's signed customer identity. It binds the job to the admission, registration, current preference version and scheduled time. The same admission and registration can create one job.

When due, the queue uses the existing locked viewing eligibility check before evaluating notification consent and registration ownership. A cancelled or otherwise obsolete viewing ends with a suppression receipt. Retrying a completed job returns the original outcome.

The test captured one due notification for a confirmed viewing, cancelled the viewing, and verified that a later job stayed suppressed across retries. It also checked early execution, duplicate scheduling and refusal of a wrong registration or company. [Twenty focused checks](push417-checks.txt) passed, including the existing reminder capture and deletion and push regressions.

Next add a bounded worker that selects due jobs and verify that a failed job can be retried without blocking unrelated jobs. This checkpoint covers the synthetic database path. Provider delivery, owned device verification and production deletion remain open for task 09-3.
