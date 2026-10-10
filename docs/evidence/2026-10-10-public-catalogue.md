# Connected public catalogue — 10 October 2026

Africa/Nairobi checkpoint. Independent replacement code and synthetic fixtures only. Vendor files, the old live system, provider accounts and production data were untouched. No paid service was provisioned; KES 10,000 remains the total monthly client-price baseline.

## Delivered

Public discovery and property details now deliberately select demo or connected v2 data. A server-only wrapper reads controlled deployment configuration; browser query parameters cannot select an API origin or company. Connected reads use the actual validating shared client, no-store requests and no credentials or automatic retries. A failed or malformed connected response produces an unavailable state, never replacement demo stock.

The explicit adapter maps demo priceMinor and API amountMinor to integer KES cents. Demo fixtures retain their general bathroom count, concept gallery and synthetic amenities. Connected records retain separate private/shared bathrooms, exact pricing, nullable county/town/area and the legacy locality label. Missing floor area and amenities remain unknown. Connected photos show an unavailable placeholder until trusted image delivery is connected; accepted fixture metadata is not substituted with illustrative photos.

Both compact cards and the detail panel show base price/period, known recurring and initial subtotals, named mandatory fees, refundable deposits, optional costs and quote-required amounts. A complete declaration is labelled as supplied mandatory amounts, never an independently verified all-inclusive quote. Unknown zero extra subtotals say “None supplied”; incomplete/undeclared coverage stays visible.

Search accepts all nine API property types and exact decimal KES budgets. A maximum applying to rentals requires an explicit day/week/month/year period. Rates are matched exactly without conversion; sale prices remain one-off. Filters apply to the loaded selection, currently at most100 records. A full selection is visibly marked as limited. A missing detail from a full selection is inconclusive, rather than a false missing-property decision. Server-side pagination/search and exact-detail retrieval remain follow-up work.

Native Next loading, empty, validation, unavailable and not-found views are distinct. Expected service failures retain safe text and a manual retry link. Unexpected errors use the supported retry callback. Pages remain noindex development previews with enquiries/viewings disabled.

## Actual verification

- Root npm test passed **203 checks**, zero failures/skips:65 domain,5 demo,41 API/auth/HTTP,31 client transport/HTTP,7 client/service integration,28 SQL,21 web adapter/presentation,5 synthetic HTTP harness. Log: public-catalogue-tests.txt.
- All seven workspace typechecks passed; log: public-catalogue-types.txt. The final web production build, including its TypeScript check, passed; log: public-catalogue-web-build.txt. Routes / and /properties/[id] are dynamic.
- The new harness uses actual API/HTTP/client code, both migrations and a checked restricted nonowner PGlite login. It tests two startup companies, no cross-company/private-field leakage, exact cents/costs, empty/503 scenarios, unsafe startup/host/query refusal, no credentials or writes and no image bytes. It is loopback-only, read-only and refuses production mode.
- Browser observed loading and connected Realtime sample stock at1280×720. Rent fixture:20,000 base/month +1,000 recurring fee +20,000 deposit +500 one-off fee =21,000 known recurring and41,500 known initial; optional300 parking and a cleaning quote remain separate. Images: public-v2-search.png and public-v2-rent-costs.png.
- Browser form refused a20,000 rent budget without a period, marked the period field invalid, then returned exactly one monthly sample after selecting month. A nonmatching location returned an explicit filtered-empty state. Paused synthetic stock returned a genuine API-empty catalogue, without the other company's record; public-v2-empty.png.
- Browser sale detail at **observed390×844** displayed base999,999, known fee1,500, known initial1,001,499, a named mandatory quote and incomplete coverage. County/town/area stayed unsupplied; no invented amenities, floor area or image gallery. Document scrollWidth375≤390; public-v2-sale-390.png.
- With the local API stopped, that detail displayed an unavailable message and manual retry, without sample fallback. Observed390×844, scrollWidth390; public-v2-error-390.png. This browser check simulates network unavailability; the separate HTTP harness verifies503.
- Production-build default-demo browser check retained four sample listings, undeclared costs and the expandable five-image labelled concept gallery. This is not a connected production deployment.

An initial browser compile exposed a relative .js resolution mismatch; source imports and test emit settings were corrected before the successful build/browser checks. The first navigation happened before the dev server was ready; later checks used its ready listener. No failed attempt is counted as a pass. A review also identified mixed rental periods; the selector, validation and mixed-period tests resolve that issue.

## Limits and next task

No Android/iOS device, screen-reader, keyboard-complete/200% text, full-site390px, hosted database/PostGIS/TLS/pooling, real authentication, trusted uploads, operator UAT or launch gate passed here. Admin/mobile source is unchanged; previous build/export evidence remains separate. A browser-rendered missing view after streaming does not establish an HTTP404 status. Dependency advisories remain open.

Next: authenticated staff client and draft editing UI with safe session handling, optimistic-version conflicts and recoverable edits. Then trusted media upload/processing and moderation routes; verify listing approval→discovery→enquiry→assignment→viewing. Complete public pagination/exact detail and connect real media before claiming complete public discovery. Obtain controlled accounts/rights, independent backup and operator/device acceptance before deployment/cutover.

Framework conventions were checked against bundled Next16.4 documentation and the official [loading](https://nextjs.org/docs/app/api-reference/file-conventions/loading), [fetch](https://nextjs.org/docs/app/api-reference/functions/fetch) and [error](https://nextjs.org/docs/app/api-reference/file-conventions/error) references. Loading uses route Suspense; no-store requests read fresh data, and retry re-fetches unexpected failures. These conventions do not substitute for hosted/device verification.
