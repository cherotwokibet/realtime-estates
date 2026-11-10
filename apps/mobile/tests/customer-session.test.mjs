import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileCustomerSession } from '../dist/tests/src/customer-session.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const config = {
  mode: 'runtime-customer-v1',
  tenantId: id(1),
  apiOrigin: 'https://synthetic.invalid',
};
const grant = (overrides = {}) => ({
  policy: 'runtime-customer-grant-v1',
  tenantId: id(1),
  customerId: id(13),
  generation: id(99),
  expiresAt: new Date(Date.now() + 60000).toISOString(),
  bearerToken: 'synthetic.header.signature',
  ...overrides,
});
const account = (customerId) => ({ policy: 'customer-account-v1', tenantId: id(1), customerId });
const command = {
  policy: 'customer-favourite-command-v1',
  operationId: id(100),
  listingId: id(200),
  expectedVersion: '0',
  saved: true,
};
const receipt = {
  policy: 'customer-favourite-receipt-v1',
  tenantId: id(1),
  customerId: id(13),
  operationId: command.operationId,
  listingId: command.listingId,
  expectedVersion: '0',
  version: '1',
  requestedSaved: true,
  saved: true,
  outcome: 'applied',
  recordedAt: '2026-11-10T21:30:00.000Z',
};
const json = (value) => Response.json(value, { headers: { 'Cache-Control': 'no-store' } });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test('native session is off by default and invalid grants/config never dispatch or invoke accessors', async () => {
  let calls = 0,
    getters = 0;
  const transport = async () => {
    calls++;
    return json(account(id(13)));
  };
  const off = createMobileCustomerSession(undefined, transport);
  assert.equal(await off.activate(grant()), false);
  assert.equal(off.snapshot().status, 'off');
  assert.equal(await off.save(command), false);
  assert.throws(() =>
    createMobileCustomerSession({ ...config, apiOrigin: 'http://external.invalid' }, transport),
  );
  assert.throws(() => createMobileCustomerSession({ ...config, bearerToken: 'secret' }, transport));
  const s = createMobileCustomerSession(config, transport);
  try {
    const bad = grant();
    Object.defineProperty(bad, 'bearerToken', {
      enumerable: true,
      get() {
        getters++;
        return 'secret';
      },
    });
    for (const value of [
      bad,
      grant({ tenantId: id(2) }),
      grant({ expiresAt: new Date(Date.now() - 1).toISOString() }),
      grant({ expiresAt: new Date(Date.now() + 900000).toISOString() }),
      grant({ extra: 'secret' }),
      grant({ bearerToken: 'plain secret' }),
    ])
      assert.equal(await s.activate(value), false);
    assert.equal(s.snapshot().status, 'signed_out');
    assert.equal(calls, 0);
    assert.equal(getters, 0);
  } finally {
    s.clear();
  }
});

test('native account validation precedes private reads; snapshots omit credentials and exact scope is validated', async () => {
  const calls = [];
  const s = createMobileCustomerSession(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/account')) return json(account(id(13)));
    if (url.includes('?'))
      return json({
        policy: 'customer-favourites-page-v1',
        tenantId: id(1),
        customerId: id(13),
        items: [],
        hasMore: false,
      });
    return json({
      policy: 'customer-favourite-state-v1',
      tenantId: id(1),
      customerId: id(13),
      listingId: id(200),
      version: '0',
      saved: false,
    });
  });
  try {
    assert.equal(await s.favourite(id(200)), null);
    assert.equal(await s.activate(grant()), true);
    assert.equal((await s.favourite(id(200))).saved, false);
    assert.equal((await s.list()).items.length, 0);
    const snapshot = s.snapshot();
    assert.equal(snapshot.phase, 'idle');
    assert.equal(Object.isFrozen(snapshot), true);
    assert(!JSON.stringify(s).includes('signature'));
    assert(!JSON.stringify(snapshot).includes('bearer'));
    assert.equal(calls.length, 3);
    for (const { url, init } of calls) {
      assert(url.startsWith(config.apiOrigin + '/v2/customer/'));
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
    }
  } finally {
    s.clear();
  }
  const denied = createMobileCustomerSession(config, async () => json(account(id(14))));
  try {
    assert.equal(await denied.activate(grant()), false);
    assert.equal(denied.snapshot().status, 'signed_out');
  } finally {
    denied.clear();
  }
});

