import { getDemoBrand, resolveDemoTenantSlug, type DemoTenantSlug } from '@realtor/demo';
import { resolveCatalogueConfig } from './catalogue-config.ts';
import { publicIntakeConfig } from './intake-config.ts';
import {
  resolvePublicCompanyContent,
  type PublicCompanyContent,
} from './public-company-content.ts';
import { resolveTenantManifest } from './tenant-manifest.ts';

export type PublicAdvisor = Readonly<{
  id: string;
  name: string;
  role: string;
  bio: string | null;
  source: 'synthetic' | 'configuration';
}>;
export type PublicCompanyInfo = Readonly<{
  slug: DemoTenantSlug;
  name: string;
  mode: 'demo' | 'connected' | 'unavailable';
  synthetic: boolean;
  contentStatus: 'absent' | 'configured' | 'invalid';
  content: PublicCompanyContent | null;
  advisors: readonly PublicAdvisor[];
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
  const manifest = resolveTenantManifest(environment.TENANT_MANIFEST_JSON, slug);
  const resolution =
    manifest.status === 'invalid'
      ? manifest
      : manifest.status === 'configured'
        ? manifest.manifest.companyContent
          ? { status: 'configured' as const, content: manifest.manifest.companyContent }
          : { status: 'absent' as const }
        : resolvePublicCompanyContent(environment.WEB_PUBLIC_COMPANY_CONTENT, slug);
  const features = manifest.status === 'configured' ? manifest.manifest.features : null;
  const resolvedContent = resolution.status === 'configured' ? resolution.content : null;
  const content = resolvedContent
    ? Object.freeze({
        policy: resolvedContent.policy,
        companySlug: resolvedContent.companySlug,
        company: resolvedContent.company,
        advisors: resolvedContent.advisors,
        ...(features?.contactActions === false
          ? {}
          : resolvedContent.contact
            ? { contact: resolvedContent.contact }
            : manifest.status === 'configured'
              ? {
                  contact: Object.freeze({
                    email: manifest.manifest.brand.contact.email,
                    phone: manifest.manifest.brand.contact.phone,
                  }),
                }
              : {}),
      })
    : null;
  const advisors: readonly PublicAdvisor[] = Object.freeze(
    content && features?.advisorProfiles !== false
      ? content.advisors.map((advisor) =>
          Object.freeze({ ...advisor, source: 'configuration' as const }),
        )
      : resolution.status === 'absent' && synthetic && manifest.status === 'absent'
        ? [
            Object.freeze({
              id: advisorIds[slug],
              name: 'Sample property advisor',
              role: 'Synthetic profile for interface testing',
              bio: null,
              source: 'synthetic' as const,
            }),
          ]
        : [],
  );
  let testEnquiry = false;
  try {
    publicIntakeConfig(environment);
    testEnquiry = true;
  } catch {}
  return Object.freeze({
    slug,
    name:
      manifest.status === 'configured'
        ? manifest.manifest.brand.companyName
        : getDemoBrand(slug).name,
    mode: catalogue.status === 'ready' ? catalogue.config.mode : 'unavailable',
    synthetic,
    contentStatus: resolution.status,
    content,
    advisors,
    advisor: advisors[0] ?? null,
    testEnquiry,
  });
}

/** An exact, configured company-bound ID is required; display labels never resolve identities. */
export function publicAdvisor(info: PublicCompanyInfo, id: unknown): PublicAdvisor | undefined {
  return typeof id === 'string' ? info.advisors.find((advisor) => advisor.id === id) : undefined;
}
