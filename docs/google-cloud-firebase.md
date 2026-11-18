# Google Cloud and Firebase delivery target

18 November 2026. Boniface selected Google Cloud/Firebase and authorized routine implementation choices using our best judgment. This supersedes the earlier unselected provider candidates as the current technical target. It does not authorize spending, changing plans, using credits, changing vendor resources, or production cutover. The old live system remains available.

| Surface                 | Selected direction                                                               | Current status                                                                       |
| ----------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Customer/staff identity | Firebase Authentication, initially Google and email/password with verified email | Project/provider setup and real sign-in remain pending                               |
| Web/admin/API           | Separate Cloud Run Node services, one maintained configurable source             | Existing Next builds pass; deployable API adapter and controlled hosting remain open |
| Business data           | Cloud SQL for PostgreSQL, retaining the existing restricted SQL/RLS model        | No database instance provisioned or cost accepted                                    |
| Media                   | Private Google Cloud Storage with the existing authorization/provenance boundary | Hosted provider integration and restore remain open                                  |
| Server credentials      | Cloud Run service identity/Application Default Credentials and Secret Manager    | No downloaded service-account key or secret committed                                |
| Mobile                  | Existing configurable Expo app using the same Firebase project/identity boundary | Native Firebase sign-in/device verification remain open                              |

