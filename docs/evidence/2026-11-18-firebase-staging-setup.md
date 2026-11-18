# Controlled Firebase staging project — checkpoint 448

18 November 2026 EAT. Boniface explicitly authorized a new staging project and completed the official Firebase authentication flow. Native Firebase tools completed the connection; no password, authorization code, refresh/access token or service-account key is retained in source/evidence.

## Remote actions actually completed

- Created **boniface-realtor-staging**, display name **Realtor Platform Staging**, project number **144079064698**. Firebase creation returned success and a separate Google Cloud project read returned ACTIVE with createTime 2026-11-18T20:01:07.412Z. Firebase and Google Cloud share this project; a duplicate project was not created.
- Created two WEB app registrations: Realtor Web Staging (1:144079064698:web:89f61d2a4a0fb52d8675c3) and Realtor Admin Staging (1:144079064698:web:7b448ab47043f0758675c3). A separate app listing returned both ACTIVE. Their SDK configurations were retrieved through the official tool; no public API key or server credential is included in the committed app inventory.
- Added firebase.json containing only the staged Authentication configuration: email/password and Google requested, anonymous disabled. Deployed **only auth** through the native Firebase tool. Job **1795032367763** returned **success, 100%**. There was no independent remote provider-configuration readback and no application sign-in attempt, so deployment success is not a passed login/reset/deletion/MFA test.
- Independent environment reads before and after the auth deployment reported **Billing Enabled: No**, using the relocated maintained workspace and new staging project. No billing link, credit, plan upgrade, Cloud Run deployment, Cloud SQL instance, application Hosting release or storage provisioning was performed. The Firebase creation result included its default empty Hosting site; that is not a deployed platform application.
- The pre-existing rte-realtor-dev project was only listed, then listed again with its original metadata/etag unchanged. No mutation was directed at it. Vendor/live resources and old-system availability are preserved.

## Maintained local artifacts

.firebaserc selects only the new project through default/staging aliases. firebase.json defines only auth deployment. infra/google-cloud/staging.request.json now records the actual created identity and verified billing-disabled state. staging.apps.json records the two app IDs and their project/auth-domain association. The structured receipt is 2026-11-18-firebase-staging-created.json beside this document.

The first active-project update could not persist while firebase.json was absent. get_environment still reported NONE and get_project refused its precondition. Adding the minimal local configuration and explicit aliases corrected this; the subsequent native environment/project readbacks verified the new active project. The failed read was not reported as successful and no duplicate create was attempted.

These are actual controlled-provider provisioning/configuration results. No code tests, positive Firebase token verification, UI/device checks, database installation, backup/restore, hosted concurrency or release gate ran in this configuration-only batch. The 43 focused code checks and two production builds remain dated checkpoint 447 evidence.

## Exact next steps

Continue the shared Firebase client sign-in screen using the registered web/admin SDK configurations and in-memory client persistence; connect its ID-token exchange to the existing server session lifecycle. Then integrate customer/staff adapters with active actor bindings, current company membership, durable original-operation recovery and cache clearing. Obtain the reviewed regional runtime/database/storage/backup/email quote and keyless deployment plan before requesting any billing change. The current runtime still needs Cloud Run/Cloud SQL/Secret Manager composition; Google project creation does not establish that hosting.

Native mobile app registration/signing/device verification, account lifecycle/MFA and all full release requirements remain open. Tasks 04-3, 04-5 and 05-1 remain incomplete: managed secret storage, complete staged deployment identity/migrations/rollback and integrated account lifecycle are not accepted. Tracker stays **55/97**, **0/14 gates**. KES 10,000 per realtor/month remains the recurring baseline.

Provider configuration follows [Firebase's authentication CLI guidance](https://firebase.google.com/docs/auth/configure-providers-cli), scoped with the [auth-only deployment target](https://firebase.google.com/docs/cli#partial_deploys). Project identity follows the [Firebase/Google Cloud relationship](https://firebase.google.com/docs/projects/learn-more#relationship-between-firebase-projects-and-google-cloud).
