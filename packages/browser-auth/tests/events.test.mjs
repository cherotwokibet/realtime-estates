import assert from 'node:assert/strict';
import { test } from 'node:test';
import { authChange, authChangeEffect } from '../dist/events.js';
test('auth notifications distinguish invalidation from a request to recheck server authority', () => {
  for (const reason of ['signing-out', 'signed-out'])
    assert.equal(authChangeEffect(authChange(reason)), 'block');
  assert.equal(authChangeEffect(authChange('signed-in')), 'recheck');
  for (const event of [
    { type: 'auth-changed' },
    { type: 'auth-changed', reason: 'future' },
    { type: 'auth-changed', reason: 'signed-in', account: 'fake' },
    ['auth-changed'],
  ]) {
    assert.notEqual(authChangeEffect(event), 'recheck');
  }
  for (const event of [null, undefined, 1, 'signed-in', {}, { type: 'unrelated' }])
    assert.equal(authChangeEffect(event), 'ignore');
  assert.deepEqual(authChange('signing-out'), { type: 'auth-changed', reason: 'signing-out' });
});
