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

The adapter is not yet mounted in the development API entry point or the Next browser session exchange. Next work is a Firebase client ID-token exchange into the existing encrypted, cancellation-aware SQL session lifecycle, followed by customer/staff BFF integration and sign-in/logout navigation. Keep browser Firebase persistence in memory and clear the client SDK session after exchange; server cookies remain HttpOnly. Account reset/verification/deletion and browser/native acceptance remain required. See [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens), [session-cookie guidance](https://firebase.google.com/docs/auth/admin/manage-cookies), and [server SDK setup](https://firebase.google.com/docs/admin/setup).

## Access and cost prerequisites

Read-only inspection found no gcloud/firebase executable on PATH, no matching project/credential environment variables, no exposed Google Cloud/Firebase connector and no local project files in the maintained workspace. This is not proof that Boniface has no cloud account. A Firebase/Google Cloud project ID (or confirmation that a new staging project is needed) is pending. Never request passwords or service-account private keys in chat.

The KES 10,000 per realtor/month recurring baseline and KES 6,000 internal external-service allowance remain unchanged. Earlier Supabase/Workers examples are historical comparisons and do not establish the cost of this selected target. Obtain a regional Cloud SQL/Cloud Run/storage/backup/email estimate before provisioning. [Cloud SQL charges depend on instance, CPU/memory, storage and network](https://cloud.google.com/sql/pricing); no free-credit or zero-cost assumption is allowed. Co-locate services after project and region availability/cost review. No region, billable instance, billing link, paid plan, API enablement or deployment was created by this checkpoint.

## Local verification scope

The Firebase adapter's six tests exercise policy using injected SDK responses, actual Firebase Admin rejection of an HS256 token before credentials, and actual disposable SQL binding lookup/revocation. They do not prove Google's cryptographic verification, real Firebase account revocation, ADC access, live sign-in or browser/device behavior. API compilation passed. The API/web/admin production dependency audit reports zero advisories after adding Firebase Admin; the earlier whole-monorepo mobile-toolchain advisories remain unresolved. No previously open checklist item or gate is accepted by provider selection alone.
