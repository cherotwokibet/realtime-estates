# Reference-aware successor domain contract

Checkpoint 158, 24 October 2026. The isolated successor SQL candidate now has exported bounded domain validators and an actual SQL-to-domain receipt check. The candidate remains absent from default migrations, HTTP routes, SDK methods and operator screens. It uses synthetic data and grants no access, publication or release authority.

`validateSyntheticReferenceSuccessorCommand(input, originalCatalogue)` captures a detached, frozen full command with policy `synthetic-reference-successor-v1`, operation/listing IDs, expected listing version, explicit approved/rejected predecessor revision/version/state, canonical full content and reference selection. It reuses the existing successor and reference-draft validators. Exhausted listing or revision counters are rejected before deriving the new revision; the largest accepted predecessor revision is 2147483646 and expected listing version is 9007199254740990. Their applied results can reach the existing SQL maxima. A predecessor editorial version may itself be at its supported maximum because starting another revision does not increment that predecessor.

`syntheticReferenceSuccessorDraftCommand` derives predecessor revision + 1 with initial expectedVersion `2`. Call it only with a validated command. Adoption produces initial revisionVersion `3`. These versions are immutable historical facts and cannot authorize editing the current draft after later writes.

`validateSyntheticReferenceSuccessorReceipt(input, command, originalCatalogue, verifiedActorId)` accepts only an applied base successor with the exact retained command, expected listing version increment, allocated revision and initial version 2, plus the matching reference original at that revision/version 3. Both components must bind the same operation, listing and verified actor. Current access remains SQL/API responsibility. Recovery must supply the retained original catalogue, never substitute the latest pointer.

The composition checks the raw base successor against its validated canonical shape as well. This prevents the base validator's normalization from silently changing a composed original's public title, IDs or private facts. Private address whitespace is intentionally valid and retained exactly; it is not trimmed. Unsupported fields, symbols, accessors, sparse arrays, custom prototypes, wrong identities, changed predecessor/content/selection, malformed clocks and snapshot-label substitutions fail. Accessor tests confirm untrusted getters are not evaluated.

## Capacity

The command ceiling is 131072 UTF-8 bytes. Each projected or recovered component is capped separately at 131072 bytes; the composed receipt ceiling is 262272 bytes. Preflight constructs both projected originals, including a 27-character completion timestamp, before callers may mutate SQL. The measured JSON wrapper overhead is 76 bytes, within its reserved 128 bytes. Ordinary component limits are unchanged.

A valid stress fixture with 50 selected amenities, 32 explicit charges, a 10000-code-point four-byte Unicode description and a 1000-code-point private address measured:

| Value                    | UTF-8 bytes |
| ------------------------ | ----------: |
| Canonical command        |       71230 |
| Base successor original  |       69324 |
| Reference draft original |      107380 |
| Composed original        |      176780 |

This verifies a valid composed result larger than an ordinary 128 KiB envelope while both components retain their own limits. Existing field limits are tighter than some defensive byte ceilings; the stress test does not claim to find an otherwise-valid payload crossing the exact ceiling. A 10001-code-point description is rejected by the existing content bound.

## Evidence and remaining work

All 283 domain checks passed, including eight new focused checks; nine isolated SQL candidate checks passed with actual rejected/approved successor, explicit matching legacy completion and historical originals validated by the new domain contract. All eight workspace typechecks and repository formatting/whitespace checks passed. The full database suite was not rerun for this domain-only change; its preceding checkpoint result remains 327 passed. SQL and migration order were unchanged.

Logs are in sibling `rebuild-preservation/2026-10-12-source/reference-successor-domain-{focused,tests,sql,types,format}.txt`. Initial tests incorrectly mutated frozen normalization fixtures, treated permitted private whitespace as invalid and omitted rent purpose from the charge stress fixture. Those fixture errors were corrected; validation guards were not loosened. The original failed logs are retained.

Next: a separately default-off HTTP write/original-read route and SDK methods. Validate the full retained original and historical catalogue inside the restricted authenticated transaction, apply these capacity bounds before mutation/commit, require current role/tenant/requester/assignment, and abort malformed returned originals. Match route IDs and explicit original command; no automatic retry or GET allocation. Keep SQL conflict/refusal rollback semantics and current-catalogue validation for new writes while permitting historical exact replay. Then implement operator successor retention/recovery, import reference conversion and default schema compatibility before release acceptance. KES 10,000 remains the total monthly price per realtor; preserve vendor resources and the old live system.
