# One explicit synthetic photo workflow — executed evidence

Date: 11 October 2026. Stage06 remains In progress. Checklist13/97, accepted gates0/14. Synthetic local data; vendor originals and live services untouched. KES10,000 total monthly price unchanged; no dependency/version, SQL grants, provider, account or paid service change.

## Executed checks

- Media build passed.
- **142 focused media tests passed**, zero failures, cancellations, skips or todos. See [full log](media-one-attempt-tests.txt).
- **All eight workspace typechecks passed** through root npm run typecheck, including package builds. See [full log](media-one-attempt-types.txt).
- Corrected25-case new-workflow probe passed before the final run. Initial probe passed23/25; failed cleanup expectation omitted a valid not_launched archive, and a seal fault fixture accidentally dereferenced an absent prelaunch receipt. Only test expectations/fixture logic changed; failures and exact commands remain preserved outside checkout.
- Source/runtime/test/package/lock hashes were frozen and verified unchanged during each successful command. Exact argv, timestamps, durations, hashes and raw logs: verification-one-attempt-final-1.json, verification-one-attempt-probe-2.json outside checkout. Final run finished 2026-10-11T05:37:52.903473+00:00.

## Result and evidence scope

The new Node-only workflow persists original input and claim facts before SQL writes, uses one live worker permit/journal ticket, runs a fixed codec once, independently verifies bounded actual files, installs output, persists an exact full seal request and seals through the isolated coordinator. Fresh/reopened requests cannot repeat commands or recover launch authority. Expired/missing/superseded original leases, mismatched facts and partial seal records block.

The actual Windows/PGlite fault test lets each capture, claim and seal COMMIT complete, then deliberately withholds its acknowledgement. All three recover through exact readProcessing facts: one write per command, one actual native conversion, original claim/attempt/nonce/input/output/full manifest, three destroyed logical checkouts. The test-owned PGlite backend remains alive. Canonical archived owner/launch/completion bytes match the original request and real native outcome. A privileged labelled pending/version fixture confirms historical read-only recovery without version adoption; it does not claim submission acceptance.

A second actual Windows/PGlite integration verifies pre-SQL request persistence, byte/storage/seal binding, full store/journal/worker reopening and original verified readback with no relaunch. An explicit refused replay may archive a fresh unarmed not_launched reservation; it performs no additional capture/claim/seal/native work. Draft version2 and accepted photo count0 remain unchanged.

Eight request filesystem tests and13 controller tests include strict snapshots/capability binding, one-use authority, deliberately lost persistence acknowledgements, manually seeded partial/corrupt history, typed SQL uncertainty, prelaunch supersession/expiry, bounded output checks, native failure/unknown retention, cancellation and draining close. Their coordinator/supervisor outcomes are explicitly simulated; header-only unit WebP fixtures prove readback branches, not native decoding or OS containment. Separate metadata SQL cases exercise current authorization and successor claims without a child; superseded expiry is manually seeded. Real native termination/codec evidence is confined to the executed integration cases and the existing supervisor suite.

Earlier318 combined API/SQL/SDK/HTTP/media results remain a separate checkpoint. This run is not full-platform, UI production build, remote CI, independent PostgreSQL concurrency, device, accessibility, performance or operator UAT acceptance. No forced worker/DB crash, power loss, hostile filesystem, production ACL/network/CPU/memory isolation, provider/quotas/retention/audit or off-device backup proof. All14 release gates remain open.

Next implement authenticated exact-version attach intents/finalize/remove/reorder, immutable receipts and verified provenance gating that excludes old metadata-only rows. Preserve old approved snapshots; no automatic latest-version adoption, bytes promotion or deletion. Then connect the draft/gallery UI and complete remaining service/provider/device/operator acceptance.
