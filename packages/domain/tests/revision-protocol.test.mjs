import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRevisionProtocol, validateRevisionProtocolTarget } from '../dist/index.js';
const id = '00000000-0000-4000-8000-000000000001',
  target = { listingId: id, revision: 1 };
const row = () => ({
  ...target,
  listingVersion: '1',
  revisionVersion: '2',
  state: 'draft',
  editable: true,
  protocol: 'ordinary-v2',
});
test('protocol contract freezes exact mixed-row identity/currency without adopting unknown protocols', () => {
  for (const protocol of ['ordinary-v2', 'synthetic-reference-v1'])
    for (const state of ['draft', 'pending', 'approved', 'rejected']) {
      const value = { ...row(), protocol, state, editable: state === 'draft' };
      assert.deepEqual(validateRevisionProtocol(value, target), value);
      assert.ok(Object.isFrozen(validateRevisionProtocol(value, target)));
    }
  for (const change of [
    { listingId: '00000000-0000-4000-8000-000000000002' },
    { revision: 2 },
    { listingVersion: '0' },
    { revisionVersion: 2 },
    { revisionVersion: '9007199254740992' },
    { listingVersion: '01' },
    { protocol: 'ordinary-v3' },
    { protocol: null },
    { state: 'archived' },
    { state: 'approved', editable: true },
    { editable: 1 },
    { privateFacts: 'unexpected' },
  ])
    assert.throws(() => validateRevisionProtocol({ ...row(), ...change }, target));
  for (const value of [null, [], {}, Object.assign(Object.create({}), row())])
    assert.throws(() => validateRevisionProtocol(value, target));
});
test('protocol validation never evaluates property getters, state coercions or hidden extra fields', () => {
  let reads = 0;
  const value = row();
  Object.defineProperty(value, 'state', {
    enumerable: true,
    get() {
      reads++;
      return 'draft';
    },
  });
  assert.throws(() => validateRevisionProtocol(value, target));
  assert.throws(() =>
    validateRevisionProtocol(
      {
        ...row(),
        state: {
          toString() {
            reads++;
            return 'draft';
          },
        },
      },
      target,
    ),
  );
  for (const extra of ['hidden', Symbol('extra')]) {
    const v = row();
    Object.defineProperty(v, extra, { value: 1 });
    assert.throws(() => validateRevisionProtocol(v, target));
  }
  assert.equal(reads, 0);
  for (const value of [0, -1, 1.1, 2147483648, NaN, '1', null])
    assert.throws(() => validateRevisionProtocolTarget({ ...target, revision: value }));
});
