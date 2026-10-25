import {
  RealtorApiClient,
  type PublicPhoto,
  type PublicPropertyV2,
  type SyntheticReferencePublicPropertyV3,
  type SyntheticReferencePublicSnapshot,
  type PropertyType,
} from '@realtor/api-client';
import { propertiesForCompany, type DemoProperty } from '@realtor/demo';
import { searchCatalogue, type SearchQuery } from '@realtor/demo/search';
import {
  calculateWirePricingV2,
  kesFromMajor,
  kesFromMinor,
  matchesNumericRange,
  validatePublicLocationV2,
  type PricingDisclosure,
  type PublicLocationV2,
  type RentalPeriod,
} from '@realtor/domain';
import {
  CATALOGUE_READ_ONLY_NOTICE,
  type CatalogueConfigResolution,
  type CatalogueDataKind,
} from './catalogue-config.ts';
import {
  parseReferenceFilters,
  matchesReferenceFilters,
  referenceOptions,
  type ReferenceFilters,
  type ReferenceOptions,
} from './catalogue-reference-filters.ts';
import { browseLoadedCatalogue, LOADED_PAGE_SIZE } from './catalogue-browse.ts';
export { resolveCatalogueConfig } from './catalogue-config.ts';
export type {
  CatalogueConfig,
  CatalogueConfigResolution,
  CatalogueDataKind,
  CatalogueEnvironment,
} from './catalogue-config.ts';
export type CatalogueQuery = SearchQuery;
export interface CatalogueFilters {
  readonly reference: ReferenceFilters;
  readonly location: string;
  readonly purpose: string;
  readonly type: string;
  readonly period: string;
  readonly maxText: string;
  readonly bedsText: string;
  readonly privateBathsText: string;
  readonly sharedBathsText: string;
  readonly error: string | null;
}
export interface CatalogueProperty {
  readonly id: string;
  readonly slug: string;
  readonly revision: number | null;
  readonly title: string;
  readonly description: string;
  readonly purpose: 'rent' | 'sale';
  readonly type: PropertyType;
  readonly priceMinor: number;
  readonly rentalPeriod: RentalPeriod | null;
  readonly bedrooms: number | null;
  /** Demo fixtures disclose a general count, without asserting that bathrooms are private/shared. Connected totals are unknown. */
  readonly bathrooms: number | null;
  readonly privateBathrooms: number | null;
  readonly sharedBathrooms: number | null;
  readonly areaSqm: number | null;
  readonly amenities: readonly string[];
  readonly amenitiesKnown: boolean;
  readonly reference?: SyntheticReferencePublicSnapshot;
  readonly locality: string;
  readonly location: PublicLocationV2;
  readonly publicPrecision: 'area' | 'exact';
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly photos: readonly PublicPhoto[];
  readonly pricing: PricingDisclosure;
}
interface CatalogueSource {
  readonly mode: 'demo' | 'connected';
  readonly dataKind: CatalogueDataKind;
  readonly sourceLabel: string;
}
export interface CatalogueSuccess extends CatalogueSource {
  readonly referenceOptionsScope?: 'catalogue';
  readonly searchPage?: Readonly<{
    total: number;
    offset: number;
    hasMore: boolean;
    maxOffset: number;
  }>;
  readonly referenceOptions: ReferenceOptions;
  readonly filters: CatalogueFilters;
  readonly items: readonly CatalogueProperty[];
  readonly sourceCount: number;
  readonly limit: number | null;
  readonly mayBeTruncated: boolean;
}
export interface CatalogueFailure {
  readonly mode: 'error';
  readonly sourceMode: 'demo' | 'connected' | 'configuration';
  readonly code: 'CONFIGURATION' | 'UNAVAILABLE';
  readonly message: string;
  readonly filters: CatalogueFilters;
}
export type CatalogueResult = CatalogueSuccess | CatalogueFailure;
export type CatalogueDetailResult =
  | (CatalogueSource & { readonly status: 'found'; readonly property: CatalogueProperty })
  | (CatalogueSource & { readonly status: 'not_found' })
  | (CatalogueSource & {
      readonly status: 'incomplete';
      readonly limit: number;
      readonly message: string;
    })
  | CatalogueFailure;
export interface CatalogueLoader {
  list(query?: CatalogueQuery): Promise<CatalogueResult>;
  detail(id: string): Promise<CatalogueDetailResult>;
}
export interface CatalogueDependencies {
  readonly fetch?: typeof globalThis.fetch;
}
export const CATALOGUE_UNAVAILABLE_MESSAGE =
  'The property catalogue could not be loaded. Please try again later.';
