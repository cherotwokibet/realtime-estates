import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createBrowserSignInClient } from '../dist/client.js';
import { createFirebaseBrowserIdentity } from '../../../apps/api/dist/firebase-browser-identity.js';
import { createPostgresBrowserIdentityStore } from '../../../apps/api/dist/browser-identity-store.js';
test('client exchange and lost acknowledgement join actual SQL authority, scoped cookies and server logout', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(
        new URL('../../../database/proposals/browser-identity-state.sql', import.meta.url),
        'utf8',
      ),
    );
    const origin = 'https://synthetic-browser.example',
      actorId = '00000000-0000-4000-8000-000000000003',
      tenantId = '00000000-0000-4000-8000-000000000001';
    const bridge = createFirebaseBrowserIdentity(
      { projectId: 'realtor-synthetic-staging', applicationOrigin: origin, tenantId },
      createPostgresBrowserIdentityStore(db, '01'.repeat(32)),
      async () => ({ actorId, expiresAt: Date.now() + 600000 }),
    );
    const cookies = new Map();
    let exchanges = 0,
      disposals = 0;
    const client = createBrowserSignInClient(
      () => ({
        async google() {
          return {
            async idToken() {
              return 'synthetic.payload.signature';
            },
          };
        },
        async password() {
          throw Error('unused');
        },
        async dispose() {
          disposals++;
        },
      }),
      async (path, options) => {
        const request = new Request(origin + path, {
          ...options,
          headers: {
            ...options.headers,
            origin,
            cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
          },
        });
        const response = await bridge.handle(request);
        for (const line of response.headers.getSetCookie()) {
          const pair = line.split(';')[0],
            at = pair.indexOf('=');
          if (!pair.slice(at + 1)) cookies.delete(pair.slice(0, at));
          else cookies.set(pair.slice(0, at), pair.slice(at + 1));
        }
        if (path === '/auth/firebase') {
          exchanges++;
          throw Error('Lost response after server cookie/commit');
        }
        return response;
      },
    );
    await assert.rejects(client.signIn('google'), (e) => e.kind === 'uncertain');
    assert.equal(disposals, 1);
    const session = await client.getSession();
    assert.equal(session.account.actorId, actorId);
    assert.equal(session.account.tenantId, tenantId);
    assert.equal(exchanges, 1);
    await client.logout(session);
    assert.deepEqual(await client.getSession(), { account: null, csrf: null });
    assert.equal(
      (await db.query("SELECT * FROM identity.browser_state WHERE kind='session'")).rows.length,
      0,
    );
  } finally {
    await db.close();
  }
});
