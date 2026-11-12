# Signed synthetic deletion intake recovery export

12 November 2026 EAT, checkpoint 412. The disposable restore fixture signs the committed intake with an ephemeral Ed25519 key. The signed payload binds the company, customer, request, original database timestamp, prior consent version, and SHA-256 of the snapshot. It also binds the exact snapshot and recovery cutoffs. Verification requires a trusted public key and the expected scope, snapshot hash and cutoffs supplied separately. Only a verified payload feeds the owner-only intake replay.

The restore test used actual snapshot bytes and the original committed timestamp. A separate verification test rejected a changed payload, another key, wrong scope or snapshot, mismatched cutoffs, invalid timestamps and events outside the approved window. [Fifteen focused checks](deletion412-checks.txt) passed.

The fixture covers one known intake. The cutoffs are assertions supplied by the exercise, and the signature verifies the payload and its source key. Complete event capture, protected storage and key custody, and restoration of later triage, return, planning decisions and audit records still need verification. Next recover those later records in the offline synthetic fixture. Task 09-3 and production recovery remain open.
