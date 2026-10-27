import type { PublicSearchInput } from '@realtor/api-client';
import { kesFromMajor } from '@realtor/domain';

export type MobileReferenceFilters = {
  location: string;
  purpose: '' | 'rent' | 'sale';
  type: NonNullable<PublicSearchInput['type']> | '';
  period: NonNullable<PublicSearchInput['period']> | '';
  min: string;
  max: string;
  minMode: '' | 'over';
  beds: string;
  bedsMode: '' | 'at_least';
  privateBaths: string;
  sharedBaths: string;
  sort: NonNullable<PublicSearchInput['sort']>;
};
export const emptyMobileReferenceFilters: Readonly<MobileReferenceFilters> = Object.freeze({
  location: '',
  purpose: '',
  type: '',
  period: '',
  min: '',
  max: '',
  minMode: '',
  beds: '',
  bedsMode: '',
  privateBaths: '',
  sharedBaths: '',
  sort: 'catalogue',
});

/** Form feedback only; the SDK and server independently validate the public query. */
export function prepareMobileReferenceSearch(
  filters: MobileReferenceFilters,
): { status: 'ready'; input: PublicSearchInput } | { status: 'invalid'; message: string } {
  const invalid = (message: string) => ({ status: 'invalid' as const, message });
  const location = filters.location.trim();
  if ([...location].length > 160 || /[\u0000-\u001f\u007f-\u009f]/u.test(location))
    return invalid('Use a location of at most 160 characters without control characters.');
  const input: Record<string, string | number> = { offset: 0, sort: filters.sort };
  if (location) input.location = location;
  for (const key of ['purpose', 'type', 'period'] as const)
    if (filters[key]) input[key] = filters[key];
  if (filters.period && filters.purpose !== 'rent')
    return invalid('Choose For rent before selecting a rental period.');
  const amounts: Partial<Record<'min' | 'max', number>> = {};
  for (const key of ['min', 'max'] as const) {
    const value = filters[key].trim();
    if (!value) continue;
    try {
      const minor = kesFromMajor(value).minorUnits;
      if (minor <= 0) throw Error();
      amounts[key] = minor;
      input[key] = value;
    } catch {
      return invalid(
        `Use a positive ${key === 'min' ? 'minimum' : 'maximum'} KES price with at most two decimal places.`,
      );
    }
  }
  if (
    (input.min || input.max || filters.sort.startsWith('price_')) &&
    !(filters.purpose === 'sale' || (filters.purpose === 'rent' && filters.period))
  )
    return invalid('To compare prices, choose For sale or For rent with one rental period.');
  if (amounts.min !== undefined && amounts.max !== undefined && amounts.min > amounts.max)
    return invalid('The minimum price must not exceed the maximum price.');
  if (filters.minMode && !input.min) return invalid('Enter a minimum price for Strictly over.');
  if (filters.minMode) input.minMode = filters.minMode;
  for (const key of ['beds', 'privateBaths', 'sharedBaths'] as const) {
    const value = filters[key].trim();
    if (!value) continue;
    if (!/^(0|[1-9]\d{0,2})$/.test(value) || Number(value) > 100)
      return invalid('Use whole room counts from 0 to 100.');
    input[key] = value;
  }
  if (filters.bedsMode && input.beds === undefined)
    return invalid('Enter a bedroom count for At least.');
  if (filters.bedsMode) input.bedsMode = filters.bedsMode;
  return { status: 'ready', input: Object.freeze(input) as PublicSearchInput };
}

export function mobileReferenceSearchSummary(input: PublicSearchInput): string {
  const parts = [
    input.location,
    input.purpose,
    input.type,
    input.period ? `per ${input.period}` : undefined,
  ];
  if (input.min) parts.push(`${input.minMode === 'over' ? 'over' : 'from'} KES ${input.min}`);
  if (input.max) parts.push(`up to KES ${input.max}`);
  if (input.beds !== undefined)
    parts.push(`${input.beds}${input.bedsMode === 'at_least' ? '+' : ' exact'} bedrooms`);
  if (input.privateBaths !== undefined) parts.push(`${input.privateBaths}+ private bathrooms`);
  if (input.sharedBaths !== undefined) parts.push(`${input.sharedBaths}+ shared bathrooms`);
  const sortLabels = {
    catalogue: 'catalogue order',
    title: 'title order',
    price_low: 'lowest price first',
    price_high: 'highest price first',
  };
  parts.push(sortLabels[input.sort ?? 'catalogue']);
  return parts.filter(Boolean).join(' · ');
}
