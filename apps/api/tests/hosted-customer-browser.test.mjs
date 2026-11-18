import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import {
  fixture,
  publish,
  asActor,
  T,
  LISTING,
} from '../../../database/tests/public-media-fixtures.mjs';
import { createPostgresBrowserIdentityStore } from '../dist/browser-identity-store.js';
import { createFirebaseBrowserIdentity } from '../dist/firebase-browser-identity.js';
import { createCustomerOriginals } from '../dist/customer-browser-originals.js';
import { createHostedCustomerBrowser } from '../dist/hosted-customer-browser.js';
import { createCustomerFavouritesHttpCandidate } from '../dist/customer-favourites-http.js';
import { AuthenticationError } from '../dist/auth.js';

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const A = id(13),
  B = id(14),
  origin = 'https://synthetic-customer.example',
  apiOrigin = 'https://synthetic-api.example';
const command = (n = 9001) => ({
  policy: 'customer-favourite-command-v1',
  operationId: id(n),
  listingId: LISTING,
  expectedVersion: '0',
  saved: true,
});
async function setup() {
  const db = await fixture();
  await publish(db);
  for (const name of [
    'customer-favourites.sql',
    'browser-identity-state.sql',
    'customer-browser-originals.sql',
  ])
    await db.exec(
      await readFile(new URL('../../../database/proposals/' + name, import.meta.url), 'utf8'),
    );
  await db.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'customer')",
    [T, B],
  );
  const cookies = new Map(),
    tokenActors = new Map([
      ['syntheticA.payload.signature', A],
      ['syntheticB.payload.signature', B],
    ]);
  let bridge,
    bff,
    posts = 0,
    mode = 'normal',
    afterResponse = async () => {};
  const originals = () => createCustomerOriginals(db, '04'.repeat(32));
  const api = createCustomerFavouritesHttpCandidate({
    mode: 'synthetic-customer-favourites-v1',
    tenantId: T,
    database: { transaction: (context, fn) => asActor(db, context.tenantId, context.actorId, fn) },
    verifyAuthorization: async (r) => {
      const actorId = tokenActors.get(r.headers.get('authorization')?.slice(7));
      if (!actorId) throw new AuthenticationError();
      return { actorId };
    },
  });
  function restart() {
    bridge = createFirebaseBrowserIdentity(
      { projectId: 'realtor-synthetic-staging', applicationOrigin: origin, tenantId: T },
      createPostgresBrowserIdentityStore(db, '03'.repeat(32)),
      async (token) => {
        const actorId = tokenActors.get(token);
        if (!actorId) throw Error();
        return { actorId, expiresAt: Date.now() + 600000 };
      },
    );
    bff = createHostedCustomerBrowser(
      { applicationOrigin: origin, apiOrigin, tenantId: T },
      {
        handle: (r) => bridge.handle(r),
        authenticateSession: async (r) => {
          try {
            return await bridge.authenticateSession(r);
          } catch {
            throw new AuthenticationError();
          }
        },
      },
      originals(),
      async (url, options) => {
        assert.ok(String(url).startsWith(apiOrigin + '/v2/customer/'));
        const isWrite = options.method === 'POST';
        if (isWrite) {
          posts++;
          if (mode === 'lost-before') throw Error('synthetic network refusal');
        }
        const response = await api(new Request(url, options));
        if (isWrite && mode === 'lost-after') {
          assert.equal(response.status, 200);
          throw Error('synthetic reply lost after SQL commit');
        }
        await afterResponse(String(url));
        return response;
      },
      async () => ({
        title: 'Synthetic public home',
        priceMinor: 2000000,
        purpose: 'rent',
        rentalPeriod: 'month',
      }),
    );
  }
  function request(path, body, headers = {}) {
    return new Request(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        origin,
        cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; '),
        ...(body === undefined
          ? {}
          : { 'content-type': 'application/json', 'x-customer-intent': 'session-v1' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  }
  function accept(response) {
    for (const c of response.headers.getSetCookie()) {
      const pair = c.split(';')[0],
        i = pair.indexOf('=');
      if (pair.slice(i + 1)) cookies.set(pair.slice(0, i), pair.slice(i + 1));
      else cookies.delete(pair.slice(0, i));
    }
    return response;
  }
  async function login(actor = A) {
    const started = accept(await bridge.handle(request('/auth/login', {})));
    assert.equal(started.status, 200);
    const { state } = await started.json();
    const r = accept(
      await bridge.handle(
        request('/auth/firebase', {
          state,
          idToken: actor === A ? 'syntheticA.payload.signature' : 'syntheticB.payload.signature',
        }),
      ),
    );
    assert.equal(r.status, 200);
    return bridge.authenticateSession(request('/api/customer/session'));
  }
  restart();
  return {
    db,
    originals,
    request,
    login,
    restart,
    accept,
    get bridge() {
      return bridge;
    },
    get bff() {
      return bff;
    },
    get posts() {
      return posts;
    },
    set mode(v) {
      mode = v;
    },
    set afterResponse(v) {
      afterResponse = v;
    },
    async call(path, body, csrf) {
      return accept(
        await bff.handle(
          request('/api/customer' + path, body, csrf ? { 'x-customer-csrf': csrf } : {}),
        ),
      );
    },
  };
}

test('lost committed save survives identity/BFF/store recreation; recovery/settle add no second mutation', async () => {
  const f = await setup();
  try {
    const session = await f.login();
    const c = command();
    f.mode = 'lost-after';
    assert.equal((await f.call('/favourite', c, session.csrf)).status, 503);
    assert.equal(f.posts, 1);
    f.restart();
    f.mode = 'normal';
    const meta = await (await f.call('/session')).json();
    assert.deepEqual(meta.pending, c);
    assert.deepEqual(meta.choices, []);
    assert.equal(meta.account.customerId, A);
    assert.equal(meta.policy, 'hosted-customer-browser-session-v1');
    assert.ok(!JSON.stringify(meta).includes('payload.signature'));
    assert.equal(
      (await f.call('/retry', { operationId: c.operationId }, session.csrf)).status,
      409,
    );
    assert.equal((await f.call('/favourite', command(9002), session.csrf)).status, 409);
    const recovered = await f.call('/original');
    assert.equal(recovered.status, 200);
    assert.equal((await recovered.json()).saved, true);
    assert.equal(
      (await f.call('/settle', { operationId: c.operationId }, session.csrf)).status,
      200,
    );
    assert.equal(await f.originals().read({ tenantId: T, actorId: A }), null);
    assert.equal(f.posts, 1);
    const page = await (await f.call('/favourites')).json();
    assert.equal(page.page.items.length, 1);
    assert.equal(page.summaries[0].title, 'Synthetic public home');
    assert.equal((await f.call('/sign-out', {}, session.csrf)).status, 200);
    assert.equal((await f.call('/session')).status, 401);
  } finally {
    await f.db.close();
  }
});
test('only explicit missing-original recovery permits one retry of the retained bytes', async () => {
  const f = await setup();
  try {
    const session = await f.login(),
      c = command();
    f.mode = 'lost-before';
    assert.equal((await f.call('/favourite', c, session.csrf)).status, 503);
    assert.equal(
      (await f.call('/retry', { operationId: c.operationId }, session.csrf)).status,
      409,
    );
    assert.equal((await f.call('/original')).status, 404);
    f.restart();
    f.mode = 'normal';
    assert.equal(
      (await f.call('/retry', { operationId: c.operationId }, session.csrf)).status,
      200,
    );
    assert.equal(
      (await f.call('/retry', { operationId: c.operationId }, session.csrf)).status,
      409,
    );
    assert.equal(f.posts, 2);
    assert.equal((await f.call('/original')).status, 200);
    assert.equal(
      (await f.call('/retry', { operationId: c.operationId }, session.csrf)).status,
      409,
    );
  } finally {
    await f.db.close();
  }
});
test('current SQL membership and authenticated actor scope protect retained originals; logout works after membership revocation', async () => {
  const f = await setup();
  try {
    let session = await f.login();
    f.mode = 'lost-after';
    await f.call('/favourite', command(), session.csrf);
    f.mode = 'normal';
    await f.db.query(
      'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
      [T, A],
    );
    for (const path of ['/session', '/original', '/favourites'])
      assert.equal((await f.call(path)).status, 403);
    assert.equal((await f.call('/sign-out', {}, session.csrf)).status, 200);
    await f.login(B);
    const other = await (await f.call('/session')).json();
    assert.equal(other.account.customerId, B);
    assert.equal(other.pending, null);
    await f.db.query(
      'UPDATE app_private.memberships SET active=true,revoked_at=null WHERE tenant_id=$1 AND user_id=$2',
      [T, A],
    );
    session = await f.login(A);
    assert.deepEqual((await (await f.call('/session')).json()).pending, command());
    assert.equal((await f.call('/original')).status, 200);
  } finally {
    await f.db.close();
  }
});
test('logout during an in-flight private response suppresses its data while retaining the committed original', async () => {
  const f = await setup();
  try {
    const session = await f.login();
    let fired = false;
    f.afterResponse = async (url) => {
      if (!fired && url.includes('/favourite-operations/')) {
        fired = true;
        const r = await f.bridge.handle(
          f.request('/auth/logout', {}, { 'x-csrf-token': session.csrf }),
        );
        assert.equal(r.status, 200);
      }
    };
    const response = await f.call('/favourite', command(), session.csrf);
    assert.equal(response.status, 401);
    assert.ok(!(await response.text()).includes('recordedAt'));
    assert.equal(f.posts, 1);
    assert.deepEqual(await f.originals().read({ tenantId: T, actorId: A }), command());
  } finally {
    await f.db.close();
  }
});
test('origin, posted identity, CSRF, duplicate keys and synthetic account selection cannot start a hosted write', async () => {
  const f = await setup();
  try {
    const session = await f.login();
    for (const headers of [
      { origin: 'https://attacker.example' },
      { 'x-actor-id': B },
      { 'x-customer-csrf': 'wrong' },
      { 'sec-fetch-site': 'cross-site' },
    ]) {
      const r = await f.bff.handle(
        f.request('/api/customer/favourite', command(), {
          'x-customer-csrf': session.csrf,
          ...headers,
        }),
      );
      assert.ok([400, 403].includes(r.status));
    }
    assert.equal((await f.call('/sign-in', { userId: B }, session.csrf)).status, 404);
    const r = f.request('/api/customer/favourite', command(), { 'x-customer-csrf': session.csrf });
    const duplicated = JSON.stringify(command()).replace(
      '"saved":true',
      '"saved":true,"saved":false',
    );
    assert.equal((await f.bff.handle(new Request(r, { body: duplicated }))).status, 400);
    assert.equal(f.posts, 0);
    assert.equal(await f.originals().read({ tenantId: T, actorId: A }), null);
  } finally {
    await f.db.close();
  }
});
test('SQL reservation is exclusive, payloads are sealed and actor/company/ciphertext swapping is refused', async () => {
  const f = await setup();
  try {
    const store = f.originals(),
      scope = { tenantId: T, actorId: A };
    assert.deepEqual(
      (
        await Promise.all([store.reserve(scope, command()), store.reserve(scope, command(9002))])
      ).sort(),
      [false, true],
    );
    const retained = await store.read(scope);
    assert.ok([id(9001), id(9002)].includes(retained.operationId));
    const raw = (await f.db.query('SELECT sealed FROM identity.customer_browser_originals')).rows[0]
      .sealed;
    assert.ok(!raw.includes('listingId'));
    await f.db.query('UPDATE identity.customer_browser_originals SET actor_id=$1', [B]);
    await assert.rejects(store.read({ tenantId: T, actorId: B }));
    await f.db.exec('BEGIN; SET LOCAL ROLE api_runtime');
    try {
      await assert.rejects(f.db.query('SELECT * FROM identity.customer_browser_originals'));
    } finally {
      await f.db.exec('ROLLBACK');
    }
  } finally {
    await f.db.close();
  }
});
test('membership revoked while a saved-homes response is pending suppresses the returned rows', async () => {
  const f = await setup();
  try {
    const session = await f.login();
    assert.equal((await f.call('/favourite', command(), session.csrf)).status, 200);
    let revoked = false;
    f.afterResponse = async (url) => {
      if (!revoked && url.includes('/favourites?')) {
        revoked = true;
        await f.db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
          [T, A],
        );
      }
    };
    const response = await f.call('/favourites');
    assert.equal(response.status, 403);
    assert.ok(!(await response.text()).includes(LISTING));
    assert.equal(f.posts, 1);
  } finally {
    await f.db.close();
  }
});
