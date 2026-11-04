# Signed draft and moderation evidence

Recorded 4 November 2026 EAT.

A signed local HTTP test runs the maintained v2 draft save, submit, approve and reject commands through the shared SDK. It verifies the tenant, actor, record, revision version, request correlation and summary on each audit event. A foreign draft write and unauthorized moderation attempts leave persisted business records intact. Repeating a completed decision returns a version conflict and preserves the retained result and audit history.

Approval produces the expected published title. Rejection retains the private reason and leaves the listing without a public snapshot. The save event includes the v2 contract marker. The first focused assertion omitted that marker and failed. The corrected and expanded focused test passed, and the final maintained run passed 20 of 20 checks with fresh domain, API and SDK builds.

The signed HTTP fixture uses disposable PostgreSQL-compatible storage and synthetic sealed-media records. Task 08-7 continues with withdrawal, guarded creation and successor, other legacy routes, enquiry and staff command checks. The latest test log is audit325-maintained4.txt.
