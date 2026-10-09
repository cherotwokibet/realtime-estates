# Shared public API client

This zero-runtime-dependency TypeScript package implements only the current `GET /v1/properties` and `POST /v1/enquiries` contracts. It requires Fetch, URL, AbortController and their web-platform types. It is not connected to the web or mobile previews. Staff workflows and authentication UI are outside this package.

```ts
import { RealtorApiClient, ApiClientError } from '@realtor/api-client';

const api = new RealtorApiClient({
  baseUrl: 'https://api.example.invalid', // Trusted agency deployment configuration.
  privacyNoticeVersion: 'reviewed-notice-version',
});
const properties = await api.listProperties({ limit: 20 });

// Generate ONCE when starting the submission and retain with its original body
// until a definite result. Persist both securely if retries span app restarts.
const idempotencyKey = crypto.randomUUID();
try {
  const receipt = await api.submitEnquiry({
    listingId: properties.items[0]?.id ?? null,
    name: 'Example prospect',
    phone: '0700000000',
    message: 'I would like to know more.',
    origin: 'web',
    noticeVersion: 'reviewed-notice-version',
    noticeAcknowledged: true, // Set only after the actual disclosure is shown/acknowledged.
  }, { idempotencyKey });
  // receipt.id means the server saved an enquiry, not that a message was delivered.
} catch (error) {
  if (error instanceof ApiClientError && error.submissionUncertain) {
    // Show an honest pending/unknown outcome. A manual retry must reuse the
    // original key and body; never create a new key to recover from uncertainty.
  }
}
```

Use `allowLoopbackHttp: true` only for explicit local development with `http://localhost`, `http://127.0.0.1` or `http://[::1]`. Configuration accepts an origin only, without credentials, path, query or fragment. All other endpoints require HTTPS. HTTPS configuration is not proof of server ownership: deployment/account/hostname verification remains a launch gate.

Every call may receive `signal`, `timeoutMs` and an explicit `bearerToken`; tokens are never stored as shared client configuration. GET also accepts `limit` (1–100). POST requires a caller-retained UUID idempotency key. There are no automatic retries. A receipt contains only its saved UUID. Notice version must match the configured current version; the server checks its own authoritative version again. The client does not generate notice text or infer consent from the presence of contact data.

Requests use `credentials: 'omit'`, `redirect: 'error'` and `cache: 'no-store'`. Node Fetch redirect behavior has a separate real-HTTP regression suite; controlled transport tests inspect these request flags. Browser and React Native device behavior have **not** been verified here. Before sending any real bearer token or enquiry on a native transport, prove that the exact pinned transport rejects redirects before following them and does not attach ambient credentials. A check of `response.redirected` happens after sending and cannot prevent a noncompliant transport from leaking data. Injected transports must enforce the Fetch contract; this package does not make an unsafe transport safe.

The entire request and body read has a timeout (default 10 seconds, configurable 1–120000 ms). Errors have typed `kind`, optional safe server code, request UUID, status and numeric retry-after seconds. Raw server messages, contact data, tokens and low-level transport errors are not copied into client errors. A POST interrupted after starting, receiving an invalid response or returning a server failure has `submissionUncertain: true`; it may already have committed. Cancellation does not undo a server write. A compliant Fetch implementation is needed to abort underlying network work as well as settle the client promise.

Response validation uses strict field allowlists and immutable returned DTOs. It rejects unknown tenant/private fields, unsafe/invalid KES money, incompatible rental periods and room counts, malformed reviewed photo references and precise coordinates on area-only listings. It fails on malformed pages rather than presenting an empty catalogue. Current flat `amountMinor` and `rentPeriod` map conceptually to the domain's `KesMoney.minorUnits` and rental period; this deliberately narrow wire contract is not full domain convergence. Missing fee fields remain absent/unknown, never assumed zero. Photo keys are opaque references, not URLs: callers must use a separately trusted asset origin. Any wire-shape additions require deliberate client/server version work.

Tenant scoping is the server's responsibility. The client sends no tenant or actor override, and a safe DTO alone cannot prove that a configured hostname belongs to the intended realtor. Authentication verification and database authorization remain server gates.

The response character limit is checked **after** `response.text()` completes; it is a parsing cap, not a streaming download or memory bound. Current API responses have bounded item/photo/text fields. Connecting arbitrary/untrusted servers requires a separately enforced streaming/proxy byte limit. Browser CORS, TLS, persistent credential storage, native redirects/credentials, real provider identity, deployment and actual devices remain unverified.

## Verification

From the repository root after the root workspace manifest/lock has been integrated:

```powershell
npm run build --workspace @realtor/api-client
node --test packages/api-client/tests/transport.test.mjs
node --test packages/api-client/tests/http-transport.test.mjs
npm run build --workspace @realtor/api
node --test packages/api-client/tests/service-integration.test.mjs
```

`transport.test.mjs` tests malformed data, credential flags/per-call tokens, redirect indicators, cancellation/timeouts, notice/key validation and no automatic retries using controlled Fetch responses. `http-transport.test.mjs` uses Node Fetch and ephemeral loopback HTTP servers with synthetic values. `service-integration.test.mjs` runs this client against the actual API handler and migration-backed in-memory PGlite with a nonowner/non-bypass login; it checks tenant isolation, exact money, private projection, durable replay/conflict and stale notices. The latter is an in-process service/database integration, not a live HTTP/cloud/Supabase/provider-auth test. It uses trusted synthetic accepted-media metadata, without testing upload bytes or a media processor. No production data or services are touched.
