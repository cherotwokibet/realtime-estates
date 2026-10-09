# Reuse and pricing checkpoint — 10 October 2026

Dates use Africa/Nairobi. Original resources and live services remain unchanged; all previews use synthetic fixtures.

## Second-company configuration

An isolated current-source snapshot at `../.tenant-preview-check-20261010` used the same maintained application code and existing installed dependencies with `TENANT_SLUG=sample-homes`. Isolation avoided Next development commands rewriting the main checkout's generated declarations/tsconfig. No main application source or production build was changed for this check.

`next dev --webpack -p 3002 -H 127.0.0.1` served the public app; port 3003 served admin. Actual browser review at 1280 px showed Sample Homes name/initials and its single synthetic property. Public computed variables were primary `#10465b` and accent `#b76a35`; admin inherited primary `#10465b`. Neither catalogue contained the Realtime fixture. Navigating to `/properties/demo-langata-1` on Sample Homes showed the standard 404 page; the server response was also 404. Screenshots: sample-company-web.png and sample-company-admin.png.

Expo `config --type public --json` was run separately for both configured tenants. Saved tenant-config-sample-homes.json and tenant-config-realtime-estates.json show distinct display names, slugs/schemes, Android packages, iOS bundle identifiers and extra.tenantSlug. These are preview identifiers and config outputs, not signed applications or device behavior.

This verifies early configuration flexibility in the implemented foundation. The original plan asked for it before coding; it was completed after reversible foundation work and before production integration. It is not complete automated onboarding, hosted tenant-isolation acceptance, native brand rendering or deployment reproduction.

## Pricing disclosure

`packages/domain/src/pricing.ts` adds a pure `calculatePricingDisclosure` contract alongside the unchanged legacy money helper. It distinguishes known/quote-required amounts, mandatory/optional charges, fee/deposit classification, timing and declared completeness. Unknown amounts remain null. Missing declaration remains unresolved even with an empty charge array. Optional quotes stay separate from mandatory subtotals; only explicit complete coverage and no mandatory quote mark mandatory amounts complete. All results are copied/frozen, and safe-integer sums use exact arithmetic.

Domain build and 43 domain tests passed, including 12 new pricing cases. Exact examples cover sale KES 999,999 plus KES 1,500 = KES 1,001,499, and monthly KES 20,000 plus KES 1,000 service, KES 20,000 refundable deposit and KES 500 one-off fee = KES 41,500 initial known subtotal. Independent read-only review found no blocking calculation/immutability/compatibility defect. Logs: pricing-build.txt and pricing-domain-tests.txt.

The helper has not yet been integrated into persisted property drafts, SQL snapshots, API DTOs or screens. Existing previews still label fees as not supplied. See ../contracts-roadmap.md for the versioned transition and required denial/snapshot/compatibility tests.

The complete root npm test pipeline was rerun after the new export: **118 checks passed, zero failures/skips** (43 domain, 5 demo, 32 API/auth/HTTP, 19 client transport/HTTP, 1 client/service integration, 18 SQL). All seven workspace typechecks passed. Logs: pricing-checkpoint-tests.txt and pricing-types.txt. SQL remains disposable PGlite, not hosted PostgreSQL/PostGIS. Existing UI production builds and mobile JS export are unchanged; no new device or launch result is inferred.

## Design references

The original Miro board's read-only accessible outline was enabled with Enter after mouse interaction timed out. It exposes 100 top-level objects and available nested text, including listing verification/rejection, user/account/policy/contact/support views and historical booking/payment/commission/ads/chat/notification wireframes. Raw outline is preserved outside source at `../rebuild-preservation/2026-10-10-reference-review/miro-original-outline.txt`. This is structured requirements evidence, not a complete visual board audit, editable export, finished brand system or asset licence. Historical payments/commission/paid advertising/chat campaigns remain deferred; they do not expand the low-budget pilot.
