import { kesFromMajor, matchesNumericRange } from '@realtor/domain';
import { propertiesForCompany, resolveDemoTenantSlug, type DemoProperty } from './index.js';
export type SearchQuery = Record<string, string | string[] | undefined>;
export type CatalogueSearch = {
  location: string;
  purpose: string;
  type: string;
  maxText: string;
  error: string | null;
  items: readonly DemoProperty[];
};
export function searchCatalogue(tenantSlug: string, query: SearchQuery): CatalogueSearch {
  resolveDemoTenantSlug(tenantSlug);
  const value = (key: string) => (typeof query[key] === 'string' ? query[key].trim() : '');
  const location = value('location'),
    purpose = value('purpose'),
    type = value('type'),
    maxText = value('max');
  let maximum: number | undefined,
    error: string | null = null;
  const malformedKeys = ['location', 'purpose', 'type', 'max'].filter(
    (key) => query[key] !== undefined && typeof query[key] !== 'string',
  );
  if (malformedKeys.length) error = 'Use one value for each search filter.';
  if (purpose && !['rent', 'sale'].includes(purpose)) error = 'Choose rent or buy.';
  if (type && !['apartment', 'bedsitter', 'studio', 'maisonette', 'land'].includes(type))
    error = 'Choose a supported property type.';
  if (maxText) {
    try {
      maximum = kesFromMajor(maxText).minorUnits;
      if (maximum <= 0) error = 'Enter a positive maximum price in KES.';
    } catch {
      error = 'Enter a valid KES amount with at most two decimal places.';
    }
  }
  const items = error
    ? []
    : propertiesForCompany(tenantSlug).filter(
        (p) =>
          (!location ||
            (p.neighbourhood + ' ' + p.county).toLowerCase().includes(location.toLowerCase())) &&
          (!purpose || p.purpose === purpose) &&
          (!type || p.type === type) &&
          (maximum === undefined ||
            matchesNumericRange(p.priceMinor, { max: { value: maximum, inclusive: true } })),
      );
  return { location, purpose, type, maxText, error, items };
}
