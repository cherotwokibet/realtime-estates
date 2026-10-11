# Authenticated development photo transport

11 October 2026, Africa/Nairobi. Independently authored, synthetic local integration. Original resources and live systems remain available. This adapter is an explicit composition for loopback development; the default API entry point does not enable it or create storage roots automatically.

## Request and access boundary

`createDevelopmentServer` accepts an optional upload hook. Only an exact raw `GET` or `PUT` path receives it:

`/v2/staff/listings/{listingId}/revisions/{revision}/media-jobs/{jobId}/uploads/{uploadId}`

UUIDs and revision ranges are validated. Query fields, trailing slashes, dot-path aliases and other methods receive the existing general handler and limits. A headers-only Request and lazy source are passed to the hook. Raw duplicate authorization values remain ambiguous and fail bearer parsing; duplicate Host headers are rejected. Upload Expect requests receive417 without an automatic100 Continue. Application body consumption starts after authorization; this cannot prevent bytes arriving in OS/network buffers before the decision.

`createDevelopmentUploadApi` fixes company context from trusted hostname configuration and verifies the bearer with the configured identity verifier. Tenant, actor, listing assignment, worker identity, paths, checksums and processing credentials are not accepted as posted metadata. Wrong host, missing/ambiguous/unverified identity and known SQL authorization denials stop before source iteration. Responses use private no-store JSON and a generated correlation ID, with fixed safe errors rather than database/storage diagnostics.

For new bytes, additive migration0008 provides `app_api.preflight_media_upload`. Under the current API context it checks active staff membership, current listing access, the exact listing/revision/job, the job's original requester, unchanged registered assignment, a draft revision and an unexpired job. Its short transaction returns only the job/listing/revision tuple. It creates no reservation, version adoption, write, audit entry, storage key or processing capability.

The service awaits this preflight before asking for the source iterator and repeats it after the bounded body is complete. No SQL transaction spans streaming or native work. Coordinator commands retain their own eligibility checks, so the first preflight is not a durable permission to process later.

## Bounded upload and original identity

PUT requires `application/octet-stream` with no compression. The byte reader enforces actual input1 byte–10 MiB, an exact optional Content-Length, cancellation and a whole-body deadline. The general64 KiB JSON cap and exact128 KiB draft-save exception remain. Disconnects propagate an abort signal; unread denied bodies are closed after the denial response, without an unbounded drain. The default reader deadline starts after initial authorization; it does not bound arbitrary synchronous JavaScript or every authentication/database wait.

One upload per service instance is admitted without queueing through authorization, collection, the second check, metadata reservation, native processing and processor close. This limits that instance to one collected upload body; it is not a distributed or multi-instance/global quota. Status reads are allowed concurrently and remain descriptive, not proof that a recorded worker is live or terminated.

The immutable journal binds the verified tenant/actor and exact resource to internally computed input size/hash and fresh server-generated processing IDs. The service independently joins the consumed one-use ticket, processing request, lease, verified receipt and input facts before projecting a result. Processing runs once from fresh authority. Duplicate PUT may recollect a bounded body before the permanent job reservation rejects it; it does not launch another conversion. There is no automatic retry, replacement upload ID, revision-token adoption, root rotation or historical ticket reconstruction.

The journal stores metadata only. Original bytes become durable in the existing processor. An interruption before that processor's original request is installed stays blocked; this transport does not repair or resume it. Missing, corrupt, uncertain or conflicting history remains retained. Each created processor is closed; caller-owned stores, journal and worker roots remain the composition owner's responsibility.

## Read-only recovery and separate attachment

GET rechecks the current authenticated original requester and listing access through `read_media_job`, verifies the exact URL tuple, then matches every original principal/resource field in the journal. Historical status intentionally uses a different SQL read from fresh admission; it does not require the draft/expiry conditions needed for new work. Reconciliation uses the saved job/claim/generation binding and never calls processing run.

Only `{uploadId,jobId,listingId,revision,state}` crosses the response boundary, with state `verified`, `processing`, `blocked` or `native_failed`. Storage IDs, manifest, hashes, claims, leases, workers and private request context stay internal. A later blocked status does not grant a new attempt. Current native failures may be returned safely without claiming an accepted photo; reopened uncertain work stays blocked.

Verified processing does not attach or publish a photo. The existing exact-version staff attachment intent and coordinator finalization remain separate. Image delivery and browser controls are not part of this transport slice.

## Next integration and open evidence

Wire the explicit adapter into a synthetic development composition with stable owned storage/worker roots and clear lifecycle handling. Add shared client binary upload and original-status reads, then sequential admin upload/attachment with explicit pending, uncertain and conflict states and private image previews. Preserve the original upload operation during recovery and the user's unsaved draft fields during any current-version comparison.

Production hosting/provider/session setup, service-wide limits, hostile filesystem resistance, Windows ACL/network/CPU/memory isolation, retention/cleanup, independent backup and power-loss/worker/database restart or real PostgreSQL concurrency evidence remain open. No device, accessibility, operator UAT or launch gate follows from this contract. KES10,000 remains the total monthly client price; no paid service is added. See the dated executed evidence for actual verification and limits.
