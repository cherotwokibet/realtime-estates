# Successor floor-plan selection checkpoint381 - 6 November 2026 EAT

An isolated SQL candidate now carries a floor-plan selection into a guarded successor without inventing a new upload, actor, lease or attachment receipt. This is a database checkpoint, not application/native image-delivery acceptance.

## Behavior and authority

New floor-plan-successor.sql is explicitly installed after existing floor attachment/publication candidates and guarded successor migrations. It is not a normal migration and is not loaded into the native preview. An AFTER INSERT trigger on applied guarded successor results records an immutable, FORCE-RLS inheritance row in the same allocation transaction. It verifies current company/requester and exact predecessor revision/version/state. Conflicts/refusals and matching original replay create no mapping. A failed mapping or failed adopted-reference save rolls back the allocation and mapping together.

The row points to the original attachment operation; the original creator, command revision, sealed output, lease and registration stay unchanged. Selection first reads the current revision's latest local decision, including explicit null; only when no local decision exists does it read the frozen mapping. There is no dynamic historical traversal or fallback behind a removal. A second successor resolves to the same original source, while an explicit removal propagates null into subsequent successors.

Approval capture freezes this selected source operation, or null, in the immutable approved snapshot. Existing anonymous SQL metadata remains identifier-free and a draft removal leaves the old approved public snapshot intact until new approval. No backfill, new worker grant, physical file copy or decoder invocation is added.

A new private SQL envelope, synthetic-floor-plan-selection-v1 with source, retains source revision provenance explicitly. Current assignment/company and exact requested version are rechecked. It is available only to authorized staff through api_runtime; table DML and private helper execute remain denied. Current agent reassignment permits the new assigned staff member to read the selection but never rewrites the original source creator.

## Checks actually run

28 database checks passed,0 skipped: floor381-regression.txt. Six new successor checks plus existing attachment, publication and adopted-reference-successor regressions. Cases include one original source across multiple successors, original replay and changed-payload conflict, stale predecessor refusal, explicit null and no resurrection, forced capture rollback and identical retry, adopted reference save rollback/atomic adoption, approval snapshot preservation then explicit-null approval, cross-company/customer/peer denial, stale version, immutable/table/helper protections, reassignment and company-disable denial. Initial4 and intermediate5 runs passed too; floor381-initial.txt and floor381-selection.txt retain those overlapping runs. No failure was suppressed.

The tests use restricted disposable PGlite transactions, actual synthetic image conversion and sealed SQL fixture metadata. They do not run a native worker, durable image delivery, API/SDK/BFF join, hydrated browser or physical device. Formatting and diff checks passed; no TypeScript code changed. The disposable databases close through test cleanup.

## Exact next steps and current count

54/97(56%);06-4 and all14 stage gates remain open. Next implement strict API projection and durable reader support for the explicit source envelope without relaxing old v1 same-revision assertions. Private/reviewer/public read authority must bind the requested target revision, while retained bytes remain bound to the original source revision/creator/lease. Add source-aware reviewer and approved-output SQL paths, then install only in an explicit native floor successor journey. Current preview successor/public modes are mutually exclusive; preserve defaults when composing the new explicit journey. Verify actual native approval, copy, removal, review/public bytes and no-reprocess behavior before claiming those app flows passed. Then actual mobile image/refresh checks and combined original-lock matrix; reference review/availability navigation remains next.

Boniface + Codex own follow-up. KES10,000 total recurring client price baseline retained. Vendor/live system untouched; no Actions, spending, account changes or cutover. Publication and preserved browser notes recorded separately after private dashboard deployment.
