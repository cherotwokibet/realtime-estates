import type { Metadata, MetadataRoute } from 'next';
import type { CatalogueDetailResult } from './catalogue.ts';
import { resolveCatalogueConfig, type CatalogueEnvironment } from './catalogue-config.ts';
import { formatKes, kesFromMinor } from '@realtor/domain';

export type PublicSeoPolicy = Readonly<{ origin: string | null; index: boolean }>;
type SeoEnvironment = CatalogueEnvironment & { WEB_PUBLIC_ORIGIN?: string; WEB_INDEXING?: string };

/** Deployment configuration only; request Host/forwarded headers never select canonical URLs. */
export function resolvePublicSeoPolicy(env: SeoEnvironment): PublicSeoPolicy {
  const mode = env.WEB_INDEXING ?? 'disabled';
  if (!['disabled', 'approved'].includes(mode)) throw Error('Invalid public SEO configuration.');
  let origin: string | null = null;
  if (env.WEB_PUBLIC_ORIGIN !== undefined) {
    const raw = env.WEB_PUBLIC_ORIGIN;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw Error('Invalid public SEO origin.');
    }
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash ||
      raw !== url.origin ||
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname) ||
      url.hostname.includes(':')
    )
      throw Error('Invalid public SEO origin.');
    origin = url.origin;
  }
  if (mode === 'approved') {
    const resolution = resolveCatalogueConfig(env);
    if (
      !origin ||
      env.NODE_ENV !== 'production' ||
      resolution.status !== 'ready' ||
      resolution.config.mode !== 'connected' ||
      resolution.config.dataKind !== 'unspecified' ||
      resolution.config.referenceMode ||
      resolution.config.searchMode !== 'public-search-v1' ||
      resolution.config.allowLoopbackHttp
    )
      throw Error('Indexing requires an approved production catalogue and origin.');
  }
  return Object.freeze({ origin, index: mode === 'approved' });
}

export function publicPageMetadata(
  policy: PublicSeoPolicy,
  brand: string,
  path: string,
  title: string,
  description: string,
  index = policy.index,
): Metadata {
  const url = policy.origin ? new URL(path, policy.origin).href : undefined;
  const fullTitle = `${title} | ${brand}`;
  const images = policy.origin
    ? [{ url: `${policy.origin}/sharing-card`, width: 1200, height: 630, alt: brand }]
    : undefined;
  return {
    title: fullTitle,
    description,
    robots: { index: policy.index && index, follow: policy.index },
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: {
      type: 'website',
      locale: 'en_KE',
      siteName: brand,
      title: fullTitle,
      description,
      ...(url ? { url } : {}),
      ...(images ? { images } : {}),
    },
    twitter: {
      card: 'summary_large_image',
      title: fullTitle,
      description,
      ...(images ? { images: images.map((image) => image.url) } : {}),
    },
  };
}

export function propertyPageMetadata(
  policy: PublicSeoPolicy,
  brand: string,
  result: CatalogueDetailResult,
): Metadata {
  if (result.mode === 'error' || result.status !== 'found')
    return {
      title: `Property unavailable | ${brand}`,
      description: 'This property could not be displayed.',
      robots: { index: false, follow: false },
      openGraph: {
        title: `Property unavailable | ${brand}`,
        description: 'This property could not be displayed.',
      },
      twitter: {
        title: `Property unavailable | ${brand}`,
        description: 'This property could not be displayed.',
      },
    };
  const p = result.property;
  const synthetic = result.mode === 'demo' || result.dataKind === 'synthetic';
  const location = [p.location.area, p.location.town, p.location.county].filter(Boolean).join(', ');
  const description = `${synthetic ? 'Synthetic preview. No real availability. ' : ''}${formatKes(kesFromMinor(p.priceMinor))}${p.rentalPeriod ? ` per ${p.rentalPeriod}` : ''} base price. ${location || 'Public location not supplied'}. View itemized fees and property details.`;
  return publicPageMetadata(
    policy,
    brand,
    `/properties/${encodeURIComponent(p.id)}`,
    p.title,
    description,
    !synthetic,
  );
}

export function publicRobots(policy: PublicSeoPolicy): MetadataRoute.Robots {
  return policy.index && policy.origin
    ? {
        rules: { userAgent: '*', allow: '/', disallow: ['/api/'] },
        sitemap: `${policy.origin}/sitemap.xml`,
      }
    : { rules: { userAgent: '*', disallow: '/' } };
}

type SitemapPage = Readonly<{
  items: readonly { id: string }[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}>;
/** Bounded complete traversal. Fail instead of publishing a silently truncated or inconsistent sitemap. */
export async function publicSitemap(
  policy: PublicSeoPolicy,
  readPage: (offset: number) => Promise<SitemapPage>,
): Promise<MetadataRoute.Sitemap> {
  if (!policy.index || !policy.origin) return [];
  const ids = new Set<string>();
  let total: number | undefined;
  for (let offset = 0; ; offset += 100) {
    const page = await readPage(offset);
    if (
      !Number.isInteger(page.total) ||
      page.total < 0 ||
      page.total > 10000 ||
      (total !== undefined && page.total !== total) ||
      page.offset !== offset ||
      page.limit !== 100 ||
      page.items.length !== Math.min(100, Math.max(0, page.total - offset)) ||
      page.hasMore !== offset + page.items.length < page.total
    )
      throw Error('Public sitemap catalogue is incomplete.');
    total = page.total;
    for (const item of page.items) {
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id) ||
        ids.has(item.id)
      )
        throw Error('Invalid public sitemap property.');
      ids.add(item.id);
    }
    if (!page.hasMore) break;
  }
  return [
    { url: `${policy.origin}/` },
    ...[...ids].map((id) => ({ url: `${policy.origin}/properties/${id}` })),
  ];
}
