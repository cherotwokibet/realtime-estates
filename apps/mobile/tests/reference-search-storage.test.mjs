import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createMobileReferenceSearchStore,
  emptyMobileReferenceFilters,
  prepareMobileReferenceSearch,
} from '../dist/tests/src/reference-search.js';
const scope = {
  mode: 'synthetic-reference-public-v1',
  tenantSlug: 'sample-homes',
  apiOrigin: 'https://synthetic.invalid',
  allowLoopbackHttp: false,
};
const filters = {
  ...emptyMobileReferenceFilters,
  location: 'Synthetic town',
  purpose: 'rent',
  period: 'month',
  min: '20000.01',
  beds: '0',
};
function memoryStorage() {
  const items = new Map();
  return {
    items,
    async getItem(key) {
      return items.get(key) ?? null;
    },
    async setItem(key, value) {
      items.set(key, value);
    },
    async removeItem(key) {
      items.delete(key);
    },
  };
}

test('saved filters survive a fresh controller while companies and API origins remain separate', async () => {
  const storage = memoryStorage(),
    store = createMobileReferenceSearchStore(storage, scope);
  assert.deepEqual(await store.load(), { status: 'empty' });
  assert.equal(await store.save(filters), true);
  const restored = await createMobileReferenceSearchStore(storage, scope).load();
  assert.deepEqual(restored, { status: 'ready', filters });
  assert.equal(prepareMobileReferenceSearch(restored.filters).input.offset, 0);
  for (const other of [
    { ...scope, tenantSlug: 'realtime-estates' },
    { ...scope, apiOrigin: 'https://other.synthetic.invalid' },
  ])
    assert.deepEqual(await createMobileReferenceSearchStore(storage, other).load(), {
      status: 'empty',
    });
  const raw = [...storage.items.values()][0];
  assert.deepEqual(Object.keys(JSON.parse(raw)).sort(), [
    'apiOrigin',
    'filters',
    'mode',
    'tenantSlug',
    'version',
  ]);
  assert.equal(
    await createMobileReferenceSearchStore(storage, {
      ...scope,
      tenantSlug: 'realtime-estates',
    }).save({ ...filters, location: 'Other synthetic town' }),
    true,
  );
  assert.equal(await store.clear(), true);
  assert.deepEqual(await store.load(), { status: 'empty' });
  assert.equal(
    (
      await createMobileReferenceSearchStore(storage, {
        ...scope,
        tenantSlug: 'realtime-estates',
      }).load()
    ).filters.location,
    'Other synthetic town',
  );
});

test('corrupt, oversized, mismatched and future or private fields are discarded before reuse', async () => {
  const storage = memoryStorage(),
    store = createMobileReferenceSearchStore(storage, scope);
  await store.save(filters);
  const key = [...storage.items.keys()][0],
    valid = JSON.parse(storage.items.get(key));
  for (const raw of [
    '{',
    'x'.repeat(4097),
    JSON.stringify({ ...valid, version: 2 }),
    JSON.stringify({ ...valid, tenantSlug: 'realtime-estates' }),
    JSON.stringify({ ...valid, apiOrigin: 'https://other.synthetic.invalid' }),
    JSON.stringify({ ...valid, bearerToken: 'DO-NOT-RESTORE' }),
    JSON.stringify({ ...valid, filters: { ...filters, accountId: 'DO-NOT-RESTORE' } }),
    JSON.stringify({ ...valid, filters: { ...filters, type: 'unsupported' } }),
    JSON.stringify({ ...valid, filters: { ...filters, beds: '101' } }),
    JSON.stringify({ ...valid, filters: { ...filters, min: '1.001' } }),
    JSON.stringify({ ...valid, filters: { ...filters, purpose: '' } }),
  ]) {
    storage.items.set(key, raw);
    assert.deepEqual(await store.load(), { status: 'discarded' });
    assert.equal(storage.items.has(key), false);
  }
  assert.equal(await store.save({ ...filters, extra: 'DO-NOT-PERSIST' }), false);
});

test('a late save cannot overwrite a later clear across controller remounts', async () => {
  const storage = memoryStorage();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const setItem = storage.setItem;
  storage.setItem = async (...args) => {
    await gate;
    return setItem(...args);
  };
  const first = createMobileReferenceSearchStore(storage, scope);
  const saved = first.save(filters);
  filters.location = 'Changed after submission';
  const second = createMobileReferenceSearchStore(storage, scope);
  const cleared = second.clear();
  const read = second.load();
  release();
  assert.equal(await saved, true);
  assert.equal(await cleared, true);
  assert.deepEqual(await read, { status: 'empty' });
  assert.equal(storage.items.size, 0);
  filters.location = 'Synthetic town';
});

test('storage failures stay contained and do not poison later operations', async () => {
  const storage = memoryStorage(),
    store = createMobileReferenceSearchStore(storage, scope);
  const getItem = storage.getItem,
    setItem = storage.setItem,
    removeItem = storage.removeItem;
  storage.getItem = async () => {
    throw Error('PRIVATE platform failure');
  };
  assert.deepEqual(await store.load(), { status: 'unavailable' });
  storage.getItem = getItem;
  storage.setItem = async () => {
    throw Error('PRIVATE platform failure');
  };
  assert.equal(await store.save(filters), false);
  storage.setItem = setItem;
  assert.equal(await store.save(filters), true);
  storage.removeItem = async () => {
    throw Error('PRIVATE platform failure');
  };
  assert.equal(await store.clear(), false);
  storage.removeItem = removeItem;
  assert.equal(await store.clear(), true);
  assert.deepEqual(await store.load(), { status: 'empty' });
});
