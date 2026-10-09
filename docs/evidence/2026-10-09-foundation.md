# Local foundation evidence — 9 October 2026

The original vendor system was not changed. All application and database fixtures are synthetic. Commands ran on Boniface's Windows workspace with Node24.19.0.

| Check actually run | Result | Evidence / limit |
|---|---|---|
| `npm test` | PASS:31 domain +5 demo +32 API/auth/HTTP +18 SQL =86 checks | foundation-tests.txt. API totals include14 JWT,2 HTTP and16 service checks; SQL uses PGlite, not a hosted provider |
| `npm run typecheck` | PASS all six workspaces | foundation-types.txt |
| Next web/admin production builds | Initial PASS; visual revision will be recorded separately | Web routes / and /properties/[id]; admin / |
| Expo Android JS export after constants/config integration | PASS:588 modules,1.5MB Hermes bundle | android-export.txt. This is not an APK, device test or store build |
| Expo SDK dependency check | PASS before constants addition; repeat before mobile release | Expo57 bundled RN0.86.3/React19.2.3 |
| Synthetic second-company Expo config | PASS sample-homes display/scheme/IDs; invalid constructor rejected | Agent ran actual config commands; native rendering not tested |
| Browser initial web filters/detail | PASS combined Ruaka/rent/studio/max18000 one result;18000 inclusive; foreign company detail404; malformed maximum empty/error | Initial screenshots web-foundation-desktop.png and web-foundation-mobile-width.png; new visual checks pending |
| Browser initial responsive layout | PASS no horizontal overflow at1240 and390 widths | Desktop browser only; no device or complete accessibility claim |
| Root `npm audit --omit=dev --json` | FAIL:22 propagated entries, three root advisories unresolved | dependency-audit.json and dependency-review.md. Nonbreaking fix/ineffective override did not resolve these |

Regression fixes include repeated search filters, inherited company keys, current assignee access, exact money, unavailable discovery, approval ordering, pending edit approval preserving pause/archive, current privacy notice acknowledgement, enquiry idempotency, transaction-local context cleanup and unsafe DB login rejection.

Not run/accepted: hosted PostgreSQL/PostGIS/TLS/pool behavior; real identity-provider login/logout/reset; live media processing; end-to-end connected UI; Android/iOS devices; complete accessibility/performance/security/UAT; off-device recovery; migration/cutover. CI workflow is defined, not remotely executed. No release gate is accepted by these local results.
