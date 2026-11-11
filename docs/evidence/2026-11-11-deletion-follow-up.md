# Synthetic deletion follow-up and customer progress

11 November 2026 EAT, checkpoint 399. The optional SQL proposal gives current company admins a separate follow-up queue for each triage outcome. It returns customer and request IDs and the review time, with a customer ID cursor and a maximum page size of 50. Current company admins own both queues in this synthetic model. Assignment to an individual reviewer and returning a request to review remain workflow decisions.

A separate customer read returns the current progress of that customer’s own request. Its status is pending review, privacy review pending, or staff follow-up pending. It exposes no reviewer identity or decision history. The original customer receipt continues to describe intake, so a caller recovering a submission gets the same receipt after staff triage. A request awaiting privacy review stays pending for an authorized privacy decision.

All nine focused PGlite checks passed with zero skips. The new cases verify outcome separation, company isolation, pagination, revoked staff and customer access, the minimal customer projection, and original receipt stability. The existing intake and triage checks passed. See deletion399-sql.txt.

Next add strict shared contracts and signed read endpoints for both projections, then show follow-up in the admin workspace and current progress in mobile. Test signed HTTP and browser integration. An approved retention and privacy review process is still required before destructive processing. Task 09-3 remains open at 55/97 tasks and 0/14 stage gates. The recurring baseline is KES 10,000 per realtor per month.