export const CATALOGUE_INCOMPLETE_MESSAGE =
  'This property was not found in the loaded catalogue. The catalogue may contain additional properties.';
const ADDITIONAL_API_TYPES = new Set(['bungalow', 'townhouse', 'villa', 'commercial']);
const RENTAL_PERIODS = new Set(['day', 'week', 'month', 'year']);

/** Preserve the existing search validation/decimal-KES semantics, extending its type list to all nine API types. */
export function parseCatalogueFilters(query: CatalogueQuery): CatalogueFilters {
  const type = typeof query.type === 'string' ? query.type.trim() : '';
  const period = typeof query.period === 'string' ? query.period.trim() : '';
  const validationQuery = ADDITIONAL_API_TYPES.has(type) ? { ...query, type: '' } : query;
  // This pure shared helper supplies only validation state here; none of its demo items are returned.
  const parsed = searchCatalogue('realtime-estates', validationQuery);
  let error = parsed.error;
  if (query.period !== undefined && typeof query.period !== 'string')
    error = 'Use one value for each search filter.';
  if (period && !RENTAL_PERIODS.has(period)) error = 'Choose a supported rental period.';
  if (!error && parsed.maxText && parsed.purpose !== 'sale' && !period)
    error = 'Choose a rental period when filtering rent by price.';
  const room = (key: string, message: string) => {
    const raw = query[key];
    if (raw !== undefined && typeof raw !== 'string') {
      error = 'Use one value for each search filter.';
      return '';
    }
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (value && (!/^(0|[1-9]\d{0,2})$/.test(value) || Number(value) > 100)) error = message;
    return value;
  };
  const bedsText = room('beds', 'Choose an exact bedroom count from 0 to 100.');
  const privateBathsText = room(
    'privateBaths',
    'Choose a minimum private bathroom count from 0 to 100.',
  );
  const sharedBathsText = room(
    'sharedBaths',
    'Choose a minimum shared bathroom count from 0 to 100.',
  );
  const reference = parseReferenceFilters(query);
  if (reference.invalid.length)
    error = 'Choose one supported location or amenity option per field.';
  // An absent/empty period includes all rents; a maximum requires an explicit rent period.
  return Object.freeze({
    reference: reference.values,
    location: parsed.location,
    purpose: parsed.purpose,
    type,
    period,
    maxText: parsed.maxText,
    bedsText,
    privateBathsText,
    sharedBathsText,
    error,
  });
}
function fromDemo(property: DemoProperty): CatalogueProperty {
  return Object.freeze({
    id: property.id,
    slug: property.id,
    revision: null,
    title: property.title,
    description: property.description,
    purpose: property.purpose,
    type: property.type,
    priceMinor: property.priceMinor,
    rentalPeriod: property.rentalPeriod,
    bedrooms: property.bedrooms,
    bathrooms: property.bathrooms,
    privateBathrooms: null,
    sharedBathrooms: null,
    areaSqm: property.areaSqm,
    amenities: Object.freeze([...property.amenities]),
    amenitiesKnown: true,
    locality: property.neighbourhood,
    location: validatePublicLocationV2({
      county: property.county,
      town: null,
      area: property.neighbourhood,
    }),
    publicPrecision: 'area',
    latitude: null,
    longitude: null,
    // The UI may show explicitly labelled demo concepts; they are not verified property-media references.
    photos: Object.freeze([]),
    pricing: calculateWirePricingV2(
      kesFromMinor(property.priceMinor),
      property.purpose,
      property.rentalPeriod,
      { declaration: 'not_declared', charges: [] },
    ),
  });
}
function fromConnected(
  property: PublicPropertyV2 | SyntheticReferencePublicPropertyV3,
): CatalogueProperty {
  const reference = 'reference' in property ? property.reference : undefined;
  const attributes = reference?.attributes;
  return Object.freeze({
    id: property.id,
    slug: property.slug,
    revision: property.revision,
    title: property.title,
    description: property.description,
    purpose: property.purpose,
    type: property.propertyType,
    priceMinor: property.amountMinor,
    rentalPeriod: property.rentPeriod,
    bedrooms: property.bedrooms,
    bathrooms: null,
    privateBathrooms: property.privateBathrooms,
    sharedBathrooms: property.sharedBathrooms,
    areaSqm: null,
    amenities: Object.freeze(attributes?.amenities.map((a) => a.label) ?? []),
    amenitiesKnown: attributes !== undefined && attributes !== null,
    ...(reference ? { reference } : {}),
    locality: property.locality,
    location: property.location,
    publicPrecision: property.publicPrecision,
    latitude: property.latitude,
    longitude: property.longitude,
    photos: Object.freeze(property.photos.map((photo) => Object.freeze({ ...photo }))),
    pricing: property.pricing,
  });
}
function filterItems(
  items: readonly CatalogueProperty[],
  filters: CatalogueFilters,
): readonly CatalogueProperty[] {
  if (filters.error) return Object.freeze([]);
  const maximum = filters.maxText ? kesFromMajor(filters.maxText).minorUnits : undefined;
  const location = filters.location.toLowerCase();
  return Object.freeze(
    items.filter((property) => {
      const searchableLocation = [
        property.locality,
        property.location.county,
        property.location.town,
        property.location.area,
      ]
        .filter((value) => value !== null)
        .join(' ')
        .toLowerCase();
      return (
        (!location || searchableLocation.includes(location)) &&
        matchesReferenceFilters(property, filters.reference) &&
        (!filters.purpose || property.purpose === filters.purpose) &&
        (!filters.type || property.type === filters.type) &&
        (!filters.bedsText ||
          (property.bedrooms !== null && property.bedrooms === Number(filters.bedsText))) &&
        (!filters.privateBathsText ||
          (property.privateBathrooms !== null &&
            property.privateBathrooms >= Number(filters.privateBathsText))) &&
        (!filters.sharedBathsText ||
          (property.sharedBathrooms !== null &&
            property.sharedBathrooms >= Number(filters.sharedBathsText))) &&
        (!filters.period ||
          property.purpose === 'sale' ||
          property.rentalPeriod === filters.period) &&
        (maximum === undefined ||
          matchesNumericRange(property.priceMinor, { max: { value: maximum, inclusive: true } }))
      );
    }),
  );
}
function failure(
  sourceMode: CatalogueFailure['sourceMode'],
  filters: CatalogueFilters,
  code: CatalogueFailure['code'] = 'UNAVAILABLE',
  message = CATALOGUE_UNAVAILABLE_MESSAGE,
): CatalogueFailure {
  return Object.freeze({ mode: 'error', sourceMode, code, message, filters });
}

