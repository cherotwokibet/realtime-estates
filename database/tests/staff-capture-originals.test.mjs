import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, asActor, T, OTHER, ADMIN, AGENT, scalar } from './public-media-fixtures.mjs';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const PEER = id(12);
const command = (role, n) => ({
  policy: 'staff-capture-command-v1',
  operationId: id(n),
  role,
  input: {
    listingId: null,
    name: 'Synthetic Capture',
    phone: null,
    email: 'synthetic@example.test',
    message: 'PRIVATE_CAPTURE_ORIGINAL',
    noticeVersion: 'synthetic-staff-notice-v1',
    noticeAcknowledged: true,
  },
});
for (const [actor, role, n] of [
  [ADMIN, 'admin', 8500],
  [AGENT, 'agent', 8600],
])
  test(
    role +
      ': immutable creator-bound capture receipt replays once, recovers unassigned work, and rejects foreign facts/actor/revocation',
    async (t) => {
      const db = await fixture();
      t.after(() => db.close());
      const c = command(role, n);
      const write = (who, value = c) =>
        asActor(db, T, who, () =>
          scalar(db, 'SELECT app_api.record_staff_capture_original($1,$2::jsonb)', [
            id(n + 1),
            JSON.stringify(value),
          ]),
        );
      const receipt = await write(actor);
      assert.deepEqual(receipt.request, c);
      assert.equal(receipt.actorId, actor);
      assert.equal(receipt.tenantId, T);
      assert.equal(new Date(receipt.recordedAt).toISOString(), receipt.recordedAt);
      assert.deepEqual(await write(actor), receipt);
      assert.deepEqual(
        await asActor(db, T, actor, () =>
          scalar(db, 'SELECT app_api.read_staff_capture_original($1)', [c.operationId]),
        ),
        receipt,
      );
      assert.equal(
        (
          await db.query(
            'SELECT assigned_agent_id FROM app_private.enquiries WHERE tenant_id=$1 AND id=$2',
            [T, receipt.enquiryId],
          )
        ).rows[0].assigned_agent_id,
        null,
      );
      assert.equal(
        await asActor(db, T, PEER, () =>
          scalar(db, 'SELECT app_api.read_staff_capture_original($1)', [c.operationId]),
        ),
        null,
      );
      assert.equal(
        await asActor(db, OTHER, id(20), () =>
          scalar(db, 'SELECT app_api.read_staff_capture_original($1)', [c.operationId]),
        ),
        null,
      );
      await assert.rejects(write(actor, { ...c, input: { ...c.input, message: 'changed' } }));
      await assert.rejects(write(PEER, { ...c, role: 'agent' }));
      await assert.rejects(
        write(actor, { ...c, operationId: id(n + 10), role: role === 'admin' ? 'agent' : 'admin' }),
      );
      await assert.rejects(
        asActor(db, T, actor, () => db.query('SELECT * FROM app_private.staff_capture_originals')),
      );
      await assert.rejects(
        db.query(
          'UPDATE app_private.staff_capture_originals SET request=request WHERE tenant_id=$1',
          [T],
        ),
      );
      await db.query(
        'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
        [T, actor],
      );
      await assert.rejects(
        asActor(db, T, actor, () =>
          scalar(db, 'SELECT app_api.read_staff_capture_original($1)', [c.operationId]),
        ),
      );
      assert.equal(
        Number(
          (
            await db.query(
              'SELECT count(*) AS n FROM app_private.staff_capture_originals WHERE tenant_id=$1',
              [T],
            )
          ).rows[0].n,
        ),
        1,
      );
    },
  );
