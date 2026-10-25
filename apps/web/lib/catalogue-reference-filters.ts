import type { CatalogueProperty, CatalogueQuery } from './catalogue.ts';

export const REFERENCE_FILTER_KEYS = [
  'countyId',
  'localityId',
  'neighbourhoodId',
  'amenityId',
] as const;
export type ReferenceFilterKey = (typeof REFERENCE_FILTER_KEYS)[number];
export type ReferenceFilters = Readonly<Record<ReferenceFilterKey, string>>;
export type ReferenceOptions = Readonly<
  Record<ReferenceFilterKey, readonly Readonly<{ id: string; label: string }>[]>
>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function parseReferenceFilters(query: CatalogueQuery) {
  const values = {} as Record<ReferenceFilterKey, string>;
  const invalid: ReferenceFilterKey[] = [];
  for (const key of REFERENCE_FILTER_KEYS) {
    const raw = query[key];
    values[key] = typeof raw === 'string' ? raw : '';
    if (raw !== undefined && (typeof raw !== 'string' || (raw !== '' && !UUID.test(raw))))
      invalid.push(key);
  }
  return Object.freeze({ values: Object.freeze(values), invalid: Object.freeze(invalid) });
}
/** Only saved public identities match. Legacy/demo labels never become reference IDs. */
export function matchesReferenceFilters(
  property: CatalogueProperty,
  filters: ReferenceFilters,
): boolean {
  const attributes = property.reference?.attributes;
  return (
    (!filters.countyId || attributes?.location.county?.id === filters.countyId) &&
    (!filters.localityId || attributes?.location.locality?.id === filters.localityId) &&
    (!filters.neighbourhoodId ||
      attributes?.location.neighbourhood?.id === filters.neighbourhoodId) &&
    (!filters.amenityId ||
      attributes?.amenities.some((row) => row.id === filters.amenityId) === true)
  );
}
/** Facets describe only the unfiltered loaded selection, including its historical public labels. */
export function referenceOptions(items: readonly CatalogueProperty[]): ReferenceOptions {
  const result = {} as Record<
    ReferenceFilterKey,
    readonly Readonly<{ id: string; label: string }>[]
  >;
  for (const key of REFERENCE_FILTER_KEYS) {
    const labels = new Map<string, Set<string>>();
    for (const item of items) {
      const a = item.reference?.attributes;
      if (!a) continue;
      const path = [a.location.county, a.location.locality, a.location.neighbourhood];
      const index = ['countyId', 'localityId', 'neighbourhoodId'].indexOf(key);
      const rows =
        key === 'amenityId'
          ? a.amenities
          : path[index]
            ? [
                {
                  ...path[index]!,
                  label: path
                    .slice(0, index + 1)
                    .filter(Boolean)
                    .map((row) => row!.label)
                    .join(' › '),
                },
              ]
            : [];
      for (const row of rows) {
        if (!labels.has(row.id)) labels.set(row.id, new Set());
        labels.get(row.id)!.add(row.label);
      }
    }
    result[key] = Object.freeze(
      [...labels]
        .map(([id, variants]) => Object.freeze({ id, label: [...variants].sort().join(' / ') }))
        .sort((a, b) =>
          a.label < b.label ? -1 : a.label > b.label ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
        ),
    );
  }
  return Object.freeze(result);
}
