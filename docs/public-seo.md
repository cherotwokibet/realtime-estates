# Public URLs, sharing and indexing

The public web app builds canonical property URLs from the configured HTTPS origin and stable public property ID: `/properties/{id}`. Listing title/slug changes do not change this URL. Search tracking fields and request Host/forwarded headers do not select the canonical origin. Metadata and body use the same request-scoped public detail read.

Property metadata includes title, base KES price and rental period, public area labels, a fees/detail prompt, Open Graph/Twitter fields and a company sharing image. It does not copy the full description, private address, coordinates, staff notes or account data. Synthetic results explicitly say there is no real availability. Missing/incomplete/unavailable results are excluded from indexing. Next may stream a not-found response with HTTP200; its not-found boundary and noindex remain required. Do not claim every missing-property response is HTTP404.

## Deployment settings

- `WEB_INDEXING=disabled` is the default and must remain in previews. Demo/reference/synthetic catalogues cannot enable indexing. Robots disallows crawling and sitemap contains no synthetic URLs.
- `WEB_PUBLIC_ORIGIN` is optional while indexing is disabled. When present, use an exact HTTPS origin without trailing slash, path, credentials, query, fragment, localhost or IP literal. This is a trusted deployment value, never a request header or tenant parameter. Without it, no absolute canonical/share URL is invented.
- `WEB_INDEXING=approved` requires production, an explicit origin, ordinary connected catalogue search, no synthetic/reference declaration and no loopback opt-in. This flag records an operator's separate approval; code does not establish domain ownership, content rights, provider readiness or launch acceptance. Those facts and approvals must exist before enabling it. No current real deployment is enabled by this change.
- Filtered results remain noindex and point to the root canonical. Enquiry forms explicitly stay noindex. In an approved deployment, robots permits public crawling and excludes API routes; crawlers can read the form's noindex directive.

`/sharing-card` generates a 1200×630 PNG with the configured company's name and contrast-safe primary theme. Preview cards disclose synthetic/no-real-availability status. It loads no external image or font and ignores company values in requests.

`/sitemap.xml` traverses the anonymous approved public search in stable 100-item pages, with a 10,000-property bound. Every URL must be a unique public UUID. Changing totals, duplicates, transport errors or an exceeded cap fail instead of advertising an incomplete sitemap. No modification date is fabricated. A larger catalogue needs a separately verified full sitemap export path before activation.

The implementation is local. Public DNS/TLS, real-catalogue rights, crawler/search-console behavior, production load and migration/legacy-link verification retain their separate gates. Run `npm run smoke:public-routes --workspace=@realtor/web` against a fresh production build for the synthetic HTTP/metadata/PNG checks; it does not establish browser/device acceptance.
