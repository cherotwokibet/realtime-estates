# Hosted browser identity integration

18 November 2026. Tasks 04-3, 04-5 and 05-1 remain open. The implementation now includes a shared OIDC code/S256 provider client, encrypted PostgreSQL browser state, and Node route mounts in both web and admin. This is a deployment prerequisite with executable local integration evidence. It is not a hosted pilot, completed account lifecycle or release acceptance.

## Implemented boundary

Both apps mount POST /auth/login, GET /auth/callback, GET /auth/session and POST /auth/logout. Without explicit hosted settings they return 503 SIGN_IN_UNAVAILABLE and do not allocate a database pool or contact an identity provider. Existing disposable preview sign-in stays separate.

The provider endpoints, client, application origin and company ID come from server configuration. Authorization uses code flow, S256 PKCE, state plus an independent browser binding, and a nonce. A login expires after five minutes and SQL atomically claims its matching state once. Session issuance then atomically checks the claim is still live, creates the encrypted session and links its issuance marker. The callback verifies the ID-token signature, issuer, browser-client audience and nonce, and separately verifies the API access token using the existing fixed RS256/JWKS verifier. Subjects must match. No email linking, provider role claims or posted company IDs grant membership.

Each deployment gets its own HttpOnly, SameSite=Lax, host-only session cookie; HTTPS uses Secure and the __Host- prefix. Only opaque random identifiers enter cookies. Store keys contain a hash of the application origin, company, provider and client; tokens and PKCE values remain on the server. AES-256-GCM encrypts each stored payload and authenticates its scoped key. Editing expiry or moving ciphertext to another key fails decryption/validation. A dedicated identity database login is separate from the ordinary tenant API login. Shared SQL storage supports callback/session reads across instances and server-side logout invalidation. Sessions last at most one hour or the ID-token expiry, whichever is sooner. Access tokens are reverified on authenticate(). There is no refresh-token storage; expiry requires sign-in again.

POST login requires the configured Origin; logout also checks a session CSRF value. Responses use no-store, no-referrer and generic errors. Provider redirects from token/JWKS fetches are refused. GET /auth/session returns only subject, configured company, expiry and CSRF. It never returns the provider token or client secret.

