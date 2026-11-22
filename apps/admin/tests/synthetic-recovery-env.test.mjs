import test from 'node:test';
import assert from 'node:assert/strict';
import { syntheticRecoveryEnvironment } from '../../../scripts/synthetic-recovery-env.mjs';
test('disposable preview keys are random RAM-only values; explicit configuration is preserved and production/partial overrides fail closed', () => {
  const parent = {},
    a = syntheticRecoveryEnvironment(parent),
    b = syntheticRecoveryEnvironment(parent);
  assert.match(a.PRIVATE_RECOVERY_STORAGE_KEY, /^[0-9a-f]{64}$/);
  assert.notEqual(a.PRIVATE_RECOVERY_STORAGE_KEY, b.PRIVATE_RECOVERY_STORAGE_KEY);
  assert.equal(a.PRIVATE_RECOVERY_MODE, 'synthetic-sealed-original-v1');
  assert.deepEqual(parent, {});
  assert.ok(Object.isFrozen(a));
  assert.deepEqual(syntheticRecoveryEnvironment(a), a);
  for (const env of [
    { NODE_ENV: 'production' },
    { PRIVATE_RECOVERY_CUSTODY_MODE: 'synthetic-windows-owner-v1' },
    { PRIVATE_RECOVERY_CUSTODY_FILE: 'configured' },
    { PRIVATE_RECOVERY_CUSTODY_ID: 'configured' },
    { PRIVATE_RECOVERY_MODE: a.PRIVATE_RECOVERY_MODE },
    { PRIVATE_RECOVERY_STORAGE_KEY: a.PRIVATE_RECOVERY_STORAGE_KEY },
    {
      PRIVATE_RECOVERY_MODE: 'other',
      PRIVATE_RECOVERY_STORAGE_KEY: a.PRIVATE_RECOVERY_STORAGE_KEY,
    },
    { PRIVATE_RECOVERY_MODE: a.PRIVATE_RECOVERY_MODE, PRIVATE_RECOVERY_STORAGE_KEY: 'invalid' },
  ])
    assert.throws(() => syntheticRecoveryEnvironment(env));
});
