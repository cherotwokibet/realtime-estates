import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { validateCustomerFavouriteCommand, type CustomerFavouriteCommand } from '@realtor/domain';
import type { IdentityStateDatabase } from './browser-identity-store.js';
export interface OriginalScope {
  readonly tenantId: string;
  readonly actorId: string;
}
export interface CustomerOriginals {
  read(scope: OriginalScope): Promise<CustomerFavouriteCommand | null>;
  reserve(scope: OriginalScope, command: CustomerFavouriteCommand): Promise<boolean>;
  missing(scope: OriginalScope, operationId: string): Promise<void>;
  recovered(scope: OriginalScope, operationId: string): Promise<void>;
  retry(scope: OriginalScope, operationId: string): Promise<boolean>;
  clear(scope: OriginalScope, operationId: string): Promise<void>;
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** Atomic SQL reservation; no process-local pending state and no bearer tokens in this table. */
export function createCustomerOriginals(
  db: IdentityStateDatabase,
  encryptionKey: string,
): CustomerOriginals {
  if (!/^[0-9a-f]{64}$/.test(encryptionKey)) throw Error('Invalid original storage key.');
  const key = Buffer.from(encryptionKey, 'hex');
  function args(s: OriginalScope) {
    if (!uuid.test(s.tenantId) || !uuid.test(s.actorId)) throw Error('Invalid original scope.');
    return [s.tenantId, s.actorId];
  }
  function aad(s: OriginalScope, op: string) {
    if (!uuid.test(op)) throw Error('Invalid original operation.');
    return Buffer.from('customer-original-v1|' + args(s).join('|') + '|' + op);
  }
  return Object.freeze<CustomerOriginals>({
    async read(s) {
      const { rows } = await db.query(
        'SELECT sealed, operation_id FROM identity.customer_browser_originals WHERE tenant_id=$1 AND actor_id=$2',
        args(s),
      );
      if (!rows[0]) return null;
      const r = rows[0];
      if (
        typeof r.sealed !== 'string' ||
        !/^[A-Za-z0-9_-]{39,4096}$/.test(r.sealed) ||
        typeof r.operation_id !== 'string'
      )
        throw Error('Invalid original state.');
      const bytes = Buffer.from(r.sealed, 'base64url');
      const cipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(0, 12));
      cipher.setAAD(aad(s, r.operation_id));
      cipher.setAuthTag(bytes.subarray(12, 28));
      const command = validateCustomerFavouriteCommand(
        JSON.parse(
          Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'),
        ),
      );
      if (command.operationId !== r.operation_id) throw Error('Invalid original binding.');
      return command;
    },
    async reserve(s, value) {
      const command = validateCustomerFavouriteCommand(value),
        iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, iv);
      cipher.setAAD(aad(s, command.operationId));
      const bytes = Buffer.concat([cipher.update(JSON.stringify(command), 'utf8'), cipher.final()]);
      const sealed = Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
      const { rows } = await db.query(
        'INSERT INTO identity.customer_browser_originals (tenant_id,actor_id,operation_id,sealed) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id,actor_id) DO NOTHING RETURNING operation_id',
        [...args(s), command.operationId, sealed],
      );
      return rows.length === 1;
    },
    async missing(s, op) {
      aad(s, op);
      await db.query(
        'UPDATE identity.customer_browser_originals SET recovery_missing=true WHERE tenant_id=$1 AND actor_id=$2 AND operation_id=$3',
        [...args(s), op],
      );
    },
    async recovered(s, op) {
      aad(s, op);
      await db.query(
        'UPDATE identity.customer_browser_originals SET recovery_missing=false WHERE tenant_id=$1 AND actor_id=$2 AND operation_id=$3',
        [...args(s), op],
      );
    },
    async retry(s, op) {
      aad(s, op);
      const { rows } = await db.query(
        'UPDATE identity.customer_browser_originals SET recovery_missing=false WHERE tenant_id=$1 AND actor_id=$2 AND operation_id=$3 AND recovery_missing=true RETURNING operation_id',
        [...args(s), op],
      );
      return rows.length === 1;
    },
    async clear(s, op) {
      aad(s, op);
      await db.query(
        'DELETE FROM identity.customer_browser_originals WHERE tenant_id=$1 AND actor_id=$2 AND operation_id=$3',
        [...args(s), op],
      );
    },
  });
}
