# Local staff photo workflow

12 October 2026 · independently authored replacement · synthetic data only.

The staff editor now prepares one original photo request, uploads and verifies its actual bytes, and explicitly attaches the verified output to the original saved draft version. The default preview remains a metadata fixture. Native mode is a separate, explicit development option; the ordinary API entry point remains unchanged.

## Operator flow

1. Choose one fictional JPEG, PNG or WebP, 1 byte–10 MiB, and a trimmed description of 1–300 Unicode characters.
2. **Prepare photo** retains the registration, upload and attachment UUIDs, description and saved version. Preparation changes no gallery association or draft version.
3. **Upload and verify image** sends the original upload once. The server owns all storage and decoder identifiers. A verified status establishes the sealed image result; it does not attach it.
4. **Add verified photo to draft** creates the original exact-version intent, then explicitly invokes the development finalizer. Intent creation and GET recovery never finalize. The coordinator derives authority from the persisted intent and checks current eligibility, assignment, state, version, expiry, seal, duplicate output and capacity.
5. **Read current gallery** loads a separate current snapshot. Compare it and explicitly use current text/photos or keep local text against current photos. Historical receipts never automatically become a new editing version. Invalid or unsaved text survives this comparison.

Other saved changes and submission stay locked while a photo request is unresolved. Local text remains editable between requests. Keep the tab open: original operation state and unsaved text currently live in memory, with an unload warning. This is not durable browser draft recovery.

Transport uncertainty uses the original registration, upload or attachment GET. The client and UI perform no automatic write retries, new identities, conversion relaunch, version adoption or root rotation. A definite non-uncertain preparation/attachment refusal goes to the current-gallery comparison; upload errors conservatively retain original-status recovery. A confirmed stopped native failure can also permit comparison. Unknown native/finalization work stays blocked. An authorized ready intent recovered before any finalization attempt offers an explicit finish action; an uncertain attempted finalization that still reads ready is not resubmitted.

## Development composition

`apps/api/dev/media-preview.mjs` creates four fixed durable stores, one attempt parent, one attempt journal, one persistent worker admission, one upload journal and one Windows supervisor. The startup configuration is plain trusted data, never request-selected. An existing empty absolute local directory is required. Exclusive owner/resource markers record that root set. Missing, occupied, partial, aliased or ambiguous roots fail closed; shutdown retains all files.

The database and identity remain disposable: local PGlite and ephemeral RS256/JWKS, with a 30-minute token. API and coordinator operations use two fixed separate NOINHERIT/NOBYPASSRLS logins and existing role guards. A single shared queue switches between those restricted logins because PGlite has one session. No database transaction spans body collection or native execution. This is serialized local role evidence, not real PostgreSQL session/concurrency evidence. Native mode begins without fabricated accepted-photo or pending-review fixtures.

To launch, build the shared packages/API and use the existing `dev:staff-preview` script with these explicit environment values:

```powershell
$env:STAFF_PREVIEW_MEDIA_MODE = 'synthetic-native-v1'
$env:STAFF_PREVIEW_MEDIA_ROOT = 'C:\absolute\existing-empty-owned-test-directory'
$env:STAFF_PREVIEW_POWERSHELL_PATH = 'C:\absolute\trusted\pwsh.exe'
npm run dev:staff-preview
```

Use the project's supported Node 24 runtime. The directory must already exist and be empty. This example does not create, clear or reuse a prior root. Retained occupied roots cannot be restarted against a newly disposable database. Investigate unresolved native history using its original root set; creating another root to evade that state is not recovery. The launcher sets `STAFF_PREVIEW_MEDIA=synthetic` only for its Next child and keeps the ephemeral bearer on the server.

## Boundaries and limits

The Next proxy checks development mode, exact loopback Host, preview instance, origin, fetch-site, method, resource syntax and absence of caller-selected Authorization. It reads the original authorized job and expiry before collecting binary bytes. One fixed-size 10 MiB collector skips empty chunks and checks a monotonic 15-second deadline around each read, with cancellation. It then calls the shared binary SDK. The downstream upload API performs its stronger current SQL preflight before iterating the forwarded body and again after collection. **The browser proxy buffers bounded input; this is not end-to-end streaming or a global memory/admission quota.**

Finalization accepts an empty POST only, including Next's empty-stream representation. Neither body metadata nor browser-supplied tenant, principal, job output, seal, accepted status, storage path or receipt can select coordinator authority. API reads before and after one coordinator invocation bind the original tuple and immutable result. Lost command results reconcile through current authorized reads; access loss after invocation preserves uncertainty. Already terminal history returns without another coordinator call.

The SDK snapshots bounded binary input, validates exact response fields/resource identities, rejects raw JSON aliases/duplicate fields and redirects, and preserves write uncertainty through deadlines/cancellation. Existing JSON write semantics stay separate.

Saved image previews remain the next independent boundary: current gallery metadata deliberately has no storage locator. Removed, legacy, unaccepted or unsealed rows must not produce image bytes. Production provider sign-in, durable database/root reopening, crash/all-store restart, retention, global quotas, host isolation/ACLs, real PostgreSQL concurrency, device/accessibility/operator UAT and cutover acceptance remain open. No new paid service was provisioned. KES 10,000 total monthly client price remains the baseline.

See [verification evidence](evidence/2026-10-12-admin-photo.md). Earlier checkpoints are retained and their test counts overlap; do not add them together.
