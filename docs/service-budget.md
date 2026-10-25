# Solo delivery and KES 10,000 service baseline

Recorded 9 October 2026. Boniface confirmed he will build with Codex himself and asked us to work with KES 10,000 per realtor per month for everything. This document treats that as the total recurring client service price. No customer sale, payment, provider purchase or commercial contract has occurred.

## Confirmed constraints and proposed allocations

Builder: Boniface with Codex. Realtime operator review and UAT participation are still required. No paid developer, designer or QA capacity is assumed. The platform remains an independently written TypeScript monorepo serving web, mobile and admin, with configurable brands and server-enforced company isolation.

KES 10,000 is gross service revenue, not a hosting allowance or verified profit. Internal working allocation for the first paying agency:

| Allocation                          | KES/month | Purpose                                                                                                          |
| ----------------------------------- | --------: | ---------------------------------------------------------------------------------------------------------------- |
| External service allowance          |     6,000 | Shared production hosting, database, image storage, email, independent backup copies and annual-service reserves |
| Maintenance and support allowance   |     1,500 | Founder time allocation; actual hours and effective rate must be tracked                                         |
| Operating contingency               |     1,000 | Usage variation, exchange/card charges and unexpected operational work                                           |
| Development recovery / contribution |     1,500 | Contribution toward initial build, tools and business costs; not guaranteed take-home profit                     |
| Total                               |    10,000 | Complete recurring price ceiling used for planning                                                               |

These are allocation targets, not supplier quotes. Any applicable taxes, collection fees, recurring development tools and actual support labour must be entered before declaring net margin. The build itself is founder investment; KES 10,000 does not finance unlimited custom development. A setup fee has not been agreed and is not assumed. Target external cost below KES 3,000 per agency as shared usage is measured across three or more clients; this is an optimization goal, not an existing cost.

## Current provider references and illustrative scenarios

Prices checked against official pages on 9 October 2026. USD to KES **150** is an internal stress-planning assumption, not a current exchange-rate quote. Replace it with the actual billed conversion and charges before purchase. No promotional credits assumed.

