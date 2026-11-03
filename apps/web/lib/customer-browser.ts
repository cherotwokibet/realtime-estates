import {
  parseCustomerFavouriteJson,
  validateCustomerFavouriteCommand,
  validateCustomerFavouritesPage,
  type CustomerFavouriteCommand,
  type CustomerScope,
} from '@realtor/domain';
export interface BrowserAccount extends CustomerScope {
  readonly label: string;
  readonly generation: string;
  readonly expiresAt: string;
}
export interface BrowserSession {
  readonly policy: 'customer-browser-session-v1';
  readonly account: BrowserAccount | null;
  readonly csrf: string | null;
  readonly pending: CustomerFavouriteCommand | null;
  readonly choices: readonly { readonly id: string; readonly label: string }[];
}
export interface FavouriteSummary {
  readonly listingId: string;
  readonly title: string;
  readonly priceMinor: number;
  readonly purpose: 'rent' | 'sale';
  readonly rentalPeriod: 'day' | 'week' | 'month' | 'year' | null;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex = /^[a-f0-9]{64}$/;
const bad = (): never => {
  throw Error('Customer reply unavailable.');
};
function row(v: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!v || typeof v !== 'object' || ![Object.prototype, null].includes(Object.getPrototypeOf(v)))
    return bad();
  const own = Reflect.ownKeys(v);
  if (own.length !== keys.length || own.some((k) => typeof k !== 'string' || !keys.includes(k)))
    return bad();
  const r: Record<string, unknown> = Object.create(null);
  for (const k of keys) {
    const d = Object.getOwnPropertyDescriptor(v, k);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return bad();
    r[k] = d.value;
  }
  return r;
}
function array(v: unknown, max: number): unknown[] {
  if (
    !Array.isArray(v) ||
    v.length > max ||
    Object.getOwnPropertyNames(v).length !== v.length + 1 ||
    Object.getOwnPropertySymbols(v).length
  )
    return bad();
  const values = [];
  for (let i = 0; i < v.length; i++) {
    const d = Object.getOwnPropertyDescriptor(v, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) return bad();
    values.push(d.value);
  }
  return values;
}
const id = (v: unknown) => (typeof v === 'string' && uuid.test(v) ? v : bad());
const label = (v: unknown) =>
  typeof v === 'string' && /^Synthetic [A-Za-z0-9 -]{1,60}$/.test(v) ? v : bad();
export function validateBrowserSession(
  v: unknown,
  tenantId: string,
  now = Date.now(),
): BrowserSession {
  const r = row(v, ['policy', 'account', 'csrf', 'pending', 'choices']);
  if (r.policy !== 'customer-browser-session-v1' || !uuid.test(tenantId)) return bad();
  const choices = array(r.choices, 4).map((v) => {
    const c = row(v, ['id', 'label']);
    return Object.freeze({ id: id(c.id), label: label(c.label) });
  });
  if (!choices.length || new Set(choices.map((c) => c.id)).size !== choices.length) return bad();
  let account: BrowserAccount | null = null;
  if (r.account !== null) {
    const a = row(r.account, ['tenantId', 'customerId', 'label', 'generation', 'expiresAt']);
    if (
      id(a.tenantId) !== tenantId ||
      typeof a.generation !== 'string' ||
      !hex.test(a.generation) ||
      typeof a.expiresAt !== 'string' ||
      !Number.isFinite(Date.parse(a.expiresAt)) ||
      new Date(a.expiresAt).toISOString() !== a.expiresAt ||
      Date.parse(a.expiresAt) <= now ||
      Date.parse(a.expiresAt) > now + 600000
    )
      return bad();
    const customerId = id(a.customerId),
      name = label(a.label);
    if (
      !choices.some((c) => c.id === customerId && c.label === name) ||
      typeof r.csrf !== 'string' ||
      !hex.test(r.csrf)
    )
      return bad();
    account = Object.freeze({
      tenantId,
      customerId,
      label: name,
      generation: a.generation,
      expiresAt: a.expiresAt,
    });
  } else if (r.csrf !== null || r.pending !== null) return bad();
  const pending = r.pending === null ? null : validateCustomerFavouriteCommand(r.pending);
  return Object.freeze({
    policy: 'customer-browser-session-v1',
    account,
    csrf: r.csrf as string | null,
    pending,
    choices: Object.freeze(choices),
  });
}
export function validateBrowserFavourites(
  v: unknown,
  scope: CustomerScope,
  limit = 20,
  after: string | null = null,
) {
  const r = row(v, ['page', 'summaries']);
  const page = validateCustomerFavouritesPage(r.page, scope, limit, after);
  const seen = new Set<string>();
  const summaries = array(r.summaries, limit).map((v) => {
    const s = row(v, ['listingId', 'title', 'priceMinor', 'purpose', 'rentalPeriod']);
    const listingId = id(s.listingId);
    if (seen.has(listingId) || !page.items.some((x) => x.listingId === listingId && x.available))
      return bad();
    seen.add(listingId);
    if (
      typeof s.title !== 'string' ||
      s.title.length < 1 ||
      s.title.length > 160 ||
      /[\x00-\x1f\x7f]/.test(s.title) ||
      typeof s.priceMinor !== 'number' ||
      !Number.isSafeInteger(s.priceMinor) ||
      s.priceMinor < 1 ||
      s.priceMinor > 100000000000000 ||
      !['rent', 'sale'].includes(s.purpose as string) ||
      !(
        s.rentalPeriod === null ||
        ['day', 'week', 'month', 'year'].includes(s.rentalPeriod as string)
      ) ||
      (s.purpose === 'sale' && s.rentalPeriod !== null) ||
      (s.purpose === 'rent' && s.rentalPeriod === null)
    )
      return bad();
    return Object.freeze({
      listingId,
      title: s.title,
      priceMinor: s.priceMinor,
      purpose: s.purpose as 'rent' | 'sale',
      rentalPeriod: s.rentalPeriod as FavouriteSummary['rentalPeriod'],
    });
  });
  return Object.freeze({ page, summaries: Object.freeze(summaries) });
}
export async function readCustomerBrowserReply(response: Response): Promise<unknown> {
  if (
    response.headers.get('content-type')?.split(';')[0] !== 'application/json' ||
    !response.headers
      .get('cache-control')
      ?.split(',')
      .some((x) => x.trim() === 'no-store')
  )
    return bad();
  const reader = response.body?.getReader();
  if (!reader) return bad();
  const chunks: Uint8Array[] = [];
  let n = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      n += next.value.length;
      if (n > 32768) return bad();
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(n);
    let at = 0;
    for (const c of chunks) {
      bytes.set(c, at);
      at += c.length;
    }
    return parseCustomerFavouriteJson(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