test('lost committed reply freezes one operation until original GET and explicit settlement; no automatic retry', async () => {
  const calls = [];
  const s = createMobileCustomerSession(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/account')) return json(account(id(13)));
    if (init.method === 'POST') throw Error('private connection detail');
    return json(receipt);
  });
  try {
    assert.equal(await s.activate(grant()), true);
    const input = { ...command };
    assert.equal(await s.save(input), false);
    input.saved = false;
    assert.equal(s.snapshot().phase, 'uncertain');
    assert.deepEqual(s.snapshot().pending, command);
    assert.equal(await s.save({ ...command, operationId: id(101) }), false);
    assert.equal(await s.retry(), false);
    assert.equal(s.settle(), false);
    assert.equal(await s.recover(), true);
    assert.equal(s.snapshot().phase, 'settled');
    assert.equal(s.snapshot().receipt.outcome, 'applied');
    assert.equal(await s.save(command), false);
    assert.equal(s.settle(), true);
    assert.equal(s.snapshot().pending, null);
    assert.deepEqual(
      calls.map((x) => x.init.method),
      ['GET', 'POST', 'GET'],
    );
    assert.equal(calls[1].url, calls[2].url);
    assert.deepEqual(JSON.parse(calls[1].init.body), command);
    assert.equal(calls[2].init.body, undefined);
  } finally {
    s.clear();
  }
});

test('missing original enables only deliberate retry of exact retained command and blocks concurrent writes', async () => {
  const reply = deferred(),
    calls = [];
  let writes = 0;
  const s = createMobileCustomerSession(config, async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('/account')) return json(account(id(13)));
    if (init.method === 'POST') {
      writes++;
      if (writes === 1) throw Error('loss');
      return reply.promise;
    }
    return new Response(null, { status: 404 });
  });
  try {
    await s.activate(grant());
    await s.save(command);
    assert.equal(await s.recover(), false);
    assert.equal(s.snapshot().phase, 'missing');
    assert.equal(await s.save({ ...command, saved: false }), false);
    const retry = s.retry();
    assert.equal(s.snapshot().phase, 'busy');
    assert.equal(await s.retry(), false);
    assert.equal(await s.recover(), false);
    assert.equal(s.settle(), false);
    reply.resolve(json(receipt));
    assert.equal(await retry, true);
    const posts = calls.filter((x) => x.init.method === 'POST');
    assert.equal(posts.length, 2);
    assert.equal(posts[0].url, posts[1].url);
    assert.equal(posts[0].init.body, posts[1].init.body);
  } finally {
    reply.resolve(json(receipt));
    s.clear();
  }
});

test('switch and logout abort active work and suppress late account/private replies', async () => {
  const first = deferred(),
    privateReply = deferred();
  let accountReads = 0,
    oldSignal;
  const s = createMobileCustomerSession(config, async (url, init) => {
    if (url.endsWith('/account')) {
      accountReads++;
      if (accountReads === 1) {
        oldSignal = init.signal;
        return first.promise;
      }
      return json(account(id(14)));
    }
    oldSignal = init.signal;
    return privateReply.promise;
  });
  try {
    const old = s.activate(grant());
    assert.equal(s.snapshot().status, 'activating');
    assert.equal(await s.activate(grant({ customerId: id(14), generation: id(98) })), true);
    assert.equal(oldSignal.aborted, true);
    first.resolve(json(account(id(13))));
    assert.equal(await old, false);
    assert.equal(s.snapshot().account.customerId, id(14));
    const read = s.favourite(id(200));
    s.clear();
    assert.equal(oldSignal.aborted, true);
    privateReply.resolve(
      json({
        policy: 'customer-favourite-state-v1',
        tenantId: id(1),
        customerId: id(14),
        listingId: id(200),
        version: '0',
        saved: false,
      }),
    );
    assert.equal(await read, null);
    assert.equal(s.snapshot().status, 'signed_out');
  } finally {
    first.resolve(json(account(id(13))));
    privateReply.resolve(new Response(null, { status: 403 }));
    s.clear();
  }
});

test('session expiry and server revocation clear pending private state without resurrecting it', async () => {
  let deny = false;
  const s = createMobileCustomerSession(config, async (url) =>
    url.endsWith('/account')
      ? json(account(id(13)))
      : deny
        ? new Response(null, { status: 403 })
        : Promise.reject(Error('loss')),
  );
  try {
    assert.equal(
      await s.activate(grant({ expiresAt: new Date(Date.now() + 100).toISOString() })),
      true,
    );
    await s.save(command);
    assert.equal(s.snapshot().phase, 'uncertain');
    await new Promise((resolve) => setTimeout(resolve, 130));
    assert.equal(s.snapshot().status, 'signed_out');
    assert.equal(await s.recover(), false);
    assert.equal(await s.activate(grant()), true);
    deny = true;
    assert.equal(await s.list(), null);
    assert.equal(s.snapshot().status, 'signed_out');
  } finally {
    s.clear();
  }
});
