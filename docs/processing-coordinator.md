# Synthetic processing coordinator foundation — 11 October 2026

This checkpoint is a private local processing foundation, separate from HTTP uploads, user attachment and production operations. Its agreed contract is recorded before implementation. Actual executed evidence is recorded separately; a proposed state transition is not a passed test.

## Frozen boundaries

Keep migration0003 media jobs and registration receipts immutable. Add globally unique job UUIDs and append-only captured-input, processing-lease and verified-output records with composite company/job relationships and forced RLS. The application API connection/guard and registration projection remain unchanged. The dedicated media_coordinator role is NOLOGIN, NOINHERIT, NOSUPERUSER, NOBYPASSRLS; its isolated login has only that membership, no private table/column DML or reads, schema CREATE, owner/API membership or arbitrary SQL interface. Only four named app_media functions are granted, owned by the controlled migration owner with fixed pg_catalog search path and PUBLIC revoked.

| Internal function | Exact input and result |
| --- | --- |
| capture_input | Job UUID, immutable generated input-generation UUID, actual byte count and SHA256. Returns the captured identity and timestamp. Same facts recover; changed identity conflicts. |
| claim_processing | Job UUID and stable explicit claim UUID. Returns attempt, secret lease nonce/expiry, generated private storage identities, captured input facts and fixed pipeline. Same claim never renews/increments; cross-job reuse conflicts. |
| seal_output | Job UUID, exact attempt/nonce and complete fixed-codec manifest. Returns immutable output facts, digest and historical verified receipt. New writes require the current unexpired latest lease and captured input match. |
| read_processing | Job UUID. Returns bounded registered/captured/processing/verified/expired state with private capture/latest lease/seal receipts. This is an internal coordinator projection, never a browser response. |

Each function derives company, listing/revision and original requester from the persisted job, ignoring caller tenant/actor GUCs. Current company/membership/listing authorization is rechecked. New work requires the original registered assignment, a draft and unexpired registration. Processing changes no draft version and does not adopt any revision token; a later explicit authenticated attachment intent supplies its own exact token. Historical identical capture/claim/seal recovery uses current read authorization and can survive old state/expiry without creating new work. No existing GUC-based audit helper is invoked as the coordinator; immutable transition receipts are local evidence, while production operational audit remains open.

Claims are globally bound to one job, maximum three attempts. Each new lease lasts at most180s and cannot exceed the registration expiry. This accommodates the existing local supervisor's bounded startup, maximum120s child work and termination window; it is not an OS resource limit. A stale/replaced lease cannot seal new facts. A committed seal can be recovered with the exact original attempt/nonce/manifest after expiry, while altered facts conflict.

The manifest must bind captured input generation/hash/length to the fixed synthetic-codec-v1 policy: static JPEG/PNG/WebP source, WebP output hash/bytes/dimensions, Sharp0.35.5/libvips8.18.7 and exact orientation/resize/metadata-strip/encode operations. SQL validates structure and identity; it cannot prove that decoding occurred. The trusted coordinator attests facts only after actual supervised processing and bounded pure parent readback. The child has no database pool, credentials, browser token or acting-user selector.

## Verification and remaining work

Executed evidence: **283 affected tests and eight typechecks passed**, including actual restricted-session grant tampering and supervised codec-to-SQL integration. See evidence/2026-10-11-media-processing.md.

The verification covers narrow privileges and adversarial connection metadata, current/revoked/reassigned authorization, forged GUC refusal, immutable input and historical retries, attempt caps, expired/replaced lease fencing, exact manifest binding and no accepted-media/version mutations. A separate synthetic integration runs the real child and seal its actual byte-derived manifest through the restricted coordinator adapter. An ephemeral local storage handle is not a durable SQL object mapping or restart recovery proof.

Lease expiry permits SQL fencing/reclaim; it never proves that an old process is gone. containment_unknown attempts remain retained and blocked, and the caller must not automatically retry or clean them because a lease expired. This foundation supplies no production orchestrator, public upload transport, attachment intent, accepted photo, versioned gallery ordering, retention sweeper or publication. Independent PostgreSQL races/revocation concurrency, actual provider/identity/hosting, production filesystem/network/CPU/memory isolation, restart recovery, devices/operator UAT and every release gate remain open. Synthetic data only; vendor originals/live systems and KES10,000 total monthly baseline remain unchanged.
