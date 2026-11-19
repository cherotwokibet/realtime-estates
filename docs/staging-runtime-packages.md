## Verified Linux CI, PostgreSQL and containers — checkpoint 456, 19 November 2026 EAT

Source 7718aaaf4f9e1949f461b9bcb77bf4126369ec6d passed complete GitHub Actions run 44462854182: all four test groups covering every command in the unchanged canonical npm test suite, workspace type checks, production web/admin builds and Android export. Platform-specific skips remain recorded in the logs; Android export is not a device test. Seventeen local planner/coverage/package safety checks passed. Ordinary included November CI is available; the stale October quota hold is superseded. Source history is pushed to the existing private origin, whose private visibility was independently confirmed. A fresh shallow source clone and git fsck passed; this is not a database/media restore.

New real PostgreSQL 17.12 TCP coverage passed all seven tests, including two distinct backend connections, concurrent original replay/version conflict, rollback, actor revocation and pooled tenant/role cleanup. The disposable CI migration used its test administrator, so managed Cloud SQL non-superuser migration bootstrap and IAM membership attestation remain unverified.

Linux runtime verification passed fourteen detached HTTP/SSR/static profiles and server SDK imports. Three pinned non-root Node images built and imported SDKs; configured web/admin containers served SSR/static and refused the private-origin probe at 512 MiB/one CPU. Missing API configuration refused as expected. Positive API database startup, Cloud Run deployment, real Google sign-in, managed IAM/SQL, device/UAT and cutover are not accepted by these results.

Exact logs and complete run/job/step receipt: docs/evidence/2026-11-19-ci456-*. The old 30-minute serial timeout was fixed through four isolated test runners with explicit dependency builds and a required success gate, preserving every canonical test command. The first isolated preview run exposed a missing compiled web helper; that prerequisite was fixed and the exact replacement run passed. Earlier prepared/pending and failed-run notes below are historical.

Next: pending explicit approval for docs/staging-billing-proposal.md (synthetic Iowa plan, about USD15/month before tax/FX; USD25 alerts-only planning budget, not a spending cap). Billing remains disabled. Do not provision paid resources or assume silence is consent. Before hosted acceptance, inspect actual managed SQL role attributes/membership and verify non-superuser migration bootstrap without weakening runtime attestation. Then run the hosted customer/admin-branch pilot; keep full staff/mobile/account lifecycle scope. Maintain 55/97 verified full deliverables, all fourteen launch gates open and KES10,000 per realtor/month. Preserve browser notes, exports and the old live system. No billing/account/plan/credit/vendor/live configuration change occurred.

# Local staging runtime packages

These scripts prepare reviewable, platform-specific runtime directories for the separate API, web and admin services. They do not publish, provision a resource, install migrations, grant IAM access, enable billing or accept a launch gate.

Build from the maintained repository with Node 24 and the pinned lockfile. First build packages/API and both Next applications:

    npm ci
    npm run build:web
    node scripts/stage-runtime-packages.mjs

Use a reviewed clean checkout for release candidates. The packaging command creates a unique directory under .staging-artifacts and prints its path and summary as JSON. It never replaces an earlier candidate. Copy the returned directory path into:

    node scripts/verify-runtime-packages.mjs <returned-directory>

This verifier checks file inventories and copies each service into a new detached OS temporary directory. It imports required server SDKs from that directory, requires missing API configuration to refuse with a generic message, and runs the existing fourteen local production HTTP/SSR profiles against the standalone web/admin entry points. It fetches a built static asset in every profile. No source-checkout dependency resolution is allowed for the checked SDKs; NODE_PATH is removed for children. Temporary verification directories remain available for inspection. No recursive cleanup or progress-export move is performed.

Next configuration uses output=standalone with the monorepo tracing root. Google auth/Cloud SQL, Firebase Admin and PostgreSQL are explicit server externals, preserving their Node package/module behavior. The packager adds public and .next/static assets omitted by Next's minimal output. Windows junctions are materialized as regular files after checking that their targets remain within the source root; cycles and escaping links refuse.

The API uses the pinned Next distribution's file tracer on its compiled hosted-index entry point. Workspace import aliases are materialized from the traced package files, including subpath-only imports such as @realtor/media/upload-body. It excludes development source, migrations, test/evidence folders, vendor archives, uploads, mobile application files and local configuration by path policy. New/unreviewed trace warnings stop packaging. The reported exceptions are optional pg-native, the non-Node cloudflare:sockets branch, and gRPC LICENSE text parsed as code by tracing. These warnings remain in the API manifest; they are not missing live-runtime acceptance evidence.

Each service has an external JSON inventory containing relative paths, byte counts and SHA-256 digests. The summary records inventory digests, entry points, source commit/dirty state, Node version, OS/architecture and lockfile digest. Verification rejects altered bytes, extra/missing files and runtime links. The output refuses environment files, selected credential filenames, signing-file extensions and complete PEM private-key blocks. This is not a general secret detector: review compiled public configuration and source provenance, and keep actual secret values out of build inputs. Inventory digests detect changes relative to the reviewed manifest; they are not a signature or proof of a reproducible/fresh build.

Commands must run from the relocated realtor-platform directory. Output includes only generated runtime assets and the traced closure, with platform native dependencies from the build host. The locally verified Windows/x64 candidates must not be copied into a Linux Cloud Run container. Rebuild and repeat all checks in a controlled Linux environment, pin/review the base image and record image digests before any deployment claim. Local Docker remains stopped. Linux image/container checks subsequently passed in owned disposable GitHub CI at checkpoint 456, as recorded above; hosted deployment remains pending.

Entrypoints inside each service directory are apps/api/dist/hosted-index.js, apps/web/server.js and apps/admin/server.js. The web/admin servers accept PORT and HOSTNAME; bind the reviewed deployment interface when packaging for a controlled service. API startup still requires valid staging policy, fixed HTTPS origin, Firebase project and ordinary-role database connectivity. The verifier proves only refusal without configuration, not positive database startup. Existing staging configuration, Cloud SQL IAM and private Cloud Run invocation requirements continue to apply.

Remaining release work includes a clean Linux rebuild/container run, actual Google ADC/token refresh/invoker-denial proof, managed Cloud SQL role compatibility, reviewed migrations/direct grants/retained-original cleanup, managed secrets, regional costs/backup/email, and full hosted browser/device/UAT/cutover acceptance. Keep billing disabled and the existing live/vendor system available until the separate verification and cutover approvals are complete.
