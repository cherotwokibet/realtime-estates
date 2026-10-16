# Contributor onboarding and source rules

The maintained source is private at https://github.com/cherotwokibet/realtime-estates. Boniface controls the connected cherotwokibet account used to create and push this repository. The authenticated access page confirmed a private repository with zero collaborators and only the owner able to contribute. This is an observed account/repository fact, not a legal conclusion about vendor assets. No external contributor has been invited by the rebuild. Boniface remains the decision owner; Codex assists implementation. Source is private pending an explicit licence decision; no open-source or vendor licence is granted here.

Use Node 24.19.0 and the committed npm lockfile. From a Windows terminal:

```text
git -c core.longpaths=true clone https://github.com/cherotwokibet/realtime-estates.git
cd realtime-estates
npm ci
npm run format:check
npm run typecheck
npm test
npm run build:web
npm run export:android --workspace=@realtor/mobile
```

Use the same commands on Linux; the command-scoped Windows long-path option can be omitted. Do not change global Git configuration merely to restore this project. A fresh Linux CI checkout/install/test/build/export passed for commit 0058473007a5debb9e5f0bc5db13c7807203732b: https://github.com/cherotwokibet/realtime-estates/actions/runs/38802146440. This is Android bundle export, not an installed-device or store acceptance test. Consult development.md for local preview commands and .env.example for placeholder server configuration. Never reuse synthetic signing identities in production.

Before editing, inspect Git/workspace state, read CONTINUATION.md and applicable AGENTS.md instructions, and preserve unrelated work. The Next.js app instructions require reading the relevant installed Next guide before changing its routes/components. Read architecture.md and the specific command/evidence documents for the area being changed. Keep company-specific branding/configuration outside shared business logic. Public, browser, native and server package boundaries must remain explicit.

Future human contributors should use a focused branch and a reviewable change with meaningful denial/recovery tests and exact verification results. Current CI runs on pushes and pull requests; branch protection and mandatory review are not represented as configured. Do not add a contributor or widen repository access without Boniface's authorization. No one may grant rights they do not hold. Independently write replacement code; do not copy vendor implementations or import client exports while rights/control are unresolved. Use synthetic data and keep original vendor resources and the live system available.

Never commit tokens, .env secrets, signing keys, customer records, raw vendor archives or unreviewed generated dumps. .env.example contains placeholders only. Keep short-lived credentials in session memory and managed provider storage where provisioned. Review dependency licences and compatibility before adding a library. Record evidence without private payloads or credentials. A dependency/CLI purchase, account-plan change, usage reset or bypass is not authorized by these contribution rules.

Run checks appropriate to the changed boundary, inspect failures and record unrun checks honestly. Keep current request/actor/target/version validation inside transactions. Do not automatically retry uncertain writes or substitute a newer version after conflict. Update dated continuation notes, the canonical delivery tracker and its private publication after meaningful progress, preserving browser notes. Release and cutover follow release-workflow.md; merging or green CI alone does not accept a launch gate.
