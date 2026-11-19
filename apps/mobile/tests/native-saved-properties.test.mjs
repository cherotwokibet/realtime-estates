import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileCustomerSession } from '../dist/tests/src/customer-session.js';
import { createNativeSavedProperties } from '../dist/tests/src/native-saved-properties.js';
import { readNativeFirebaseConfig } from '../dist/tests/src/native-firebase-config.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const token = 'synthetic.private.signature';
const json = (value, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const page = (start = 200, count = 2, hasMore = false, overrides = {}) => ({
  policy: 'customer-favourites-page-v1',
  tenantId: id(1),
  customerId: id(13),
  items: Array.from({ length: count }, (_, n) => ({
    listingId: id(start + n),
    version: '1',
    available: n % 2 === 0,
  })),
  hasMore,
  ...overrides,
});
const grant = (overrides = {}) => ({
  policy: 'runtime-customer-grant-v1',
  tenantId: id(1),
  customerId: id(13),
  generation: id(99),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  bearerToken: token,
  ...overrides,
});
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise((done) => setImmediate(done));
function fixture(t, fetchPage = () => json(page()), options = {}) {
  const calls = [];
  let actor = id(13);
  const session = createMobileCustomerSession(
    { mode: 'runtime-customer-v1', tenantId: id(1), apiOrigin: 'https://api.synthetic.invalid' },
    async (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer ' + token);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      if (new URL(url).pathname === '/v2/customer/account')
        return json({ policy: 'customer-account-v1', tenantId: id(1), customerId: actor });
      calls.push({ url, init });
      assert.equal(init.method, 'GET');
      assert.ok(!init.body);
      assert.ok(
        !Object.keys(init.headers).some((k) => /tenant|actor|role|company|preview/i.test(k)),
      );
      return fetchPage(url, init, calls.length);
    },
  );
  const controller = createNativeSavedProperties(
    session,
    options.links === false ? undefined : 'https://properties.synthetic.invalid',
    options.timeoutMs ?? 1000,
  );
  t.after(() => {
    controller.dispose();
    session.clear();
  });
  return {
    session,
    controller,
    calls,
    async login(overrides) {
      actor = overrides?.customerId ?? id(13);
      assert.equal(await session.activate(grant(overrides)), true);
    },
  };
}
test('inactive sessions do not read; one bounded page uses only validated server cursors and first/reload navigation', async (t) => {
  const f = fixture(t, (_, __, n) => json(n === 2 ? page(220, 1) : page(200, 20, true)));
  assert.equal(await f.controller.first(), false);
  assert.equal(f.calls.length, 0);
  await f.login();
  assert.equal(await f.controller.first(), true);
  assert.equal(f.controller.snapshot().page.items.length, 20);
  assert.equal(await f.controller.next(), true);
  assert.equal(f.controller.snapshot().pageNumber, 2);
  assert.equal(new URL(f.calls[1].url).search, '?limit=20&after=' + id(219));
  assert.equal(await f.controller.next(), false);
  assert.equal(f.calls.length, 2);
  assert.equal(await f.controller.reload(), false);
  assert.equal(new URL(f.calls[2].url).search, '?limit=20&after=' + id(219));
  // Repeating an earlier page is correctly refused by the cursor validator.
});
test('first page resets cursor while keeping only the current page and no credential in snapshot', async (t) => {
  const f = fixture(t, (_, __, n) => json(n === 2 ? page(220, 2) : page(200, 20, true)));
  await f.login();
  await f.controller.first();
  await f.controller.next();
  assert.equal(await f.controller.first(), true);
  assert.equal(f.controller.snapshot().pageNumber, 1);
  assert.equal(new URL(f.calls.at(-1).url).search, '?limit=20');
  assert.ok(!JSON.stringify(f.controller.snapshot()).includes(token));
  assert.ok(Object.isFrozen(f.controller.snapshot().page.items));
});
test('foreign accounts, malformed pagination, duplicate/out-of-order IDs and oversized pages refuse without stale data', async (t) => {
  const bad = [
    page(200, 2, false, { tenantId: id(2) }),
    page(200, 2, false, { customerId: id(14) }),
    page(200, 0, true),
    page(200, 21),
    { ...page(), items: [page().items[0], page().items[0]] },
    { ...page(), items: [...page().items].reverse() },
    { ...page(), role: 'owner' },
  ];
  for (const invalid of bad) {
    let reply = page();
    const f = fixture(t, () => json(reply));
    await f.login();
    assert.equal(await f.controller.first(), true);
    reply = invalid;
    assert.equal(await f.controller.reload(), false);
    assert.equal(f.controller.snapshot().phase, 'unavailable');
    assert.equal(f.controller.snapshot().page, null);
    assert.equal(f.controller.propertyUrl(id(200)), null);
  }
});
test('cursor overlap fails and reload retries that exact page without retaining the previous page', async (t) => {
  const f = fixture(t, (_, __, n) => json(n <= 2 ? page(200, 20, true) : page(220, 1)));
  await f.login();
  await f.controller.first();
  assert.equal(await f.controller.next(), false);
  assert.equal(f.controller.snapshot().page, null);
  assert.equal(f.controller.snapshot().pageNumber, 2);
  assert.equal(await f.controller.reload(), true);
  assert.equal(new URL(f.calls[2].url).searchParams.get('after'), id(219));
  assert.equal(f.controller.snapshot().page.items[0].listingId, id(220));
});
test('property navigation is current-page available-only and contains no auth, scope, cursor or tracking fields', async (t) => {
  const f = fixture(t);
  await f.login();
  await f.controller.first();
  assert.equal(
    f.controller.propertyUrl(id(200)),
    'https://properties.synthetic.invalid/properties/' + id(200),
  );
  assert.equal(f.controller.propertyUrl(id(201)), null);
  assert.equal(f.controller.propertyUrl(id(999)), null);
  assert.equal(f.controller.propertyUrl(id(200) + '?token=' + token), null);
  f.controller.hide();
  assert.equal(f.controller.propertyUrl(id(200)), null);
  assert.equal(f.controller.snapshot().page, null);
  const noLinks = fixture(t, () => json(page()), { links: false });
  await noLinks.login();
  await noLinks.controller.first();
  assert.equal(noLinks.controller.propertyUrl(id(200)), null);
});
test('trusted public link configuration rejects accessors, credentials, paths and foreign schemes', () => {
  const config = {
    mode: 'firebase-native-customer-v1',
    tenantId: id(1),
    apiOrigin: 'https://api.synthetic.invalid',
    firebase: {
      apiKey: 'AIza' + 'a'.repeat(35),
      projectId: 'synthetic-native',
      authDomain: 'synthetic-native.firebaseapp.com',
      appId: '1:123:web:abcdef123456',
    },
  };
  assert.equal(
    readNativeFirebaseConfig({
      ...config,
      propertyLinkOrigin: 'https://properties.synthetic.invalid',
    }).propertyLinkOrigin,
    'https://properties.synthetic.invalid',
  );
  for (const origin of [
    null,
    'http://properties.synthetic.invalid',
    'https://user:pass@properties.synthetic.invalid',
    'https://properties.synthetic.invalid/path',
    'https://properties.synthetic.invalid?token=x',
    'https://properties.synthetic.invalid:8443',
    'https://127.0.0.1',
  ])
    assert.throws(() => readNativeFirebaseConfig({ ...config, propertyLinkOrigin: origin }));
  let invoked = false;
  const accessor = { ...config };
  Object.defineProperty(accessor, 'propertyLinkOrigin', {
    enumerable: true,
    get() {
      invoked = true;
      return 'https://foreign.invalid';
    },
  });
  assert.throws(() => readNativeFirebaseConfig(accessor));
  assert.equal(invoked, false);
});
test('leaving the page cancels only its read and late ignored transport replies cannot repopulate it', async (t) => {
  const late = deferred();
  const f = fixture(t, (_, __, n) => (n === 1 ? late.promise : json(page(300))));
  await f.login();
  const pending = f.controller.first();
  await tick();
  assert.equal(await f.controller.next(), false);
  assert.equal(f.calls.length, 1);
  f.controller.hide();
  assert.equal(await pending, false);
  assert.equal(f.calls[0].init.signal.aborted, true);
  assert.equal(f.session.snapshot().status, 'ready');
  assert.equal(await f.controller.first(), true);
  let cancelled = false;
  late.resolve(
    new Response(
      new ReadableStream({
        cancel() {
          cancelled = true;
        },
      }),
    ),
  );
  await tick();
  assert.equal(cancelled, true);
  assert.equal(f.controller.snapshot().page.items[0].listingId, id(300));
});
test('logout and account switch discard private list/cursors and late replies from the old account', async (t) => {
  const late = deferred();
  const f = fixture(t, (_, __, n) =>
    n === 1 ? late.promise : json(page(400, 1, false, { customerId: id(14) })),
  );
  await f.login();
  const pending = f.controller.first();
  await tick();
  f.session.clear();
  assert.equal(f.controller.snapshot().page, null);
  assert.equal(await pending, false);
  await f.login({ customerId: id(14), generation: id(100) });
  assert.equal(await f.controller.first(), true);
  late.resolve(json(page()));
  await tick();
  assert.equal(f.controller.snapshot().page.customerId, id(14));
  assert.equal(f.controller.snapshot().pageNumber, 1);
  assert.equal(new URL(f.calls.at(-1).url).searchParams.has('after'), false);
});
test('expiry clears the page and cancels pending reads with deterministic timer advancement', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: Date.UTC(2026, 10, 19, 14) });
  const late = deferred();
  const f = fixture(t, () => late.promise);
  await f.login();
  const pending = f.controller.first();
  await tick();
  t.mock.timers.tick(60001);
  assert.equal(await pending, false);
  assert.equal(f.controller.snapshot().page, null);
  assert.equal(f.controller.snapshot().pageNumber, 1);
  assert.equal(f.session.snapshot().status, 'signed_out');
  late.resolve(json(page()));
  await tick();
  assert.equal(f.controller.snapshot().page, null);
});
test('timeout and transport/authorization errors distinguish retryable view failure from session refusal', async (t) => {
  const hung = fixture(t, () => new Promise(() => {}), { timeoutMs: 30 });
  await hung.login();
  assert.equal(await hung.controller.first(), false);
  assert.equal(hung.controller.snapshot().phase, 'unavailable');
  assert.equal(hung.session.snapshot().status, 'ready');
  for (const status of [401, 403, 500]) {
    const f = fixture(t, () => json({ error: { code: 'REFUSED' } }, status));
    await f.login();
    assert.equal(await f.controller.first(), false);
    assert.equal(f.controller.snapshot().page, null);
    assert.equal(f.session.snapshot().status, status === 500 ? 'ready' : 'signed_out');
  }
});
test('read cancellation is isolated from another list read on the same account', async (t) => {
  const late = deferred();
  const f = fixture(t, (_, __, n) => (n === 1 ? late.promise : json(page())));
  await f.login();
  const controller = new AbortController();
  const first = f.session.list({}, controller.signal);
  const second = f.session.list();
  controller.abort();
  assert.equal(await first, null);
  assert.equal((await second).items.length, 2);
  assert.equal(f.session.snapshot().status, 'ready');
  late.resolve(json(page()));
  await tick();
});
test('disposing a list cancels its outstanding read and permanently prevents further reads or links', async (t) => {
  const late = deferred();
  const f = fixture(t, () => late.promise);
  await f.login();
  const pending = f.controller.first();
  await tick();
  f.controller.dispose();
  assert.equal(await pending, false);
  assert.equal(f.controller.snapshot().page, null);
  assert.equal(await f.controller.first(), false);
  assert.equal(f.calls.length, 1);
  assert.equal(f.controller.propertyUrl(id(200)), null);
  assert.equal(f.session.snapshot().status, 'ready');
  late.resolve(json(page()));
  await tick();
  assert.equal(f.controller.snapshot().page, null);
});
