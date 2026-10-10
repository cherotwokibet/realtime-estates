# Local synthetic staff preview

`startStaffPreview()` runs the actual API service, RS256 signature/claim verifier, ephemeral loopback JWKS and restricted nonowner PGlite transactions after both migrations. Independently authored fixtures contain no vendor exports, real properties, prospects, provider accounts or credentials. This is a development test harness, **not a login/session implementation**. It refuses `NODE_ENV=production`; both listeners bind only to `127.0.0.1`.

After building the domain and API, import it from a local development launcher:

```js
import {startStaffPreview} from './apps/api/dev/staff-preview.mjs';
const preview = await startStaffPreview({tenantSlug:'realtime-estates',port:4101});
// Hand preview.bearerToken directly to the Next development server's private
// STAFF_PREVIEW_TOKEN environment. Never print it or send it to the browser.
// Stop both loopback servers/database with: await preview.close();
```

The frozen result has `origin`, non-enumerable `bearerToken`, `listingId`, `revision`, `tenantSlug`, `expiresAt`, `acceptedMediaMetadataOnly` and `close`. The token identifies a synthetic assigned agent, expires after **30 minutes**, and is handed only to the calling process. There is no HTTP token/login/refresh endpoint, token file or token logging. Restart the launcher to create a new disposable database, key and token. Keep the token exclusively in server-side environment/configuration; no `NEXT_PUBLIC_*` variable or client component may receive it.

Trusted startup selects `realtime-estates` (default) or `sample-homes`. Default port is 4101; port 0 permits an ephemeral test port. No request query, header or JWT tenant/role claim chooses the company. Authenticated routes are limited to GET/PUT `/v2/staff/listings/{uuid}/drafts/1` and POST its `/submit` suffix. Public reads, enquiry writes, listing creation, approval and membership administration are not exposed. Invalid methods, untrusted Host/absolute-form hosts, query context, cookie credentials and cross-origin requests fail. Server-to-server requests may omit Origin; a supplied Origin must match the API origin exactly. There are no browser CORS grants. The development bridge permits **128 KiB** only for exact v2 draft PUT routes and retains **64 KiB** for other routes. The API independently enforces its body limits, including **4 KiB** for submission, plus content/type/optimistic validation.

Realtime's draft ID is `00000000-0000-4000-8000-000000000400`; Sample Homes uses ending `500`. Each starts at revision 1, state `draft`, version **`"2"`**. Realtime's separate peer-assigned draft ends `401` and is inaccessible to the default agent. Base is KES 20,000/month, mandatory recurring service 1,000, refundable deposit 20,000 and one-off preparation 500: known recurring 21,000/month and known initial 41,500. Structured location is `Nairobi` / `Synthetic Nairobi town` / `Synthetic preview area`; coordinates are null and the private address is explicitly synthetic. A successful save returns the next version; use that version on subsequent saves/submission. Submission means **pending review**, never published.

By default the fixture explicitly seeds four accepted **synthetic media metadata rows**, with no image bytes, checksum verification, uploaded-file processing or owner/advertising-rights proof. Passing `seedAcceptedMedia:false` omits that fixture and submission must fail its actual SQL media gate. No upload endpoint or actual media processor is supplied. Connected UI must identify this local synthetic condition and must not advertise a verified real publication journey.

Tests may select synthetic `actor:'customer'`, `'revoked-agent'` or `'other-company-agent'` at trusted startup to obtain genuinely signed tokens whose current database authorization must deny access. This is in-process fixture construction only; there is no browser-selectable identity switch. Normal launchers should keep the default assigned agent.

Run `node --test apps/api/dev/staff-preview.test.mjs` from the repository root after building `@realtor/api`. Owned checks exercise real HTTP/JWKS, signature rejection, private draft reads, save/reload/conflict, current membership/assignment/company denial and metadata-dependent submission. They do not establish a deployed provider, MFA/session revocation, production PostgreSQL/PostGIS/pooling/TLS, real media handling, operator acceptance or real-device readiness.
