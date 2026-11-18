# Google Cloud/Firebase adoption — checkpoint 446

18 November 2026 EAT. Boniface answered the staging-provider question: "use google cloud firebase , use your best judgement". The maintained target is now Firebase Authentication, Cloud Run Node services, Cloud SQL PostgreSQL and private Cloud Storage. KES 10,000 per realtor/month remains the recurring client baseline. No service was provisioned, no paid API enabled, no billing/credits/plan changed and no vendor/live resource modified.

## Implementation and evidence

- Added pinned Firebase Admin 14.5.1 and a dedicated server identity verifier. Firebase's Google key origin differs from its token issuer; the generic OIDC same-origin verifier remains restricted. No arbitrary cross-origin key exception was introduced.
- The Firebase adapter requests revoked/disabled-user checking, pins project and optional Identity Platform tenant, requires verified email and nonanonymous identity, validates token time bounds, optionally requires recent sign-in, and refuses auth emulator activation. Provider role/company claims do not become permissions.
- Added an explicit project/auth-tenant/UID to internal actor UUID mapping with a read-only SQL resolver. The standalone table proposal is outside accepted migrations; enrollment and grants remain unperformed. Binding is independent of company membership, which private operations must still check.
- API TypeScript compilation passed. **37 focused tests passed, zero skips/failures:** 31 existing identity/session checks plus six Firebase cases. Most Firebase policy cases use injected SDK responses. One actual Firebase Admin negative test rejects HS256 without credential lookup or actor mapping. One test runs actual disposable SQL for exact binding isolation and active-flag revocation. See 2026-11-18-firebase-identity-tests.txt.
- API/web/admin production dependency audit reports zero advisories; JSON is retained. Earlier whole-monorepo mobile-toolchain advisories remain unresolved. Install-time warnings listed unapproved optional dependency scripts for @firebase/util/protobufjs; no script approval was issued. SDK import, compilation and the above tests passed.
- No accessible GCP/Firebase connector, CLI on PATH, project/credential environment names or maintained project configuration was found. This does not establish whether Boniface owns cloud accounts. Project ID or confirmation of a new staging project was requested without asking for secrets.

## Actual limits and next work

No real Firebase token, live Google project, ADC permission, SDK user revocation, hosted PostgreSQL race, browser sign-in or native-device check passed here. The new adapter is not mounted in the API entry point or Next session exchange. Do not describe the existing generic OIDC routes as a working Firebase login. Full API suite and Next builds were not rerun for this unused adapter/dependency addition; checkpoint 445 retains the prior build evidence.

Next implement Firebase client ID-token exchange into the existing encrypted/cancellation-aware SQL session lifecycle, then connect customer/staff BFFs and usable navigation/cache clearing. Resolve the controlled project ID, reviewed regional cost and workload identity before provisioning. The selected Google stack has no verified price yet; earlier Supabase/Workers examples are historical comparisons. [Google Cloud/Firebase target and configuration](../google-cloud-firebase.md) records the official references and required work.

Checklist stays 55/97 and all 14 gates open. Provider selection and local adapter tests do not complete identity, staging or release deliverables.
