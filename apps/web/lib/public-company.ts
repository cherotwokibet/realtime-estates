import { getDemoBrand, resolveDemoTenantSlug, type DemoTenantSlug } from '@realtor/demo';
import { resolveCatalogueConfig } from './catalogue-config.ts';
import { publicIntakeConfig } from './intake-config.ts';

export type PublicAdvisor = Readonly<{
  id: string;
  name: 'Sample property advisor';
  role: 'Synthetic profile for interface testing';
}>;
export type PublicCompanyInfo = Readonly<{
  slug: DemoTenantSlug;
  name: string;
  mode: 'demo' | 'connected' | 'unavailable';
  synthetic: boolean;
  advisor: PublicAdvisor | null;
  testEnquiry: boolean;
}>;

const advisorIds: Readonly<Record<DemoTenantSlug, string>> = Object.freeze({
  'realtime-estates': 'sample-advisor-realtime',
  'sample-homes': 'sample-advisor-homes',
});

/** Deployment settings only. These presentation identities never select protected data or imply staff assignment. */
export function publicCompanyInfo(
  environment: Readonly<Record<string, string | undefined>>,
): PublicCompanyInfo {
  const slug = resolveDemoTenantSlug(environment.TENANT_SLUG);
  const catalogue = resolveCatalogueConfig(environment);
  const synthetic = catalogue.status === 'ready' && catalogue.config.dataKind === 'synthetic';
  let testEnquiry = false;
  try {
    publicIntakeConfig(environment);
    testEnquiry = true;
  } catch {}
  return Object.freeze({
    slug,
    name: getDemoBrand(slug).name,
    mode: catalogue.status === 'ready' ? catalogue.config.mode : 'unavailable',
    synthetic,
    advisor: synthetic
      ? Object.freeze({
          id: advisorIds[slug],
          name: 'Sample property advisor' as const,
          role: 'Synthetic profile for interface testing' as const,
        })
      : null,
    testEnquiry,
  });
}

/** An exact, configured company-bound ID is required; display labels never resolve identities. */
export function publicAdvisor(info: PublicCompanyInfo, id: unknown): PublicAdvisor | undefined {
  return typeof id === 'string' && info.advisor?.id === id ? info.advisor : undefined;
}
