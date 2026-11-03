import { RealtorApiClient } from '@realtor/api-client';
import type { ListingVideo } from '@realtor/domain';
import { resolveCatalogueConfig, type CatalogueEnvironment } from './catalogue-config.ts';
export type PublicVideoResult =
  | Readonly<{ status: 'off' }>
  | Readonly<{ status: 'unavailable' }>
  | Readonly<{ status: 'ready'; video: ListingVideo | null }>;
/** An anonymous read of the approved revision, never a private/draft fallback. */
export async function readPublicVideo(
  property: { id: string; revision: number | null; reference?: { revisionVersion: string | null } },
  env: CatalogueEnvironment & { readonly WEB_CATALOGUE_VIDEO?: string },
  transport?: typeof fetch,
  signal?: AbortSignal,
): Promise<PublicVideoResult> {
  if (env.WEB_CATALOGUE_VIDEO === undefined) return Object.freeze({ status: 'off' });
  try {
    const resolved = resolveCatalogueConfig(env);
    if (
      env.WEB_CATALOGUE_VIDEO !== 'synthetic-listing-video-publication-v1' ||
      resolved.status !== 'ready' ||
      resolved.config.mode !== 'connected' ||
      resolved.config.dataKind !== 'synthetic' ||
      !['development', 'test'].includes(env.NODE_ENV ?? '') ||
      property.revision === null
    )
      throw Error('Unavailable');
    const c = resolved.config;
    const api = new RealtorApiClient({
      baseUrl: c.apiOrigin,
      allowLoopbackHttp: c.allowLoopbackHttp,
      privacyNoticeVersion: 'public-video-read-only',
      ...(transport ? { fetch: transport } : {}),
    });
    const saved = await api.getPublishedListingVideo(property.id, property.revision, { signal });
    if (
      property.reference?.revisionVersion &&
      saved.approvedVersion !== property.reference.revisionVersion
    )
      throw Error('Approved version changed');
    return Object.freeze({ status: 'ready', video: saved.video });
  } catch {
    return Object.freeze({ status: 'unavailable' });
  }
}
