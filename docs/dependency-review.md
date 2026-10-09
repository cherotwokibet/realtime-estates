# Dependency review — 9 October 2026

Initial npm install completed with22 audit entries, reflecting three root advisories through Expo/Metro build tooling. The existing project uses the current stable Expo57/RN0.86 compatibility set. A nonbreaking npm audit fix did not resolve these entries; its suggested force operation would downgrade Expo to44 and break that set, so it was not applied.

| Root package | Verified advisory | Current handling |
|---|---|---|
| braces<=3.0.3 | [Deep nested-pattern stack exhaustion](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm); upstream lists no patched release | Track upstream fix. Keep Metro/build inputs trusted and development servers local. No browser query is used as a build glob; this limits the known path without claiming remediation |
| node-forge<=1.4.0 | [RSA signature validation ambiguity](https://github.com/advisories/GHSA-86w9-cpqp-85rv); latest registry1.4.0 remains affected | Track upstream fix; no application authentication or signing verification is implemented using this package. Native release/signing acceptance remains open |
| uuid<11.1.1 | [Buffer bounds validation](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | An attempted xcode-scoped override did not change its installed uuid7 dependency. Removed the ineffective override and unused direct dependency. Await a compatible upstream fix; no remediation is claimed |

Latest audit output is retained in docs/dependency-audit.json; the initial output is retained separately in docs/evidence/dependency-audit-initial.json. The root dependency tree still reports22 entries; a workspace-scoped install reporting zero does not clear that root audit. Severity propagation is not a count of independently proven exploits in this app. Review actual runtime versus tooling paths and rerun audit before releases. Do not mark dependency security accepted while high advisories are unresolved. This review does not substitute for testing the deployed API, data policies or signed applications.
