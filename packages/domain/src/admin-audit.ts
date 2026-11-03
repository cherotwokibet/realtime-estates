import { DomainError } from './errors.js';

export interface AdminAuditQuery {
  readonly limit: number;
  readonly before: string | null;
  readonly actorId: string | null;
  readonly objectId: string | null;
}
export interface AdminAuditPage {
  readonly policy: 'admin-audit-page-v1';
  readonly tenantId: string;
  readonly items: readonly {
    readonly id: string;
    readonly actorId: string | null;
    readonly action: string;
    readonly objectType: string;
    readonly objectId: string;
    readonly objectVersion: string | null;
    readonly occurredAt: string;
  }[];
  readonly nextBefore: string | null;
}
const invalid = (): never => {
  throw new DomainError('INVALID_ADMIN_AUDIT', 'Invalid administrator audit data.');
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
const integer = (v: unknown): string =>
  typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v) && BigInt(v) <= 9223372036854775807n
    ? v
    : invalid();
const nullable = (v: unknown, check: (v: unknown) => string) => (v === null ? null : check(v));
const name = (v: unknown): string =>
  typeof v === 'string' && /^[a-z][a-z0-9_.-]{0,95}$/.test(v) ? v : invalid();

export function validateAdminAuditQuery(v: unknown): AdminAuditQuery {
  const r = record(v, ['limit', 'before', 'actorId', 'objectId']);
  if (!Number.isInteger(r.limit) || Number(r.limit) < 1 || Number(r.limit) > 20) invalid();
  return {
    limit: r.limit as number,
    before: nullable(r.before, integer),
    actorId: nullable(r.actorId, uuid),
    objectId: nullable(r.objectId, uuid),
  };
}
export function adminAuditQuery(search: URLSearchParams): AdminAuditQuery {
  const allowed = ['limit', 'before', 'actorId', 'objectId'];
  for (const key of search.keys())
    if (!allowed.includes(key) || search.getAll(key).length !== 1) invalid();
  const limit = search.get('limit');
  if (limit !== null && !/^(?:[1-9]|1[0-9]|20)$/.test(limit)) invalid();
  return validateAdminAuditQuery({
    limit: limit === null ? 20 : Number(limit),
    before: search.get('before'),
    actorId: search.get('actorId'),
    objectId: search.get('objectId'),
  });
}
/** Copies only fixed own data properties; private fields or accessors fail closed. */
export function validateAdminAuditPage(
  v: unknown,
  tenant: string,
  input: AdminAuditQuery,
): AdminAuditPage {
  const query = validateAdminAuditQuery(input);
  const r = record(v, ['policy', 'tenantId', 'items', 'nextBefore']);
  if (r.policy !== 'admin-audit-page-v1' || uuid(r.tenantId) !== uuid(tenant)) invalid();
  if (!Array.isArray(r.items) || r.items.length > query.limit) invalid();
  // Refuse sparse/accessor arrays without invoking row getters.
  const array = r.items as unknown[];
  if (Reflect.ownKeys(array).length !== array.length + 1) invalid();
  let previous = query.before;
  const items: AdminAuditPage['items'][number][] = [];
  for (let i = 0; i < array.length; i++) {
    const d = Object.getOwnPropertyDescriptor(array, String(i));
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) invalid();
    const row = record(d!.value, [
      'id',
      'actorId',
      'action',
      'objectType',
      'objectId',
      'objectVersion',
      'occurredAt',
    ]);
    const id = integer(row.id),
      actorId = nullable(row.actorId, uuid),
      objectId = uuid(row.objectId);
    if (
      (previous !== null && BigInt(id) >= BigInt(previous)) ||
      (query.actorId !== null && actorId !== query.actorId) ||
      (query.objectId !== null && objectId !== query.objectId)
    )
      invalid();
    previous = id;
    if (
      typeof row.occurredAt !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(row.occurredAt) ||
      !Number.isFinite(Date.parse(row.occurredAt))
    )
      invalid();
    items.push({
      id,
      actorId,
      objectId,
      action: name(row.action),
      objectType: name(row.objectType),
      objectVersion: nullable(row.objectVersion, integer),
      occurredAt: row.occurredAt as string,
    });
  }
  const nextBefore = nullable(r.nextBefore, integer);
  if (nextBefore !== null && (items.length !== query.limit || nextBefore !== previous)) invalid();
  return { policy: 'admin-audit-page-v1', tenantId: tenant, items, nextBefore };
}
