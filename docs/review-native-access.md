# Reviewer authorization changes around native I/O — 17 October 2026

A new signed loopback integration test uses the existing reviewer consumer with actual durable native output, request/capture/seal stores, restricted runtime SQL, RS256 verification and a real JWKS endpoint. Product code is unchanged. A trusted test-only output-store adapter pauses after a real byte read; no browser or production configuration can select this gate.

The generated target photo is uploaded once, processed by the supervised native worker, sealed and attached through the normal APIs. Three additional relational sealed fixtures satisfy the four-photo submission requirement; these extras have no native-byte or decode proof. The target alone is read and verified in this test.

The initial pending reviewer read succeeds. While the next read is paused outside any SQL transaction, a separate local membership update demotes the administrator. Releasing storage causes post-I/O authorization to deny delivery with a private JSON404 and no image bytes. Restoring the current admin role permits the exact original pending revision/version to read again, with SHA-256 identical to the baseline bytes.

A second paused native read overlaps a rejection committed through the signed HTTP API and current administrator. Releasing storage again returns private JSON404 with no image. A subsequent decided read is denied before another storage read. Exactly four native output reads and one decoder run are asserted: baseline, demotion attempt, restored read and decision attempt. Image reads never launch processing or adopt a new version.

The focused test passed with zero skips. Durable native roots are retained at the diagnostic path in `review-native-access-focused.txt`; handles, admission objects and servers are closed. This is deliberately sequenced across completed transactions in one PGlite session. It proves the before/after authorization boundary around actual native I/O, not independent hosted PostgreSQL sessions, continuous authorization during network transmission, or the ability to retract already-delivered bytes.

No reviewer browser access-loss/restoration, device/accessibility/operator UAT, current remote CI or cutover is claimed. Earlier actual browser four-image rendering/approval evidence is separate. No production policy or test privilege was weakened. KES10,000 total monthly client price, vendor resources and old live service remain intact.

Next: verify browser clearing and deliberate reinspection after current access loss/restoration using a narrowly scoped development fixture, preserving the exact pending revision/version and no implicit retry. Audit canonical catalogue/admin checklist acceptance against remaining provider/storage/security/public delivery requirements; broad tasks and launch gates remain open. Rights/accounts/retention, legacy RPC retirement, hosted PostgreSQL races, physical devices, operator UAT and cutover still require evidence.

Final API suite:220 checks passed, zero skips. The focused native case overlaps that suite. The separate moderation implementation acceptance audit passed25 checks on current disclosure/successor SQL, moderation integration and signed native successor files. See docs/moderation-implementation-acceptance.md for task06-5 closure and remaining boundaries.
