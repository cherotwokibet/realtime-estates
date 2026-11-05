# Durable floor-plan output checkpoint 362

5 November 2026 EAT. Owner Boniface + Codex.

Verified floor-plan bytes, seal intent and SQL receipt now persist in durable stores. Read-only recovery verifies the original without decoding or repeating writes. All 32 focused checks passed, including actual Windows processing and store reopening. Progress remains 54/97 (56%).

Implementation

packages/media/src/floor-plan-output.ts composes the trusted fixed processor, immutable source reader, separate durable output and metadata stores, fresh SQL preflight, seal and historical read callbacks. The full target is snapshotted before asynchronous work. Actual readback bytes are independently verified again against retained source. An immutable canonical seal intent binds company/actor/draft/version/request/job/generation/claim/nonce, fixed output identity, manifest and both destination store identities. Intent is installed before output bytes and SQL sealing. Reads verify store identity, complete reference, byte count and SHA256. Output bytes must be fully read back before sealing.

A successful run validates and persists the original SQL receipt. Receipt validation binds the full original lease/source facts, manifest and bounded verification timestamp. Its PostgreSQL canonical manifest digest is treated as trusted SQL metadata, separately from actual output-byte hash verification. Only the explicit FloorPlanSealUncertainError transport classification permits one automatic original-receipt read after an uncertain seal acknowledgement. Generic failures trigger no implicit SQL read or repeat. No seal command is retried.

Reconcile first checks current SQL read authority, then verifies stored intent, retained source and output bytes. A second authenticated SQL read checks the same original before return. It invokes no decoder, seal or store install. A missing local receipt may be reported as receiptPersisted false when SQL and immutable intent/byte facts agree; recovery does not manufacture that missing record. Missing SQL/original byte facts remain blocked. Corruption or a changed receipt/store identity is refused. Fresh worker admission still requires a live lease by default; explicit historical receipt validation permits expired history without authorizing new work. Close fences new calls and drains the admitted operation, leaving supplied stores and processor caller-owned.

Verification

Media TypeScript build passed. `node --test --test-concurrency=1 packages/media/tests/floor-plan-output.test.mjs packages/media/tests/floor-plan-processing.test.mjs packages/media/tests/floor-plan-admission.test.mjs packages/media/tests/floor-plan-request.test.mjs` passed32 tests, zero failures/skips, about55seconds. Raw log floor362-output-delivery.txt. Ten new delivery checks cover actual Windows processing to durable bytes and SQL sealing; closed/reopened store recovery; typed uncertain seal response; generic failure and missing SQL original; lost local receipt acknowledgement; missing local receipt/output and wrong stores; mismatched SQL receipt; output persistence failure/access loss; corrupted bytes; busy/close-drain; and historical recovery under a simulated local test-process clock advance. The simulated clock changes no OS/account time and authorizes no new processing. Existing22 source/admission/processing tests also passed, including another actual Windows-worker path.

The delivery test fixture uses real isolated SQL proposals, durable stores and native processing for its first integration. Other new delivery tests explicitly simulate the trusted processor using actual lossless conversion in the test process and inject acknowledgement/storage faults. They make no independent OS termination claim. The initial seven-test run passed and is retained in floor362-output-first.txt. A test syntax typo and a missing fault-injection error import were corrected before the final32 passing checks.

Limits

Maintained local synthetic composition only. A durable sealed output is not a listing attachment or a gallery/public URL. Normal database migrations remain unchanged. Missing or partial unsealed attempts remain blocked for explicit handling rather than automatic decode/write resumption. Application HTTP, author/reviewer UI, attachment/gallery/approval/public consumers, production storage and independent disaster recovery, hosted PostgreSQL concurrency, physical mobile checks and operator UAT remain open. Task06-4 remains open,54/97(56%),0/14 release gates accepted.

Next, add separate floor-plan listing attachment and saved gallery reads, binding current company/actor/draft version to the sealed output and durable bytes. Then connect author/reviewer UI and approval/public consumers under task06-4.

KES10,000 total monthly per realtor remains. Vendor resources and old live system are preserved. No GitHub Actions execution, provider purchase, credits or account plan change.
