# Tenant deployment manifest

This optional `TENANT_MANIFEST_JSON` deployment setting binds the already selected `TENANT_SLUG` to one strictly validated synthetic-compatible brand, semantic theme, two presentation flags, and optional company content. It is read only from the server deployment environment. A browser URL, form, header, API parameter, or posted tenant ID cannot select or override it.

The exact top-level fields are `policy`, `slug`, `brand`, `features`, and optional `companyContent`. Policy must be `realtor-tenant-manifest-v1`; `slug` and `brand.slug` must both match the existing configured tenant. `brand` uses the existing exact `TenantBrandConfig` validator, including safe HTTPS/local logo paths, normalized Kenyan phone, `en-KE`/KES, four validated colors, and explicit boolean `viewings` and `customerAccounts`. The manifest derives its deeply frozen semantic theme and fixed CSS aliases from those colors. No arbitrary CSS is accepted.

The exact presentation flags are `advisorProfiles` and `contactActions`, each an explicit boolean. They can suppress public advisor/contact presentation. They grant no role, membership, enquiry, booking, payment, storage, API, or database permission and cannot turn on an unimplemented service. Profiles render only from same-slug `public-company-content-v1`; contact links render only when `contactActions` is true and that company content is present. Explicit content contact wins; otherwise the already validated manifest brand email/phone are used. Disabled or missing profiles never restore a synthetic profile while a manifest is configured.

`companyContent`, when supplied, uses the existing strict `PublicCompanyContent` schema and must match the manifest slug. The shared bounded JSON parser rejects duplicate decoded keys and excessive nesting before object validation. Unknown root, brand, feature, or content fields fail the whole manifest. The validator returns only detached, frozen data; invalid optional manifests make the server layout fail closed and public company data unavailable. Removing the setting preserves the existing `TENANT_SLUG` plus `WEB_PUBLIC_COMPANY_CONTENT` compatibility path.

Example shape (synthetic values only; not facts approved for publication):

```json
{
  "policy": "realtor-tenant-manifest-v1",
  "slug": "realtime-estates",
  "brand": {
    "tenantId": "synthetic-realtime-1",
    "slug": "realtime-estates",
    "companyName": "Synthetic Realtime Estates",
    "colors": {
      "primary": "#5e0202",
      "secondary": "#194d3e",
      "accent": "#b77b27",
      "background": "#ffffff"
    },
    "logo": { "url": "/brands/synthetic/logo.svg", "alt": "Synthetic brand mark" },
    "contact": { "email": "test@example.invalid", "phone": "0700000000" },
    "locale": "en-KE",
    "currency": "KES",
    "features": { "viewings": false, "customerAccounts": false }
  },
  "features": { "advisorProfiles": false, "contactActions": false }
}
```

The deployment owner must keep this public presentation document in managed environment configuration; do not commit a filled `.env` or publish an unapproved company identity/contact. Tests establish parsing, tenant binding, fail-closed behavior and presentation gates, not factual rights, real contact ownership, data tenancy, deployment ownership, production release or service activation. Provisioned tenant onboarding, live data and account access remain separate work.
