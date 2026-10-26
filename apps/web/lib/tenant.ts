import { getDemoBrand, getDemoThemeCss, resolveDemoTenantSlug } from '@realtor/demo';
import { resolveTenantManifest } from './tenant-manifest.ts';
// Server build/deployment context; posted tenant IDs never select protected data.
export const tenantSlug = resolveDemoTenantSlug(process.env.TENANT_SLUG);
export const tenantManifest = resolveTenantManifest(process.env.TENANT_MANIFEST_JSON, tenantSlug);
if (tenantManifest.status === 'invalid')
  throw new Error('TENANT_MANIFEST_JSON must be a valid manifest for the configured tenant.');
export const tenantBrand =
  tenantManifest.status === 'configured'
    ? {
        name: tenantManifest.manifest.brand.companyName,
        primary: tenantManifest.manifest.brand.colors.primary,
        accent: tenantManifest.manifest.brand.colors.accent,
        initials: tenantManifest.manifest.brand.companyName
          .split(/\s+/)
          .slice(0, 2)
          .map((word) => word[0])
          .join('')
          .toUpperCase(),
      }
    : getDemoBrand(tenantSlug);
export const tenantThemeCss =
  tenantManifest.status === 'configured'
    ? tenantManifest.manifest.themeCss
    : getDemoThemeCss(tenantSlug);
