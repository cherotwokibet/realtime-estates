import test from 'node:test';
import assert from 'node:assert/strict';
import { staffInvitationIntentForPage } from '../dist/tests/lib/staff-invitation-selection.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const branch = {
  policy: 'staff-branch-current-v1',
  branchId: id(2),
  name: 'Nairobi',
  active: true,
  version: '1',
  recordedAt: '2026-11-02T05:00:00.000Z',
};
const page = (items) => ({ policy: 'staff-branch-page-v1', items, nextAfter: null });
const request = (branchId = id(2)) => ({
  policy: 'staff-invitation-intent-v1',
  operationId: id(1),
  recipientEmail: 'synthetic@example.invalid',
  requestedRole: 'agent',
  branchId,
  expiresAfterHours: 24,
});
test('invitation request retains the visible active branch and returns a detached immutable intent', () => {
  const input = request();
  const command = staffInvitationIntentForPage(page([branch]), input);
  input.branchId = null;
  assert.equal(command.branchId, id(2));
  assert.ok(Object.isFrozen(command));
});
test('branch paging, removal or deactivation refuses the old selection without substituting company-wide', () => {
  for (const items of [[], [{ ...branch, branchId: id(3) }], [{ ...branch, active: false }]])
    assert.throws(() => staffInvitationIntentForPage(page(items), request()));
  assert.equal(staffInvitationIntentForPage(page([]), request(null)).branchId, null);
});
test('branch selection preserves company-admin and strict intent requirements', () => {
  assert.throws(() =>
    staffInvitationIntentForPage(page([branch]), { ...request(), requestedRole: 'admin' }),
  );
  assert.equal(
    staffInvitationIntentForPage(page([]), { ...request(null), requestedRole: 'admin' }).branchId,
    null,
  );
  assert.throws(() =>
    staffInvitationIntentForPage(page([branch]), { ...request(), tenantId: id(4) }),
  );
});
