import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import type {
  BrowserIdentitySession,
  BrowserIdentityStore,
  LoginTransaction,
} from './browser-identity.js';

export interface IdentityStateDatabase {
  query(sql: string, values: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
}
/** Durable shared store. Schema must be installed separately by a migration owner.
 * The runtime login needs SELECT/INSERT/UPDATE/DELETE on this dedicated table.
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
      'INSERT INTO identity.browser_state (key, kind, sealed, expires_at, state_hash) VALUES ($1,$2,$3,$4,$5)',
      [
        key,
        kind,
        seal(key, value),
        value.expiresAt,
        kind === 'login'
          ? createHash('sha256')
              .update((value as LoginTransaction).state)
              .digest('hex')
          : null,
      ],
    );
  }
  return Object.freeze({
    putLogin: (key: string, value: LoginTransaction) => put(key, 'login', value),
    async claimLogin(key: string, state: string, now: number): Promise<LoginTransaction | null> {
      check(key, 'login');
      const { rows } = await database.query(
        "UPDATE identity.browser_state SET claimed=true WHERE key=$1 AND kind='login' AND claimed=false AND expires_at>$2 AND state_hash=$3 RETURNING sealed, expires_at",
        [key, now, createHash('sha256').update(state).digest('hex')],
      );
      return rows[0] ? unseal(key, rows[0], now) : null;
    },
    async completeLogin(
      loginKey: string,
      sessionKey: string,
      value: BrowserIdentitySession,
      now: number,
    ) {
      check(loginKey, 'login');
      check(sessionKey, 'session');
      if (
        loginKey.split(':')[0] !== sessionKey.split(':')[0] ||
        !Number.isSafeInteger(value.expiresAt) ||
        value.expiresAt <= now
      )
        throw Error('Invalid identity session completion.');
      const { rows } = await database.query(
        `WITH eligible AS (
        UPDATE identity.browser_state SET issued_session_key=$2
        WHERE key=$1 AND kind='login' AND claimed=true AND issued_session_key IS NULL AND expires_at>$5
        RETURNING key
      ) INSERT INTO identity.browser_state (key,kind,sealed,expires_at)
        SELECT $2,'session',$3,$4 FROM eligible RETURNING key`,
        [loginKey, sessionKey, seal(sessionKey, value), value.expiresAt, now],
      );
      return rows.length === 1;
    },
    async cancelLogin(key: string) {
      check(key, 'login');
      await database.query(
        `WITH cancelled AS (
        DELETE FROM identity.browser_state WHERE key=$1 AND kind='login' RETURNING issued_session_key
      ) DELETE FROM identity.browser_state WHERE kind='session' AND key IN (SELECT issued_session_key FROM cancelled)`,
        [key],
      );
    },
    async getSession(key: string, now: number): Promise<BrowserIdentitySession | null> {
      check(key, 'session');
      // Require the issuance marker on every read. READ COMMITTED cancellation can wait
      // for a callback's row lock yet miss its new session in the statement snapshot.
      // Removing the marker still revokes that orphan even when physical cleanup misses it.
      const { rows } = await database.query(
        `SELECT s.sealed, s.expires_at FROM identity.browser_state s
         WHERE s.key=$1 AND s.kind='session' AND s.expires_at>$2
         AND EXISTS (SELECT 1 FROM identity.browser_state l
           WHERE l.kind='login' AND l.issued_session_key=s.key)`,
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
      await database.query(
        `DELETE FROM identity.browser_state expired WHERE expires_at<=$1
        AND (kind='session' OR issued_session_key IS NULL OR NOT EXISTS (
          SELECT 1 FROM identity.browser_state live
          WHERE live.key=expired.issued_session_key AND live.kind='session' AND live.expires_at>$1))`,
        [now],
      );
    },
  });
}