Cloud Run/Cloud SQL integration follows the [official connection guidance](https://cloud.google.com/sql/docs/postgres/connect-run). The private delivery dashboard remains its existing separate Site and is not the platform database/API host. Firestore is not required for the SQL-backed business model.

## Firebase-specific identity work

Firebase is not a drop-in configuration for the earlier generic OIDC code client. Firebase ID tokens use the project ID as audience, an issuer under securetoken.google.com, and Google-managed public keys on a different origin. The existing generic verifier deliberately forbids arbitrary cross-origin key configuration. Its trust boundary has not been weakened to accommodate Firebase.

The new apps/api/src/firebase-identity.ts uses pinned Firebase Admin 14.5.1 and verifyIdToken(token, true), including the SDK's revoked/disabled-user check. It pins project/optional Identity Platform auth tenant, requires verified email, rejects anonymous sessions, validates token time bounds and can require sign-in within five minutes before session exchange. It explicitly rejects Firebase Auth emulator activation. Roles/company IDs in token claims do not authorize platform access.

Firebase UIDs need not be PostgreSQL actor UUIDs. A trusted, active binding maps project/auth-tenant/UID to the internal actor. The read-only SQL resolver and database/proposals/firebase-actor-bindings.sql implement that boundary without assigning company membership or implicitly linking by email. Binding writes/enrollment need a separate reviewed administrative role. Existing company membership and resource policy must still be checked by the API on every private operation.

The Firebase-aware Next auth runtime now supports ID-token exchange into the existing encrypted, cancellation-aware SQL lifecycle. The adapter remains unmounted in the development API entry point; Firebase client screens, customer/staff BFF integration and usable navigation remain open. Keep browser Firebase persistence in memory and clear the client SDK session after exchange; server cookies remain HttpOnly. Account reset/verification/deletion and browser/native acceptance remain required. See [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [session-cookie guidance](https://firebase.google.com/docs/auth/admin/manage-cookies), and [server SDK setup](https://firebase.google.com/docs/admin/setup).

## Access and cost prerequisites

Read-only inspection found no gcloud/firebase executable on PATH, no matching project/credential environment variables, no exposed Google Cloud/Firebase connector and no local project files in the maintained workspace. This is not proof that Boniface has no cloud account. Boniface subsequently confirmed a NEW staging project and explicitly authorized creation. He reports signing in to both consoles in the in-app browser. No project has been created. The official Firebase integration is now confirmed installed/enabled. Account authentication remains missing: Firebase CLI 15.36.0 login:list returned no authorized accounts, and agent-side login exited with a Windows libuv assertion. Boniface has been asked to finish CLI sign-in locally and reply done without sending secrets. Signed-in in-app tab control is not exposed to this session. The reviewable request is infra/google-cloud/staging.request.json; do not ask creation permission again. Never request passwords or service-account private keys in chat.

The KES 10,000 per realtor/month recurring baseline and KES 6,000 internal external-service allowance remain unchanged. Earlier Supabase/Workers examples are historical comparisons and do not establish the cost of this selected target. Obtain a regional Cloud SQL/Cloud Run/storage/backup/email estimate before provisioning. [Cloud SQL charges depend on instance, CPU/memory, storage and network](https://cloud.google.com/sql/pricing); no free-credit or zero-cost assumption is allowed. Co-locate services after project and region availability/cost review. No region, billable instance, billing link, paid plan, API enablement or deployment was created by this checkpoint.

## Local verification scope

The Firebase adapter's six tests exercise policy using injected SDK responses, actual Firebase Admin rejection of an HS256 token before credentials, and actual disposable SQL binding lookup/revocation. They do not prove Google's cryptographic verification, real Firebase account revocation, ADC access, live sign-in or browser/device behavior. API compilation passed. The API/web/admin production dependency audit reports zero advisories after adding Firebase Admin; the earlier whole-monorepo mobile-toolchain advisories remain unresolved. No previously open checklist item or gate is accepted by provider selection alone.

## Firebase browser exchange configuration, checkpoint 447

FIREBASE_BROWSER_CONFIG is an explicit server-only JSON object with projectId, applicationOrigin and tenantId string fields, plus optional authTenantId for Identity Platform. applicationOrigin must be the exact HTTPS deployment origin; tenantId is the server-configured realtor company UUID. Do not add loopback/emulator flags or combine it with BROWSER_IDENTITY_CONFIG. APP_ENV must be staging or production. The dedicated BROWSER_IDENTITY_DATABASE_URL (TLS verify-full) and BROWSER_IDENTITY_STORAGE_KEY remain required. Cloud Run/Cloud SQL connector composition and its workload identity still need implementation/hosted proof; a generic URL setting alone does not establish that connection.

POST /auth/login returns a browser-bound state and cookie. A client using Firebase in-memory persistence sends its fresh ID token and that state as exact JSON to POST /auth/firebase, then clears the client Firebase session. The server stores the token only as encrypted state and sets an opaque browser cookie until token expiry (at most one hour). GET /auth/session and server authenticate() recheck Firebase revocation plus the internal actor binding. POST /auth/logout requires Origin and the session CSRF header, cancels an in-flight exchange and clears cookies. No refresh token is stored. The Firebase client SDK screen itself is not implemented by this backend batch.

The new staging project will be one Firebase-enabled Google Cloud project, with separate production isolation later. The preferred ID is not an allocated or verified project ID. Creation remains technically dependent on Firebase account authentication (the integration is installed), not on further user approval. No billing link, Analytics property or billable database/service is authorized by the request artifact.

## Native management connection follow-up

The official Firebase management tools are now exposed. Their environment initially pointed at the obsolete OneDrive directory; it has been corrected to the relocated maintained workspace. The native environment reported no authenticated user or active project. An official Firebase login flow is pending; its one-time code must be completed through firebase_login. This replaces the earlier local CLI sign-in request. Project creation is already authorized; do not ask for installation, CLI setup or creation permission again. No project, billing link, Analytics property or Gemini consent was created by this connection check.

## Actual controlled staging, checkpoint 448

Native authentication and project creation succeeded. The active project is boniface-realtor-staging (144079064698), independently read ACTIVE with billing disabled. Two WEB app registrations are ACTIVE; infra/google-cloud/staging.apps.json records their IDs. Auth-only deployment job 1795032367763 returned success for Google/email-password with anonymous disabled. No application sign-in or provider-config readback is claimed. This section supersedes the earlier pending-connection/project statements, which remain chronological history. .firebaserc and firebase.json select only the new project; rte-realtor-dev remains untouched.

Continue client sign-in/BFF integration and cost/keyless hosting preparation. Do not repeat account login or creation permission requests. Cloud Run, Cloud SQL, storage/backup, managed secrets and application deployment remain unprovisioned by this session. Billing remains unlinked; the project is not a passed hosted pilot or release gate.

## Shared client screen, checkpoint 449

Web/admin now mount the same client at /sign-in. FIREBASE_WEB_CONFIG is JSON containing exactly apiKey, authDomain, projectId and appId from that app's native get_sdk_config result. Only the validated public DTO enters client props; project/default Firebase auth-domain must match server FIREBASE_BROWSER_CONFIG. Optional Identity Platform tenant comes from trusted server settings. Do not put service-account/database/encryption credentials or preview flags in this DTO. Missing/invalid setup renders an unavailable screen. The runtime config remains server-only and requires the existing isolated APP_ENV and TLS database settings. No env file was created or overwritten by this checkpoint.

The client performs Google popup or existing-account email/password sign-in with explicit in-memory persistence, exchanges the fresh token/state once and clears the SDK instance. It does not create accounts, reset passwords, enroll actor bindings or grant company roles. Customer/staff BFFs and private-screen cache invalidation still need integration. See evidence/2026-11-18-firebase-client.md for test/dependency limitations; no hosted/browser acceptance yet.
