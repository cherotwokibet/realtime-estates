import test from 'node:test';
import assert from 'node:assert/strict';
import { listingVerificationSession } from '../dist/tests/lib/listing-verification-session.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const command = () => ({
  operationId: id(300),
  policy: 'synthetic-check-record-v1',
  target: { listingId: id(100), listingVersion: '1', revision: 1, revisionVersion: '2' },
  expectedVerificationVersion: '0',
  subject: 'identity',
  outcome: 'inconclusive',
  evidenceReference: null,
  note: 'Synthetic assessment.',
  observedAt: '2026-01-01T00:00:00.000Z',
});
function memory() {
  const map = new Map();
  return {
    map,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}
test('assessment session stores original before dispatch, detaches edits and isolates instance/listing namespaces', () => {
  const store = memory(),
    session = listingVerificationSession(store, id(9), id(100)),
    input = command();
  assert.equal(session.load(), null);
  session.save(input);
  input.note = 'Edited form';
  assert.deepEqual(session.load(), command());
  assert.ok(Object.isFrozen(session.load().target));
  assert.equal(listingVerificationSession(store, id(8), id(100)).load(), null);
  assert.equal(listingVerificationSession(store, id(9), id(101)).load(), null);
  session.clear();
  assert.equal(session.load(), null);
});
test('assessment session refuses corrupt, foreign, duplicate-key and fractional-revision persisted originals', () => {
  for (const raw of [
    'not JSON',
    ' '.repeat(16385),
    JSON.stringify({ ...command(), target: { ...command().target, listingId: id(101) } }),
    JSON.stringify(command()).replace('"revision":1', '"revision":1.0'),
    JSON.stringify(command()).replace('"note":', '"note":"lost","n\\u006fte":'),
  ]) {
    const store = memory();
    store.setItem(`synthetic-check-original-v1:${id(9)}:${id(100)}`, raw);
    assert.throws(() => listingVerificationSession(store, id(9), id(100)).load());
    assert.equal(store.map.size, 1);
  }
});
test('storage denial and failed save readback cannot establish a retained original', () => {
  for (const store of [
    {
      getItem() {
        throw Error();
      },
      setItem() {
        throw Error();
      },
      removeItem() {
        throw Error();
      },
    },
    {
      getItem() {
        return null;
      },
      setItem() {},
      removeItem() {},
    },
  ])
    assert.throws(() => listingVerificationSession(store, id(9), id(100)).save(command()));
  const store = memory(),
    session = listingVerificationSession(store, id(9), id(100));
  assert.throws(() =>
    session.save({ ...command(), target: { ...command().target, listingId: id(101) } }),
  );
  assert.equal(store.map.size, 0);
});
