import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type {
  BrowserIdentitySession,
  BrowserIdentityStore,
  LoginTransaction,
} from './browser-identity.js';

export interface IdentityStateDatabase {
  query(sql: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
/** Durable shared store. Schema must be installed separately by a migration owner.
 * The runtime login needs only SELECT/INSERT/DELETE on this dedicated table.
 * encryptionKeyHex is a server secret, independent of database/provider credentials.
 */
export function createPostgresBrowserIdentityStore(
  database: IdentityStateDatabase,
  encryptionKeyHex: string,
): BrowserIdentityStore & { pruneExpired(now?: number): Promise<void> } {
  if (!/^[0-9a-f]{64}$/.test(encryptionKeyHex)) throw Error('Invalid identity storage key.');
  const encryptionKey = Buffer.from(encryptionKeyHex, 'hex');
  const keyPattern = /^[0-9a-f]{64}:(?:login|session):[0-9a-f]{64}$/;
  function check(key: string, kind: string) {
    if (!keyPattern.test(key) || !key.includes(':' + kind + ':'))
      throw Error('Invalid identity state key.');
  }
  function seal(key: string, value: LoginTransaction | BrowserIdentitySession) {
    const iv = randomBytes(12),
      cipher = createCipheriv('aes-256-gcm', encryptionKey, iv);
    cipher.setAAD(Buffer.from(key));
    const bytes = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), bytes]).toString('base64url');
  }
  function unseal(key: string, row: Record<string, unknown>, now: number) {
    if (
      typeof row.sealed !== 'string' ||
      row.sealed.length > 32768 ||
      !/^[A-Za-z0-9_-]+$/.test(row.sealed)
    )
      throw Error('Invalid identity state.');
    const bytes = Buffer.from(row.sealed, 'base64url');
    if (bytes.length < 29) throw Error('Invalid identity state.');
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey, bytes.subarray(0, 12));
    cipher.setAAD(Buffer.from(key));
    cipher.setAuthTag(bytes.subarray(12, 28));
    const value = JSON.parse(
      Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8'),
    );
    if (!Number.isSafeInteger(value.expiresAt) || value.expiresAt !== Number(row.expires_at))
      throw Error('Invalid identity state expiry.');
    return value.expiresAt > now ? value : null;
  }
  async function put(key: string, kind: string, value: LoginTransaction | BrowserIdentitySession) {
    check(key, kind);
    if (!Number.isSafeInteger(value.expiresAt)) throw Error('Invalid identity state expiry.');
    // No upsert: an opaque login/session identifier may never overwrite an existing record.
    await database.query(
      'INSERT INTO identity.browser_state (key, kind, sealed, expires_at) VALUES ($1,$2,$3,$4)',
      [key, kind, seal(key, value), value.expiresAt],
    );
  }
  return Object.freeze({
    putLogin: (key: string, value: LoginTransaction) => put(key, 'login', value),
    async takeLogin(key: string, now: number): Promise<LoginTransaction | null> {
      check(key, 'login');
      const { rows } = await database.query(
        "DELETE FROM identity.browser_state WHERE key=$1 AND kind='login' RETURNING sealed, expires_at",
        [key],
      );
      return rows[0] ? unseal(key, rows[0], now) : null;
    },
    putSession: (key: string, value: BrowserIdentitySession) => put(key, 'session', value),
    async getSession(key: string, now: number): Promise<BrowserIdentitySession | null> {
      check(key, 'session');
      const { rows } = await database.query(
        "SELECT sealed, expires_at FROM identity.browser_state WHERE key=$1 AND kind='session' AND expires_at>$2",
        [key, now],
      );
      return rows[0] ? unseal(key, rows[0], now) : null;
    },
    async deleteSession(key: string) {
      check(key, 'session');
      await database.query("DELETE FROM identity.browser_state WHERE key=$1 AND kind='session'", [
        key,
      ]);
    },
    async pruneExpired(now = Date.now()) {
      if (!Number.isSafeInteger(now)) throw Error('Invalid cleanup timestamp.');
      await database.query('DELETE FROM identity.browser_state WHERE expires_at<=$1', [now]);
    },
  });
}
