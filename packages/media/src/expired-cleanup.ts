/** Internal offline maintenance contract; never a browser capability. */
import { isProxy } from 'node:util/types';
export interface ExpiredMediaCleanupAuthorization {
  readonly kind: 'expire_unverified_media';
  readonly tenantId: string;
  readonly jobId: string;
  readonly operationId: string;
  readonly quarantineId: string;
  readonly outputId: string;
  readonly expiredAt: string;
  readonly authorizedAt: string;
  readonly outcome: 'authorized';
}
export class ExpiredMediaCleanupError extends Error {
  override readonly name = 'ExpiredMediaCleanupError';
  constructor(readonly code: 'INVALID_AUTHORIZATION' | 'NOT_QUIESCENT') {
    super(`Expired media cleanup: ${code}.`);
  }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const KEYS = [
  'kind',
  'tenantId',
  'jobId',
  'operationId',
  'quarantineId',
  'outputId',
  'expiredAt',
  'authorizedAt',
  'outcome',
];
function fail(): never {
  throw new ExpiredMediaCleanupError('INVALID_AUTHORIZATION');
}
function instant(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) ||
    value.startsWith('0000')
  )
    fail();
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !== value.slice(0, 23) + 'Z') fail();
  return BigInt(ms) * 1000n + BigInt(value.slice(23, 26));
}
/** Snapshot exact SQL response before awaiting filesystem or quiescence checks. */
export function expiredMediaCleanupAuthorization(value: unknown): ExpiredMediaCleanupAuthorization {
  if (
    !value ||
    typeof value !== 'object' ||
    isProxy(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    fail();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== KEYS.length || keys.some((k) => typeof k !== 'string' || !KEYS.includes(k)))
    fail();
  const row: Record<string, unknown> = Object.create(null);
  for (const key of KEYS) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) fail();
    row[key] = d.value;
  }
  if (row.kind !== 'expire_unverified_media' || row.outcome !== 'authorized') fail();
  for (const key of ['tenantId', 'jobId', 'operationId', 'quarantineId', 'outputId'])
    if (typeof row[key] !== 'string' || !UUID.test(row[key])) fail();
  if (new Set([row.jobId, row.operationId, row.quarantineId, row.outputId]).size !== 4) fail();
  if (instant(row.authorizedAt) - instant(row.expiredAt) < 3600000000n) fail();
  return Object.freeze({ ...row }) as unknown as ExpiredMediaCleanupAuthorization;
}
