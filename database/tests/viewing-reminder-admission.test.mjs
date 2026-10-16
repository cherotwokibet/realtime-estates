import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReminderAdmissionFixture as fixture,
  reminderFixtureActor as actor,
  reminderFixtureScalar as scalar,
} from '../test-helpers/reminder-admission-fixture.mjs';
import {
  validateViewingReminderCandidate,
  validateViewingReminderAdmissionReceipt,
} from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  T = id(1),
  A = id(10),
  U = id(11),
  P = id(12),
  L = id(100),
  E = id(200);
const slot = {
    startAt: '2090-01-01T09:00:00.000Z',
    endAt: '2090-01-01T10:00:00.000Z',
    timeZone: 'Africa/Nairobi',
  },
  due = '2090-01-01T08:00:00.000Z',
  expires = slot.startAt;
test('capture-only reminder admission saves immutable originals under current authority without delivery or workflow mutation', async (t) => {
  const { db, viewing } = await fixture();
  try {
    const admit = (
      operation = id(800),
      expected = 3,
      when = due,
      until = expires,
      user = U,
      tenant = T,
    ) =>
      actor(
        db,
        user,
        () =>
          scalar(db, 'SELECT app_api.admit_viewing_reminder($1,$2,$3,$4,$5,$6) value', [
            E,
            viewing,
            operation,
            expected,
            when,
            until,
          ]),
        tenant,
      );
    const original = (operation = id(800), user = U, tenant = T) =>
      actor(
        db,
        user,
        () =>
          scalar(db, 'SELECT app_api.read_viewing_reminder_admission($1,$2) value', [E, operation]),
        tenant,
      );
    let saved;
    await t.test(
      'one exact candidate and original replay preserve enquiry/viewing versions',
      async () => {
        saved = await admit();
        assert.deepEqual(
          validateViewingReminderAdmissionReceipt(saved, E, viewing, {
            operationId: id(800),
            expectedVersion: '3',
            dueAt: due,
            expiresAt: expires,
          }),
          saved,
        );
        assert.equal(saved.outcome, 'admitted');
        assert.equal(saved.mode, 'capture-only-v1');
        assert.equal(saved.kind, 'admit_reminder');
        assert.deepEqual(validateViewingReminderCandidate(saved.candidate), saved.candidate);
        assert.equal(saved.candidate.cycleNumber, '1');
        assert.deepEqual(await admit(), saved);
        assert.deepEqual(await original(), saved);
        assert.deepEqual(
          (
            await db.query(
              'SELECT (SELECT version::text FROM app_private.enquiries WHERE id=$1) enquiry,(SELECT version::text FROM app_private.viewings WHERE id=$2) viewing',
              [E, viewing],
            )
          ).rows[0],
          { enquiry: '1', viewing: '3' },
        );
      },
    );
    await t.test(
      'same facts under a new operation cannot admit twice and originals bind requester/window',
      async () => {
        assert.equal((await admit(id(801))).reason, 'ALREADY_ADMITTED');
        assert.equal((await admit(id(802), 3, due, expires, A)).reason, 'ALREADY_ADMITTED');
        await assert.rejects(() => admit(id(800), 3, '2090-01-01T08:01:00.000Z'));
        await assert.rejects(() => admit(id(800), 3, due, expires, A));
        await assert.rejects(() => original(id(800), A));
      },
    );
    await t.test(
      'stale and policy-window refusals are durable and do not create candidates',
      async () => {
        const stale = await admit(id(803), 2);
        assert.equal(stale.outcome, 'conflict');
        assert.equal(stale.reason, 'VERSION_CONFLICT');
        assert.equal(stale.candidate, null);
        assert.deepEqual(await original(id(803)), stale);
        for (const [operation, when, until, reason] of [
          [id(804), '2020-01-01T08:00:00.000Z', '2020-01-01T09:00:00.000Z', 'WINDOW_EXPIRED'],
          [id(805), '2020-01-01T08:00:00.000Z', expires, 'WINDOW_BEFORE_CONFIRMATION'],
          [id(806), due, '2090-01-01T09:00:00.001Z', 'WINDOW_OUTSIDE_SLOT'],
        ]) {
          const receipt = await admit(operation, 3, when, until);
          assert.equal(receipt.reason, reason);
          assert.equal(receipt.candidate, null);
          assert.deepEqual(await admit(operation, 3, when, until), receipt);
        }
        await assert.rejects(() => admit(id(807), 3, expires, due));
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int n FROM app_private.viewing_reminder_admissions WHERE operation_id=$1',
              [id(807)],
            )
          ).rows[0].n,
          0,
        );
      },
    );
    await t.test('stored receipts are forced-RLS and immutable even to owner', async () => {
      await assert.rejects(() =>
        db.query(
          'UPDATE app_private.viewing_reminder_admissions SET receipt=receipt||\'{"mode":"live"}\'::jsonb WHERE operation_id=$1',
          [id(800)],
        ),
      );
      await assert.rejects(() =>
        db.query('DELETE FROM app_private.viewing_reminder_admissions WHERE operation_id=$1', [
          id(800),
        ]),
      );
      const flags = (
        await db.query(
          "SELECT relrowsecurity rls,relforcerowsecurity forced FROM pg_class WHERE oid='app_private.viewing_reminder_admissions'::regclass",
        )
      ).rows[0];
      assert.deepEqual(flags, { rls: true, forced: true });
      await assert.rejects(() =>
        actor(db, U, () => db.query('SELECT * FROM app_private.viewing_reminder_admissions')),
      );
      assert.equal(
        await scalar(
          db,
          'SELECT app_private.viewing_reminder_admission_valid(a) value FROM app_private.viewing_reminder_admissions a WHERE operation_id=$1',
          [id(800)],
        ),
        true,
      );
      for (const patch of [
        { mode: 'live' },
        { observedVersion: '03' },
        { candidate: { ...saved.candidate, listingId: id(999) } },
        { completedAt: '2090-01-01T00:00:00.000Z' },
      ])
        assert.equal(
          await scalar(
            db,
            "SELECT app_private.viewing_reminder_admission_valid(jsonb_populate_record(NULL::app_private.viewing_reminder_admissions,to_jsonb(a)||jsonb_build_object('receipt',a.receipt||$2::jsonb))) value FROM app_private.viewing_reminder_admissions a WHERE operation_id=$1",
            [id(800), JSON.stringify(patch)],
          ),
          false,
        );
    });
    await t.test('rolled-back admission leaves no receipt candidate or audit event', async () => {
      const count = async () =>
        scalar(
          db,
          "SELECT count(*)::int value FROM app_private.audit_events WHERE action='viewing.reminder_admitted'",
        );
      const before = await count();
      await db.exec('BEGIN;SET LOCAL ROLE api_runtime;');
      await db.query(
        "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
        [T, U],
      );
      assert.equal(
        (
          await scalar(db, 'SELECT app_api.admit_viewing_reminder($1,$2,$3,3,$4,$5) value', [
            E,
            viewing,
            id(813),
            '2090-01-01T08:02:00.000Z',
            expires,
          ])
        ).outcome,
        'admitted',
      );
      await db.exec('ROLLBACK');
      await assert.rejects(() => original(id(813)));
      assert.equal(await count(), before);
    });
    await t.test(
      'a different valid same-company listing cannot be substituted into admission evidence',
      async () => {
        await actor(db, U, () =>
          db.query('SELECT app_api.create_listing($1,$2)', [
            id(101),
            'synthetic-wrong-reminder-listing',
          ]),
        );
        await assert.rejects(
          () =>
            db.query(
              "INSERT INTO app_private.viewing_reminder_admissions SELECT tenant_id,$2::uuid,enquiry_id,viewing_id,$3::uuid,requester_id,expected_version,due_at+interval '1 minute',expires_at,receipt||jsonb_build_object('operationId',$2::uuid::text,'request',jsonb_build_object('dueAt',app_private.enquiry_utc(due_at+interval '1 minute'),'expiresAt',app_private.enquiry_utc(expires_at)),'candidate',(receipt->'candidate')||jsonb_build_object('listingId',$3::uuid::text,'dueAt',app_private.enquiry_utc(due_at+interval '1 minute'))),created_at FROM app_private.viewing_reminder_admissions WHERE operation_id=$1",
              [id(800), id(851), id(101)],
            ),
          (error) => error.code === '23503',
        );
      },
    );
    await t.test(
      'unavailable listings,foreign companies and inactive current roles cannot admit work or expose originals',
      async () => {
        await db.query("UPDATE app_private.listings SET availability='withdrawn' WHERE id=$1", [L]);
        assert.equal((await admit(id(815))).reason, 'LISTING_UNAVAILABLE');
        await db.query("UPDATE app_private.listings SET availability='available' WHERE id=$1", [L]);
        await db.query(
          "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'foreign-reminder','Synthetic foreign reminder')",
          [id(2)],
        );
        await db.query(
          "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
          [id(2), id(20)],
        );
        await assert.rejects(() => admit(id(816), 3, due, expires, id(20), id(2)));
        await assert.rejects(() => original(id(800), id(20), id(2)));
        await db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',
          [T, U],
        );
        await assert.rejects(() => original());
        await assert.rejects(() => admit(id(817)));
        await db.query(
          'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
          [T, U],
        );
        assert.deepEqual(await original(), saved);
      },
    );
    await t.test(
      'current assignment loss hides originals and restored access recovers unchanged admission',
      async () => {
        const assign = (operation, expected, user) =>
          actor(db, A, () =>
            db.query(
              "SELECT app_api.execute_enquiry_operation($1,$2,$3,'assign',$4,NULL,NULL,NULL)",
              [E, operation, expected, user],
            ),
          );
        await assign(id(900), 1, P);
        await assert.rejects(() => original());
        await assert.rejects(() => admit(id(808)));
        await assign(id(901), 2, U);
        assert.deepEqual(await original(), saved);
        assert.deepEqual(await admit(), saved);
      },
    );
    await t.test(
      'replacement cycle needs a new agreement and keeps the first admission historical',
      async () => {
        const moved = {
          ...slot,
          startAt: '2090-01-02T09:00:00.000Z',
          endAt: '2090-01-02T10:00:00.000Z',
        };
        const proposed = await actor(db, U, () =>
          scalar(db, 'SELECT app_api.reschedule_viewing($1,$2,$3,3,$4::jsonb,$5) value', [
            E,
            viewing,
            id(910),
            JSON.stringify(moved),
            'Synthetic new reminder cycle.',
          ]),
        );
        assert.equal((await admit(id(809), 4)).reason, 'INVALID_STATE');
        await actor(db, U, () =>
          scalar(
            db,
            "SELECT app_api.confirm_viewing_phone($1,$2,$3,4,$4::jsonb,'phone',$5,$6) value",
            [
              E,
              viewing,
              id(911),
              JSON.stringify(moved),
              proposed.completedAt,
              'Independent synthetic second agreement.',
            ],
          ),
        );
        const next = await admit(id(810), 5, '2090-01-02T08:00:00.000Z', moved.startAt);
        assert.equal(next.outcome, 'admitted');
        assert.equal(next.candidate.cycleNumber, '2');
        assert.notDeepEqual(next.candidate.slot, saved.candidate.slot);
        assert.deepEqual(await original(), saved);
      },
    );
    await t.test(
      'explicit ending and closed/unavailable cleanup never rewrite the original candidate',
      async () => {
        await actor(db, U, () =>
          db.query("SELECT app_api.terminate_viewing($1,$2,$3,5,'cancel',$4)", [
            E,
            viewing,
            id(920),
            'Synthetic cancellation after admission.',
          ]),
        );
        assert.equal((await admit(id(811), 6)).reason, 'INVALID_STATE');
        assert.deepEqual(await admit(), saved);
        await actor(db, A, () =>
          db.query(
            "SELECT app_api.execute_enquiry_operation($1,$2,3,'transition',NULL,'closed_lost',NULL,$3)",
            [E, id(921), 'Synthetic closure after reminder admission.'],
          ),
        );
        await db.query(
          "UPDATE app_private.listings SET publication_status='paused',availability='withdrawn' WHERE id=$1",
          [L],
        );
        assert.equal((await admit(id(812), 6)).reason, 'ENQUIRY_CLOSED');
        assert.deepEqual(await original(), saved);
        assert.deepEqual(await admit(), saved);
      },
    );
  } finally {
    await db.close();
  }
});
