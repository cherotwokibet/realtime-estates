import type { ConfigContext, ExpoConfig } from 'expo/config';
import { propertyLinkOrigin, propertyLinkPathPrefix, previewApplicationId } from '@realtor/domain';
import { getDemoBrand, resolveDemoTenantSlug } from '@realtor/demo';
import { resolveMobileReferenceConfig } from './src/reference-catalogue.ts';

/** Build-time synthetic tenant configuration. No signing keys or provider secrets belong here. */
export default ({ config }: ConfigContext): ExpoConfig => {
  const tenantSlug = resolveDemoTenantSlug(process.env.TENANT_SLUG);
  const brand = getDemoBrand(tenantSlug);
  const applicationId = previewApplicationId(tenantSlug);
  const links =
    process.env.MOBILE_PROPERTY_LINK_ORIGIN === undefined
      ? undefined
      : propertyLinkOrigin(process.env.MOBILE_PROPERTY_LINK_ORIGIN);
  const icon = `./assets/icons/${tenantSlug}.png`;
  const adaptiveIcon = `./assets/icons/${tenantSlug}-foreground.png`;
  const mode = process.env.MOBILE_CATALOGUE_MODE;
  const extra: Record<string, unknown> = { ...config.extra, tenantSlug };
  delete extra.mobileReference;
  if (mode !== undefined) {
    const candidate = {
      mode,
      ...(process.env.MOBILE_CATALOGUE_VIDEO !== undefined
        ? { videoMode: process.env.MOBILE_CATALOGUE_VIDEO }
        : {}),
      ...(process.env.MOBILE_CATALOGUE_FLOOR_PLAN !== undefined
        ? { floorPlanMode: process.env.MOBILE_CATALOGUE_FLOOR_PLAN }
        : {}),
      ...(process.env.MOBILE_CATALOGUE_PHOTOS !== undefined
        ? { photoMode: process.env.MOBILE_CATALOGUE_PHOTOS }
        : {}),
      ...(process.env.MOBILE_CUSTOMER_MODE !== undefined
        ? { customerMode: process.env.MOBILE_CUSTOMER_MODE }
        : {}),
      ...(process.env.MOBILE_PUSH_MODE !== undefined
        ? { pushMode: process.env.MOBILE_PUSH_MODE }
        : {}),
      ...(process.env.MOBILE_DELETION_MODE !== undefined
        ? { deletionMode: process.env.MOBILE_DELETION_MODE }
        : {}),
      ...(process.env.MOBILE_DELETION_FOLLOW_UP_MODE !== undefined
        ? { deletionFollowUpMode: process.env.MOBILE_DELETION_FOLLOW_UP_MODE }
        : {}),
      apiOrigin: process.env.MOBILE_API_ORIGIN,
      allowLoopbackHttp: process.env.MOBILE_ALLOW_LOOPBACK_API === 'true',
    };
    if (
      process.env.MOBILE_ALLOW_LOOPBACK_API !== undefined &&
      !['true', 'false'].includes(process.env.MOBILE_ALLOW_LOOPBACK_API)
    )
      throw Error('Invalid mobile loopback configuration.');
    const resolved = resolveMobileReferenceConfig(
      candidate,
      tenantSlug,
      ['development', 'test'].includes(process.env.NODE_ENV ?? ''),
    );
    if (resolved.mode !== 'synthetic-reference-public-v1')
      throw Error('Invalid synthetic mobile catalogue configuration.');
    extra.mobileReference = candidate;
  } else if (
    process.env.MOBILE_CATALOGUE_VIDEO !== undefined ||
    process.env.MOBILE_CATALOGUE_FLOOR_PLAN !== undefined ||
    process.env.MOBILE_CATALOGUE_PHOTOS !== undefined ||
    process.env.MOBILE_CUSTOMER_MODE !== undefined ||
    process.env.MOBILE_PUSH_MODE !== undefined ||
    process.env.MOBILE_DELETION_MODE !== undefined ||
    process.env.MOBILE_DELETION_FOLLOW_UP_MODE !== undefined ||
    process.env.MOBILE_API_ORIGIN !== undefined ||
    process.env.MOBILE_ALLOW_LOOPBACK_API !== undefined
  ) {
    throw Error('An explicit mobile catalogue mode is required.');
  }
  return {
    ...config,
    name: `${brand.name} Preview`,
    slug: `${tenantSlug}-preview`,
    scheme: `${tenantSlug}-preview`,
    icon,
    android: {
      ...config.android,
      package: applicationId,
      ...(links
        ? {
            intentFilters: [
              ...(config.android?.intentFilters ?? []),
              {
                action: 'VIEW',
                autoVerify: true,
                category: ['BROWSABLE', 'DEFAULT'],
                data: [
                  { scheme: 'https', host: links.hostname, pathPrefix: propertyLinkPathPrefix },
                ],
              },
            ],
          }
        : {}),
      adaptiveIcon: {
        ...config.android?.adaptiveIcon,
        foregroundImage: adaptiveIcon,
        backgroundColor: brand.primary,
      },
    },
    ios: {
      ...config.ios,
      bundleIdentifier: applicationId,
      ...(links
        ? {
            associatedDomains: [
              ...new Set([...(config.ios?.associatedDomains ?? []), 'applinks:' + links.hostname]),
            ],
          }
        : {}),
    },
    extra,
  };
};
