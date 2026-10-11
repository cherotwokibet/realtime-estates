# Draft photo removal and ordering

Implementation checkpoint: 11 October 2026. Executed verification is recorded in evidence/2026-10-11-media-gallery.md. Synthetic local data only; production, device and operator acceptance remain open. KES 10,000 is the total monthly service price, and vendor originals/live services remain preserved.

## Exact requests and authorization

The implemented command routes are `POST /v2/staff/listings/:listingId/revisions/:revision/media-removals`, accepting exactly `{operationId,mediaId,expectedVersion}`, and `POST .../media-reorders`, accepting exactly `{operationId,orderedIds,expectedVersion}`. `GET .../media-operations/:operationId` reads the original terminal result. These commands require a currently active assigned agent or agency admin in an enabled company. Historical results additionally require the original requesting principal; an admin cannot inherit another principal's receipt.

SQL signatures are `app_api.remove_draft_media(uuid,integer,bigint,uuid,uuid)`, `app_api.reorder_draft_media(uuid,integer,bigint,uuid,uuid[])`, and `app_api.read_media_operation(uuid)`. The URL tuple is checked against historical results before disclosure. Versions are canonical positive decimal strings in the shared SDK and original positive decimal integer literals in JSON, at most 9007199254740990 for requests. Duplicate decoded keys and fractional/exponent spellings are rejected before ordinary JSON parsing.

The operation UUID shares the existing immutable company operation namespace with registration and attachment. The canonical request binds kind, company, principal, listing, revision, exact expected version and target media ID or complete requested order. Changed payloads under the same UUID conflict. Listing, revision and operation locks precede decision and media mutation. Current authorization precedes historical disclosure; exact matching replay precedes current state/version/media-existence checks.

## Terminal receipt

Commands return one direct immutable terminal receipt:

```text
{kind: remove_media | reorder_media,
 operationId, listingId, revision, expectedVersion: decimal string,
 version: decimal string, outcome: applied | noop | conflict | rejected,
 reason: null | VERSION_CONFLICT | REVISION_NOT_DRAFT | MEDIA_NOT_FOUND | MEDIA_SET_CHANGED,
 mediaId: UUID | null, orderedIds: UUID[], completedAt: UTC timestamp}
```

Removal always records the requested target as `mediaId`, including failure. Its `orderedIds` captures the complete resulting order after successful removal, or the locked current order for a typed failure. Reorder always records `mediaId:null` and the exact original requested ordered IDs, including failure. SQL emits six fractional UTC digits; the API validates and projects three. These are historical facts, never recalculated from later draft state.

Applied operations increment the revision token exactly once and append one derived actor audit. A valid identical reorder records `noop`, keeps the token and creates no success audit. Removal has no noop. New commands check draft state, then the exact current expected version, then gallery membership, even for an identical reorder. A state rejection may therefore record a current token different from the expected one. Failure records keep the current supported token and change no media/token/success audit. Unsupported current tokens conservatively abort; they are never rounded or clamped.

## Complete gallery and retained references

Reorder must include every current media row exactly once, including legacy unaccepted rows. Null arrays, more than twelve entries, duplicates, null entries, noncanonical SQL array dimensions or lower bounds are invalid. The canonical empty array is allowed. A missing, extra or foreign full-set member produces `MEDIA_SET_CHANGED`; absent removal targets produce `MEDIA_NOT_FOUND`, whose captured order cannot include that target. Sparse current positions cannot be silently repaired by removal. A valid reorder can explicitly assign a complete contiguous order; repairing gaps is applied even when the sorted IDs were already in the requested order.

A named deferrable position uniqueness constraint permits safe swaps and compaction within the existing zero-to-eleven range. Only that constraint is deferred, and the final complete zero-to-count-minus-one positions are proved before returning. Media metadata/provenance immutability remains enabled. Rollback must restore associations, positions, revision token, operation result and audit together.

Removal changes the draft association only. Immutable attachments, sealed jobs, historical receipts, retained revisions, approved snapshots and physical objects remain retained. This slice introduces no storage deletion, sweeper, grace-period policy, cross-revision carry-forward or cleanup authority. An old attachment receipt remains readable after removal under current authorization and cannot reattach its job. Production retention/account/independent backup evidence remains separate.

## Client recovery and verification boundary

The SDK snapshots the original own-property request before asynchronous work, validates exact response fields and bindings, and never retries a mutation or adopts a new version automatically. A lost or malformed successful response is uncertain; explicit historical readback recovers the original operation. A fresh operation requires an explicit new UUID and current version selected after reviewing current state.

Meaningful verification must cover real restricted API login integration, raw JSON boundaries, authorization/tenant denial, immutable request collisions, full legacy membership, swaps/compaction/noop, rollback, retained references and response loss. A serialized disposable PGlite database can establish transactional policy but cannot establish independent PostgreSQL races, restart durability or provider/device/operator acceptance. Exact executed results belong in the dated evidence checkpoint.
