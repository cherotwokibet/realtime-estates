import { DomainError } from './errors.js';
export interface CustomerScope {
  readonly tenantId: string;
  readonly customerId: string;
}
export interface CustomerFavouriteCommand {
  readonly policy: 'customer-favourite-command-v1';
  readonly operationId: string;
  readonly listingId: string;
  readonly expectedVersion: string;
  readonly saved: boolean;
}
export interface CustomerFavouriteReceipt extends CustomerScope {
  readonly policy: 'customer-favourite-receipt-v1';
  readonly operationId: string;
  readonly listingId: string;
  readonly expectedVersion: string;
  readonly version: string;
  readonly requestedSaved: boolean;
  readonly saved: boolean;
  readonly outcome: 'applied' | 'unchanged' | 'conflict';
  readonly recordedAt: string;
}
export interface CustomerFavouritesPage extends CustomerScope {
  readonly policy: 'customer-favourites-page-v1';
  readonly items: readonly {
    readonly listingId: string;
    readonly version: string;
    readonly available: boolean;
  }[];
  readonly hasMore: boolean;
}
const invalid = (): never => {
  throw new DomainError('INVALID_CUSTOMER_FAVOURITE', 'Invalid customer favourite.');
};
function record(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    return invalid();
  const own = Reflect.ownKeys(v);
  if (own.length !== keys.length || own.some((k) => typeof k !== 'string' || !keys.includes(k)))
    return invalid();
  const out: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    out[k] = d.value;
  }
  return out;
}
const uuid = (v: unknown): string =>
  typeof v === 'string' &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(v)
    ? v
    : invalid();
