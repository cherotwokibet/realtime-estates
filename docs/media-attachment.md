# Authenticated synthetic photo attachment

Implementation checkpoint: 11 October 2026. Verification is recorded separately in the dated evidence file; this contract is not a launch or UAT acceptance. Synthetic local data only, with the original vendor resources and live system preserved. KES 10,000 remains the total monthly client price.

## User authorization and exact draft version

`POST /v2/staff/listings/:listingId/revisions/:revision/media-attach-intents` accepts exactly `{operationId,jobId,expectedVersion}`. The JSON expectedVersion must be an original positive decimal integer literal, at most 9007199254740990; duplicate decoded keys and rounded fractional/exponent literals are refused before parsing. The shared SDK takes a canonical decimal version string and snapshots the immutable request before asynchronous work.

The SQL command receives the URL listing/revision as well as the job, operation UUID and version. It checks current company, membership, original requester, assignment, draft/version, unexpired verified job and immutable sealed output. A UUID used for a different command/request cannot be repurposed. The server generates the association identity and binds the validated original alt text and seal digest. Creating an intent changes no listing token, revision token or accepted photo count.

The response has status `ready` and receipt `null` while queued. This acknowledgement is not an accepted photo. Exact explicit repetition of the original request returns its existing status under current authorization, including after later content/version/state changes. Neither API nor SDK automatically retries a mutation.

`GET` on the same path followed by `/:operationId` reads the original intent/result. It must match the URL tuple and original principal; a guessed foreign identifier or revoked/reassigned actor cannot reveal the private receipt. No private object keys, manifests, upload capability or coordinator endpoint is exposed by these routes.

## Coordinator finalization and historical recovery

The isolated coordinator exposes `finalizeMedia(operationId)` and `readMediaAttachIntent(operationId)` in `@realtor/media/coordinator-database`. Its catalogue guard now requires exactly seven reviewed function signatures, fixed owner/security-definer/search-path configuration and no direct table, API, owner or delegated privileges. A decoder never receives this connection.

Finalization accepts only the persisted operation UUID. SQL derives tenant, actor, job, expected version, seal, association identity and alt text from immutable records; caller GUC values cannot authorize or redirect it. It holds the normal listing/revision locks, rechecks current authorization and returns a committed typed terminal outcome. A newer draft version becomes a conflict, never implicit permission to adopt that version.

An applied transaction creates the immutable attachment/provenance record and current photo association, increments the revision token exactly once, and inserts one audit event with the persisted tenant/requester and server correlation. It leaves the separate listing token alone. The terminal receipt is append-only and commits atomically with those effects. Failed state/version/assignment/expiry/duplicate/capacity/provenance checks record a bounded terminal failure without a photo, token increment or success audit. Authorization failures or database exceptions disclose no success and roll back; an unknown COMMIT outcome is never inferred to be a terminal failure.

The envelope contains kind, operationId, jobId, listingId, revision, original expectedVersion, altText, status and receipt. A terminal receipt additionally contains the resulting historical version, outcome/reason, nullable mediaId/position and UTC microsecond completion time. It is a historical fact, not the current draft token. Applied versions equal original expectedVersion plus one; failed outcomes describe the version observed at finalization. Unsupported versions fail conservatively rather than being rounded or clamped.

After a lost response, read the original operation UUID. Exact committed receipts survive later save/submission, expiry and future association removal while current authorization still permits access. A read creates no intent, photo, audit or fresh authority. The private adapter issues each requested command once and reports typed COMMIT uncertainty; callers must not blindly resend finalization. SQL nevertheless preserves exact committed historical replay for an explicit authorized call.

After a durable conflict, an authorized user can explicitly create a new operation UUID for the same still-unattached, unexpired verified job and a freshly supplied exact version. The coordinator cannot manufacture that permission. An already attached job cannot be attached again; future carry-forward/removal policy is separate.

## Provenance and publication boundary

Migration 0006 keeps old media rows in place with null provenance. It does not backfill verification. New accepted rows reference immutable attachment and sealed-output facts, including the exact generated synthetic key, manifest digest, checksum, content type, size, dimensions and alt text. Duplicate keys/checksums in a draft are rejected, and every existing row consumes capacity and a position slot.

Submission now requires 4–12 distinct accepted, fully provenanced rows. A separate approval-transition trigger prevents a legacy pending fixture from becoming newly published. Already approved historical snapshots remain retained. This establishes a trusted SQL association boundary; it does not make a provider object publicly retrievable or authenticate the bytes of an arbitrary privileged fixture.

Existing authorization/moderation tests and local dev previews use an explicitly labelled privileged SQL-only provenance helper. Those fixtures preserve intended version assertions and never claim native decoding, real image storage or upload authentication. Actual-byte integration evidence is recorded separately.

## Remaining work

Implement exact-version removal/reordering and retained historical references, then connect sequential attachment to draft/gallery UX. Carry-forward rules remain separate. Public upload transport, provider storage/delivery, quotas, cleanup/retention, production resource isolation, real PostgreSQL races, independent backup/restore, account/asset rights, devices and operator UAT remain open. The local native workflow still retains unknown attempts and supplies no automatic relaunch/reclaim/deletion/root rotation. Every release gate remains open.
