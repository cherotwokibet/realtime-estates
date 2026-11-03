import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCustomerFavouriteJson as parse,
  validateCustomerFavouriteCommand as command,
  validateCustomerFavouriteReceipt as receipt,
  validateCustomerFavouritesPage as page,
  validateCustomerAccount as account,
  validateCustomerFavouriteState as state,
} from '../dist/index.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const scope = { tenantId: id(1), customerId: id(13) };
const c = {
  policy: 'customer-favourite-command-v1',
  operationId: id(100),
  listingId: id(200),
  expectedVersion: '0',
  saved: true,
};
const r = {
  policy: 'customer-favourite-receipt-v1',
  ...scope,
  operationId: c.operationId,
  listingId: c.listingId,
  expectedVersion: '0',
  version: '1',
  requestedSaved: true,
  saved: true,
  outcome: 'applied',
  recordedAt: '2026-11-03T00:00:00.000Z',
};
test('exact command/receipt binds subject, company, desired state and version transition', () => {
  assert(Object.isFrozen(command(c)));
  assert(Object.isFrozen(receipt(r, c, scope)));
  for (const patch of [
    { customerId: id(14) },
    { tenantId: id(2) },
    { operationId: id(101) },
    { listingId: id(201) },
    { expectedVersion: '1' },
    { version: '2' },
    { saved: false },
    { requestedSaved: false },
    { recordedAt: '2026-02-30T00:00:00.000Z' },
    { outcome: 'sent' },
  ])
    assert.throws(() => receipt({ ...r, ...patch }, c, scope));
  assert.throws(() => command({ ...c, expectedVersion: '9007199254740991' }));
  assert.throws(() => command({ ...c, customerId: id(14) }));
});
test('bounded JSON rejects escaped duplicate authority/operation fields and oversized source', () => {
  assert.deepEqual(command(parse(JSON.stringify(c))), c);
  for (const text of [
    '{"a":1,"a":2}',
    '{"policy":1,"pol\\u0069cy":2}',
    '{"nested":{"x":1,"x":2}}',
    '{',
    ' '.repeat(32769),
  ])
    assert.throws(() => parse(text));
  let called = 0;
  const g = { ...c };
  Object.defineProperty(g, 'saved', {
    enumerable: true,
    get() {
      called++;
      return true;
    },
  });
  assert.throws(() => command(g));
  assert.equal(called, 0);
});
test('page rejects scope mixup, repeated/out-of-order/sparse/accessor rows and private fields', () => {
  const p = {
    policy: 'customer-favourites-page-v1',
    ...scope,
    items: [{ listingId: id(200), version: '1', available: false }],
    hasMore: false,
  };
  assert(Object.isFrozen(page(p, scope).items));
  account({ policy: 'customer-account-v1', ...scope }, scope);
  for (const bad of [
    { ...p, customerId: id(14) },
    { ...p, items: [...p.items, ...p.items] },
    { ...p, items: [{ ...p.items[0], title: 'private' }] },
    { ...p, hasMore: true },
    { ...p, items: new Array(1) },
  ])
    assert.throws(() => page(bad, scope));
  let called = 0;
  const a = [];
  Object.defineProperty(a, '0', {
    enumerable: true,
    get() {
      called++;
      return p.items[0];
    },
  });
  assert.throws(() => page({ ...p, items: a }, scope));
  assert.equal(called, 0);
  assert.throws(() => page(p, scope, 20, id(200)));
});

test('per-listing state binds company/customer and distinguishes absent from removed versions', () => {
  const initial = {
    policy: 'customer-favourite-state-v1',
    ...scope,
    listingId: c.listingId,
    version: '0',
    saved: false,
  };
  assert(Object.isFrozen(state(initial, scope, c.listingId)));
  state({ ...initial, version: '2' }, scope, c.listingId);
  for (const patch of [
    { saved: true },
    { tenantId: id(2) },
    { customerId: id(14) },
    { listingId: id(201) },
    { version: '01' },
    { version: '1.0' },
    { version: 1 },
  ])
    assert.throws(() => state({ ...initial, ...patch }, scope, c.listingId));
});
