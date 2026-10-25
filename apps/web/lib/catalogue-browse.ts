import type { CatalogueFilters, CatalogueProperty, CatalogueQuery } from './catalogue.ts';
export const LOADED_PAGE_SIZE = 12;
export type LoadedSort = 'catalogue' | 'title' | 'price_low' | 'price_high';
export interface LoadedBrowse {
  readonly sort: string;
  readonly page: number;
  readonly pageCount: number;
  readonly matchingLoadedCount: number;
  readonly start: number;
  readonly end: number;
  readonly outOfRange: boolean;
  readonly error: string | null;
  readonly errorField: 'sort' | 'page' | null;
  readonly items: readonly CatalogueProperty[];
}
/** Presentation paging over the already loaded selection; never a global API count/cursor. */
export function browseLoadedCatalogue(
  items: readonly CatalogueProperty[],
  filters: CatalogueFilters,
  query: CatalogueQuery,
): LoadedBrowse {
  let error: string | null = filters.error,
    errorField: LoadedBrowse['errorField'] = null;
  const rawSort = query.sort,
    rawPage = query.page;
  const sort = typeof rawSort === 'string' ? rawSort.trim() || 'catalogue' : 'catalogue';
  if (
    (rawSort !== undefined && typeof rawSort !== 'string') ||
    !['catalogue', 'title', 'price_low', 'price_high'].includes(sort)
  ) {
    error = 'Choose a supported loaded-results order.';
    errorField = 'sort';
  }
  const pageText = typeof rawPage === 'string' ? rawPage.trim() : '';
  let page = 1;
  if (
    (rawPage !== undefined && typeof rawPage !== 'string') ||
    (pageText && (!/^[1-9]\d{0,6}$/.test(pageText) || Number(pageText) > 1000000))
  ) {
    error = 'Choose one whole-number page from 1 to 1000000.';
    errorField = 'page';
  } else if (pageText) page = Number(pageText);
  if (
    !error &&
    ['price_low', 'price_high'].includes(sort) &&
    !(filters.purpose === 'sale' || (filters.purpose === 'rent' && filters.period))
  ) {
    error = 'Choose rent with a rental period, or buy, before ordering by base price.';
    errorField = 'sort';
  }
  if (
    !error &&
    ['price_low', 'price_high'].includes(sort) &&
    items.some(
      (item) =>
        item.purpose !== filters.purpose ||
        (item.purpose === 'rent' && item.rentalPeriod !== filters.period),
    )
  ) {
    error = 'Loaded properties do not match the selected price basis. Refresh the search.';
    errorField = 'sort';
  }
  const ordered = [...items];
  const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  if (!error && sort !== 'catalogue')
    ordered.sort((a, b) => {
      const primary =
        sort === 'title'
          ? compare(a.title.toLowerCase(), b.title.toLowerCase())
          : (a.priceMinor - b.priceMinor) * (sort === 'price_high' ? -1 : 1);
      return primary || compare(a.id, b.id);
    });
  const matchingLoadedCount = items.length,
    pageCount = Math.max(1, Math.ceil(matchingLoadedCount / LOADED_PAGE_SIZE));
  const outOfRange = !error && page > pageCount;
  const visible =
    error || outOfRange
      ? []
      : ordered.slice((page - 1) * LOADED_PAGE_SIZE, page * LOADED_PAGE_SIZE);
  return Object.freeze({
    sort,
    page,
    pageCount,
    matchingLoadedCount,
    start: visible.length ? (page - 1) * LOADED_PAGE_SIZE + 1 : 0,
    end: visible.length ? (page - 1) * LOADED_PAGE_SIZE + visible.length : 0,
    outOfRange,
    error,
    errorField,
    items: Object.freeze(visible),
  });
}
/** Preserve only validated public filters; context/credentials/arbitrary query keys never propagate. */
export function loadedPageHref(filters: CatalogueFilters, sort: string, page: number): string {
  if (
    filters.error ||
    !['catalogue', 'title', 'price_low', 'price_high'].includes(sort) ||
    !Number.isSafeInteger(page) ||
    page < 1 ||
    page > 1000000
  )
    throw Error('Invalid loaded-page link.');
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({
    location: filters.location,
    purpose: filters.purpose,
    type: filters.type,
    period: filters.period,
    max: filters.maxText,
    beds: filters.bedsText,
    privateBaths: filters.privateBathsText,
    sharedBaths: filters.sharedBathsText,
  }))
    if (value) params.set(key, value);
  if (sort !== 'catalogue') params.set('sort', sort);
  if (page !== 1) params.set('page', String(page));
  return '/' + (params.size ? '?' + params.toString() : '') + '#properties';
}
