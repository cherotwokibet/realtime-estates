import test from 'node:test';
import assert from 'node:assert/strict';
import { CustomerViewGate } from '../dist/tests/lib/customer-view.js';
import {
  validateBrowserSession as session,
  validateBrowserFavourites as favourites,
  readCustomerBrowserReply as read,
} from '../dist/tests/lib/customer-browser.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0'),
  now = Date.UTC(2030, 0, 1);
const a = {
  tenantId: id(1),
  customerId: id(13),
  label: 'Synthetic Customer A',
  generation: 'a'.repeat(64),
  expiresAt: new Date(now + 600000).toISOString(),
};
const s = {
  policy: 'customer-browser-session-v1',
  account: a,
  csrf: 'b'.repeat(64),
  pending: null,
  choices: [{ id: a.customerId, label: a.label }],
};
test('browser reply scope binds fixed company, exact synthetic customer and expiry without accepting credentials', () => {
  assert(Object.isFrozen(session(s, id(1), now)));
  for (const bad of [
    { ...s, token: 'secret' },
    { ...s, account: { ...a, tenantId: id(2) } },
    { ...s, account: { ...a, customerId: id(14) } },
    { ...s, account: { ...a, expiresAt: new Date(now).toISOString() } },
    { ...s, account: null },
    { ...s, csrf: 'bad' },
  ])
    assert.throws(() => session(bad, id(1), now));
  let called = 0;
  const g = { ...s };
  Object.defineProperty(g, 'account', {
    enumerable: true,
    get() {
      called++;
      return a;
    },
  });
  assert.throws(() => session(g, id(1), now));
  assert.equal(called, 0);
});
test('favourite summaries cannot mix customers, duplicate rows, unavailable stock or private fields', () => {
  const p = {
      policy: 'customer-favourites-page-v1',
      tenantId: a.tenantId,
      customerId: a.customerId,
      items: [{ listingId: id(200), version: '1', available: true }],
      hasMore: false,
    },
    summary = {
      listingId: id(200),
      title: 'Synthetic saved home',
      priceMinor: 2000000,
      purpose: 'rent',
      rentalPeriod: 'month',
    };
  favourites({ page: p, summaries: [summary] }, a);
  for (const v of [
    { page: { ...p, customerId: id(14) }, summaries: [summary] },
    { page: p, summaries: [summary, summary] },
    { page: { ...p, items: [{ ...p.items[0], available: false }] }, summaries: [summary] },
    { page: p, summaries: [{ ...summary, privateAddress: 'secret' }] },
  ])
    assert.throws(() => favourites(v, a));
});
test('account generation invalidation aborts old reads and refuses late success after logout or account switch', async () => {
  const gate = new CustomerViewGate();
  const old = gate.begin();
  let release;
  const delayed = new Promise((r) => (release = r));
  let rendered = false;
  const work = delayed.then(() => {
    if (gate.current(old.version)) rendered = true;
  });
  const next = gate.begin();
  assert(old.signal.aborted);
  assert(!gate.current(old.version));
  release();
  await work;
  assert.equal(rendered, false);
  assert(gate.current(next.version));
  gate.invalidate();
  assert(next.signal.aborted);
  assert(!gate.current(next.version));
});
test('browser decoder refuses caching, duplicate JSON, malformed UTF-8 and oversized streaming bodies', async () => {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
  assert.deepEqual(await read(Response.json({ ok: true }, { headers })), { ok: true });
  for (const response of [
    Response.json({ ok: true }),
    new Response('{"x":1,"x":2}', { headers }),
    new Response(new Uint8Array([255]), { headers }),
    new Response(' '.repeat(32769), { headers }),
  ])
    await assert.rejects(() => read(response));
});
