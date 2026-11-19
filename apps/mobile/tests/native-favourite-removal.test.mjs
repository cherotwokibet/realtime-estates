import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileCustomerSession } from '../dist/tests/src/customer-session.js';
import { createNativeSavedProperties } from '../dist/tests/src/native-saved-properties.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const token = 'synthetic.private.signature';
const json = (value, status = 200) =>
  Response.json(value, { status, headers: { 'Cache-Control': 'no-store' } });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((done) => setImmediate(done));
const account = (actor) => ({ policy: 'customer-account-v1', tenantId: id(1), customerId: actor });
const page = (actor) => ({
  policy: 'customer-favourites-page-v1',
  tenantId: id(1),
  customerId: actor,
  items: [{ listingId: id(200), version: '5', available: false }],
  hasMore: false,
});
const receipt = (command, overrides = {}) => ({
  policy: 'customer-favourite-receipt-v1',
  tenantId: id(1),
  customerId: id(13),
  operationId: command.operationId,
  listingId: command.listingId,
  expectedVersion: command.expectedVersion,
  version: '6',
  requestedSaved: false,
  saved: false,
  outcome: 'applied',
  recordedAt: '2026-11-19T16:00:00.000Z',
  ...overrides,
});
function fixture(t, exchange = (_, __, command) => json(receipt(command)), options = {}) {
  const calls = [];
  let actor = id(13),
    generated = 0,
    latest;
  const session = createMobileCustomerSession(
    { mode: 'runtime-customer-v1', tenantId: id(1), apiOrigin: 'https://synthetic.invalid' },
    async (url, init) => {
      calls.push({ url, init });
      assert.equal(init.headers.Authorization, 'Bearer ' + token);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      if (url.endsWith('/account')) return json(account(actor));
      if (url.includes('/favourites?')) return json(page(actor));
      if (init.method === 'POST') latest = JSON.parse(init.body);
      return exchange(url, init, latest);
    },
  );
  const controller = createNativeSavedProperties(
    session,
    undefined,
    1000,
    options.readOnly ? undefined : () => (options.badId ? 'invalid' : id(100 + ++generated)),
  );
  t.after(() => {
    controller.dispose();
    session.clear();
  });
  return {
    session,
    controller,
    calls,
    generated: () => generated,
    command: () => latest,
    async login(customerId = id(13)) {
      actor = customerId;
      assert.equal(
        await session.activate({
          policy: 'runtime-customer-grant-v1',
          tenantId: id(1),
          customerId,
          generation: id(99),
          expiresAt: new Date(Date.now() + 60000).toISOString(),
          bearerToken: token,
        }),
        true,
      );
      assert.equal(await controller.first(), true);
    },
    remove: () => controller.remove(id(200), controller.revision()),
    posts: () => calls.filter((c) => c.init.method === 'POST'),
  };
}
test('removal uses only a current visible row/version and fresh ID, including an unavailable saved listing', async (t) => {
  const f = fixture(t);
  await f.login();
  const revision = f.controller.revision();
  assert.equal(await f.controller.remove(id(201), revision), false);
  assert.equal(await f.controller.remove(id(200), revision - 1), false);
  assert.equal(f.generated(), 0);
  assert.equal(await f.remove(), true);
  assert.equal(f.controller.snapshot().operation, 'removed');
  assert.equal(f.controller.snapshot().page, null);
  assert.deepEqual(f.command(), {
    policy: 'customer-favourite-command-v1',
    operationId: id(101),
    listingId: id(200),
    expectedVersion: '5',
    saved: false,
  });
  assert.equal(await f.remove(), false);
  assert.equal(f.generated(), 1);
  assert.equal(await f.controller.continueRemoval(f.controller.revision()), true);
  assert.equal(f.controller.snapshot().operation, 'none');
  assert.equal(await f.remove(), true);
  assert.equal(f.command().operationId, id(102));
  assert.ok(!JSON.stringify(f.controller.snapshot()).includes(token));
});
test('lost acknowledgement blocks all new commands/retries until original receipt GET and explicit settlement', async (t) => {
  const f = fixture(t, (_, init, command) => {
    if (init.method === 'POST') throw Error('synthetic loss');
    return json(receipt(command));
  });
  await f.login();
  assert.equal(await f.remove(), false);
  assert.equal(f.controller.snapshot().operation, 'uncertain');
  assert.equal(await f.remove(), false);
  assert.equal(await f.controller.retryRemoval(f.controller.revision()), false);
  assert.equal(await f.controller.continueRemoval(f.controller.revision()), false);
  assert.equal(f.posts().length, 1);
  assert.equal(await f.controller.recoverRemoval(f.controller.revision()), true);
  assert.equal(f.controller.snapshot().operation, 'removed');
  assert.equal(f.calls.at(-1).url, f.posts()[0].url);
  assert.equal(f.calls.at(-1).init.method, 'GET');
  assert.equal(f.calls.at(-1).init.body, undefined);
  assert.equal(await f.controller.continueRemoval(f.controller.revision()), true);
  assert.equal(f.controller.snapshot().phase, 'ready');
  assert.equal(f.posts().length, 1);
});
test('missing original permits only explicit retry with byte-identical command and URL; concurrent requests refuse', async (t) => {
  const late = deferred();
  let writes = 0;
  const f = fixture(t, (_, init) => {
    if (init.method === 'POST') {
      if (++writes === 1) throw Error('loss');
      return late.promise;
    }
    return json({}, 404);
  });
  await f.login();
  await f.remove();
  assert.equal(await f.controller.recoverRemoval(f.controller.revision()), false);
  assert.equal(f.controller.snapshot().operation, 'missing');
  assert.equal(f.posts().length, 1);
  const retry = f.controller.retryRemoval(f.controller.revision());
  assert.equal(f.controller.snapshot().operation, 'busy');
  assert.equal(await f.remove(), false);
  assert.equal(await f.controller.retryRemoval(f.controller.revision()), false);
  late.resolve(json(receipt(f.command())));
  assert.equal(await retry, true);
  assert.equal(f.posts().length, 2);
  assert.equal(f.posts()[0].url, f.posts()[1].url);
  assert.equal(f.posts()[0].init.body, f.posts()[1].init.body);
  assert.equal(f.generated(), 1);
});
test('conflict is never announced as removal; continue refreshes before another versioned command', async (t) => {
  const f = fixture(t, (_, __, command) =>
    json(receipt(command, { outcome: 'conflict', saved: true, version: '9' })),
  );
  await f.login();
  assert.equal(await f.remove(), true);
  assert.equal(f.controller.snapshot().operation, 'conflict');
  assert.equal(await f.remove(), false);
  const before = f.calls.length;
  assert.equal(await f.controller.continueRemoval(f.controller.revision()), true);
  assert.equal(f.calls.length, before + 1);
  assert.ok(f.calls.at(-1).url.endsWith('/favourites?limit=20'));
});
test('malformed/foreign receipt remains uncertain and never leads to a blind second POST', async (t) => {
  for (const overrides of [
    { customerId: id(14) },
    { listingId: id(201) },
    { version: '5' },
    { requestedSaved: true },
  ]) {
    const f = fixture(t, (_, __, command) => json(receipt(command, overrides)));
    await f.login();
    assert.equal(await f.remove(), false);
    assert.equal(f.controller.snapshot().operation, 'uncertain');
    assert.equal(await f.controller.recoverRemoval(f.controller.revision()), false);
    assert.equal(f.posts().length, 1);
    assert.equal(await f.controller.retryRemoval(f.controller.revision()), false);
  }
});
test('definite rejection requires reload, while authorization refusal clears the account', async (t) => {
  for (const status of [400, 401, 403, 429]) {
    const f = fixture(t, () => json({ error: { code: 'REFUSED' } }, status));
    await f.login();
    assert.equal(await f.remove(), false);
    assert.equal(f.posts().length, 1);
    if ([401, 403].includes(status)) assert.equal(f.session.snapshot().status, 'signed_out');
    else {
      assert.equal(f.controller.snapshot().operation, 'rejected');
      assert.equal(await f.controller.reload(), true);
      assert.equal(f.controller.snapshot().operation, 'none');
    }
  }
  const invalid = fixture(t, undefined, { badId: true });
  await invalid.login();
  assert.equal(await invalid.remove(), false);
  assert.equal(invalid.posts().length, 0);
});
test('leaving the view preserves an in-flight write and its later recovery without resubmission', async (t) => {
  const late = deferred();
  const f = fixture(t, (_, init, command) =>
    init.method === 'POST' ? late.promise : json(receipt(command)),
  );
  await f.login();
  const pending = f.remove();
  f.controller.hide();
  assert.equal(f.controller.snapshot().operation, 'busy');
  late.reject(Error('late loss'));
  assert.equal(await pending, false);
  assert.equal(f.controller.snapshot().operation, 'uncertain');
  assert.equal(await f.controller.first(), false);
  assert.equal(await f.controller.recoverRemoval(f.controller.revision()), true);
  assert.equal(f.posts().length, 1);
});
test('logout/account switch cancels local write state; old replies and stale actions cannot alter the new account', async (t) => {
  const late = deferred();
  const f = fixture(t, () => late.promise);
  await f.login();
  const oldRevision = f.controller.revision();
  const pending = f.remove();
  f.session.clear();
  assert.equal(await pending, false);
  assert.equal(f.posts()[0].init.signal.aborted, true);
  await f.login(id(14));
  assert.equal(await f.controller.remove(id(200), oldRevision), false);
  assert.equal(await f.controller.recoverRemoval(oldRevision), false);
  assert.equal(await f.controller.retryRemoval(oldRevision), false);
  late.resolve(json(receipt(f.command())));
  await tick();
  assert.equal(f.controller.snapshot().operation, 'none');
  assert.equal(f.controller.snapshot().page.customerId, id(14));
  assert.equal(f.posts().length, 1);
});
test('read-only construction never enables mutation and disposed controllers cannot retry retained commands', async (t) => {
  const readonly = fixture(t, undefined, { readOnly: true });
  await readonly.login();
  assert.equal(await readonly.remove(), false);
  assert.equal(readonly.posts().length, 0);
  const f = fixture(t, () => {
    throw Error('loss');
  });
  await f.login();
  await f.remove();
  f.controller.dispose();
  assert.equal(await f.controller.recoverRemoval(f.controller.revision()), false);
  assert.equal(await f.controller.retryRemoval(f.controller.revision()), false);
  assert.equal(f.posts().length, 1);
});
