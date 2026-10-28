import { validateViewingSlot, type ViewingSlot } from './viewing-scheduling.js';

export interface ViewingCalendarWindow {
  readonly fromAt: string;
  readonly untilAt: string;
  readonly timeZone: 'Africa/Nairobi';
}
export type CalendarViewingStatus =
  'proposed' | 'confirmed' | 'cancelled' | 'declined' | 'completed' | 'no_show';
export interface ViewingCalendarEntry {
  readonly viewingId: string;
  readonly enquiryId: string;
  readonly listingId: string;
  readonly title: string;
  readonly version: string;
  readonly status: CalendarViewingStatus;
  readonly slot: ViewingSlot;
  readonly enquiryClosed: boolean;
}
export interface UnscheduledViewingRequest {
  readonly viewingId: string;
  readonly enquiryId: string;
  readonly listingId: string;
  readonly title: string;
  readonly version: string;
  readonly status: 'requested';
  readonly createdAt: string;
  readonly enquiryClosed: boolean;
}
export interface StaffViewingCalendar {
  readonly policy: 'staff-viewing-calendar-v1';
  readonly asOf: string;
  readonly window: ViewingCalendarWindow;
  readonly scheduled: Readonly<{
    items: readonly ViewingCalendarEntry[];
    limit: 100;
    hasMore: boolean;
  }>;
  readonly unscheduled: Readonly<{
    items: readonly UnscheduledViewingRequest[];
    limit: 25;
    hasMore: boolean;
  }>;
}
export class ViewingCalendarValidationError extends Error {
  constructor() {
    super('Invalid viewing calendar.');
  }
}
const fail = (): never => {
  throw new ViewingCalendarValidationError();
};
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
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
}
function instant(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^(?!0000)\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  )
    return fail();
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value ? value : fail();
}
const uuid = (value: unknown): string =>
  typeof value === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
    ? value
    : fail();
const text = (value: unknown): string =>
  typeof value === 'string' &&
  value.trim() &&
  [...value].length <= 160 &&
  !/[\u0000-\u001f\u007f-\u009f\ud800-\udfff]/u.test(value)
    ? value
    : fail();
const version = (value: unknown): string =>
  typeof value === 'string' &&
  /^[1-9]\d{0,15}$/.test(value) &&
  BigInt(value) <= BigInt(Number.MAX_SAFE_INTEGER)
    ? value
    : fail();
const bool = (value: unknown): boolean => (typeof value === 'boolean' ? value : fail());

/** A half-open, canonical UTC range; UI labels remain explicitly Africa/Nairobi. */
export function validateViewingCalendarWindow(input: unknown): ViewingCalendarWindow {
  const row = record(input, ['fromAt', 'untilAt', 'timeZone']),
    fromAt = instant(row.fromAt),
    untilAt = instant(row.untilAt);
  const duration = Date.parse(untilAt) - Date.parse(fromAt);
  if (row.timeZone !== 'Africa/Nairobi' || duration <= 0 || duration > 31 * 86400000) return fail();
  return Object.freeze({ fromAt, untilAt, timeZone: 'Africa/Nairobi' });
}
function queue<T>(input: unknown, limit: 100 | 25, parse: (item: unknown) => T) {
  const row = record(input, ['items', 'limit', 'hasMore']);
  if (
    row.limit !== limit ||
    typeof row.hasMore !== 'boolean' ||
    !Array.isArray(row.items) ||
    Object.getPrototypeOf(row.items) !== Array.prototype ||
    row.items.length > limit ||
    Reflect.ownKeys(row.items).length !== row.items.length + 1 ||
    (row.hasMore && row.items.length !== limit)
  )
    return fail();
  const items = Array.from({ length: row.items.length }, (_, index) => {
    const field = Object.getOwnPropertyDescriptor(row.items, String(index));
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) return fail();
    return Object.freeze(parse(field.value));
  });
  return Object.freeze({ items: Object.freeze(items), limit, hasMore: row.hasMore });
}
/** Minimal current staff projection; contact data, agreement notes and reminder destinations never enter it. */
export function validateStaffViewingCalendar(
  input: unknown,
  expectedWindow?: ViewingCalendarWindow,
): StaffViewingCalendar {
  const row = record(input, ['policy', 'asOf', 'window', 'scheduled', 'unscheduled']);
  if (row.policy !== 'staff-viewing-calendar-v1') return fail();
  const asOf = instant(row.asOf),
    window = validateViewingCalendarWindow(row.window);
  if (expectedWindow) {
    const expected = validateViewingCalendarWindow(expectedWindow);
    if (expected.fromAt !== window.fromAt || expected.untilAt !== window.untilAt) return fail();
  }
  const seen = new Set<string>();
  function base(item: Record<string, unknown>) {
    const viewingId = uuid(item.viewingId);
    if (seen.has(viewingId)) return fail();
    seen.add(viewingId);
    return {
      viewingId,
      enquiryId: uuid(item.enquiryId),
      listingId: uuid(item.listingId),
      title: text(item.title),
      version: version(item.version),
      enquiryClosed: bool(item.enquiryClosed),
    };
  }
  const scheduled = queue(row.scheduled, 100, (input) => {
    const item = record(input, [
      'viewingId',
      'enquiryId',
      'listingId',
      'title',
      'version',
      'status',
      'slot',
      'enquiryClosed',
    ]);
    if (
      typeof item.status !== 'string' ||
      !['proposed', 'confirmed', 'cancelled', 'declined', 'completed', 'no_show'].includes(
        item.status,
      )
    )
      return fail();
    const slot = validateViewingSlot(item.slot);
    if (
      Date.parse(slot.startAt) >= Date.parse(window.untilAt) ||
      Date.parse(slot.endAt) <= Date.parse(window.fromAt)
    )
      return fail();
    return { ...base(item), status: item.status as CalendarViewingStatus, slot };
  });
  const unscheduled = queue(row.unscheduled, 25, (input) => {
    const item = record(input, [
      'viewingId',
      'enquiryId',
      'listingId',
      'title',
      'version',
      'status',
      'createdAt',
      'enquiryClosed',
    ]);
    const createdAt = instant(item.createdAt);
    if (item.status !== 'requested' || Date.parse(createdAt) > Date.parse(asOf)) return fail();
    return { ...base(item), status: 'requested' as const, createdAt };
  });
  return Object.freeze({
    policy: 'staff-viewing-calendar-v1',
    asOf,
    window,
    scheduled: scheduled as StaffViewingCalendar['scheduled'],
    unscheduled: unscheduled as StaffViewingCalendar['unscheduled'],
  });
}
