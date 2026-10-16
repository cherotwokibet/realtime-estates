import type { ConfigContext, ExpoConfig } from 'expo/config';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';

/** Build-time synthetic tenant configuration. No signing keys or provider secrets belong here. */
export default ({ config }: ConfigContext): ExpoConfig => {
  const tenantSlug = resolveDemoTenantSlug(process.env.TENANT_SLUG);
  const brand = getDemoBrand(tenantSlug);
  const applicationId = `com.boniface.realtor.preview.${tenantSlug.replaceAll('-', '')}`;
  return {
    ...config,
    name: `${brand.name} Preview`,
    slug: `${tenantSlug}-preview`,
    scheme: `${tenantSlug}-preview`,
    android: { ...config.android, package: applicationId },
    ios: { ...config.ios, bundleIdentifier: applicationId },
    extra: { ...config.extra, tenantSlug },
  };
};
