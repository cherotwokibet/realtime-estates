import test from 'node:test';
import assert from 'node:assert/strict';
import { adminAuditQuery, validateAdminAuditPage } from '../dist/index.js';
const tenant = '00000000-0000-4000-8000-000000000001';
const query = () => adminAuditQuery(new URLSearchParams());
const row = () => ({
  id: '9007199254740994',
  actorId: null,
  action: 'listing.reassigned',
  objectType: 'listing',
  objectId: tenant,
  objectVersion: '9007199254740993',
  occurredAt: '2026-11-03T16:00:00.123456+00:00',
});
const page = () => ({
  policy: 'admin-audit-page-v1',
  tenantId: tenant,
  items: [row()],
  nextBefore: null,
});
test('audit bounds, exact bigint strings, company/filter/order/cursor bindings', () => {
  assert.deepEqual(query(), { limit: 20, before: null, actorId: null, objectId: null });
  const parsed = validateAdminAuditPage(page(), tenant, query());
  assert.equal(parsed.items[0].objectVersion, '9007199254740993');
  for (const source of [
    'limit=0',
    'limit=21',
    'limit=01',
    'before=0',
    'before=9223372036854775808',
    'limit=2&limit=3',
    'tenantId=' + tenant,
    'actorId=bad',
    'objectId=',
  ])
    assert.throws(() => adminAuditQuery(new URLSearchParams(source)));
  for (const mutate of [
    (p) => (p.tenantId = tenant.replace(/1$/, '2')),
    (p) => p.items.push(row()),
    (p) => (p.items[0].id = 9007199254740994),
    (p) => (p.nextBefore = '1'),
    (p) => (p.items[0].summary = { secret: true }),
    (p) => (p.items[0].objectVersion = '1e2'),
  ]) {
    const p = page();
    mutate(p);
    assert.throws(() => validateAdminAuditPage(p, tenant, query()));
  }
  assert.throws(() => validateAdminAuditPage(page(), tenant, { ...query(), before: row().id }));
  assert.throws(() => validateAdminAuditPage(page(), tenant, { ...query(), actorId: tenant }));
  const p = page();
  p.nextBefore = p.items[0].id;
  assert.equal(validateAdminAuditPage(p, tenant, { ...query(), limit: 1 }).nextBefore, row().id);
});
test('audit accessors, extra private fields and sparse/accessor rows fail without invoking getters', () => {
  let reads = 0;
  for (const target of ['page', 'row', 'array']) {
    const p = page();
    const obj = target === 'page' ? p : target === 'row' ? p.items[0] : p.items;
    const key = target === 'page' ? 'tenantId' : target === 'row' ? 'action' : '0';
    Object.defineProperty(obj, key, {
      enumerable: true,
      get() {
        reads++;
        throw Error('private');
      },
    });
    assert.throws(() => validateAdminAuditPage(p, tenant, query()));
  }
  const p = page();
  delete p.items[0];
  assert.throws(() => validateAdminAuditPage(p, tenant, query()));
  assert.equal(reads, 0);
});
