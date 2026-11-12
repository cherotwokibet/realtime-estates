import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createReminderAdmissionFixture as fixture,
  reminderFixtureActor as actor,
  reminderFixtureScalar as scalar,
} from '../test-helpers/reminder-admission-fixture.mjs';

const id = (number) => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const tenant = id(1);
const agent = id(11);
const customer = id(20);
const enquiry = id(200);
const device = id(850);

test('admitted viewing queues a customer notification and cancellation suppresses the later job', async (t) => {
  const { db, viewing } = await fixture(customer);
  t.after(() => db.close());
  for (const name of [
    'customer-favourites',
    'customer-push-preferences',
    'customer-deletion-requests',
    'synthetic-customer-push-capture',
    'synthetic-customer-push-jobs',
  ]) {
    await db.exec(
      await readFile(new URL('../proposals/' + name + '.sql', import.meta.url), 'utf8'),
    );
  }
  await actor(db, customer, async () => {
    await db.query("SELECT app_api.change_customer_push_preferences($1,0,'consent',true,NULL)", [
      id(851),
    ]);
    await db.query("SELECT app_api.change_customer_push_preferences($1,1,'register',NULL,$2)", [
      id(852),
      device,
    ]);
  });
  const current = await actor(db, agent, () =>
    scalar(db, 'SELECT app_api.read_viewing($1,$2) value', [enquiry, viewing]),
  );
  const due = current.confirmation.recordedAt;
  const later = new Date(Date.parse(due) + 60000).toISOString();
  const expiry = current.schedule.proposedSlot.startAt;
  for (const [admission, schedule] of [
    [id(860), due],
    [id(861), later],
  ]) {
    const result = await actor(db, agent, () =>
      scalar(db, 'SELECT app_api.admit_viewing_reminder($1,$2,$3,3,$4,$5) value', [
        enquiry,
        viewing,
        admission,
        schedule,
        expiry,
      ]),
    );
    assert.equal(result.outcome, 'admitted');
  }
  const enqueue = (admission, job, registration = device, company = tenant) =>
    scalar(db, 'SELECT app_private.enqueue_synthetic_viewing_push($1,$2,$3,$4) value', [
      company,
      id(admission),
      id(job),
      registration,
    ]);
  const run = (job, clock) =>
    scalar(db, 'SELECT app_private.run_synthetic_customer_push($1,$2,$3) value', [
      tenant,
      id(job),
      clock,
    ]);
  await assert.rejects(() => enqueue(860, 870, id(859)), { code: 'P0002' });
  await assert.rejects(() => enqueue(860, 870, device, id(2)), { code: 'P0002' });
  assert.equal(await enqueue(860, 870), true);
  assert.equal(await enqueue(860, 870), false);
  await assert.rejects(() => enqueue(860, 872), { code: '23505' });
  assert.equal(await enqueue(861, 871), true);
  assert.equal(await run(871, due), 'not_due');
  assert.equal(await run(870, new Date(Date.parse(due) + 10000).toISOString()), 'captured');

  await actor(db, agent, () =>
    db.query("SELECT app_api.terminate_viewing($1,$2,$3,3,'cancel',$4)", [
      enquiry,
      viewing,
      id(880),
      'Synthetic cancellation.',
    ]),
  );
  assert.equal(await run(871, later), 'viewing_obsolete');
  assert.equal(await run(871, later), 'viewing_obsolete');
  assert.equal(await run(870, later), 'captured');
  assert.deepEqual(
    (
      await db.query(
        'SELECT customer_id, outcome FROM app_private.synthetic_customer_push_attempts ORDER BY operation_id',
      )
    ).rows,
    [
      { customer_id: customer, outcome: 'captured' },
      { customer_id: customer, outcome: 'viewing_obsolete' },
    ],
  );
});
