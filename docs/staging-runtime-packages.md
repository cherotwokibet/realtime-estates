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

Commands must run from the relocated realtor-platform directory. Output includes only generated runtime assets and the traced closure, with platform native dependencies from the build host. The locally verified Windows/x64 candidates must not be copied into a Linux Cloud Run container. Rebuild and repeat all checks in a controlled Linux environment, pin/review the base image and record image digests before any deployment claim. Local Docker was previously unavailable; no Linux image/container build has been run for this checkpoint.

Entrypoints inside each service directory are apps/api/dist/hosted-index.js, apps/web/server.js and apps/admin/server.js. The web/admin servers accept PORT and HOSTNAME; bind the reviewed deployment interface when packaging for a controlled service. API startup still requires valid staging policy, fixed HTTPS origin, Firebase project and ordinary-role database connectivity. The verifier proves only refusal without configuration, not positive database startup. Existing staging configuration, Cloud SQL IAM and private Cloud Run invocation requirements continue to apply.

Remaining release work includes a clean Linux rebuild/container run, actual Google ADC/token refresh/invoker-denial proof, managed Cloud SQL role compatibility, reviewed migrations/direct grants/retained-original cleanup, managed secrets, regional costs/backup/email, and full hosted browser/device/UAT/cutover acceptance. Keep billing disabled and the existing live/vendor system available until the separate verification and cutover approvals are complete.
