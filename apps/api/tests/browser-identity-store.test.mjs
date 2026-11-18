import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresBrowserIdentityStore } from '../dist/browser-identity-store.js';

const key = 'ab'.repeat(32),
  prefix = 'cd'.repeat(32);
const loginKey = prefix + ':login:' + 'ef'.repeat(32);
const sessionKey = prefix + ':session:' + 'ef'.repeat(32);
test('durable encrypted identity records survive adapter restart, atomic consume and shared logout', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/browser-identity-state.sql', import.meta.url),
        'utf8',
      ),
    );
    const a = createPostgresBrowserIdentityStore(db, key),
      b = createPostgresBrowserIdentityStore(db, key);
    const tx = { verifier: 'private-verifier', nonce: 'private-nonce', expiresAt: 1000 };
    await a.putLogin(loginKey, tx);
    const consumed = await Promise.all([a.takeLogin(loginKey, 100), b.takeLogin(loginKey, 100)]);
    assert.equal(consumed.filter(Boolean).length, 1);
    assert.deepEqual(consumed.find(Boolean), tx);
    const session = {
      actorId: 'private-subject',
      accessToken: 'private-bearer-token',
      csrf: 'private-csrf',
      expiresAt: 2000,
    };
    await a.putSession(sessionKey, session);
    assert.deepEqual(await b.getSession(sessionKey, 1000), session);
    const raw = JSON.stringify((await db.query('SELECT * FROM identity.browser_state')).rows);
    for (const secret of Object.values(session).filter((v) => typeof v === 'string'))
      assert.equal(raw.includes(secret), false);
    await assert.rejects(a.putSession(sessionKey, session));
    assert.equal(await b.getSession(sessionKey, 2000), null);
    await b.deleteSession(sessionKey);
    assert.equal(await a.getSession(sessionKey, 1000), null);
    await a.putLogin(loginKey, tx);
    await b.pruneExpired(1000);
    assert.equal(await a.takeLogin(loginKey, 100), null);
  } finally {
    await db.close();
  }
});
test('ciphertext swap, modified expiry, wrong encryption key and malformed keys fail closed', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/browser-identity-state.sql', import.meta.url),
        'utf8',
      ),
    );
    const a = createPostgresBrowserIdentityStore(db, key);
    await a.putSession(sessionKey, {
      actorId: 'test',
      accessToken: 'test',
      csrf: 'test',
      expiresAt: 2000,
    });
    await assert.rejects(
      createPostgresBrowserIdentityStore(db, 'aa'.repeat(32)).getSession(sessionKey, 100),
    );
    const alternate = prefix + ':session:' + '01'.repeat(32);
    await db.query(
      'INSERT INTO identity.browser_state SELECT $1,kind,sealed,expires_at FROM identity.browser_state WHERE key=$2',
      [alternate, sessionKey],
    );
    await assert.rejects(a.getSession(alternate, 100));
    await db.query('UPDATE identity.browser_state SET expires_at=3000 WHERE key=$1', [sessionKey]);
    await assert.rejects(a.getSession(sessionKey, 100));
    await assert.rejects(a.getSession('untrusted-key', 100));
    assert.throws(() => createPostgresBrowserIdentityStore(db, 'short'));
  } finally {
    await db.close();
  }
});
