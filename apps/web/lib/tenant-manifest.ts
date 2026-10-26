import {
  brandThemeCss,
  createBrandTheme,
  validateTenantBrandConfig,
  type TenantBrandConfig,
} from '@realtor/domain';
import type { DemoTenantSlug } from '@realtor/demo';
import {
  parseDeploymentJson,
  validatePublicCompanyContent,
  type PublicCompanyContent,
} from './public-company-content.ts';

/** A deployment-scoped presentation manifest. It cannot select data or authorize services. */
export type TenantManifest = Readonly<{
  policy: 'realtor-tenant-manifest-v1';
  slug: DemoTenantSlug;
  brand: TenantBrandConfig;
  theme: ReturnType<typeof createBrandTheme>;
  themeCss: Readonly<Record<string, string>>;
  features: Readonly<{ advisorProfiles: boolean; contactActions: boolean }>;
  companyContent?: PublicCompanyContent;
}>;

export type TenantManifestResolution =
  | Readonly<{ status: 'absent' | 'invalid' }>
  | Readonly<{ status: 'configured'; manifest: TenantManifest }>;

function invalid(): never {
  throw Error('Invalid tenant deployment manifest.');
}

function exactRecord(input: unknown, required: readonly string[], optional: readonly string[]) {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    return invalid();
  const keys = Reflect.ownKeys(input);
  if (
    keys.some((key) => typeof key !== 'string' || ![...required, ...optional].includes(key)) ||
    required.some((key) => !Object.hasOwn(input, key))
  )
    return invalid();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys as string[]) {
    const field = Object.getOwnPropertyDescriptor(input, key);
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) return invalid();
    result[key] = field.value;
  }
  return result;
}

/** Validate trusted deployment JSON; browser input never reaches this resolver. */
export function resolveTenantManifest(
  source: unknown,
  configuredSlug: DemoTenantSlug,
): TenantManifestResolution {
  if (source === undefined) return Object.freeze({ status: 'absent' });
  try {
    if (typeof source !== 'string' || !source) return invalid();
    const root = exactRecord(
      parseDeploymentJson(source),
      ['policy', 'slug', 'brand', 'features'],
      ['companyContent'],
    );
    if (root.policy !== 'realtor-tenant-manifest-v1' || root.slug !== configuredSlug)
      return invalid();

    const brand = validateTenantBrandConfig(root.brand);
    if (brand.slug !== configuredSlug) return invalid();
    const features = exactRecord(root.features, ['advisorProfiles', 'contactActions'], []);
    if (
      typeof features.advisorProfiles !== 'boolean' ||
      typeof features.contactActions !== 'boolean'
    )
      return invalid();

    const companyContent = Object.hasOwn(root, 'companyContent')
      ? validatePublicCompanyContent(root.companyContent, configuredSlug)
      : undefined;
    const theme = createBrandTheme(brand.colors);
    return Object.freeze({
      status: 'configured',
      manifest: Object.freeze({
        policy: 'realtor-tenant-manifest-v1',
        slug: configuredSlug,
        brand,
        theme,
        themeCss: brandThemeCss(brand.colors),
        features: Object.freeze({
          advisorProfiles: features.advisorProfiles,
          contactActions: features.contactActions,
        }),
        ...(companyContent ? { companyContent } : {}),
      }),
    });
  } catch {
    return Object.freeze({ status: 'invalid' });
  }
}
