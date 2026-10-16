import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createReminderAdmissionFixture as fixture,
  reminderFixtureActor as actor,
  reminderFixtureScalar as scalar,
} from '../test-helpers/reminder-admission-fixture.mjs';
import { seedHistoricalConfirmedViewing } from '../test-helpers/historical-confirmed-viewing.mjs';
import {
  prepareViewingReminderCandidate,
  validateViewingReminderCaptureReceipt,
} from '../../packages/domain/dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  T = id(1),
  A = id(10),
  U = id(11),
  P = id(12),
  L = id(100),
  E = id(200);
test('synthetic reminder captures recheck current facts and recover immutable atomic attempts without provider delivery', async (t) => {
  const { db, viewing } = await fixture();
  try {
    const current = await actor(db, U, () =>
        scalar(db, 'SELECT app_api.read_viewing($1,$2) value', [E, viewing]),
      ),
      due = current.confirmation.recordedAt,
      expires = current.schedule.proposedSlot.startAt;
    const plus = (ms) => new Date(Date.parse(due) + ms).toISOString();
    const admissions = new Map();
    const admit = async (operation, when = due, until = expires, expected = 3) => {
      const receipt = await actor(db, U, () =>
        scalar(db, 'SELECT app_api.admit_viewing_reminder($1,$2,$3,$4,$5,$6) value', [
          E,
          viewing,
          operation,
          expected,
          when,
          until,
        ]),
      );
      admissions.set(operation, receipt);
      return receipt;
    };
    const capture = async (operation = id(1100), admission = id(1000), user = U, tenant = T) =>
      validateViewingReminderCaptureReceipt(
        await actor(
          db,
          user,
          () =>
            scalar(db, 'SELECT app_api.capture_viewing_reminder($1,$2,$3) value', [
              E,
              admission,
              operation,
            ]),
          tenant,
        ),
        admissions.get(admission),
        { operationId: operation },
      );
    const original = async (operation = id(1100), admission = id(1000), user = U, tenant = T) =>
      validateViewingReminderCaptureReceipt(
        await actor(
          db,
          user,
          () =>
            scalar(db, 'SELECT app_api.read_viewing_reminder_attempt($1,$2,$3) value', [
              E,
              admission,
              operation,
            ]),
          tenant,
        ),
        admissions.get(admission),
        { operationId: operation },
      );
    let saved;
    await t.test(
      'one atomic capture returns exact historical evidence without workflow version changes',
      async () => {
        assert.equal((await admit(id(1000))).outcome, 'admitted');
        saved = await capture();
        assert.equal(saved.outcome, 'captured');
        assert.equal(saved.mode, 'capture-only-v1');
        assert.equal(saved.kind, 'capture_reminder');
        assert.equal(saved.capture.operationId, id(1100));
        assert.equal(saved.capture.capturedAt, saved.completedAt);
        assert.equal(saved.capture.viewingVersion, '3');
        assert.deepEqual(await capture(), saved);
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
      'new operations deduplicate capture while exact operation IDs bind their admission',
      async () => {
        const duplicate = await capture(id(1101));
        assert.equal(duplicate.outcome, 'duplicate');
        assert.equal(duplicate.reason, 'ALREADY_CAPTURED');
        assert.deepEqual(duplicate.capture, saved.capture);
        assert.deepEqual(await original(id(1101)), duplicate);
        await admit(id(1001), plus(1));
        await assert.rejects(
          () => capture(id(1100), id(1001)),
          (error) => error.code === '40001',
        );
        await assert.rejects(() => original(id(1100), id(1001)));
        assert.equal((await admit(id(1009))).reason, 'ALREADY_ADMITTED');
        await assert.rejects(
          () => capture(id(1124), id(1009)),
          (error) => error.code === '23514',
        );
        assert.equal(
          await scalar(
            db,
            "SELECT count(*)::int value FROM app_private.viewing_reminder_attempts WHERE receipt->>'outcome'='captured'",
          ),
          1,
        );
      },
    );
    await t.test(
      'not-due decisions remain historical and a new operation can capture after real elapsed time',
      async () => {
        const future = await scalar(
          db,
          "SELECT app_private.enquiry_utc(date_trunc('milliseconds',clock_timestamp())+interval '1 second') value",
        );
        await admit(id(1002), future);
        const waiting = await capture(id(1102), id(1002));
        assert.equal(waiting.outcome, 'waiting');
        assert.equal(waiting.reason, 'NOT_DUE');
        assert.equal(waiting.capture, null);
        await new Promise((resolve) =>
          setTimeout(resolve, Math.max(0, Date.parse(future) - Date.now()) + 25),
        );
        assert.equal((await capture(id(1103), id(1002))).outcome, 'captured');
        assert.deepEqual(await capture(id(1102), id(1002)), waiting);
        assert.deepEqual(await original(id(1102), id(1002)), waiting);
      },
    );
    await t.test(
      'a rolled-back capture leaves no attempt or audit and the same operation remains available',
      async () => {
        const count = () =>
          scalar(
            db,
            "SELECT count(*)::int value FROM app_private.audit_events WHERE action='viewing.reminder_captured'",
          );
        const before = await count();
        await db.exec('BEGIN;SET LOCAL ROLE api_runtime;');
        try {
          await db.query(
            "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
            [T, U],
          );
          assert.equal(
            (
              await scalar(db, 'SELECT app_api.capture_viewing_reminder($1,$2,$3) value', [
                E,
                id(1001),
                id(1110),
              ])
            ).outcome,
            'captured',
          );
        } finally {
          await db.exec('ROLLBACK');
        }
        await assert.rejects(() => original(id(1110), id(1001)));
        assert.equal(await count(), before);
        assert.equal((await capture(id(1110), id(1001))).outcome, 'captured');
      },
    );
    await t.test(
      'attempt evidence is forced-RLS immutable and cannot be backdated or invoked through private helpers',
      async () => {
        await assert.rejects(() =>
          db.query(
            'UPDATE app_private.viewing_reminder_attempts SET receipt=receipt||\'{"mode":"live"}\'::jsonb WHERE operation_id=$1',
            [id(1100)],
          ),
        );
        await assert.rejects(() =>
          db.query('DELETE FROM app_private.viewing_reminder_attempts WHERE operation_id=$1', [
            id(1100),
          ]),
        );
        await assert.rejects(() =>
          actor(db, U, () => db.query('SELECT * FROM app_private.viewing_reminder_attempts')),
        );
        const flags = (
          await db.query(
            "SELECT relrowsecurity rls,relforcerowsecurity forced FROM pg_class WHERE oid='app_private.viewing_reminder_attempts'::regclass",
          )
        ).rows[0];
        assert.deepEqual(flags, { rls: true, forced: true });
        assert.equal(
          await actor(db, U, () =>
            scalar(
              db,
              "SELECT has_function_privilege(current_user,'app_private.viewing_reminder_capture_state(app_private.viewing_reminder_admissions,timestamptz)','EXECUTE') value",
            ),
          ),
          false,
        );
        await db.exec('BEGIN');
        try {
          await db.query(
            "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
            [T, U],
          );
          await assert.rejects(
            () =>
              db.query(
                "INSERT INTO app_private.viewing_reminder_attempts SELECT tenant_id,$2::uuid,admission_operation_id,enquiry_id,viewing_id,requester_id,expected_version,observed_version,$2::uuid,receipt||jsonb_build_object('operationId',$2::uuid::text,'capture',(receipt->'capture')||jsonb_build_object('operationId',$2::uuid::text)),created_at FROM app_private.viewing_reminder_attempts WHERE operation_id=$1",
                [id(1100), id(1111)],
              ),
            (error) => error.code === '23514',
          );
        } finally {
          await db.exec('ROLLBACK');
        }
      },
    );
    await t.test(
      'original capture recovery and new attempts require current company assignment and requester',
      async () => {
        const assign = (operation, expected, user) =>
          actor(db, A, () =>
            db.query(
              "SELECT app_api.execute_enquiry_operation($1,$2,$3,'assign',$4,NULL,NULL,NULL)",
              [E, operation, expected, user],
            ),
          );
        await assign(id(1200), 1, P);
        await assert.rejects(() => original());
        await assert.rejects(() => capture(id(1120)));
        await assign(id(1201), 2, U);
        assert.deepEqual(await original(), saved);
        assert.deepEqual(await capture(), saved);
        await assert.rejects(() => original(id(1100), id(1000), A));
        await assert.rejects(() => capture(id(1121), id(1000), A));
        await db.query(
          "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'foreign-capture','Synthetic foreign capture')",
          [id(2)],
        );
        await db.query(
          "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
          [id(2), id(20)],
        );
        await assert.rejects(() => original(id(1100), id(1000), id(20), id(2)));
        await assert.rejects(() => capture(id(1122), id(1000), id(20), id(2)));
        await db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',
          [T, U],
        );
        await assert.rejects(() => original());
        await assert.rejects(() => capture(id(1123)));
        await db.query(
          'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
          [T, U],
        );
        assert.deepEqual(await original(), saved);
      },
    );
    await t.test(
      'stock withdrawal suppresses a fresh attempt and its original cannot upgrade after restoration',
      async () => {
        await admit(id(1003), plus(3));
        await db.query("UPDATE app_private.listings SET availability='withdrawn' WHERE id=$1", [L]);
        const suppressed = await capture(id(1130), id(1003));
        assert.equal(suppressed.outcome, 'suppressed');
        assert.equal(suppressed.reason, 'LISTING_UNAVAILABLE');
        assert.equal(suppressed.capture, null);
        await db.query("UPDATE app_private.listings SET availability='available' WHERE id=$1", [L]);
        assert.deepEqual(await capture(id(1130), id(1003)), suppressed);
        assert.equal((await capture(id(1131), id(1003))).outcome, 'captured');
      },
    );
    let later;
    await t.test(
      'rescheduling suppresses the old candidate before and after a separate new phone agreement',
      async () => {
        await admit(id(1004), plus(4));
        const moved = {
          startAt: '2090-01-02T09:00:00.000Z',
          endAt: '2090-01-02T10:00:00.000Z',
          timeZone: 'Africa/Nairobi',
        };
        const proposed = await actor(db, U, () =>
          scalar(db, 'SELECT app_api.reschedule_viewing($1,$2,$3,3,$4::jsonb,$5) value', [
            E,
            viewing,
            id(1210),
            JSON.stringify(moved),
            'Synthetic replacement before capture.',
          ]),
        );
        const before = await capture(id(1140), id(1004));
        assert.equal(before.reason, 'NOT_CONFIRMED');
        assert.equal(before.observedVersion, '4');
        const confirmed = await actor(db, U, () =>
          scalar(
            db,
            "SELECT app_api.confirm_viewing_phone($1,$2,$3,4,$4::jsonb,'phone',$5,$6) value",
            [
              E,
              viewing,
              id(1211),
              JSON.stringify(moved),
              proposed.completedAt,
              'Independent second-slot synthetic agreement.',
            ],
          ),
        );
        const after = await capture(id(1141), id(1004));
        assert.equal(after.reason, 'VERSION_CHANGED');
        assert.equal(after.observedVersion, '5');
        assert.deepEqual(await capture(id(1140), id(1004)), before);
        assert.deepEqual(await capture(), saved);
        later = await admit(id(1005), confirmed.completedAt, moved.startAt, 5);
        assert.equal(later.candidate.cycleNumber, '2');
        const captured = await capture(id(1142), id(1005));
        assert.equal(captured.outcome, 'captured');
        assert.equal(captured.capture.viewingVersion, '5');
      },
    );
    await t.test(
      'closure and explicit cancellation suppress fresh captures without rewriting old results',
      async () => {
        const nextDue = new Date(
          Date.parse(later.candidate.confirmationRecordedAt) + 1,
        ).toISOString();
        await admit(id(1006), nextDue, later.candidate.slot.startAt, 5);
        await actor(db, A, () =>
          db.query(
            "SELECT app_api.execute_enquiry_operation($1,$2,3,'transition',NULL,'closed_lost',NULL,$3)",
            [E, id(1220), 'Synthetic closure before capture.'],
          ),
        );
        assert.equal((await capture(id(1150), id(1006))).reason, 'ENQUIRY_CLOSED');
        await actor(db, U, () =>
          db.query("SELECT app_api.terminate_viewing($1,$2,$3,5,'cancel',$4)", [
            E,
            viewing,
            id(1221),
            'Synthetic explicit cancellation after admission.',
          ]),
        );
        assert.equal((await capture(id(1151), id(1006))).reason, 'NOT_CONFIRMED');
        assert.equal((await capture(id(1152))).reason, 'NOT_CONFIRMED');
        assert.deepEqual(await original(), saved);
        assert.deepEqual(await capture(), saved);
      },
    );
    await t.test(
      'normally seeded historical admissions cannot capture after recorded completion or no-show',
      async () => {
        for (const [later, kind, viewingId, admissionId, operation] of [
          [false, 'complete', id(3000), id(1010), id(1160)],
          [true, 'no_show', id(3001), id(1011), id(1161)],
        ]) {
          await seedHistoricalConfirmedViewing(db, {
            tenantId: T,
            enquiryId: E,
            listingId: L,
            actorId: U,
            viewingId,
            later,
            offset: 15000 + Number(later) * 100,
          });
          const detail = await scalar(
              db,
              'SELECT app_private.viewing_detail(v,$2) value FROM app_private.viewings v WHERE id=$1',
              [viewingId, U],
            ),
            day = later ? '02' : '01',
            request = {
              dueAt: `2020-01-${day}T08:35:00.000Z`,
              expiresAt: `2020-01-${day}T08:50:00.000Z`,
            },
            createdAt = `2020-01-${day}T08:40:00.000Z`;
          const admission = {
            operationId: admissionId,
            enquiryId: E,
            viewingId,
            actorId: U,
            kind: 'admit_reminder',
            mode: 'capture-only-v1',
            expectedVersion: detail.schedule.version,
            observedVersion: detail.schedule.version,
            request,
            outcome: 'admitted',
            reason: null,
            candidate: prepareViewingReminderCandidate(detail, request),
            completedAt: createdAt,
          };
          // Fictional saved 2020 admission through normal constraints; never a past HTTP/API execution.
          await db.query(
            'INSERT INTO app_private.viewing_reminder_admissions(tenant_id,operation_id,enquiry_id,viewing_id,listing_id,requester_id,expected_version,due_at,expires_at,receipt,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11)',
            [
              T,
              admissionId,
              E,
              viewingId,
              L,
              U,
              detail.schedule.version,
              request.dueAt,
              request.expiresAt,
              JSON.stringify(admission),
              createdAt,
            ],
          );
          admissions.set(admissionId, admission);
          await actor(db, U, () =>
            db.query('SELECT app_api.record_viewing_outcome($1,$2,$3,$4,$5,$6,$7)', [
              E,
              viewingId,
              id(1300 + Number(later)),
              detail.schedule.version,
              kind,
              `2020-01-${day}T10:00:00.000Z`,
              'Synthetic historical outcome before a fresh capture attempt.',
            ]),
          );
          const result = await capture(operation, admissionId);
          assert.equal(result.outcome, 'suppressed');
          assert.equal(result.reason, 'NOT_CONFIRMED');
          assert.equal(result.capture, null);
        }
        assert.equal(
          await scalar(
            db,
            "SELECT count(*)::int value FROM app_private.viewing_reminder_attempts WHERE admission_operation_id IN ($1,$2) AND receipt->>'outcome'='captured'",
            [id(1010), id(1011)],
          ),
          0,
        );
      },
    );
  } finally {
    await db.close();
  }
});
