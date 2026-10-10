# Authenticated media registration — 11 October 2026

This local slice creates private SQL job metadata and an immutable registration receipt. It creates no upload capability, bytes, accepted media or attachment intent. The existing codec/store/Windows supervisor remain separate experiments. Verification results and limits are recorded in the dated evidence checkpoint.

## HTTP and shared client

All routes require a verified bearer identity, trusted deployment company, enabled company and current active staff membership. A requester must still be the assigned agent or an admin permitted to work on the listing. Reads and replay additionally require the original requester. A different admin cannot recover another requester's receipt.

| Method and route below `/v2/staff/listings/:listingId/revisions/:revision` | Behaviour |
| --- | --- |
| POST `/media-registrations` | Exact body `{registrationId,expectedVersion,altText}`. UUID supplied and retained by the caller; safe positive integer JSON version; canonical 1–300 Unicode code point description. SQL generates the distinct job UUID only when no registration exists. |
| GET `/media-registrations/:registrationId` | Original immutable receipt under current authorization, including after later saves, submission, approval or expiry. |
| GET `/media-jobs/:jobId` | Narrow current projection, with `state:registered|expired` instead of historical `outcome:registered`. Reading expiry changes nothing and renews nothing. |

Queries and unknown body fields are refused. No caller-supplied tenant/actor, storage identifier, hash, dimensions, expiry, manifest or acceptance flag is accepted. The request cap is 8 KiB of actual streamed bytes, with fatal UTF-8 decoding. Decoded duplicate keys and noninteger/fractional/exponent version literals are rejected before JSON parsing can round them. Alt text must already be trimmed, nonblank and free of C0/C1 controls or unpaired surrogates; it is not silently normalized.

The exact receipt fields are `kind:register_media_upload`, `operationId` (the registration UUID), `jobId`, `listingId`, `revision`, `expectedVersion` (decimal string), `altText`, `outcome:registered`, `registeredAt` and `expiresAt`. HTTP timestamps use UTC ISO milliseconds, exactly 24 hours apart. The current job uses the same facts with `state` replacing `outcome`. All responses use no-store and omit private storage/actor context. GET results are bound to the full requested tuple and resource UUID.

`RealtorApiClient.registerMediaUploadV2()`, `getMediaRegistrationV2()` and `getMediaJobV2()` validate exact fields, identifiers, original request facts, timestamps and raw response revision tokens. Results are frozen. Retain the original UUID and body for explicit reconciliation/retry. The SDK never retries automatically, creates a replacement UUID or adopts a newer draft token. A network/timeout/malformed success after a write starts remains uncertain until readback; an expired historical receipt is still valid evidence of the earlier registration.

## SQL and historical recovery

Apply ordered migration `0003_registered_media_jobs.sql` after 0001 and 0002. `app_api.register_media_upload(uuid,integer,bigint,uuid,text)`, `read_media_registration(uuid)` and `read_media_job(uuid)` are the only new runtime grants. The existing connection safety guard is unchanged. Forced RLS, composite context FKs and immutable row triggers protect `media_operations` and `media_jobs`; runtime receives no direct table reads or DML. Generated quarantine/output UUIDs remain private and allocate no storage objects.

New registration locks listing, revision, tenant-scoped operation identity and job in that order. It requires a draft and the exact current version. It changes neither revision/listing version nor accepted photo count. An equivalent retry finds the existing operation before allocating job identity; it checks original actor, kind, tuple, version and canonical payload plus server digest. It returns the original receipt without requiring the old draft state/token or an unexpired job. Changed facts conflict. The operation namespace is shared with future media command kinds, which are not executable yet. Creation is audited once; replay creates no second job or audit event.

Readback rechecks current authorization. Revocation, company disablement and reassignment can deny access even to a historically successful registration. These controls are not renewable upload authority. Receipts and operation rows are immutable in this migration; future lifecycle/retention migrations must explicitly preserve historical reconciliation while adding fenced changes.

## Remaining work

Next connect actual private upload/processing to persisted jobs using bounded claims, captured input identity, leases and immutable sealed output. Then implement explicit authenticated attachment intents, coordinator finalization and versioned removal/reordering, with provenance gates for submission and retained-reference cleanup. Legacy accepted-metadata fixtures must not be relabelled as decoded output.

Fresh UUID registrations can accumulate metadata; distributed quotas, rate limiting and retention remain open. Serialized disposable PGlite tests do not establish independent PostgreSQL races or concurrent revocation semantics. Hosted identity/database/storage/decoder compatibility, production resource/network/filesystem isolation, restart recovery, devices, operator UAT and every launch gate remain open. No provider, subscription or dependency version changes are required by this slice; KES10,000 total monthly service price remains the baseline.
