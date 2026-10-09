# Identity verification and company context boundary

9 October 2026. This adapter is independently written replacement code. It verifies real JWT signatures in tests using ephemeral local keys; it does not establish a deployed sign-in provider, working account registration, password reset, MFA, session revocation or production authorization.

## Trusted configuration

`createIdentityVerifier({ issuer, audience, jwksUrl })` returns an asynchronous function accepting a compact bearer JWT. `parseBearerHeader(request.headers.authorization)` strictly extracts that token and rejects absent/duplicate/malformed headers. Errors expose a generic 401 identity failure without payloads, tokens, key details or upstream diagnostics.

The issuer and JWKS endpoint must be explicitly configured server-side HTTPS URLs on the same origin, with no credentials, query, fragment or wildcard. Audience is one explicit non-wildcard value. Configuration is captured at construction. No request header, posted body, JWT issuer, `jku`, embedded key or role claim chooses the trusted endpoint. This initial same-origin restriction intentionally excludes identity providers whose documented JWKS lives on another origin; supporting one requires an explicitly reviewed endpoint allowlist change.

Only **RS256** is accepted. Require `kid`, `iss`, `aud`, `sub`, `iat` and `exp`; check the exact issuer and intended audience, current expiry/not-before, nonblank subject, integral issued/expiry timestamps, token age at most one hour and validity interval at most one hour, with zero clock tolerance. Provider access-token settings must match these choices before integration. HTTPS authenticates the configured key origin; the adapter does not provision or approve the provider account itself.

`jose` supplies the [JWT signature/claim verification](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md) and [remote JWKS resolver](https://github.com/panva/jose/blob/main/docs/jwks/remote/functions/createRemoteJWKSet.md). Key retrieval is bounded to five seconds, keys cache for up to ten minutes, and an unknown key is denied with a thirty-second refetch cooldown. Redirects are not followed. Key/network/format/signature failures deny identity. Cached valid public keys may continue verifying tokens within cache life during a provider outage; this is not an immediate session/account revocation mechanism.

The sole result is `Object.freeze({ actorId: verifiedSubject })`. Roles, tenant claims, user metadata and posted memberships are ignored. Protected operations must separately query current trusted company memberships and resource assignment/ownership in the database, including account suspension. A valid JWT alone is never authority to edit a listing or export leads. The provider's subject must be consistently mapped to the replacement user ID; no email-based implicit linking is implemented here.

## Company resolution

`createTenantResolver(trustedConfigurations)` maps explicit hostnames to `{ tenantId, slug, hostnames }`. It rejects unknown/malformed hosts, wildcard configuration, collisions and duplicate IDs. Hostname matching is case-insensitive, exact and does not accept subdomain suffix matches. Request host may include a valid numeric port; configuration contains hostnames without ports. Returned configuration and hostnames are immutable copies.

Host selects company context only. A caller can send a Host value for another known company, so every private query/write must still check the verified actor's current membership and target resource in that company. This resolver has no `X-Tenant`, posted tenant ID or forwarded-host privilege path. An eventual reverse proxy must validate allowed hosts and explicitly govern forwarding; do not substitute arbitrary `X-Forwarded-Host` into this resolver. Private authorization belongs in trusted SQL/API policy, not browser-selected IDs.

## Local verification and remaining gates

Tests generate ephemeral RSA keys in memory and expose only their public JWKS on an OS-assigned `127.0.0.1` port. `allowLoopbackHttpForTests: true` enables HTTP only for localhost/loopback issuer and JWKS, and is rejected when `NODE_ENV=production`. No external identity endpoint, credential, account or secret is used. Tests cover genuine signatures, expired/future/missing claims, wrong issuer/audience, counterfeit signatures, HS256 confusion, unknown keys, unsafe configuration, remote-key failures/redirects and strict company resolution. The test-only server is closed after execution.

Before production: select a Boniface-controlled identity provider/project; confirm RS256 support, exact issuer/audience/JWKS and subject mapping; integrate membership/resource policies and revocation behavior; implement account lifecycle and administrator MFA; add rate limits, monitoring without token logging, safe error-to-HTTP mapping and end-to-end browser/mobile tests; run rotation/outage/deactivated-user and cross-company API/database denial tests. No provider purchase, deployment, sign-in credential, production migration or live account action occurred through this implementation.
