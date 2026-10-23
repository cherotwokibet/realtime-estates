# Reference draft editor candidate

Checkpoint 134 — 23 October 2026.

The admin now has a reference-aware editor component and a separately tested attempt controller. The component is not mounted in the application yet. It needs a current-authorized server adapter before users can save through it.

County, locality, neighbourhood and amenity choices retain UUID identity. Duplicate visible names are disambiguated. Unknown choices remain explicit; existing free text is never interpreted as a reference ID. Changing a parent clears dependent choices. The user must explicitly consent before the selected facts replace the draft's coarse location fields. Pricing, private address and other full-content facts are retained in the command, but private address is not rendered in this picker.

Before any POST, the controller persists and reads back the exact original command, scoped to instance, tenant, actor and listing. It stores the historical catalogue version rather than the potentially large catalogue. Retention is capped at 160 KiB and fails closed on quota, corruption, mismatched scope, conflicting original or readback failures. This tab-local synthetic storage is not production durability.

The controller permits one flight. A dispatched ambiguous write stays uncertain, including after failed 403/404 recovery. Recovery and identical replay are explicit actions against the retained original. Reload restoration performs only a historical catalogue GET, validates the original and does not automatically write. A received receipt must match the original catalogue, full command and actor. Clearing a settled original requires an explicit action and a refreshed workspace before further edits.

Verification: 299 admin checks passed (eight new controller/session cases), followed by three React server-rendered initial-markup checks; zero failures and zero skips. Four package builds and eight workspace typechecks passed. The markup checks establish initial HTML only. Browser interaction, hydration, real reload/storage, routed editor, BFF transport, installed mobile and hosted database concurrency acceptance were not run. No Next production build was run over the older active admin preview.

Next: implement current-authorized BFF catalogue and draft receipt adapters with explicit synthetic preview gating, strict request/response bounds and actor/company/session binding. Then mount the candidate in an isolated authorized preview and verify actual user events, uncertain reload, recovery and stale workspace handling. Reference-aware moderation, approved snapshots, public reads and create/successor/import conversion remain necessary before default activation. The API and schema proposals remain opt-in; adopted draft submission remains blocked until review contracts support the reference facts.

No checklist task or launch gate is closed by this component checkpoint. Rights, account control, retention, real devices, operator UAT and cutover approval remain open. Preserve the old live/vendor system and the KES 10,000 total recurring client price baseline.
