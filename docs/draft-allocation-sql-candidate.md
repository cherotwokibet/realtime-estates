Current status: promoted into the normal local migration order on16October2026. See docs/draft-allocation-activation.md for final-schema verification. The candidate checkpoint below is preserved as historical evidence.

# Private draft allocation: candidate only — 16 October 2026

`database/proposals/0024_guarded_draft_allocation.sql` is a separately tested candidate. It is deliberately absent from the default migration order and disposable preview startup. Current runtime SQL still supports legacy zero-version allocation. The positive-version HTTP/SDK boundary from checkpoint87 remains active. Do not deploy or promote this candidate until fixture callers are converted and the final-schema suites pass.

The candidate atomically moves the existing independently written v1/v2 save implementations into `app_private` as `save_draft_internal_v1` and `save_draft_internal_v2`, revoking PUBLIC and `api_runtime` execute grants. New public save wrappers retain staff authorization, require a positive expected version and delegate to those private implementations. Existing guarded creation and successor functions keep their transaction, receipt, identity, locking and audit behavior; their one internal zero-version call uses the private v2 helper. They remain owned by `realtor_owner`, with fixed `pg_catalog` search paths. No caller-selected bypass flag or runtime helper grant is introduced.

The proposal retains exact copies of our own current guarded function bodies, changing only CREATE OR REPLACE and the internal helper reference. Moving the original save function objects preserves their independently written validation, tenant/assignment locks, content handling and audits; it avoids a second handwritten allocation implementation.

Three isolated PGlite candidate tests passed:

- Both public legacy save functions reject direct zero-version initial and successor allocation. Runtime has no execute privilege on either private helper and direct calls fail. Helper ownership, definer status and fixed search path are checked. Guarded creation still allocates a new listing; positive v1 and v2 edits advance its existing draft versions; customer edits fail.
- Guarded successor allocates one empty-gallery revision, validates its original receipt, replays without extra audit, preserves the terminal predecessor and returns the same historical receipt after a later positive-version edit.
- A deliberately failing revision-insert trigger rolls back the successor request, result, revision and audit together.

Initial assertion expected SQLSTATE 23514 for zero; the existing `require_version` contract uses 40001. The test expectation was corrected to that established behavior; no error policy was changed. Failed and final logs remain in sibling `rebuild-preservation/2026-10-12-source/draft-allocation-sql-*`. All 235 database checks passed, including the initial three candidate cases; a final focused rerun extends those cases with initial-allocation denial, explicit empty-gallery and helper ownership checks. Formatting and focused outcomes are recorded at publication. PGlite checks do not prove real PostgreSQL multi-connection races, production rollout, retention, devices, UAT or cutover.

A broader literal-call inventory over five fixture/test/preview roots found 46 SQL calls: 31 initial, 12 later and three dynamic revision arguments. This supersedes the narrower 27-site scan and the three added service arrangements; it is not a complete inventory of dynamically constructed or production callers. The mechanical review confirms both guarded operation bodies exactly match their existing definitions after the two intended textual changes. JSON evidence is retained beside the logs.

Actual GitHub CI was observed successful at HTTP/SDK source `17ed4ba1359c9f57a014f1ce3dc91fbf5db595e3`, run 38866504166 (job 10m, workflow 10m51s). Recent exact-read `b1820d4`, operator `6525ed8` and native-lifecycle `3168f63` runs also show success. Candidate-source CI is not yet claimed. See `draft-allocation-actual-ci.txt` and its screenshot.

Promotion work remains:

1. Inventory and convert initial/later zero-version fixture callers, including the three explicit service-test arrangements added at checkpoint87. Preserve legacy contract tests as explicitly historical where appropriate, and add final-schema equivalents. Do not grant runtime private-helper access to make tests pass.
2. Initialize normal preview and service fixtures through guarded creation, preserving intended original actor/assignment and version/audit expectations. Later fixture revisions should use guarded successor operations from terminal predecessors.
3. Move the reviewed candidate into the migration folder, append the default order and run the complete final-schema database, API/SDK integration and signed preview suites, including native successor lifecycle. Add initial bare-listing/legacy record compatibility handling deliberately.
4. Only then claim the active SQL allocation shortcut closed. Current checklist remains 19/97 tasks and 0/14 accepted gates; vendor resources and old live system are intact, synthetic data only, KES 10,000/month total client baseline.
