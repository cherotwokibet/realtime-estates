import { getDemoBrand, getDemoThemeCss, resolveDemoTenantSlug } from '@realtor/demo';
// Server build/deployment context; posted tenant IDs never select protected data.
export const tenantSlug = resolveDemoTenantSlug(process.env.TENANT_SLUG);
export const tenantBrand = getDemoBrand(tenantSlug);
export const tenantThemeCss = getDemoThemeCss(tenantSlug);
