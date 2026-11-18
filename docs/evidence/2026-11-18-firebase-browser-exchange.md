# Firebase browser exchange and staging request — checkpoint 447

18 November 2026 EAT. Boniface selected a new staging project, reported signing into Firebase/Cloud Console in the ChatGPT in-app browser, and explicitly instructed us to create the new projects and continue. Creation authorization is recorded; no project or billable service has been created.

## Implemented backend

Firebase browser ID-token exchange now reuses the encrypted SQL state store and cancellation authority. POST /auth/login creates a browser-bound, five-minute one-use state. POST /auth/firebase accepts only bounded, exact JSON containing state and ID token, verifies recent Firebase authentication plus active internal actor binding, and creates an opaque HttpOnly/Secure cookie. No provider token is returned in a browser-session response. GET /auth/session rechecks the token/binding and only returns account/CSRF metadata. POST /auth/logout cancels pending issuance and removes the current session. authenticate() returns verified actor, configured company and server-only bearer after rechecking session authority following asynchronous verification.

Web/admin's shared Node runtime now selects this path with explicit FIREBASE_BROWSER_CONFIG. It refuses mixed OIDC/Firebase setup, emulator/preview configuration and unsafe database settings. The generic OIDC alternative remains isolated; its Google-key-origin restriction has not been weakened. Firebase role/company claims do not authorize private operations. The public API entry point remains development-only, and customer/staff BFF integration and Firebase client SDK screens remain unfinished.

## Verification actually run

- API TypeScript compilation passed.
- **43 focused checks passed, zero failures/skips.** New exchange cases run actual disposable SQL session/actor-binding tables with injected Firebase SDK claims. They cover successful exchange and opaque cookies, cross-instance session use/logout, changed actor binding, query-bearing server authentication, revoked/unverified/old/wrong-project identities, forged state, duplicate JSON, oversized body, company/origin mismatch, replay and logout barriers before/after issuance. The actual Firebase Admin negative HS256 test remains included. See 2026-11-18-firebase-browser-tests.txt.
- Both Next production builds passed with the Firebase-aware runtime imported by their actual auth route mounts. Logs are retained. Whole API suite was not rerun for this batch; no browser UI, Google cryptographic acceptance, real Firebase project, ADC permission or hosted database check is claimed.

## Project creation access

Tool discovery did not expose control of the signed-in in-app tabs; their supplied page snapshot had no readable document. The Windows Computer Use helper opened Edge separately, then lost its binding with `foreground window did not report a process id`; recovery returned no Edge window. No Google/Firebase project form was submitted through Windows, and no authentication dialog or Codex UI was automated.

Plugin discovery initially found the official Firebase integration available but not installed. It was suggested, and a later search confirmed it IS installed/enabled. Its account connection is not confirmed and no Firebase management tool is exposed yet. Setup then verified Node 24.19.0 and Firebase CLI 15.36.0. login:list returned no authorized accounts. The login command printed its completion flow but exited with a Windows libuv UV_HANDLE_CLOSING assertion before authorization. No authorization code or credential was received or persisted in evidence. Boniface was asked to complete CLI sign-in locally and reply done, without sending secrets. This account connection, rather than another creation-authorization question, is the current dependency. Never claim the in-app sign-in alone proved accessible account/project management. Do not inspect browser credentials or cookies to bypass it.

The reviewable request is infra/google-cloud/staging.request.json: proposed name Realtor Platform Staging, preferred ID boniface-realtor-staging (availability unverified), synthetic data, no billing link or Analytics requested. One Firebase-enabled Google Cloud staging project is intended: [Firebase and Google Cloud share the same project](https://firebase.google.com/docs/projects/learn-more#relationship-between-firebase-projects-and-google-cloud). Do not create duplicate infrastructure to represent the same staging environment.

## Exact continuation

Once Firebase account authentication is confirmed (installation is already confirmed), inspect its project/account tools and create the authorized isolated staging project without linking billing or changing live/vendor resources. Record its actual ID/number and returned state before using it. No further creation-permission question is needed; Boniface already authorized it. Native approval/tool requirements still apply. A regional Cloud SQL/Cloud Run/storage/backup estimate remains required before billable setup.

Continue local work on the Firebase client sign-in screen and customer/staff BFF integration, including durable retained-operation state, current membership, cache clearing and exact lost-response recovery. Do not enable existing in-memory synthetic bridges in production. API hosting, account lifecycle/MFA, provider/device/browser/hosted verification and all 14 gates remain open. Checklist stays 55/97. KES 10,000 per realtor/month and the old live system are preserved.