| Candidate                                                                                       | Published base                                                                                 | Planning treatment                                                                                                          |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [Supabase Pro](https://supabase.com/pricing)                                                    | From US$25/month; first project included, additional projects from US$10/month                 | Managed PostgreSQL/auth candidate; one shared production project initially; usage and compute upgrades add cost             |
| [Cloudflare Workers](https://developers.cloudflare.com/workers/platform/pricing/)               | Paid subscription US$5/month; metered dynamic requests/CPU beyond included allowances          | Candidate for web/admin/API; compatibility and load must be proved before selecting the host                                |
| [Cloudflare R2 Standard](https://developers.cloudflare.com/r2/pricing/)                         | US$0.015/GB-month plus operations; direct internet egress free; included monthly usage applies | Optional image/backup storage; avoid duplicating storage providers unless measured need justifies it                        |
| [Expo EAS](https://expo.dev/pricing)                                                            | Free quotas available; Starter US$19/month plus additional usage                               | Begin within actual build/update quotas or local build options; paid plan is not assumed in base infrastructure             |
| [Apple Developer](https://developer.apple.com/help/account/basics/about-your-developer-account) | US$99/year or local equivalent                                                                 | Reserve US$8.25/month per required membership when iOS distribution begins; account ownership/distribution still unresolved |
| [Google Play](https://support.google.com/googleplay/android-developer/answer/6112435?hl=en)     | US$25 one-time registration                                                                    | Initial publishing cost per required new account, not monthly hosting                                                       |

The simplest illustrative production floor is US$30/month = KES 4,500 at the planning assumption. That leaves KES 1,500 inside the external allowance for email, domain renewal, backups and fees; these still need verified quotes. Supabase's included database backups do not establish a complete object/media backup or an independently tested restore. This budget assumes no paid Supabase custom API domain, point-in-time recovery, dedicated search cluster or always-on separate API server.

| Scenario                                               |      Known base at planning conversion | Still to add / implication                                                                                                                           |
| ------------------------------------------------------ | -------------------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| One agency, one production database, Workers           |                        KES 4,500/month | Email, domain, backup copies and charges remain unquoted; feasible candidate within KES 6,000 allowance if bounded                                   |
| Same plus an extra paid staging project                |                        KES 6,000/month | Already consumes external allowance before other services; use local isolated test data during development, or revise allocation before provisioning |
| Base plus EAS Starter and one Apple membership reserve |                     KES 8,587.50/month | Exceeds external allowance before remaining services; do not assume this configuration fits the first-client offer                                   |
| Three agencies sharing the US$30 base                  | KES 1,500/agency/month base allocation | Variable usage, isolation testing, support and publishing costs still apply; no claim that all costs divide equally                                  |

Native applications stay in scope. At release, choose a build/distribution strategy that fits measured costs: available build quotas/local builds where practical, shared service costs when justified, and explicitly budgeted publisher memberships. A separate paid build plan or membership for every realtor is not silently included. Do not sell iOS availability before release gates and its recurring costs are accepted. No billable services are provisioned by this plan.

## Proposed managed-service boundary

The explicit optional-module deferral and later activation criteria are in [optional-module-scope.md](optional-module-scope.md). Payment collection, commission settlement, paid advertising, in-app chat and advanced marketing/growth alerts are not pilot launch commitments. Core transactional notifications remain separately scoped and unaccepted until verified; no provider charge or capability is implied by this planning record.

Include company branding/configuration, hosted public web and staff admin, the mobile versions once verified, catalogue/search/favourites, enquiry and viewing workflow, standard security maintenance, monitored backups/restore, routine transactional email and bounded support. Domain and publisher renewal costs must be recorded inside the allocation if Boniface absorbs them. An existing domain can be connected once account control is established.

Planning placeholders: five staff, up to 300 active listings, 10 GB retained media and up to two hours of routine support each month. These are proposed commercial allowances, not current Realtime usage, accepted contract terms or implemented limits. Measure traffic and email before setting their allowances. Support for service incidents and defect remediation needs its own policy; the routine-support allowance does not automatically permit ignoring outages. New features and bespoke workflows require separate scoping. Verify whether the labour allowance can cover actual support hours at Boniface's chosen rate.

Use optimized images, bounded upload size/count, external video links and cached public content. Start with WhatsApp/call links; bulk SMS, automated WhatsApp campaigns, paid ads, AI inference, payment processing and video hosting require a separate cost decision. Do not promise unlimited messages, storage, users, custom features or 24-hour staffed support at this price.

Implement per-company metering for media bytes, uploads, active listings, staff, transactional emails and relevant traffic/API usage. Alert at 70%, 85% and 100% of the internal cost allowance. These alerts are not a guaranteed provider hard spending cap. Apply provider controls where available, rate limits, image limits and abuse protection; freeze optional costly operations before uncontrolled spending while protecting enquiry receipt. Record invoice totals and costs by agency monthly. Obtain a scoped service change before expansion; do not automatically charge overages above KES 10,000.

## Solo delivery sequence and verification

The earlier 20–30 week envelope assumed two experienced developers plus design/QA and is superseded for this delivery model. Weekly available hours and observed throughput are not known. Use milestone planning and re-estimate after two completed delivery iterations. Do not assume Codex eliminates implementation, review, device testing, operator feedback or support work. Reserve roughly 20% of available time for verification and operational interruptions, then adjust from actual experience.

Proposed first useful release: responsive web/admin from listing creation through moderation, discovery, enquiry, staff assignment and viewing follow-up. Then Android, verified iOS and repeatable second-company onboarding. Tenant isolation and brand configuration begin in the foundation; reproduction is tested early with two synthetic companies. The full 14-stage completion plan remains in force. A web/admin pilot is an additional partial-scope milestone, not acceptance of mobile or the whole platform.

Any early pilot needs its own recorded gate: role/owner/tenant denial tests, recoverable media, accurate prices/states, critical accessibility and registration checks, operator UAT, reconciled clean stock, independent restore evidence, reversible cutover and support ownership. Full Stage 12–14 gates remain open until all required applications and handover are verified. No early production release is authorized or performed by this budget update.

Current Stage 01 items: workflow/success agreement, asset/data reuse rights, complete design exports, publisher/domain/provider control and independent production-data backup/restore evidence remain open. The private source remote and dated fresh source-clone recovery are now recorded in CONTINUATION.md; source recovery does not establish business-data recovery. Staffing and monthly service-price decisions are recorded; task 01-5 and its exit gate remain incomplete until the remaining decisions are resolved.