const version = (v: unknown): string =>
  typeof v === 'string' && /^(0|[1-9][0-9]{0,15})$/.test(v) && BigInt(v) <= 9007199254740991n
    ? v
    : invalid();
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : invalid());
const policy = (v: unknown, want: string): void => {
  if (v !== want) invalid();
};
function scope(v: Record<string, unknown>, expected: CustomerScope): CustomerScope {
  const tenantId = uuid(v.tenantId),
    customerId = uuid(v.customerId);
  if (tenantId !== uuid(expected.tenantId) || customerId !== uuid(expected.customerId)) invalid();
  return { tenantId, customerId };
}
/** Bound bytes and reject duplicate keys, including escaped aliases, before accepting wire data. */
export function parseCustomerFavouriteJson(source: string): unknown {
  if (typeof source !== 'string' || new TextEncoder().encode(source).length > 32768)
    return invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return invalid();
  }
  const tokens = source.match(/"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]/g) ?? [];
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]!;
    if (t === '{') stack.push(new Set());
    else if (t === '[') stack.push(null);
    else if (t === '}' || t === ']') stack.pop();
    else if (t.startsWith('"') && tokens[i + 1] === ':') {
      const k = JSON.parse(t) as string;
      const keys = stack.at(-1);
      if (!keys || keys.has(k)) return invalid();
      keys.add(k);
    }
  }
  return parsed;
}
export function validateCustomerFavouriteCommand(v: unknown): CustomerFavouriteCommand {
  const r = record(v, ['policy', 'operationId', 'listingId', 'expectedVersion', 'saved']);
  policy(r.policy, 'customer-favourite-command-v1');
  const expectedVersion = version(r.expectedVersion);
  if (expectedVersion === '9007199254740991') invalid();
  return Object.freeze({
    policy: 'customer-favourite-command-v1',
    operationId: uuid(r.operationId),
    listingId: uuid(r.listingId),
    expectedVersion,
    saved: bool(r.saved),
  });
}
export function validateCustomerAccount(
  v: unknown,
  expected: CustomerScope,
): Readonly<CustomerScope & { policy: 'customer-account-v1' }> {
  const r = record(v, ['policy', 'tenantId', 'customerId']);
  policy(r.policy, 'customer-account-v1');
  return Object.freeze({ policy: 'customer-account-v1', ...scope(r, expected) });
}
export function validateCustomerFavouriteReceipt(
  v: unknown,
  command: CustomerFavouriteCommand,
  expected: CustomerScope,
): CustomerFavouriteReceipt {
  const c = validateCustomerFavouriteCommand(command);
  const r = record(v, [
    'policy',
    'tenantId',
    'customerId',
    'operationId',
    'listingId',
    'expectedVersion',
    'version',
    'requestedSaved',
    'saved',
    'outcome',
    'recordedAt',
  ]);
  policy(r.policy, 'customer-favourite-receipt-v1');
  const s = scope(r, expected);
  const actual = version(r.version),
    saved = bool(r.saved),
    requestedSaved = bool(r.requestedSaved);
  if (
    uuid(r.operationId) !== c.operationId ||
    uuid(r.listingId) !== c.listingId ||
    version(r.expectedVersion) !== c.expectedVersion ||
    requestedSaved !== c.saved
  )
    invalid();
  if (!['applied', 'unchanged', 'conflict'].includes(r.outcome as string)) invalid();
  const outcome = r.outcome as CustomerFavouriteReceipt['outcome'];
  if (actual === '0' && saved) return invalid();
  if (
    outcome === 'applied' &&
    (BigInt(actual) !== BigInt(c.expectedVersion) + 1n || saved !== c.saved)
  )
    invalid();
  if (outcome === 'unchanged' && (actual !== c.expectedVersion || saved !== c.saved)) invalid();
  if (outcome === 'conflict' && actual === c.expectedVersion) invalid();
  if (
    typeof r.recordedAt !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.recordedAt) ||
    !Number.isFinite(Date.parse(r.recordedAt)) ||
    new Date(r.recordedAt).toISOString() !== r.recordedAt
  )
    invalid();
  return Object.freeze({
    policy: 'customer-favourite-receipt-v1',
    ...s,
    operationId: c.operationId,
    listingId: c.listingId,
    expectedVersion: c.expectedVersion,
    version: actual,
    requestedSaved,
    saved,
    outcome,
    recordedAt: r.recordedAt as string,
  });
}
export function validateCustomerFavouritesPage(
  v: unknown,
  expected: CustomerScope,
  limit = 20,
  after: string | null = null,
): CustomerFavouritesPage {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) invalid();
  if (after !== null) uuid(after);
  const r = record(v, ['policy', 'tenantId', 'customerId', 'items', 'hasMore']);
  policy(r.policy, 'customer-favourites-page-v1');
  const s = scope(r, expected);
  const inputItems = r.items;
  if (
    !Array.isArray(inputItems) ||
    inputItems.length > limit ||
    Object.getOwnPropertySymbols(inputItems).length ||
    Object.getOwnPropertyNames(inputItems).length !== inputItems.length + 1
  )
    return invalid();
  const items: { listingId: string; version: string; available: boolean }[] = [];
  let previous = after;
  for (let i = 0; i < inputItems.length; i++) {
    const d = Object.getOwnPropertyDescriptor(inputItems, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return invalid();
    const item = record(d.value, ['listingId', 'version', 'available']);
    const listingId = uuid(item.listingId),
      ver = version(item.version);
    if (ver === '0' || (previous !== null && listingId <= previous)) invalid();
    previous = listingId;
    items.push(Object.freeze({ listingId, version: ver, available: bool(item.available) }));
  }
  const hasMore = bool(r.hasMore);
  if (hasMore && items.length !== limit) invalid();
  return Object.freeze({
    policy: 'customer-favourites-page-v1',
    ...s,
    items: Object.freeze(items),
    hasMore,
  });
}

export function validateCustomerFavouriteState(
  v: unknown,
  expected: CustomerScope,
  expectedListingId: string,
): Readonly<
  CustomerScope & {
    policy: 'customer-favourite-state-v1';
    listingId: string;
    version: string;
    saved: boolean;
  }
> {
  const r = record(v, ['policy', 'tenantId', 'customerId', 'listingId', 'version', 'saved']);
  policy(r.policy, 'customer-favourite-state-v1');
  const s = scope(r, expected);
  const listingId = uuid(r.listingId),
    ver = version(r.version),
    saved = bool(r.saved);
  if (listingId !== uuid(expectedListingId) || (ver === '0' && saved)) return invalid();
  return Object.freeze({
    policy: 'customer-favourite-state-v1',
    ...s,
    listingId,
    version: ver,
    saved,
  });
}