The protocol client is pinned to openid-client 6.9.0. References: [upstream client documentation](https://github.com/panva/openid-client), [OpenID Connect code flow](https://openid.net/specs/openid-connect-core-1_0.html#CodeFlowAuth), and [PKCE S256](https://www.rfc-editor.org/rfc/rfc7636).

## Server configuration and provisioning

Set APP_ENV=staging in an isolated controlled deployment. Each app needs its own browser client and exact applicationOrigin/callback registration. Secrets belong in the host's server-secret manager, never NEXT_PUBLIC variables, source, progress exports or chat.

BROWSER_IDENTITY_CONFIG is a server-only JSON object containing exactly these string fields:

```json
{
  "issuer": "https://controlled-identity.example",
  "authorizationEndpoint": "https://controlled-identity.example/authorize",
  "tokenEndpoint": "https://controlled-identity.example/token",
  "jwksUrl": "https://controlled-identity.example/jwks",
  "clientId": "registered-browser-client",
  "clientSecret": "SERVER-SECRET",
  "apiAudience": "realtor-api",
  "applicationOrigin": "https://controlled-web.example",
  "tenantId": "00000000-0000-4000-8000-000000000001"
}
```

Also set BROWSER_IDENTITY_DATABASE_URL to the dedicated PostgreSQL login with sslmode=verify-full, and BROWSER_IDENTITY_STORAGE_KEY to an independently generated 32-byte secret encoded as 64 lowercase hexadecimal characters. The runtime rejects weaker TLS modes and extra database URL parameters. Install database/proposals/browser-identity-state.sql with a separate migration owner; it is deliberately outside the accepted migration sequence. Grant the dedicated login USAGE on identity and SELECT, INSERT, UPDATE, DELETE on identity.browser_state; it must not own the schema or table. Schedule pruneExpired() using the store adapter. Configure an expiry-cleanup job and reviewed key rotation before hosted use. Changing the storage key invalidates existing state; there is no multi-key rotation implementation yet.

The provider must support client_secret_post, RS256 ID/API JWTs, the existing one-hour access-token constraints, API audience selection via the authorization audience parameter, and same-origin configured endpoints. These are explicit compatibility constraints, not a claim that a candidate provider is configured. The provider subject must map to the replacement database user ID through a reviewed enrollment process. The fictional sample tenant ID in this document is not production company evidence.

## Exact remaining work

1. Confirm the names/ownership of the staging host, PostgreSQL and identity-provider projects. No matching provider connection variables were present in this session; that does not prove Boniface lacks accounts. Existing private Sites dashboard hosting is separate from this Node/PostgreSQL app runtime. No provider purchase, account creation, plan change or production provisioning occurred.
2. Review the standalone identity schema and restricted login on controlled staging PostgreSQL. Validate TLS, concurrent connections, encryption-key custody, expiry cleanup and backup/restore. Current SQL evidence uses disposable PGlite; it does not prove hosted PostgreSQL concurrency or recovery.
3. Connect the shared authenticated-session reader to the customer favourites/account adapters and staff BFF operations. The current Next route mounts support authentication endpoints only. Existing preview bridges still supply their own synthetic identities. Signing in through /auth does not yet authorize those screens. Add usable sign-in/logout navigation and cross-tab cache clearing only with that connection.
4. Ensure current database membership/suspension is checked on every private operation. Verify subject mapping, admin MFA, logout versus in-flight callback/request races, disabled-user revocation, session rotation, distributed login abuse limits and monitoring. Logout now cancels callbacks before or after session issuance at the server boundary; provider-wide logout and upstream credential revocation remain unimplemented. This does not cancel an API mutation that has already been authorized downstream.
5. Complete registration/reset/deletion/provider email flows, then real browser and native-device verification. No device/browser/hosted-provider result is claimed by the Node HTTP tests. Keep Stage 05 and all launch gates open until the full requirements are met.

Continue with item 3 locally while provider account evidence is pending. Keep the old live service and vendor resources available. KES 10,000 per realtor per month remains the total recurring baseline; these changes authorize no new service charges.

## Cancellation and issued-session authority, checkpoint 445

A login record now retains a hashed state match, an atomic claimed flag and a link to its issued session. Logout uses the browser binding to cancel a pending login and revoke any linked session. Starting another login with that binding also cancels the earlier attempt. Every session read requires a surviving issuance marker; deleting the marker denies an orphan even if a concurrent SQL cancellation missed physically deleting a newly inserted session. Expiry cleanup keeps an issuance marker while its linked session remains unexpired. Wrong state cannot consume a legitimate pending login. authenticate() checks session presence again after asynchronous signature verification.

The orphan rule follows from the documented [PostgreSQL Read Committed snapshot behavior](https://www.postgresql.org/docs/current/transaction-iso.html#XACT-READ-COMMITTED): an updating command can wait on one row yet miss newly committed rows elsewhere in its original statement snapshot. This is an implementation inference from that rule, supported by an explicit orphan-state test. It is not a multi-connection hosted PostgreSQL race result. SQL-backed local callback barriers verify logout before issuance and after issuance, before callback completion. Provider-wide revocation, already-authorized downstream operations and real browser/cross-tab behavior still require separate work.

The standalone proposal now includes claimed, state_hash and issued_session_key fields plus a unique issuance-link index. It has not been installed on controlled staging. A deployment that previously installed checkpoint 444's proposal requires a reviewed migration; do not rerun CREATE SCHEMA against it or silently treat the earlier schema as compatible. Hosted environment admission also now rejects every STAFF_PREVIEW_* key and WEB_CUSTOMER_PREVIEW_CONFIG, including empty values.
