# Synthetic connected preview

This independently authored development fixture runs the **actual API service and both SQL migrations** against disposable in-memory PGlite. API transactions use a checked nonowner/non-bypass login and `SET LOCAL ROLE api_runtime`. It reads no vendor exports, provisions no account and contains no real customers, property photos, credentials or provider identity. It refuses `NODE_ENV=production` and listens only on `127.0.0.1`.

Build the domain and API first, then from the repository root:

```powershell
npm run build --workspace @realtor/domain
npm run build --workspace @realtor/api
$env:NODE_ENV = 'development'
$env:PORT = '4100'
$env:PREVIEW_TENANT_SLUG = 'realtime-estates'
$env:PREVIEW_SCENARIO = 'normal'
node apps/api/dev/synthetic-preview.mjs
```

GET `http://127.0.0.1:4100/v2/properties` or `/health`. The unchanged v1 property projection is also available. Configure the server-side web adapter with `API_ORIGIN=http://127.0.0.1:4100` and its explicit development loopback opt-in. No browser CORS permission is supplied. Stop with Ctrl+C; restarting recreates the synthetic data.

Tenant (`realtime-estates` or `sample-homes`) and scenario (`normal`, `empty`, `error`) are selected **only at startup**. Restart after changing them. `empty` pauses that configured company's synthetic stock through the runtime RPC, leaving the other company's seeded row isolated. `error` makes the actual service's database boundary return a controlled unavailable error; it is not evidence of a real provider failure. Query parameters cannot choose tenant/scenario. Unknown hosts/routes/query fields and all writes/credentials are refused. Only property reads and a synthetic health response are exposed.

| Fixture | Stable ID ending | Expected disclosure |
|---|---|---|
| `synthetic-monthly-studio` | `000000000100` | KES 20,000/month + mandatory service 1,000 + refundable deposit 20,000 + one-off fee 500 → known recurring 21,000/month, known initial 41,500. Complete mandatory declaration. Optional parking 300/month and an optional quote stay separate. |
| `synthetic-sale-apartment` | `000000000101` | Base KES 999,999 + known mandatory fee 1,500 → known initial subtotal 1,001,499, with an additional mandatory quote and incomplete disclosure. County/town/area explicitly null; legacy locality remains available. |
| `synthetic-other-company-studio` | `000000000200` | Sample Homes only: KES 33,000.01/month, undeclared costs and partially unknown structured location. It must not appear in Realtime's configured service. |

All IDs use prefix `00000000-0000-4000-8000-`. Four accepted **synthetic metadata rows** per listing satisfy the publication fixture. No image bytes exist at their `synthetic-preview/...` keys; connected screens must show a truthful missing-media state, without substituting sample photographs. Synthetic self-approval is audited but does not prove property verification, advertising rights, file processing, real authentication or operator acceptance.

Smoke verification: build `@realtor/api-client`, then run `node --test apps/api/dev/synthetic-preview.test.mjs`. Tests use actual loopback HTTP Fetch, the shared v2 client, restricted transactions and the real service. They do not prove hosted PostgreSQL/PostGIS, CORS/TLS, live provider compatibility, real device behavior or production readiness. This harness supports a bounded list, not server-side full-catalogue search or a single-listing detail endpoint.
