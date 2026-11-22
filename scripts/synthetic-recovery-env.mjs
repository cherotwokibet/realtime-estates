import { randomBytes } from 'node:crypto';
/** Disposable local preview only. No persisted key, managed resource or identity data. Never log this object. */
export function syntheticRecoveryEnvironment(env = process.env) {
  if (
    [
      'PRIVATE_RECOVERY_CUSTODY_MODE',
      'PRIVATE_RECOVERY_CUSTODY_FILE',
      'PRIVATE_RECOVERY_CUSTODY_ID',
    ].some((k) => env[k] !== undefined)
  )
    throw Error('Use an explicit recovery custody launcher.');
  if (env.NODE_ENV === 'production') throw Error('Recovery preview refuses production.');
  const mode = env.PRIVATE_RECOVERY_MODE,
    key = env.PRIVATE_RECOVERY_STORAGE_KEY;
  if (mode !== undefined || key !== undefined) {
    if (
      mode !== 'synthetic-sealed-original-v1' ||
      typeof key !== 'string' ||
      !/^[0-9a-f]{64}$/.test(key)
    )
      throw Error('Explicit recovery configuration is invalid.');
    return Object.freeze({ PRIVATE_RECOVERY_MODE: mode, PRIVATE_RECOVERY_STORAGE_KEY: key });
  }
  return Object.freeze({
    PRIVATE_RECOVERY_MODE: 'synthetic-sealed-original-v1',
    PRIVATE_RECOVERY_STORAGE_KEY: randomBytes(32).toString('hex'),
  });
}
