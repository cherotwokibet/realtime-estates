# Local development and verification

Use Node24.19.0 and npm. Run from repository root:

```text
npm ci
npm test
npm run typecheck
npm run build:web
npm run dev:web
npm run dev:admin
npm run dev:mobile
```

Web runs on localhost3000; admin3001. API: npm run build --workspace=@realtor/api then npm start --workspace=@realtor/api (loopback4000). Default API_MODE=demo provides health and synthetic catalogue only. API_MODE=database requires all server-only configuration shown in .env.example, a controlled fresh database with the migration installed, a dedicated runtime login, configured HTTPS issuer/JWKS/audience and a reviewed privacy-notice version. Startup refuses an unsafe database login. This development HTTP bridge refuses NODE_ENV=production; deployment, distributed abuse controls and provider verification are separate work.

The actual API handler persists enquiries and staff listing drafts/submissions through parameterized PostgreSQL command functions. Its tests use disposable PGlite databases, real migrations and restricted runtime roles. JWT tests use real signatures and an ephemeral key endpoint. These local checks do not establish a deployed provider session. Public web/admin/mobile previews still use labelled synthetic data; their enquiry forms and staff writes are not yet connected to that API. See apps/api/docs/service-boundary.md and auth-boundary.md for exact routes and gaps.

Company configuration uses TENANT_SLUG, currently realtime-estates or sample-homes for synthetic reproduction. Set it before web/admin build or mobile export; invalid and inherited object-property names fail closed. Mobile app.config.ts validates the same registry and changes preview display name, scheme and platform IDs; Expo runtime reads its built configuration. These are development identities, not verified store identities. This context is not authentication. Database mode resolves exact hostnames against TRUSTED_TENANTS_JSON; request bodies/headers/JWT role claims grant no company access.

The shared domain package holds business types, validation and pure rules in one place. Demo DTO priceMinor maps to KesMoney.minorUnits; both represent integer KES cents. The development fixture contract will be replaced by versioned API DTOs. Domain tests and SQL-policy tests are distinct from deployed authentication, browser, device and UAT evidence. CI definition is supplied but cannot be claimed remotely passing until a controlled remote is configured and a run actually completes.

The seventh workspace, packages/api-client, now validates the existing database-mode `/v1/properties` and `/v1/enquiries` wire contracts. It sends no company/actor overrides, retains no bearer token between calls and never automatically retries an enquiry. A caller must retain the original UUID idempotency key and body if the result is uncertain. Root `npm test` runs its controlled transport, actual Node HTTP and actual API/PGlite tests after building the API. Its README records exact limits: browser/native transport and CORS are unverified, fees remain absent/unknown in the current wire DTO, and the response size check is a post-read parsing cap. Prove the pinned native transport rejects redirects before sending any real enquiry or credentials. The demo endpoint `/v1/demo/properties` has a separate fixture format and is intentionally not a fake persistent fallback for this client.

Versions were checked against official registry metadata and the [Expo SDK compatibility matrix](https://docs.expo.dev/versions/latest/) on9 October2026: Expo57 uses React19.2.3/RN0.86, so use RN0.86.3 bundled with Expo57.0.27 rather than standalone latest0.87.1. Next16.4.0 is pinned; TypeScript5.9.3 is a deliberate supported compiler baseline, pending evaluation of the newly released compiler major7. The lockfile pins transitive dependencies; no force/legacy peer overrides are used.

Docker CLI is installed but its Linux daemon was unavailable during initial setup. SQL-policy verification uses PGlite where supported; record that limit and run real PostgreSQL/PostGIS migration/restore/load checks before staging acceptance. No existing database is contacted by local tests.

Hosting compatibility remains a separate decision. The local Node `pg` adapter requires a PostgreSQL connection and has not been tested in the budget's Workers candidate. The private delivery dashboard is static Sites hosting; that does not establish that this API adapter can run there. Select and verify a supported provider/HTTP/transaction adapter inside the KES6,000 external-services allowance before provisioning; do not silently add a separate paid server or claim the illustrative US$30 floor deploys this exact implementation.
