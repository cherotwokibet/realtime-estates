import { randomUUID } from 'node:crypto';
import { syntheticRecoveryEnvironment } from './synthetic-recovery-env.mjs';
import { loadSyntheticRecoveryCustody } from './private-recovery-custody.mjs';
/** Opt-in custody must be complete before resources start. No key or namespace fallback. */
export async function syntheticRecoveryLaunchEnvironment(
  env = process.env,
  tenantSlug = env.TENANT_SLUG ?? 'realtime-estates',
  options,
) {
  if (process.env.NODE_ENV === 'production' || env.NODE_ENV === 'production')
    throw Error('Synthetic recovery custody unavailable.');
  const keys = [
    'PRIVATE_RECOVERY_CUSTODY_MODE',
    'PRIVATE_RECOVERY_CUSTODY_FILE',
    'PRIVATE_RECOVERY_CUSTODY_ID',
  ];
  if (keys.some((k) => env[k] !== undefined)) {
    if (
      env.NODE_ENV === 'production' ||
      env.PRIVATE_RECOVERY_CUSTODY_MODE !== 'synthetic-windows-owner-v1' ||
      env.PRIVATE_RECOVERY_MODE !== undefined ||
      env.PRIVATE_RECOVERY_STORAGE_KEY !== undefined
    )
      throw Error('Synthetic recovery custody unavailable.');
    const value = await loadSyntheticRecoveryCustody(
      env.PRIVATE_RECOVERY_CUSTODY_FILE,
      tenantSlug,
      env.PRIVATE_RECOVERY_CUSTODY_ID,
      env,
      options,
    );
    return Object.freeze(
      Object.defineProperty(
        { mode: 'protected-owner-custody', custodyId: value.custodyId, instances: value.instances },
        'environment',
        {
          value: Object.freeze({
            PRIVATE_RECOVERY_MODE: 'synthetic-sealed-original-v1',
            PRIVATE_RECOVERY_STORAGE_KEY: value.storageKey,
          }),
          enumerable: false,
        },
      ),
    );
  }
  return Object.freeze(
    Object.defineProperty(
      {
        mode: 'ephemeral',
        instances: Object.freeze({ staff: randomUUID(), admin: randomUUID(), agent: randomUUID() }),
      },
      'environment',
      { value: syntheticRecoveryEnvironment(env), enumerable: false },
    ),
  );
}
/** Public preview children never inherit recovery material or local custody configuration. */
export function publicPreviewRecoveryEnvironment(env) {
  return Object.fromEntries(
    Object.entries(env).filter(([name]) => !/^PRIVATE_RECOVERY_/i.test(name)),
  );
}
