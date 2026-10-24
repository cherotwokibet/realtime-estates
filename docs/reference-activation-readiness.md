# Reference activation compatibility — checkpoint 168

24 October 2026. Disposable synthetic compatibility checks only. No reference proposal was registered in normal migrations, no application feature was enabled and no live/vendor database changed. Task 06-1 remains open; checklist 24/97 (25% rounded), accepted stage gates 0/14. KES 10,000 remains the total monthly service price per realtor.

## Current CI evidence

The signed-in GitHub browser shows [Foundation checks run 109](https://github.com/cherotwokibet/realtime-estates/actions/runs/40115783126) **completed successfully** for `4d318790007650b4f61ee361b7193db14e28b38b`, the checkpoint 167 acceptance source. Run 108 for the preceding scope/recovery foundation is also successful. This resolves the previous connector-only uncertainty: its 404 did not establish workflow failure. It does not diagnose every historical failure email or prove a run for later checkpoint 168 edits. The workflow-list AX/screenshot and exact-source proof are retained; no unobserved job-step or exact CI test count is claimed.

## Atomic candidate simulation

The new `database/test-helpers/reference-activation-candidate.mjs` reads six fixed independently authored proposal files in reviewed dependency order: draft schema, catalogue installer, reference reads, moderation, creation and successors. It records SHA-256 hashes, checks their outer transaction framing, and executes their bodies in one disposable transaction. No caller supplies a filename or SQL body. It refuses an already-installed or partially adopted reference schema. This helper is test infrastructure, not a production migration runner or a default activation switch.

Ten focused SQL checks verify:

- Each of six interruptions before a candidate body rolls back all earlier candidate DDL, reference columns and grants, resets the local role, and preserves populated ordinary rows and original receipts.
- A full candidate installation leaves existing ordinary drafts, approved/public stock and legacy record-only listings unchanged. Reinstallation is refused without changing them.
- Current ordinary owner writes still require positive existing versions; another agent, customer and other-company context remain denied. Bare records acquire no editable revision. Ordinary successors still allocate once and preserve the selected approved public revision.
- The installed catalogue starts empty. Only an explicit owner-curated catalogue and explicit selected IDs adopt a draft. Existing matching free-text labels do not become reference IDs. Ordinary v2 writes cannot erase an adopted draft's reference facts; their failed transaction preserves the original.
- Runtime cannot directly mutate catalogue/location/amenity, receipt, transition or approved-reference tables, or execute the owner-only catalogue installer.

The fixture uses current migrations through 0031, PGlite, explicit synthetic tenants/admin/agents/customers and `SET LOCAL ROLE api_runtime` transactions. Privileged setup/snapshot queries are confined to the fixture. Accepted-photo rows are fabricated sealed metadata without image bytes; no native processor or provider is exercised. The first fixture correctly failed approval because it omitted availability confirmation; it was corrected to call the normal authorized confirmation command. The guard was preserved.

The default database test glob includes these checks. The root `npm test` chain now also invokes the existing `test:allocation-integration` script, so the two ordinary signed retained-allocation journeys added at checkpoint 167 are part of future full CI instead of depending on a separate manual invocation. Those two journeys were rerun successfully after the composition change. This checkpoint does not claim a newly completed full root CI run.

## Activation conditions that remain

| Condition                                       | Evidence or remaining work                                                                                                                                                                                                                                                                                                      |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Additive schema against populated ordinary data | Candidate simulation now verifies it, including pre-adoption atomic rollback. Normal migration registration is still unchanged.                                                                                                                                                                                                 |
| Existing ordinary/record-only callers           | Positive-version writes, original receipts and approved pointers remain compatible in the candidate. Repository source inventory is retained; dynamic/external production callers remain a release inventory requirement.                                                                                                       |
| Reference-aware editing after adoption          | The matching v3 protocol works in prior isolated implementation evidence. Current compatibility checks prove that ordinary v2 cannot silently erase its attributes. A maintained mixed-row page/router and deployment capability preflight must select the right editor/recovery protocol before normal activation.             |
| Rollback after reference writes exist           | Dropping the schema or switching to an ordinary-only editor would strand facts and receipts. Keep the reference reader/recovery/editor available across an application rollback, or fail the configuration change closed. This is not established by pre-adoption DDL rollback and is not yet implemented as a deployment gate. |
| Catalogue curation and configuration            | The candidate installs no implicit catalogue or new rights. Current bounded catalogue version/selection checks stay required. Platform/company configuration and owner-controlled curation must be composed deliberately.                                                                                                       |
| CSV import                                      | The existing 13-column decoded CSV preview stays read-only. Free-text locality is never inferred into taxonomy/amenity IDs, and no execution endpoint was added. Future execution needs explicit stable-ID choices and atomic currency/authority checks.                                                                        |
| Production/device/operator acceptance           | Hosted PostgreSQL concurrency, providers, real accounts/data rights, device checks, operator UAT and approved cutover remain separate gates.                                                                                                                                                                                    |

The schema helper's rollback proof applies before adoption and to the named injected failures. It is not a destructive downgrade plan, a hosted network-failure guarantee or backup restoration evidence.

## Task 06-6 follow-up inventory

Existing independently built availability/archiving controls and duplicate review have dated successful local browser evidence. The private assessment ledger/history and its synthetic-only policy have automated coverage, but `listing-verification-operator.md` records only an expired-token browser attempt, not successful recording/reload/history navigation. That concrete UI verification gap remains; no task 06-6 closure is made here. Preserve the protected old helper/previews and use a separately owned fresh preview if completing it. Real verification evidence policy, retention and any public badge are not inferred from synthetic statements.

## Evidence and next work

Sibling `rebuild-preservation/2026-10-12-source/reference-activation-*` contains the exact six-source hash manifest, bounded repository caller inventory, initial/final SQL and integration logs, formatting, CI AX/screenshot and source restore evidence. Full verification counts and publication details are recorded in the continuation checkpoint.

Next: implement and test the bounded authoritative mixed-row editor/recovery classifier and configuration preflight before registering a normal reference migration. Preserve legacy record-only compatibility and default-off isolated proposals. Complete the fresh successful private assessment browser journey in a separate owned preview, then audit the full named task 06-6 criteria. Continue the other remaining tasks and external ownership/accounts/media/hosting/device/operator/cutover gates; never convert narrow fixture evidence into release acceptance.
