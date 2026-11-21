import test from 'node:test';
import assert from 'node:assert/strict';
import {
  fixture,
  publish,
  asActor,
  scalar,
  T,
  OTHER,
  ADMIN,
  AGENT,
  LISTING,
} from './public-media-fixtures.mjs';
import { validatePrivateOperationResolution } from '../../packages/domain/dist/index.js';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const content = {
  companyName: 'Synthetic agency',
  summary: 'Original summary',
  about: 'Fictional content',
  officeAddress: null,
  openingHours: null,
  colors: { primary: '#5e0202', secondary: '#194d3e', accent: '#b77b27', background: '#ffffff' },
};
const commands = {
  settings: (op) => ({
    policy: 'company-settings-command-v1',
    operationId: id(op),
    expectedVersion: '0',
    approval: 'approved-for-publication',
    content,
  }),
  report: (op) => ({
    policy: 'listing-report-decision-command-v1',
    operationId: id(op),
    reportId: id(800),
    expectedVersion: '1',
    decision: 'reviewed',
    reason: 'Synthetic review',
  }),
};
const run = (db, fn, who = ADMIN, t = T) => asActor(db, t, who, fn);
const resolve = (db, kind, c, who = ADMIN, t = T) =>
  run(
    db,
    () =>
      scalar(db, 'SELECT app_api.resolve_private_operation($1,$2::jsonb)', [
        kind,
        JSON.stringify(c),
      ]),
    who,
    t,
  );
const write = (db, kind, c) =>
  run(db, () =>
    scalar(
      db,
      kind === 'settings'
        ? 'SELECT app_api.approve_company_settings($1::jsonb)'
        : 'SELECT app_api.decide_listing_report($1::jsonb)',
      [JSON.stringify(c)],
    ),
  );
const denies = (fn, code) => assert.rejects(fn, (e) => e.code === code);
for (const kind of ['settings', 'report']) {
  test(
    kind +
      ': retiring an unapplied original is immutable, exact, actor/tenant-bound, replayable and permanently blocks delayed writes',
    async () => {
      const db = await fixture();
      try {
        await db.query(
          "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'admin')",
          [T, id(19)],
        );
        const c = commands[kind](700),
          first = await resolve(db, kind, c);
        assert.equal(
          validatePrivateOperationResolution(first, {
            kind,
            original: c,
            tenantId: T,
            actorId: ADMIN,
          }).outcome,
          'cancelled',
        );
        assert.equal(first.receipt, null);
        assert.deepEqual(await resolve(db, kind, c), first);
        await denies(() => write(db, kind, c), '40001');
        const changed =
          kind === 'settings'
            ? { ...c, content: { ...c.content, summary: 'Different' } }
            : { ...c, reason: 'Different' };
        await denies(() => resolve(db, kind, changed), '40001');
        await denies(() => write(db, kind, changed), '40001');
        await denies(() => resolve(db, kind, c, id(19)), '42501');
        for (const who of [AGENT, id(13), null])
          await denies(() => resolve(db, kind, c, who), '42501');
        // The other company owns a distinct namespace even for the same operation UUID.
        const foreign = await resolve(db, kind, c, id(20), OTHER);
        assert.equal(foreign.tenantId, OTHER);
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM app_private.private_operation_cancellations',
            )
          ).rows[0].n,
          2,
        );
        await denies(
          () =>
            run(db, () => db.query('SELECT * FROM app_private.private_operation_cancellations')),
          '42501',
        );
        await denies(
          () => db.query('DELETE FROM app_private.private_operation_cancellations'),
          '23514',
        );
        await denies(
          () => db.query("UPDATE app_private.private_operation_cancellations SET request='{}'"),
          '23514',
        );
        await denies(
          () =>
            run(db, () =>
              scalar(
                db,
                kind === 'settings'
                  ? 'SELECT app_api.approve_company_settings_before_resolution($1::jsonb)'
                  : 'SELECT app_api.decide_listing_report_before_resolution($1::jsonb)',
                [JSON.stringify(c)],
              ),
            ),
          '42501',
        );
        await db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=clock_timestamp() WHERE tenant_id=$1 AND user_id=$2',
          [T, ADMIN],
        );
        await denies(() => resolve(db, kind, c), '42501');
      } finally {
        await db.close();
      }
    },
  );
  test(
    kind +
      ': resolving a committed original returns its exact receipt without cancelling, replaying or changing public state',
    async () => {
      const db = await fixture();
      try {
        if (kind === 'report') {
          await publish(db);
          await run(
            db,
            () =>
              scalar(db, 'SELECT app_api.capture_listing_report($1,$2::jsonb,$3)', [
                id(800),
                JSON.stringify({
                  policy: 'listing-report-command-v1',
                  operationId: id(799),
                  listingId: LISTING,
                  reason: 'other',
                  details: 'Synthetic concern',
                }),
                'synthetic-v1',
              ]),
            null,
          );
        }
        const c = commands[kind](701),
          saved = await write(db, kind, c),
          first = await resolve(db, kind, c);
        const checked = validatePrivateOperationResolution(first, {
          kind,
          original: c,
          tenantId: T,
          actorId: ADMIN,
        });
        assert.equal(checked.outcome, 'completed');
        assert.deepEqual(first.receipt, saved);
        assert.deepEqual(await resolve(db, kind, c), first);
        assert.deepEqual(await write(db, kind, c), saved);
        assert.equal(
          (
            await db.query(
              'SELECT count(*)::int AS n FROM app_private.private_operation_cancellations',
            )
          ).rows[0].n,
          0,
        );
        const changed =
          kind === 'settings' ? { ...c, expectedVersion: '1' } : { ...c, decision: 'dismissed' };
        await denies(() => resolve(db, kind, changed), '40001');
      } finally {
        await db.close();
      }
    },
  );
}
test('resolution rejects malformed/oversized/unknown kind originals before writing any cancellation', async () => {
  const db = await fixture();
  try {
    for (const [kind, c] of [
      ['wrong', commands.settings(702)],
      ['settings', {}],
      ['settings', { ...commands.settings(702), expectedVersion: '9007199254740991' }],
      ['report', { ...commands.report(702), reason: 'x'.repeat(501) }],
      ['report', { ...commands.report(702), expectedVersion: null }],
    ])
      await denies(() => resolve(db, kind, c), '23514');
    assert.equal(
      (await db.query('SELECT count(*)::int AS n FROM app_private.private_operation_cancellations'))
        .rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
