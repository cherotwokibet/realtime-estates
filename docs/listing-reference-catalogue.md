# Synthetic normalized location and amenity contract

Checkpoint128 adds shared reference-catalogue validation, selection and detached label snapshots as a foundation for task06-1. It does not add persistence, HTTP routes, editor controls or approved public projections. No real Kenyan location dataset, official county coverage or evidence of data rights is claimed. All test names and amenity codes are explicitly synthetic.

## Reference and selection rules

The exact catalogue shape is `{policy:'synthetic-reference-catalogue-v1',version,country:'KE',locations,amenities}`. Versions are canonical positive decimal strings up to the safe-integer ceiling. Locations use canonical UUIDs, explicit kind `county/locality/neighbourhood`, parent ID and a canonical NFC label of1–160 Unicode scalars. Counties are roots, localities refer to counties, and neighbourhoods refer to localities. Unknown parents, wrong-level edges, cycles, duplicate IDs and invalid labels fail. Names are not unique identity: repeated place labels remain distinguishable by their IDs and parents.

Amenities have a distinct stable UUID, unique lowercase hyphenated code, label and nonempty set of applicable existing property types. IDs cannot collide with location IDs. Catalogues are bounded to5000 location nodes and100 amenities. These are technical abuse bounds, not assertions about Kenya's administrative structure or commercial stock.

Selections explicitly retain `{catalogueVersion,location:{countyId,localityId,neighbourhoodId},amenityIds}`. All-null location preserves unknown facts. A locality requires its selected county; a neighbourhood requires its selected locality. Cross-county, wrong-level, nonexistent and label-as-ID selections fail. Unknown, repeated or type-inapplicable amenities fail rather than disappear; a draft with unknown property type can select no amenities yet. Up to50 selected amenity IDs are detached and sorted into a deterministic set.

Own-data validation rejects inherited, hidden, symbolic, accessor and extra fields, as well as sparse/decorated arrays, without invoking ordinary field/index getters. No tenant, actor, role, contact, precise address or coordinate is accepted or invented by this contract. A caller-supplied catalogue is not an authority source: future API code must load the current server-controlled catalogue after its own authorization checks.

`snapshotListingReferenceAttributes` captures the selected version, IDs and labels into a frozen detached value. Later catalogue or form edits cannot rewrite that value. This function does not save a revision, approve a listing or make anything public. Recovery of a future saved original must read its saved snapshot, not reconstruct labels from a newer catalogue.

## Compatibility and next persistence decision

Existing v2 location disclosure is exactly `{county,town,area}` with nullable text. Existing staff draft JSON has an exact field list and no amenities/reference selection. Current SQL enforces that v2 shape and moderation copies approved disclosure into an immutable snapshot. This checkpoint deliberately does not append fields to those contracts or guess reference IDs from legacy free text.

Before enabling persistence, introduce an explicit combined/versioned draft command or a carefully reviewed compatibility transition. A reference/amenity edit must participate in the editorial revision's optimistic version, not merely an independent side counter: otherwise a moderator could approve changed attributes using a stale core revision version. Old v2 saves must not silently retain incompatible selected amenities after property-type changes or contradictory normalized locations after free-text edits. These interactions need deliberate refusal/adoption policy and tests before default registration.

The future combined command must bind current company/assignment/actor, exact listing/revision currency and reference-catalogue version; atomically retain content, normalized selection, label snapshot, revision version, audit and original receipt; and preserve exact replay/current-authorized GET recovery. Submission/review must see the same attribute version and approved snapshots must copy the explicit saved labels/amenities. Public projections may expose only that selected approved snapshot, with unknown locations kept unknown. No standalone side-table write may bypass pending-review or approved-snapshot immutability.

Next: inventory default save/submit/review/successor/import/public projections and choose the versioned compatibility path; implement a candidate schema/command separately until all callers and restricted-role/rollback/original-replay/stale-review tests pass. Obtain an authorized reference dataset and operator validation before representing real location coverage. Device/operator UAT and cutover remain separate gates.

## Evidence

249domain checks passed with zero failures/skips (eight new contract cases overlap that total). They cover hierarchy and stale catalogue currency, graph/ID errors, amenities/type changes, getter nonexecution and array shape, detached snapshots/unknowns, bounded Unicode/version/ID input and refusal of free-text auto-mapping. Workspace builds/types and formatting are recorded in CONTINUATION.md and sibling `listing-reference-catalogue-*` logs. No SQL/API/browser/device/production result is claimed. Task06-1 remains open; the old live system and KES10,000 gross monthly total/client baseline are preserved.
