import assert from 'node:assert/strict';
/** Owned disposable PostgreSQL runtime only; current creator receipts do not confer inbox assignment. */
export async function verifyStaffCaptureOriginals(t, owner, database, context, id) {
  const agent = id(9850);
  await owner.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'agent')",
    [context.tenantId, agent],
  );
  for (const [offset, role, actorId] of [
    [0, 'admin', context.actorId],
    [10, 'agent', agent],
  ])
    await t.test(
      role + ': PostgreSQL capture original replays once with a canonical creator-bound receipt',
      async () => {
        const c = {
          policy: 'staff-capture-command-v1',
          operationId: id(9860 + offset),
          role,
          input: {
            listingId: null,
            name: 'Synthetic PostgreSQL Capture',
            phone: null,
            email: 'synthetic@example.test',
            message: 'Synthetic original',
            noticeVersion: 'synthetic-staff-notice-v1',
            noticeAcknowledged: true,
          },
        };
        const own = { ...context, actorId };
        const write = () =>
          database.transaction(
            own,
            async (q) =>
              (
                await q.query(
                  'SELECT app_api.record_staff_capture_original($1,$2::jsonb) AS receipt',
                  [id(9861 + offset), JSON.stringify(c)],
                )
              ).rows[0].receipt,
          );
        const first = await write();
        assert.deepEqual(first.request, c);
        assert.equal(new Date(first.recordedAt).toISOString(), first.recordedAt);
        assert.equal(first.actorId, actorId);
        assert.deepEqual(await write(), first);
        const get = () =>
          database.transaction(
            own,
            async (q) =>
              (
                await q.query('SELECT app_api.read_staff_capture_original($1) AS receipt', [
                  c.operationId,
                ])
              ).rows[0].receipt,
          );
        assert.deepEqual(await get(), first);
        assert.equal(
          (
            await owner.query(
              'SELECT count(*)::int AS n FROM app_private.enquiries WHERE tenant_id=$1 AND idempotency_key=$2',
              [context.tenantId, c.operationId],
            )
          ).rows[0].n,
          1,
        );
        await assert.rejects(
          database.transaction(own, (q) =>
            q.query('SELECT * FROM app_private.staff_capture_originals'),
          ),
        );
        // Deactivate only the test-created agent; the shared runtime admin remains available for later cases.
        if (role === 'agent') {
          await owner.query(
            'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
            [context.tenantId, actorId],
          );
          await assert.rejects(get(), (e) => e.code === '42501');
        }
      },
    );
}
