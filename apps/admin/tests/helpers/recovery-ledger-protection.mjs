/** Labelled cross-platform fixture wrapping only; Windows tests use real DPAPI instead. */
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
export function ledgerTestProtection(keyHex) {
  if (process.platform === 'win32') return undefined;
  if (!/^[0-9a-f]{64}$/.test(keyHex ?? ''))
    throw Error('Explicit disposable wrapping fixture required.');
  const key = Buffer.from(keyHex, 'hex');
  return {
    testPolicy: 'owned-disposable-fixture-v1',
    testProtection: {
      name: 'owned-disposable-test-v1',
      protect: async (b) => {
        const iv = randomBytes(12),
          c = createCipheriv('aes-256-gcm', key, iv);
        const body = Buffer.concat([c.update(b), c.final()]);
        return Buffer.concat([iv, c.getAuthTag(), body]);
      },
      open: async (b) => {
        const c = createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
        c.setAuthTag(b.subarray(12, 28));
        return Buffer.concat([c.update(b.subarray(28)), c.final()]);
      },
    },
  };
}
