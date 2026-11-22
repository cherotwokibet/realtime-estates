import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStaffCaptureCommand, validateStaffCaptureReceipt } from '@realtor/api-client';
import { createPrivateRecoveryCipher } from '../dist/tests/lib/private-recovery-cipher.js';
import { createSealedRecoveryStore } from '../dist/tests/lib/private-recovery-store.js';
import { createPrivateRecoveryClient } from '../dist/tests/lib/private-recovery-client.js';
import { recoveryCommand } from '../dist/tests/lib/private-recovery-contract.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
for (const [n, role] of [
  [10, 'admin'],
  [11, 'agent'],
]) {
  const scope = { instanceId: id(90), tenantId: id(1), actorId: id(n) },
    kind = 'capture-' + role;
  const command = validateStaffCaptureCommand({
    policy: 'staff-capture-command-v1',
    operationId: id(90 + n),
    role,
    input: {
      listingId: null,
      name: ' Synthetic Capture ',
      phone: null,
      email: 'SYNTHETIC@example.test',
      message: 'PRIVATE_CAPTURE_CANARY',
      noticeVersion: 'synthetic-staff-notice-v1',
      noticeAcknowledged: true,
    },
  });
  const receipt = {
    policy: 'staff-capture-receipt-v1',
    tenantId: scope.tenantId,
    actorId: scope.actorId,
    operationId: command.operationId,
    request: command,
    enquiryId: id(500 + n),
    recordedAt: '2026-11-22T07:00:00.000Z',
  };
  test(
    role +
      ': normalized original ciphertext survives disposal; only full current-creator receipt releases it',
    async () => {
      const cipher = createPrivateRecoveryCipher('bc'.repeat(32)),
        map = new Map(),
        storage = {
          getItem: (k) => map.get(k) ?? null,
          setItem: (k, v) => map.set(k, v),
          removeItem: (k) => map.delete(k),
        },
        codec = {
          seal: async (c) => cipher.seal(scope, kind, c),
          open: async (e) => cipher.open(scope, kind, e),
        };
      const first = createSealedRecoveryStore(storage, scope, kind, codec);
      await first.retain(command);
      const snapshot = [...map];
      assert.doesNotMatch(
        JSON.stringify(snapshot),
        /PRIVATE_CAPTURE_CANARY|synthetic@example.test|Synthetic Capture/,
      );
      first.dispose();
      const store = createSealedRecoveryStore(storage, scope, kind, codec);
      assert.deepEqual(await store.load(), command);
      for (const patch of [
        { actorId: id(99) },
        { tenantId: id(2) },
        { operationId: id(999) },
        { request: { ...command, input: { ...command.input, message: 'changed' } } },
        { request: { ...command, role: role === 'admin' ? 'agent' : 'admin' } },
      ]) {
        await assert.rejects(async () => store.releaseConfirmed(command, { ...receipt, ...patch }));
        assert.deepEqual([...map], snapshot);
      }
      await store.releaseConfirmed(command, receipt);
      assert.equal(map.size, 0);
    },
  );
  test(
    role +
      ': capture kind cannot impersonate the other role, retire an original, or accept a bare ID acknowledgement',
    async () => {
      assert.throws(() =>
        recoveryCommand(kind, { ...command, role: role === 'admin' ? 'agent' : 'admin' }),
      );
      assert.throws(() => validateStaffCaptureReceipt({ id: receipt.enquiryId }, command, scope));
      let calls = 0;
      await assert.rejects(
        createPrivateRecoveryClient(scope, kind, () => {
          calls++;
          throw Error('Unexpected call');
        }).resolve(command, new AbortController().signal),
      );
      assert.equal(calls, 0);
    },
  );
}