/** No cache or automatic fallback. The actual SDK enforces no-store, omitted credentials and rejected redirects. */
export function createCatalogueLoader(
  resolution: CatalogueConfigResolution,
  dependencies: CatalogueDependencies = {},
): CatalogueLoader {
  async function list(query: CatalogueQuery = {}): Promise<CatalogueResult> {
    const filters = parseCatalogueFilters(query);
    if (resolution.status === 'error')
      return failure('configuration', filters, resolution.code, resolution.message);
    const config = resolution.config;
    try {
      if (config.mode === 'demo') {
        const source = propertiesForCompany(config.tenantSlug).map(fromDemo);
        return Object.freeze({
          mode: 'demo',
          dataKind: 'synthetic',
          sourceLabel: 'Demo · Synthetic listings',
          referenceOptions: referenceOptions(source),
          filters,
          items: filterItems(source, filters),
          sourceCount: source.length,
          limit: null,
          mayBeTruncated: false,
        });
      }
      // A fresh read-only SDK instance/request on every load avoids sharing request credentials or response state.
      const api = new RealtorApiClient({
        baseUrl: config.apiOrigin,
        privacyNoticeVersion: CATALOGUE_READ_ONLY_NOTICE,
        allowLoopbackHttp: config.allowLoopbackHttp,
        ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
      });
      if (config.searchMode) {
        const browse = browseLoadedCatalogue([], filters, query);
        const offset = (browse.page - 1) * LOADED_PAGE_SIZE;
        const problem =
          filters.error ??
          browse.error ??
          (offset > 10000 ? 'Choose a page within the supported search range.' : null) ??
          (!config.referenceMode && Object.values(filters.reference).some(Boolean)
            ? 'Reference filters require a reference catalogue.'
            : null);
        const input = {
          location: filters.location,
          purpose: filters.purpose as 'rent' | 'sale',
          type: filters.type as PropertyType,
          period: filters.period as RentalPeriod,
          max: filters.maxText,
          beds: filters.bedsText,
          privateBaths: filters.privateBathsText,
          sharedBaths: filters.sharedBathsText,
          sort: browse.sort as 'catalogue' | 'title' | 'price_low' | 'price_high',
          limit: LOADED_PAGE_SIZE,
          offset,
          ...(config.referenceMode ? filters.reference : {}),
        };
        const pageRead = problem
          ? { items: [], total: 0, offset: 0, hasMore: false, maxOffset: 10000 }
          : config.referenceMode
            ? api.searchSyntheticReferencePropertiesV3(input)
            : api.searchPropertiesV2(input);
        const reads = await Promise.allSettled([
          Promise.resolve(pageRead),
          config.referenceMode ? api.getSyntheticReferenceSearchOptions() : Promise.resolve(null),
        ] as const);
        if (reads[0].status === 'rejected' || reads[1].status === 'rejected')
          throw Error('Catalogue search or public choices unavailable.');
        const page = reads[0].value,
          referenceChoices = reads[1].value;
        const source = page.items.map(fromConnected);
        return Object.freeze({
          mode: 'connected',
          dataKind: config.dataKind,
          sourceLabel: config.referenceMode
            ? 'API connected · Synthetic reference search'
            : 'API connected · Catalogue search',
          filters: problem ? Object.freeze({ ...filters, error: problem }) : filters,
          items: Object.freeze(source),
          referenceOptions: referenceChoices ?? referenceOptions(source),
          ...(referenceChoices ? { referenceOptionsScope: 'catalogue' as const } : {}),
          sourceCount: source.length,
          limit: LOADED_PAGE_SIZE,
          mayBeTruncated: false,
          searchPage: Object.freeze({
            total: page.total,
            offset: page.offset,
            hasMore: page.hasMore,
            maxOffset: page.maxOffset,
          }),
        });
      }
      const page = config.referenceMode
        ? await api.getSyntheticReferencePropertiesV3({ limit: config.limit })
        : await api.listPropertiesV2({ limit: config.limit });
      const source = page.items.map(fromConnected);
      return Object.freeze({
        mode: 'connected',
        referenceOptions: referenceOptions(source),
        dataKind: config.dataKind,
        sourceLabel: config.referenceMode
          ? 'API connected · Synthetic reference preview'
          : 'API connected · Preview environment',
        filters,
        items: filterItems(source, filters),
        sourceCount: source.length,
        limit: page.limit,
        mayBeTruncated: source.length === page.limit,
      });
    } catch {
      return failure(config.mode, filters);
    }
  }
  async function detail(id: string): Promise<CatalogueDetailResult> {
    if (
      resolution.status === 'ready' &&
      resolution.config.mode === 'connected' &&
      resolution.config.searchMode
    ) {
      const config = resolution.config;
      try {
        const api = new RealtorApiClient({
          baseUrl: config.apiOrigin,
          privacyNoticeVersion: CATALOGUE_READ_ONLY_NOTICE,
          allowLoopbackHttp: config.allowLoopbackHttp,
          ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
        });
        const page = config.referenceMode
          ? await api.searchSyntheticReferencePropertiesV3({ id, limit: 1 })
          : await api.searchPropertiesV2({ id, limit: 1 });
        const source = {
          mode: 'connected' as const,
          dataKind: config.dataKind,
          sourceLabel: config.referenceMode
            ? 'API connected · Synthetic reference search'
            : 'API connected · Catalogue search',
        };
        if (page.total > 1 || page.items.some((item) => item.id !== id))
          throw Error('Invalid property lookup');
        return page.items[0]
          ? Object.freeze({ ...source, status: 'found', property: fromConnected(page.items[0]) })
          : Object.freeze({ ...source, status: 'not_found' });
      } catch {
        return failure('connected', parseCatalogueFilters({}));
      }
    }
    const result = await list();
    if (result.mode === 'error') return result;
    const source = {
      mode: result.mode,
      dataKind: result.dataKind,
      sourceLabel: result.sourceLabel,
    } as const;
    const property = result.items.find((item) => item.id === id);
    if (property) return Object.freeze({ ...source, status: 'found', property });
    if (result.mayBeTruncated && result.limit !== null)
      return Object.freeze({
        ...source,
        status: 'incomplete',
        limit: result.limit,
        message: CATALOGUE_INCOMPLETE_MESSAGE,
      });
    return Object.freeze({ ...source, status: 'not_found' });
  }
  return Object.freeze({ list, detail });
}
