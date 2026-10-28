# Checkpoint 208: public URLs, sharing previews and indexing rules

**Date:** 28 October 2026 (Africa/Nairobi)  
**Accepted local implementation:** checklist07-5. Production activation and release gates remain separate.

## Completed bundle

Stable property-ID canonical URLs, server-rendered public metadata, Open Graph/Twitter previews, a company-themed sharing PNG, sitemap generation and explicit indexation rules are implemented. `docs/public-seo.md` records the deployment contract. Canonical/share origins come only from trusted HTTPS deployment configuration; request tracking/Host/forwarded/company fields cannot select them. Metadata and body share a request-scoped public property snapshot. Exact KES/period and public area labels are included; full descriptions, private addresses, coordinates and staff facts are not copied into metadata.

Preview/demo/reference/synthetic results stay noindex. Indexing approval requires a production connected ordinary catalogue/search and explicit origin; actual domain ownership, data rights and launch approval are not established by the environment flag. No real deployment was enabled. Filter pages and enquiry forms remain excluded from indexing. Preview robots disallows crawling and sitemap advertises no synthetic URLs.

Approved sitemap generation traverses 100-item API pages up to10,000 properties and fails on changing totals, duplicates, unsupported IDs, transport failure or an exceeded cap. It does not invent modification dates or silently truncate. Sharing PNG uses configured company/theme, with synthetic/no-availability labels in preview.

## Executed verification

- Web suite **99/99 passed**, including five SEO cases covering configuration denial, stable public metadata/exact cents, unavailable/synthetic noindex, complete paged sitemap, duplicate/changing/capped/error inventory and no private description leakage. Test compilation passed.
- Final full Next16.4.2 production build passed compilation, TypeScript, one-worker page collection/static generation and optimization. `CIRCLE_NODE_TOTAL=2` was process-local; default project configuration and type checking were not weakened.
- Fresh production-server HTTP smoke passed five existing public routes plus actual metadata/robots/sitemap/PNG checks. Confirmed canonical property URL excludes tracking and forged forwarded-host values, Open Graph/Twitter tags, preview noindex, preview robots, empty synthetic sitemap and filter-root canonical.
- Unknown property returned **HTTP200 with the Next not-found boundary and noindex**, with no canonical URL. Do not claim every missing property returns HTTP404. The installed Next streaming documentation explicitly permits this status after headers flush.
- Actual `/sharing-card` returned a **1200×630 PNG,38,788bytes**, correct PNG signature and content type. A forged company query/header returned identical image bytes. The retained image was visually inspected for readable tenant name and preview disclosure. This is image inspection, not browser/device layout acceptance.
- Focused formatting and git diff checks passed. No browser viewport, native-device, real crawler/indexing, DNS/TLS, real catalogue, load/operator, hosted CI or cutover test was performed.

## Failures and corrections retained

The first production build compiled but failed spawning TypeScript (`spawn UNKNOWN`) under low virtual-memory headroom; its log is retained. A Webpack attempt has an incomplete log and no terminal result, so it is not counted as passed. After Windows reported21GB virtual headroom, the ordinary one-worker Turbopack build passed in full. No pagefile/account setting or verification bypass was changed.

An initial test selected a fixture ID belonging to another synthetic company; it now obtains the correct same-company fixture. Initial smoke assumptions about universal HTTP404, default not-found wording and a serialized root trailing slash were corrected against the installed framework and observed output. The property metadata handler now also calls `notFound()` when the public ID is absent. Final smoke verifies the semantic not-found/noindex boundary and records the actual status.

Raw results and the generated image are in `2026-10-28-public-seo/`: `web-tests.txt`, `build.txt`, `http-smoke.txt`, `sharing-card.png`, `initial-build-failure.txt` and `incomplete-webpack-build.txt`.

## Delivery status and next

Checklist07-5 is complete as a locally built and verified implementation, consistent with the separate production gates and the07-1 acceptance precedent. Count becomes **31/97 (32% rounded),0/14 gates**. The50% target needs at least49 completed tasks,18 more. No task was split, removed or reweighted. Vendor assets, the old live system and KES10,000 total monthly service baseline are preserved. Source remains local while Actions quota is exhausted.

Next: assess complete API/company-context and media bundles against current source/tests; close only whole verified items. Continue actual search/map/admin browser acceptance when resources allow. Native/storage/database, provider/accounts/rights, real crawler/domain, operator UAT, cutover and handover retain their own unpassed gates. Owner: Boniface + Codex.

## Publication checkpoint

Checkpoint208 publication: owner-private dashboard version195 deployed successfully from5f38d11f672a365fa12ff4b0310f77816ed7145e (deployment appgdep_6ae18b147bc08191b719890c22069ebe). Access rechecked:one owner,zero external visitors/groups.31/97tasks(32%rounded),0/14gates;676notes preserved/appended. Source SEO feature97879b4 retained locally; no GitHub push/hosted CI. Generated admin next-env.d.ts preserved. Web99/99, full one-worker production build including TypeScript and final HTTP/metadata/PNG smoke passed. No real-domain indexing or browser/device/UAT/cutover gate claimed. Next: current company-context/API and media acceptance audit;18more tasks required to cross50%. Owner:Boniface+Codex.
