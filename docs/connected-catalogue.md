# Public web data modes

Default `WEB_CATALOGUE_MODE=demo` uses the selected company's labelled synthetic fixtures. `connected` uses only `/v2/properties` at server-controlled `API_ORIGIN`. Never choose that origin from a request. `TENANT_SLUG` selects the preview brand; the controlled API origin/host selects the protected server company. These must be configured together; the public response itself is not proof of agency identity.

Use HTTPS for connected deployment configuration. HTTP is accepted only for loopback with `ALLOW_LOOPBACK_API=true` and NODE_ENV development or test. Production denies that opt-in. `WEB_CATALOGUE_DATA=synthetic` explicitly labels connected test data; absent/unspecified does not claim live verified stock. No environment value uses a NEXT_PUBLIC prefix. The server-only marker prevents importing the wrapper into client components.

Build packages/API, then start the disposable harness in terminal1:

```powershell
npm run build:packages
npm run build --workspace=@realtor/api
node apps/api/dev/synthetic-preview.mjs
```

In terminal2:

```powershell
$env:WEB_CATALOGUE_MODE='connected'
$env:API_ORIGIN='http://127.0.0.1:4100'
$env:ALLOW_LOOPBACK_API='true'
$env:WEB_CATALOGUE_DATA='synthetic'
$env:TENANT_SLUG='realtime-estates'
npm run dev --workspace=@realtor/web
```

The harness is read-only, loopback-only and disposable; see apps/api/dev/README.md. Startup PREVIEW_SCENARIO is normal, empty or error. PREVIEW_TENANT_SLUG must match the brand being checked. Restart to change startup configuration. No database/provider account is required; no messages, enquiries or bookings are sent.

The current selection is at most100 reviewed public records. UI filters apply locally and disclose possible truncation. Detail uses the same bounded selection; a missing record on a full page is inconclusive. No silent demo fallback, arbitrary image URL or invented location/amenity conversion is allowed. Exact-detail/pagination, trusted media and authenticated editing are remaining work.

`npm test` includes the web adapter/presentation tests and the actual HTTP harness. Do not start Next dev and build against the same .next directory concurrently. Next dev generates AGENTS.md and dev route declarations; the final production build restores production route declarations. Keep browser/device/provider and operator acceptance evidence distinct from these local checks.
