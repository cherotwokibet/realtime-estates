import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CustomerSessionBridge,
  customerPreviewConfig,
  normalizeCustomerRouteRequest,
} from '../dist/tests/lib/customer-session.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
  NOW = Date.UTC(2030, 0, 1),
  origin = 'http://127.0.0.1:3137',
  tenantId = id(1),
  a = id(13),
  b = id(14),
  bearer = 'synthetic13.header.signature';
const config = {
  policy: 'synthetic-customer-session-v1',
  tenantId,
  apiOrigin: 'http://127.0.0.1:4999',
  webOrigin: origin,
  expiresAt: new Date(NOW + 900000).toISOString(),
  users: [
    { id: a, label: 'Synthetic Customer A', bearerToken: bearer },
    { id: b, label: 'Synthetic Customer B', bearerToken: 'synthetic14.header.signature' },
  ],
};
const command = {
  policy: 'customer-favourite-command-v1',
  operationId: id(100),
  listingId: id(200),
  expectedVersion: '0',
  saved: true,
};
const request = (path, method = 'GET', cookie = '', csrf = '', body) =>
  new Request(origin + '/api/customer' + path, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(method === 'POST'
        ? {
            origin,
            'x-customer-intent': 'session-v1',
            'x-customer-csrf': csrf,
            'content-type': 'application/json',
          }
        : {}),
    },
    ...(body !== undefined ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
  });
