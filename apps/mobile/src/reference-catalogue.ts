import {
  RealtorApiClient,
  type SyntheticReferencePublicPropertyV3,
  type PublicSearchInput,
} from '@realtor/api-client';
import { resolveDemoTenantSlug, type DemoTenantSlug } from '@realtor/demo';
import { formatKes, kesFromMinor } from '@realtor/domain';

export type MobileReferenceConfig =
  | Readonly<{ mode: 'demo' }>
  | Readonly<{ mode: 'error' }>
  | Readonly<{
      mode: 'synthetic-reference-public-v1';
      tenantSlug: DemoTenantSlug;
      apiOrigin: string;
      allowLoopbackHttp: boolean;
      videoMode?: 'synthetic-listing-video-publication-v1';
    }>;

/** Public build configuration only. A device never receives staff credentials or a tenant override. */
export function resolveMobileReferenceConfig(
  input: unknown,
  tenant: unknown,
  development: boolean,
): MobileReferenceConfig {
  if (input === undefined) return Object.freeze({ mode: 'demo' });
  try {
    if (!development || input === null || typeof input !== 'object' || Array.isArray(input))
      throw Error('Unsupported preview');
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const allowed = [
      'mode',
      'apiOrigin',
      'allowLoopbackHttp',
      ...(Object.hasOwn(input, 'videoMode') ? ['videoMode'] : []),
    ];
    if (Reflect.ownKeys(input).length !== allowed.length) throw Error('Invalid fields');
    for (const key of Reflect.ownKeys(input))
      if (typeof key !== 'string' || !allowed.includes(key) || !('value' in descriptors[key]!))
        throw Error('Invalid field');
    const mode = descriptors.mode?.value,
      apiOrigin = descriptors.apiOrigin?.value,
      allowLoopbackHttp = descriptors.allowLoopbackHttp?.value;
    if (
      mode !== 'synthetic-reference-public-v1' ||
      typeof apiOrigin !== 'string' ||
      typeof allowLoopbackHttp !== 'boolean'
    )
      throw Error('Invalid configuration');
    const videoMode = descriptors.videoMode?.value;
    if (Object.hasOwn(input, 'videoMode') && videoMode !== 'synthetic-listing-video-publication-v1')
      throw Error('Invalid video mode');
    const tenantSlug = resolveDemoTenantSlug(tenant);
    new RealtorApiClient({
      baseUrl: apiOrigin,
      privacyNoticeVersion: 'mobile-catalogue-read-only',
      allowLoopbackHttp,
    });
    return Object.freeze({
      mode,
      tenantSlug,
      apiOrigin: new URL(apiOrigin).origin,
      allowLoopbackHttp,
      ...(videoMode ? { videoMode } : {}),
    });
  } catch {
    return Object.freeze({ mode: 'error' });
  }
}

export interface MobileReferenceItem {
  readonly property: SyntheticReferencePublicPropertyV3;
  readonly location: string;
  readonly base: string;
  readonly recurring: string | null;
  readonly initial: string;
  readonly amenities: readonly Readonly<{ id: string; label: string }>[] | null;
}
export type MobileReferenceResult =
  | Readonly<{ status: 'error' }>
  | Readonly<{
      status: 'ready';
      items: readonly MobileReferenceItem[];
      mayBeTruncated: boolean;
      searchPage?: Readonly<{
        total: number;
        offset: number;
        limit: number;
        hasMore: boolean;
        maxOffset: number;
      }>;
    }>;

/** One anonymous bounded SDK read. Errors never substitute demo stock or expose transport details. */
export async function loadMobileReferenceCatalogue(
  config: MobileReferenceConfig,
  options: Readonly<{
    signal?: AbortSignal;
    fetch?: typeof globalThis.fetch;
    search?: PublicSearchInput;
  }> = {},
): Promise<MobileReferenceResult> {
  if (config.mode !== 'synthetic-reference-public-v1') return Object.freeze({ status: 'error' });
  try {
    const api = new RealtorApiClient({
      baseUrl: config.apiOrigin,
      allowLoopbackHttp: config.allowLoopbackHttp,
      privacyNoticeVersion: 'mobile-catalogue-read-only',
      ...(options.fetch ? { fetch: options.fetch } : {}),
    });
    const page = options.search
      ? await api.searchSyntheticReferencePropertiesV3(options.search, { signal: options.signal })
      : await api.getSyntheticReferencePropertiesV3({
          limit: 100,
          signal: options.signal,
        });
    const items = page.items.map((property) => {
      const attributes = property.reference.attributes;
      return Object.freeze({
        property,
        location: [property.location.area, property.location.town, property.location.county]
          .filter((value) => value !== null)
          .join(', '),
        base: formatKes(kesFromMinor(property.amountMinor)),
        recurring: property.pricing.knownMandatory.recurringSubtotal
          ? formatKes(property.pricing.knownMandatory.recurringSubtotal)
          : null,
        initial: formatKes(property.pricing.knownMandatory.initialSubtotal),
        // Null means legacy absence; an approved empty selection stays an empty list.
        amenities: attributes === null ? null : attributes.amenities,
      });
    });
    return Object.freeze({
      status: 'ready',
      items: Object.freeze(items),
      mayBeTruncated: !('total' in page) && items.length === page.limit,
      ...('total' in page
        ? {
            searchPage: Object.freeze({
              total: page.total,
              offset: page.offset,
              limit: page.limit,
              hasMore: page.hasMore,
              maxOffset: page.maxOffset,
            }),
          }
        : {}),
    });
  } catch {
    return Object.freeze({ status: 'error' });
  }
}

/** Search only the bounded loaded public page; it cannot discover omitted pages. */
export function searchMobileReferenceItems(items: readonly MobileReferenceItem[], query: string) {
  const term = query.trim().toLocaleLowerCase('en');
  return Object.freeze(
    items.filter((item) => item.location.toLocaleLowerCase('en').includes(term)),
  );
}
