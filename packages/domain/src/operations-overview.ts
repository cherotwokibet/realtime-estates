export interface OperationsStockItem {
  readonly listingId: string;
  readonly title: string;
  readonly lastCheckedAt: string | null;
}
export interface OperationsReviewItem {
  readonly listingId: string;
  readonly revision: number;
  readonly title: string;
  readonly submittedAt: string;
}
export interface OperationsEnquiryItem {
  readonly enquiryId: string;
  readonly name: string;
  readonly nextActionAt: string;
}
export interface OperationsViewingItem {
  readonly enquiryId: string;
  readonly viewingId: string;
  readonly listingId: string;
  readonly title: string;
  readonly endedAt: string;
}
export interface OperationsQueue<T> {
  readonly items: readonly T[];
  readonly hasMore: boolean;
}
export interface StaffOperationsOverview {
  readonly policy: 'staff-operations-overview-v1';
  readonly asOf: string;
  readonly freshnessDays: 30;
  readonly limit: 10;
  readonly staleStock: OperationsQueue<OperationsStockItem>;
  readonly pendingReviews: OperationsQueue<OperationsReviewItem>;
  readonly overdueEnquiries: OperationsQueue<OperationsEnquiryItem>;
  readonly viewingOutcomes: OperationsQueue<OperationsViewingItem>;
}
export class OperationsOverviewValidationError extends Error {
  constructor() {
    super('Invalid operations overview.');
  }
}
const fail = (): never => {
  throw new OperationsOverviewValidationError();
};
const record = (value: unknown, keys: readonly string[]): Record<string, unknown> => {
  if (
    !value ||
    typeof value !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    return fail();
  const own = Reflect.ownKeys(value);
  if (
    own.length !== keys.length ||
    own.some((key) => typeof key !== 'string' || !keys.includes(key))
  )
    return fail();
  const copy: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) return fail();
    copy[key] = field.value;
  }
  return copy;
};
const uuid = (value: unknown): string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : fail();
const text = (value: unknown): string =>
  typeof value === 'string' &&
  value.trim() &&
  [...value].length <= 160 &&
  !/[\u0000-\u001f\u007f-\u009f]/u.test(value)
    ? value
    : fail();
const instant = (value: unknown): string => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value))
    return fail();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : fail();
};
function queue<T>(
  value: unknown,
  parse: (input: unknown) => T,
  identity: (item: T) => string,
): OperationsQueue<T> {
  const row = record(value, ['items', 'hasMore']);
  if (
    !Array.isArray(row.items) ||
    Object.getPrototypeOf(row.items) !== Array.prototype ||
    row.items.length > 10 ||
    Reflect.ownKeys(row.items).length !== row.items.length + 1 ||
    typeof row.hasMore !== 'boolean' ||
    (row.hasMore && row.items.length !== 10)
  )
    return fail();
  const seen = new Set<string>();
  const items = Array.from({ length: row.items.length }, (_, index) => {
    const field = Object.getOwnPropertyDescriptor(row.items, String(index));
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) return fail();
    const item = Object.freeze(parse(field.value));
    const id = identity(item);
    if (seen.has(id)) return fail();
    seen.add(id);
    return item;
  });
  return Object.freeze({ items: Object.freeze(items), hasMore: row.hasMore });
}
/** Exact private summary projection; no contact channels, messages, notes or evidence links. */
export function validateStaffOperationsOverview(input: unknown): StaffOperationsOverview {
  const row = record(input, [
    'policy',
    'asOf',
    'freshnessDays',
    'limit',
    'staleStock',
    'pendingReviews',
    'overdueEnquiries',
    'viewingOutcomes',
  ]);
  if (row.policy !== 'staff-operations-overview-v1' || row.limit !== 10 || row.freshnessDays !== 30)
    return fail();
  const asOf = instant(row.asOf),
    captured = Date.parse(asOf),
    cutoff = captured - 30 * 86400000;
  const staleStock = queue(
    row.staleStock,
    (input) => {
      const item = record(input, ['listingId', 'title', 'lastCheckedAt']);
      const lastCheckedAt = item.lastCheckedAt === null ? null : instant(item.lastCheckedAt);
      if (lastCheckedAt !== null && Date.parse(lastCheckedAt) >= cutoff) return fail();
      return { listingId: uuid(item.listingId), title: text(item.title), lastCheckedAt };
    },
    (item) => item.listingId,
  );
  const pendingReviews = queue(
    row.pendingReviews,
    (input) => {
      const item = record(input, ['listingId', 'revision', 'title', 'submittedAt']);
      const submittedAt = instant(item.submittedAt);
      if (
        !Number.isSafeInteger(item.revision) ||
        Number(item.revision) < 1 ||
        Number(item.revision) > 2147483647 ||
        Date.parse(submittedAt) > captured
      )
        return fail();
      return {
        listingId: uuid(item.listingId),
        revision: item.revision as number,
        title: text(item.title),
        submittedAt,
      };
    },
    (item) => `${item.listingId}:${item.revision}`,
  );
  const overdueEnquiries = queue(
    row.overdueEnquiries,
    (input) => {
      const item = record(input, ['enquiryId', 'name', 'nextActionAt']);
      const nextActionAt = instant(item.nextActionAt);
      if (Date.parse(nextActionAt) >= captured) return fail();
      return { enquiryId: uuid(item.enquiryId), name: text(item.name), nextActionAt };
    },
    (item) => item.enquiryId,
  );
  const viewingOutcomes = queue(
    row.viewingOutcomes,
    (input) => {
      const item = record(input, ['enquiryId', 'viewingId', 'listingId', 'title', 'endedAt']);
      const endedAt = instant(item.endedAt);
      if (Date.parse(endedAt) > captured) return fail();
      return {
        enquiryId: uuid(item.enquiryId),
        viewingId: uuid(item.viewingId),
        listingId: uuid(item.listingId),
        title: text(item.title),
        endedAt,
      };
    },
    (item) => item.viewingId,
  );
  return Object.freeze({
    policy: 'staff-operations-overview-v1',
    asOf,
    freshnessDays: 30,
    limit: 10,
    staleStock,
    pendingReviews,
    overdueEnquiries,
    viewingOutcomes,
  });
}
