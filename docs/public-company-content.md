# Configured public company content

Checkpoint 188, 25 October 2026. The public company, contact and exact advisor pages can consume an optional trusted deployment document through `WEB_PUBLIC_COMPANY_CONTENT`. This adds public-content configuration support. It does not supply real company facts or establish publication approval, advisor consent, asset rights, account control or task 07-1 acceptance.

The existing server pages pass deployment environment values to `publicCompanyInfo`. Browser queries, headers and advisor path values cannot select the document, company, API origin or brand. `companySlug` must exactly match the already configured `TENANT_SLUG`; the existing supported tenant registry remains in force. Content cannot replace the current company name, header, theme, logo or tenant/data authority. The existing strict domain `TenantBrandConfig` is a different contract and is deliberately not extended or weakened here.

## Document

The exact top-level schema is `{ policy, companySlug, company, advisors, contact? }` with policy `public-company-content-v1`. Every nested object also has an exact allowlist. This fictional example is for a local synthetic test, not an instruction to publish a real contact or profile:

```json
{
  "policy": "public-company-content-v1",
  "companySlug": "realtime-estates",
  "company": {
    "summary": "Fictional company summary for a local configuration test.",
    "about": "Independently supplied sample company information, not approved business facts.",
    "officeAddress": "Fictional test office",
    "openingHours": "Sample hours only: Monday to Friday, 09:00 to 17:00"
  },
  "advisors": [
    {
      "id": "configured-sample-advisor",
      "name": "Fictional Sample Advisor",
      "role": "Sample public profile role",
      "bio": "Fictional biography for testing the company-to-profile journey."
    }
  ],
  "contact": {
    "email": "sample@example.invalid",
    "phone": "0700000000",
    "whatsapp": true
  }
}
```

`summary`, `about` and `advisors` are required. `officeAddress`, `openingHours` and `contact` are optional. A configured empty advisors array means no supplied profiles; it never restores a sample advisor. An omitted contact object or an empty one exposes no contact channels.

Each advisor requires an exact unique ID, name, role and biography. IDs contain lowercase ASCII words/digits separated by single hyphens, at most 64 characters. Exact IDs alone resolve `/agents/:id`; labels, case variants, foreign-company IDs and extra path text do not. Profiles carry source `configuration`; the sample profile is offered only when the document is absent and the existing synthetic-data gate allows it. Configured profiles do not infer staff membership, qualifications, employment or property assignments. No personal contact or photograph field exists.

## Bounds and safe rendering

The source document and normalized output each have a 64 KiB UTF-8 limit. JSON nesting is limited to six levels, and duplicate decoded keys are refused, including escaped aliases. There are at most 20 advisors. Text limits are measured in JavaScript string units, both before and after normalization:

| Field                           |           Maximum |
| ------------------------------- | ----------------: |
| Company summary                 |               240 |
| Company about                   |             4,000 |
| Office address / opening hours  |          300 each |
| Advisor name / role / biography | 120 / 160 / 2,000 |
| Email / phone input             |          254 / 40 |

Supplied text must be nonempty after trimming. It is normalized to NFC; markup angle brackets, control characters, directional override/isolate controls and unpaired surrogates are refused. Ordinary quotes and ampersands remain plain text and React escapes them. There is no HTML, arbitrary URL, CSS, photo, private staff ID, property assignment, provider credential or feature activation field. Unknown fields, inherited records, hidden/symbol fields, accessors, sparse/custom advisor arrays and duplicate advisor IDs fail validation. Validated output is detached and deeply frozen.

Email uses a bounded basic ASCII mailbox format and is lowercased. Its local part is URI-encoded before constructing a fixed `mailto:` link, so email punctuation cannot introduce a query or another scheme. Phone uses the existing domain `normalizeKenyanPhone`: supported Kenyan 07/01 mobile forms normalize to `+254`, without an extension. This checks format only, not number allocation, ownership or reachability. A supplied phone creates a `tel:` link. WhatsApp is exposed only when the exact boolean `true` and a valid phone are both supplied; no flag or a missing channel never implies WhatsApp. Its URL is constructed only as `https://wa.me/` plus the normalized digits, without an automatic message. The implementation sends no message and fetches no remote content.

## Absent, configured and invalid

An absent environment setting retains the earlier synthetic/unavailable company-page behavior. An empty, malformed, oversized, foreign-scoped or otherwise invalid setting makes the entire public-content document unavailable: no partial summary, contacts, advisor list or synthetic fallback is displayed. Company/contact render a generic unavailable message; advisor IDs do not resolve. Raw input and validation details are not exposed. The already configured company brand and catalogue navigation remain available.

Valid supplied content is marked “Configured public information” and the preview keeps its independent-verification limitation. It can be displayed independently of catalogue availability; it does not assert that the property API is healthy. Contact facts missing from a valid document remain explicitly unknown. The document does not enable enquiries, bookings, customer accounts, notifications or any other service. The existing development-only synthetic intake gate is unchanged, and the public pages continue collecting no contact data themselves.

Only approved public material belongs in this deployment setting. Configuration validation cannot establish its factual accuracy, publication authority, advisor consent, contact ownership, logo rights or domain/provider account control. Those checks, reviewed privacy/retention arrangements, actual responsive browser/keyboard/device evidence, operator acceptance and approved cutover remain separate. The old live/vendor system and KES 10,000 total monthly baseline are unchanged.

Eight new bounded model/markup tests cover two company scopes, exact profile routes, empty and absent documents, whole-document failure, duplicate/unsafe/oversized inputs, accessor refusal without getter execution, immutable output, fixed contact links and escaping, missing channels and unchanged intake enable/production refusal. The complete eighty-one-check web suite, test compilation and web TypeScript passed under a 384 MiB heap. The eight-case content file passed again after adding a UTF-8-only overflow fixture whose field/count/JavaScript-length bounds remain valid. These are logical/static markup checks, not an actual Next browser, service, device, factual-publication or production acceptance claim.