function fixture() {
  const trace = [];
  let now = NOW,
    fault = null,
    held = null;
  const originals = new Map();
  const transport = async (url, init) => {
    const u = new URL(url),
      customerId = init.headers.Authorization.includes('synthetic14') ? b : a;
    trace.push({ path: u.pathname, method: init.method });
    if (held && u.pathname === '/v2/customer/favourites') {
      await held.promise;
      return Response.json(
        {
          policy: 'customer-favourites-page-v1',
          tenantId,
          customerId,
          items: [{ listingId: id(200), version: '1', available: true }],
          hasMore: false,
        },
        { headers: { 'cache-control': 'no-store' } },
      );
    }
    let value;
    if (u.pathname === '/v2/customer/account')
      value = { policy: 'customer-account-v1', tenantId, customerId };
    else if (init.method === 'POST') {
      const c = JSON.parse(init.body);
      value = {
        policy: 'customer-favourite-receipt-v1',
        tenantId,
        customerId,
        operationId: c.operationId,
        listingId: c.listingId,
        expectedVersion: c.expectedVersion,
        version: '1',
        requestedSaved: c.saved,
        saved: c.saved,
        outcome: 'applied',
        recordedAt: '2030-01-01T00:00:00.000Z',
      };
      if (fault !== 'before') originals.set(c.operationId, value);
      if (fault) {
        fault = null;
        throw Error('Synthetic lost reply');
      }
    } else if (u.pathname.includes('favourite-operations')) {
      value = originals.get(u.pathname.split('/').at(-1));
      if (!value) return new Response('', { status: 404 });
    } else
      value = {
        policy: 'customer-favourites-page-v1',
        tenantId,
        customerId,
        items: [],
        hasMore: false,
      };
    return Response.json(value, { headers: { 'cache-control': 'no-store' } });
  };
  const cfg = customerPreviewConfig(JSON.stringify(config), tenantId, 'development', now);
  const bridge = new CustomerSessionBridge(cfg, transport, () => now);
  const login = async (userId = a, oldCookie = '') => {
    const r = await bridge.handle(request('/sign-in', 'POST', oldCookie, '', { userId }));
    assert.equal(r.status, 200);
    const text = await r.text();
    assert(!text.includes('signature'));
    const session = JSON.parse(text),
      cookie = r.headers.get('set-cookie').split(';')[0];
    return { cookie, session, header: r.headers.get('set-cookie') };
  };
  return {
    bridge,
    trace,
    login,
    transport,
    now: (v) => (now = v),
    fault: (v) => (fault = v),
    hold() {
      let release;
      const promise = new Promise((r) => (release = r));
      held = { promise };
      return () => {
        release();
        held = null;
      };
    },
  };
}
test('strict synthetic config refuses production, wrong company, external origin, duplicate users and bearer getters', () => {
  assert.equal(customerPreviewConfig(undefined, tenantId, 'production', NOW), null);
  for (const cfg of [
    { ...config, tenantId: id(2) },
    { ...config, apiOrigin: 'https://external.invalid' },
    { ...config, expiresAt: new Date(NOW + 900001).toISOString() },
    { ...config, users: [...config.users, config.users[0]] },
    { ...config, users: [{ ...config.users[0], label: 'Real login' }] },
  ])
    assert.throws(() => customerPreviewConfig(JSON.stringify(cfg), tenantId, 'development', NOW));
  assert.throws(() => customerPreviewConfig(JSON.stringify(config), tenantId, 'production', NOW));
});
test('login validates current account and rotates host/company cookie without exposing credentials or cookie identity', async () => {
  const f = fixture();
  try {
    const x = await f.login();
    assert.match(x.header, /HttpOnly/);
    assert.match(x.header, /SameSite=Strict/);
    assert(!x.header.includes('Domain='));
    assert(!x.cookie.includes(x.session.account.generation));
    const y = await f.login(b, x.cookie);
    assert.notEqual(x.cookie, y.cookie);
    assert.equal(y.session.account.customerId, b);
    const old = await f.bridge.handle(request('/session', 'GET', x.cookie));
    assert.equal((await old.json()).account, null);
    const other = new CustomerSessionBridge({ ...config, tenantId: id(2) }, f.transport, () => NOW);
    assert.equal((await other.handle(request('/favourites', 'GET', y.cookie))).status, 401);
    other.close();
  } finally {
    f.bridge.close();
  }
});
test('origin, CSRF, duplicate JSON, caller identity and invalid page filters cannot dispatch a favourite', async () => {
  const f = fixture();
  try {
    const x = await f.login();
    const before = f.trace.length;
    assert.equal(
      (await f.bridge.handle(request('/favourite', 'POST', x.cookie, 'bad', command))).status,
      403,
    );
    const cross = request('/sign-out', 'POST', x.cookie, x.session.csrf, {});
    cross.headers.set('origin', 'http://localhost:9999');
    assert.equal((await f.bridge.handle(cross)).status, 403);
    assert.equal(
      (await f.bridge.handle(request('/session?tenantId=' + id(2), 'GET', x.cookie))).status,
      400,
    );
    assert.equal(
      (await f.bridge.handle(request('/favourites?limit=1&limit=2', 'GET', x.cookie))).status,
      400,
    );
    assert.equal(
      (
        await f.bridge.handle(
          request('/sign-in', 'POST', '', '', '{"userId":"' + a + '","userId":"' + b + '"}'),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await f.bridge.handle(
          request('/favourite', 'POST', x.cookie, x.session.csrf, { ...command, customerId: b }),
        )
      ).status,
      400,
    );
    assert.equal(f.trace.length, before);
  } finally {
    f.bridge.close();
  }
});
test('lost committed reply retains SAME original across session reads and requires explicit read/settle before new action', async () => {
  const f = fixture();
  try {
    const x = await f.login();
    f.fault('after');
    const lost = await f.bridge.handle(
      request('/favourite', 'POST', x.cookie, x.session.csrf, command),
    );
    assert.equal(lost.status, 503);
    assert.equal((await lost.json()).submissionUncertain, true);
    const resumed = await f.bridge.handle(request('/session', 'GET', x.cookie));
    assert.deepEqual((await resumed.json()).pending, command);
    assert.equal(
      (
        await f.bridge.handle(
          request('/favourite', 'POST', x.cookie, x.session.csrf, {
            ...command,
            operationId: id(101),
          }),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.bridge.handle(
          request('/retry', 'POST', x.cookie, x.session.csrf, { operationId: command.operationId }),
        )
      ).status,
      409,
    );
    assert.equal((await f.bridge.handle(request('/original', 'GET', x.cookie))).status, 200);
    assert.equal(
      (
        await f.bridge.handle(
          request('/settle', 'POST', x.cookie, x.session.csrf, {
            operationId: command.operationId,
          }),
        )
      ).status,
      200,
    );
    assert.equal(
      (await (await f.bridge.handle(request('/session', 'GET', x.cookie))).json()).pending,
      null,
    );
    assert.equal(f.trace.filter((x) => x.method === 'POST').length, 1);
  } finally {
    f.bridge.close();
  }
});
test('unrecorded original permits only deliberate retry of exact retained operation after explicit GET404', async () => {
  const f = fixture();
  try {
    const x = await f.login();
    f.fault('before');
    assert.equal(
      (await f.bridge.handle(request('/favourite', 'POST', x.cookie, x.session.csrf, command)))
        .status,
      503,
    );
    assert.equal((await f.bridge.handle(request('/original', 'GET', x.cookie))).status, 404);
    assert.equal(
      (
        await f.bridge.handle(
          request('/retry', 'POST', x.cookie, x.session.csrf, { operationId: id(101) }),
        )
      ).status,
      409,
    );
    assert.equal(
      (
        await f.bridge.handle(
          request('/retry', 'POST', x.cookie, x.session.csrf, { operationId: command.operationId }),
        )
      ).status,
      200,
    );
    assert.deepEqual(
      f.trace.filter((x) => x.path.includes('favourite-operations')).map((x) => x.method),
      ['POST', 'GET', 'POST'],
    );
  } finally {
    f.bridge.close();
  }
});
test('logout disposes pending originals and suppresses late private responses; expiry cannot resurrect session', async () => {
  const f = fixture();
  try {
    const x = await f.login();
    const release = f.hold();
    const pending = f.bridge.handle(request('/favourites', 'GET', x.cookie));
    await Promise.resolve();
    const out = await f.bridge.handle(request('/sign-out', 'POST', x.cookie, x.session.csrf, {}));
    assert.equal(out.status, 200);
    assert.match(out.headers.get('set-cookie'), /Max-Age=0/);
    release();
    const late = await pending;
    assert([401, 503].includes(late.status));
    assert(!(await late.text()).includes('listingId'));
    assert.equal((await f.bridge.handle(request('/favourites', 'GET', x.cookie))).status, 401);
    const y = await f.login();
    f.now(NOW + 600001);
    assert.equal((await f.bridge.handle(request('/favourites', 'GET', y.cookie))).status, 401);
  } finally {
    f.bridge.close();
  }
});

test('Next normalized URL is adapted only for the exact configured Host, preserving origin and request body', async () => {
  const f = fixture();
  try {
    const normalized = new Request('http://localhost:3137/api/customer/sign-in', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3137',
        origin,
        'x-customer-intent': 'session-v1',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ userId: a }),
    });
    const adapted = normalizeCustomerRouteRequest(normalized, origin);
    assert.equal(adapted.url, origin + '/api/customer/sign-in');
    assert.equal((await f.bridge.handle(adapted)).status, 200);
    for (const host of ['external.invalid', 'localhost:3137', '127.0.0.1:9999'])
      assert.throws(() =>
        normalizeCustomerRouteRequest(
          new Request('http://localhost:3137/api/customer/session', {
            headers: { host, 'x-forwarded-host': '127.0.0.1:3137' },
          }),
          origin,
        ),
      );
  } finally {
    f.bridge.close();
  }
});
