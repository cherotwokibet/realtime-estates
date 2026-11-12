# Offline synthetic deletion review recovery

12 November 2026 EAT, checkpoint 413. The disposable restore exercise starts from a snapshot taken after deletion intake. It copies the original triage, return to privacy review, and planning decision from a quiescent authoritative fixture, along with the matching audit facts. The replay requires the exact restored intake and applies all three decisions and audit entries in one transaction. It preserves audit actor, action, operation, timestamp, correlation and summary. The restored database assigns local audit row IDs.

The exercise verified the original receipts, the original plan, company isolation and safe repeat. A different request or audit entry was refused. A simulated failure while inserting the final audit entry rolled back the earlier decisions and audit writes. [Sixteen focused checks](deletion413-checks.txt) passed.

The exercise trusts its in-process fixture capture. Next bind the later decisions and audit records to the signed recovery export and exercise intake and review replay from one pre-intake snapshot. Production recovery and task 09-3 remain open.
