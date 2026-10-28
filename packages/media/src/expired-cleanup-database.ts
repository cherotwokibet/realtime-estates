import { isProxy } from 'node:util/types';
import {
  assertSafeMediaMaintenanceConnection,
  MediaMaintenanceSafetyError,
  MediaCoordinatorDatabaseError,
  type MediaCoordinatorPool,
} from './coordinator-database.js';
import {
  expiredMediaCleanupAuthorization,
  type ExpiredMediaCleanupAuthorization,
} from './expired-cleanup.js';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export class MediaMaintenanceInputError extends Error {
  override readonly name = 'MediaMaintenanceInputError';
  readonly code = 'INVALID_MEDIA_MAINTENANCE_INPUT';
  constructor() {
    super('Invalid media maintenance input.');
  }
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new MediaMaintenanceInputError();
  return value;
}
function bad(): never {
  throw new MediaCoordinatorDatabaseError(false);
}
function data(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    isProxy(value) ||
    ![null, Object.prototype].includes(Object.getPrototypeOf(value))
  )
    bad();
  const own = Reflect.ownKeys(value);
  if (own.length !== keys.length || own.some((k) => typeof k !== 'string' || !keys.includes(k)))
    bad();
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const d = Object.getOwnPropertyDescriptor(value, key);
    if (!d?.enumerable || !Object.hasOwn(d, 'value')) bad();
    result[key] = d.value;
  }
  return result;
}
export interface ExpiredMediaCandidatePage {
  readonly tenantId: string;
  readonly asOf: string;
  readonly jobs: readonly { readonly jobId: string; readonly operationId: string | null }[];
  readonly hasMore: boolean;
}
/** Fixed tenant from trusted worker configuration, never posted browser authority.
 * No automatic retry: an uncertain SQL commit must be reconciled by listing the
 * original persisted operation before any physical cleanup is attempted. */
export class MediaMaintenanceDatabase {
  readonly #pool: MediaCoordinatorPool;
  readonly #tenant: string;
  constructor(pool: MediaCoordinatorPool, configuredTenantId: string) {
    this.#tenant = uuid(configuredTenantId);
    if (!pool || typeof pool.connect !== 'function') throw new MediaMaintenanceInputError();
    this.#pool = pool;
  }
  async candidates(after: string | null = null, limit = 25): Promise<ExpiredMediaCandidatePage> {
    const cursor = after === null ? null : uuid(after);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new MediaMaintenanceInputError();
    return this.#command(
      'SELECT app_media.expired_cleanup_candidates($1::uuid,$2::uuid,$3::integer) AS receipt',
      [this.#tenant, cursor, limit],
      (value) => {
        const row = data(value, ['tenantId', 'asOf', 'jobs', 'hasMore']);
        if (
          row.tenantId !== this.#tenant ||
          typeof row.asOf !== 'string' ||
          !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.asOf) ||
          row.asOf.startsWith('0000') ||
          !Number.isFinite(Date.parse(row.asOf)) ||
          new Date(Date.parse(row.asOf)).toISOString() !== row.asOf.slice(0, 23) + 'Z' ||
          typeof row.hasMore !== 'boolean'
        )
          bad();
        if (
          !Array.isArray(row.jobs) ||
          isProxy(row.jobs) ||
          Object.getPrototypeOf(row.jobs) !== Array.prototype ||
          row.jobs.length > limit ||
          (row.hasMore && row.jobs.length !== limit)
        )
          bad();
        if (Reflect.ownKeys(row.jobs).length !== row.jobs.length + 1) bad();
        const jobs: { readonly jobId: string; readonly operationId: string | null }[] = [];
        let previous = cursor;
        for (let i = 0; i < row.jobs.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(row.jobs, String(i));
          if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) bad();
          const item = data(descriptor.value, ['jobId', 'operationId']);
          let jobId: string, operationId: string | null;
          try {
            jobId = uuid(item.jobId);
            operationId = item.operationId === null ? null : uuid(item.operationId);
          } catch {
            return bad();
          }
          if ((previous && jobId <= previous) || jobId === operationId) bad();
          previous = jobId;
          jobs.push(Object.freeze({ jobId, operationId }));
        }
        return Object.freeze({
          tenantId: this.#tenant,
          asOf: row.asOf,
          jobs: Object.freeze(jobs),
          hasMore: row.hasMore,
        });
      },
    );
  }
  async authorize(jobId: string, operationId: string): Promise<ExpiredMediaCleanupAuthorization> {
    const job = uuid(jobId),
      operation = uuid(operationId);
    if (job === operation) throw new MediaMaintenanceInputError();
    return this.#command(
      'SELECT app_media.authorize_expired_cleanup($1::uuid,$2::uuid,$3::uuid) AS receipt',
      [this.#tenant, job, operation],
      (value) => {
        let result: ExpiredMediaCleanupAuthorization;
        try {
          result = expiredMediaCleanupAuthorization(value);
        } catch {
          return bad();
        }
        if (
          result.tenantId !== this.#tenant ||
          result.jobId !== job ||
          result.operationId !== operation
        )
          bad();
        return result;
      },
    );
  }
  async #command<T>(
    sql: string,
    values: readonly unknown[],
    parse: (value: unknown) => T,
  ): Promise<T> {
    let client;
    try {
      client = await this.#pool.connect();
    } catch {
      throw new MediaCoordinatorDatabaseError(false);
    }
    let began = false,
      destroy = false,
      commitStarted = false;
    try {
      await assertSafeMediaMaintenanceConnection(client);
      await client.query('BEGIN');
      began = true;
      await client.query('SET LOCAL ROLE media_maintenance');
      await client.query("SET LOCAL statement_timeout='2s'");
      const response = await client.query(sql, values);
      if (!response || !Array.isArray(response.rows) || response.rows.length !== 1) bad();
      const row = data(response.rows[0], ['receipt']),
        result = parse(row.receipt);
      commitStarted = true;
      await client.query('COMMIT');
      began = false;
      return result;
    } catch (error) {
      if (!began || commitStarted || error instanceof MediaMaintenanceSafetyError) destroy = true;
      if (began)
        try {
          await client.query('ROLLBACK');
        } catch {
          destroy = true;
        }
      if (error instanceof MediaMaintenanceSafetyError) throw error;
      const state =
        error &&
        typeof error === 'object' &&
        'code' in error &&
        typeof error.code === 'string' &&
        /^[0-9A-Z]{5}$/.test(error.code)
          ? error.code
          : undefined;
      throw new MediaCoordinatorDatabaseError(commitStarted, state);
    } finally {
      try {
        client.release(destroy);
      } catch {
        throw new MediaCoordinatorDatabaseError(commitStarted);
      }
    }
  }
}
