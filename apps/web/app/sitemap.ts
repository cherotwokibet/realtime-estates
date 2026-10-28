import { RealtorApiClient } from '@realtor/api-client';
import { publicSitemap } from '../lib/public-seo';
import { publicSeoPolicy } from '../lib/public-seo-server';
import { resolveCatalogueConfig } from '../lib/catalogue-config';
export const dynamic = 'force-dynamic';
export default async function sitemap() {
  return publicSitemap(publicSeoPolicy, async (offset) => {
    const config = resolveCatalogueConfig(process.env);
    if (config.status !== 'ready' || config.config.mode !== 'connected')
      throw Error('Sitemap catalogue unavailable.');
    const api = new RealtorApiClient({
      baseUrl: config.config.apiOrigin,
      privacyNoticeVersion: 'public-sitemap',
    });
    return api.searchPropertiesV2({ offset, limit: 100, sort: 'catalogue' });
  });
}
