import type { PublicSearchInput } from '@realtor/api-client';
import { kesFromMajor, PROPERTY_TYPES, RENTAL_PERIODS } from '@realtor/domain';
import type { MobileReferenceConfig } from './reference-catalogue.js';

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

export interface MobileSearchStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
}
type Scope = Extract<MobileReferenceConfig, { mode: 'synthetic-reference-public-v1' }>;
type RestoredSearch =
  | { status: 'ready'; filters: MobileReferenceFilters }
  | { status: 'empty' | 'discarded' | 'unavailable' };
const keys = Object.keys(emptyMobileReferenceFilters);
const storageQueues = new WeakMap<MobileSearchStorage, Map<string, Promise<void>>>();
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
function validFilters(value: unknown): value is MobileReferenceFilters {
  if (
    !isRecord(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => typeof value[key] !== 'string')
  )
    return false;
  if (
    !['', 'rent', 'sale'].includes(value.purpose as string) ||
    !['', ...PROPERTY_TYPES].includes(value.type as string) ||
    !['', ...RENTAL_PERIODS].includes(value.period as string) ||
    !['', 'over'].includes(value.minMode as string) ||
    !['', 'at_least'].includes(value.bedsMode as string) ||
    !['catalogue', 'title', 'price_low', 'price_high'].includes(value.sort as string)
  )
    return false;
  return prepareMobileReferenceSearch(value as MobileReferenceFilters).status === 'ready';
}

/** Public search preferences only. Never use this store for accounts, tokens or catalogue responses. */
export function createMobileReferenceSearchStore(
  storage: MobileSearchStorage,
  scope: Scope,
  waitMs = 3000,
) {
  if (!Number.isFinite(waitMs) || waitMs < 1 || waitMs > 30000)
    throw Error('Invalid storage wait.');
  const key = `realtor:reference-search:v1:${scope.tenantSlug}:${encodeURIComponent(scope.apiOrigin)}`;
  let queues = storageQueues.get(storage);
  if (!queues) {
    queues = new Map();
    storageQueues.set(storage, queues);
  }
  const sharedQueues = queues;
  const enqueue = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = (sharedQueues.get(key) ?? Promise.resolve()).then(operation);
    const settled = result.then(
      () => undefined,
      () => undefined,
    );
    sharedQueues.set(key, settled);
    void settled.then(() => {
      if (sharedQueues.get(key) === settled) sharedQueues.delete(key);
    });
    return result;
  };
  // Bound the UI wait, but leave native operations serialized until they actually settle.
  // Releasing the queue on timeout could let an older write finish after a later clear.
  const within = <T>(operation: Promise<T>, fallback: T): Promise<T> => {
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), waitMs);
    });
    return Promise.race([operation, deadline]).finally(() => clearTimeout(timer));
  };
  return Object.freeze({
    load: (): Promise<RestoredSearch> =>
      within(
        enqueue<RestoredSearch>(async () => {
          try {
            const raw = await storage.getItem(key);
            if (raw === null) return { status: 'empty' };
            let value: unknown;
            try {
              value = raw.length <= 4096 ? JSON.parse(raw) : null;
            } catch {
              value = null;
            }
            if (
              !isRecord(value) ||
              Object.keys(value).length !== 5 ||
              value.version !== 1 ||
              value.mode !== scope.mode ||
              value.tenantSlug !== scope.tenantSlug ||
              value.apiOrigin !== scope.apiOrigin ||
              !validFilters(value.filters)
            ) {
              await storage.removeItem(key);
              return { status: 'discarded' };
            }
            return { status: 'ready', filters: { ...value.filters } };
          } catch {
            return { status: 'unavailable' };
          }
        }),
        { status: 'unavailable' },
      ),
    save: (filters: MobileReferenceFilters): Promise<boolean> => {
      if (!validFilters(filters)) return Promise.resolve(false);
      const raw = JSON.stringify({
        version: 1,
        mode: scope.mode,
        tenantSlug: scope.tenantSlug,
        apiOrigin: scope.apiOrigin,
        filters: { ...filters },
      });
      if (raw.length > 4096) return Promise.resolve(false);
      return within(
        enqueue(async () => {
          try {
            await storage.setItem(key, raw);
            return true;
          } catch {
            return false;
          }
        }),
        false,
      );
    },
    clear: (): Promise<boolean> =>
      within(
        enqueue(async () => {
          try {
            await storage.removeItem(key);
            return true;
          } catch {
            return false;
          }
        }),
        false,
      ),
  });
}
