import assert from 'node:assert/strict';
import { publish, asActor, scalar, T, AGENT, LISTING } from '../tests/public-media-fixtures.mjs';
import { validatePrivateOperationResolution } from '../../packages/domain/dist/index.js';
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, label) {
  const end = Date.now() + 10000;
  while (Date.now() < end) {
    if (await fn()) return;
    await pause(20);
  }
  throw Error('Timed out: ' + label);
}
/** Only called by the owned/disposable PostgreSQL17 integration runner after its policy/name checks. */
export async function verifyPrivateOperationResolution(t, owner, database, context, id) {
  const adapter = { query: (...a) => owner.query(...a), exec: (s) => owner.query(s) };
  await owner.query(
    "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'agent') ON CONFLICT(tenant_id,user_id) DO UPDATE SET role='agent',active=true,revoked_at=NULL",
    [T, AGENT],
  );
  await publish(adapter);
  const content = {
    companyName: 'Synthetic concurrency agency',
    summary: 'Synthetic summary',
    about: 'Synthetic original',
    officeAddress: null,
    openingHours: null,
    colors: { primary: '#5e0202', secondary: '#194d3e', accent: '#b77b27', background: '#ffffff' },
  };
  async function pair(first, second) {
    let release, ready, failed;
    const gate = new Promise((r) => (release = r)),
      entered = new Promise((r, j) => {
        ready = r;
        failed = j;
      });
    const pids = [];
    const a = database.transaction(context, async (q) => {
      pids.push((await q.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
      const result = await first(q);
      ready();
      await gate;
      return result;
    });
    a.catch(failed);
    let b;
    try {
      await entered;
      b = database.transaction(context, async (q) => {
        pids.push((await q.query('SELECT pg_backend_pid() AS pid')).rows[0].pid);
        return second(q);
      });
      b.catch(() => {});
      await until(
        async () =>
          pids.length === 2 &&
          (
            await owner.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [
              pids[1],
            ])
          ).rows[0]?.wait_event_type === 'Lock',
        'second real connection blocked behind first terminal/write lock',
      );
      assert.equal(new Set(pids).size, 2);
    } finally {
      release();
    }
    return Promise.allSettled([a, b]);
  }
  for (const [index, kind] of ['settings', 'report'].entries()) {
    const command = (op) =>
      kind === 'settings'
        ? {
            policy: 'company-settings-command-v1',
            operationId: id(op),
            expectedVersion: '0',
            approval: 'approved-for-publication',
            content,
          }
        : {
            policy: 'listing-report-decision-command-v1',
            operationId: id(op),
            reportId: id(920 + index),
            expectedVersion: '1',
            decision: 'reviewed',
            reason: 'Synthetic concurrency review',
          };
    if (kind === 'report')
      await asActor(adapter, T, null, () =>
        scalar(adapter, 'SELECT app_api.capture_listing_report($1,$2::jsonb,$3)', [
          id(920 + index),
          JSON.stringify({
            policy: 'listing-report-command-v1',
            operationId: id(930 + index),
            listingId: LISTING,
            reason: 'other',
            details: 'Synthetic concern',
          }),
          'synthetic-v1',
        ]),
      );
    const resolve = (q, c) =>
      q
        .query('SELECT app_api.resolve_private_operation($1,$2::jsonb) AS value', [
          kind,
          JSON.stringify(c),
        ])
        .then((r) => r.rows[0].value);
    const write = (q, c) =>
      q
        .query(
          kind === 'settings'
            ? 'SELECT app_api.approve_company_settings($1::jsonb) AS value'
            : 'SELECT app_api.decide_listing_report($1::jsonb) AS value',
          [JSON.stringify(c)],
        )
        .then((r) => r.rows[0].value);
    await t.test(
      kind + ': committed retirement holds a real lock; a delayed writer then fails permanently',
      async () => {
        const c = command(940 + index),
          [retired, late] = await pair(
            (q) => resolve(q, c),
            (q) => write(q, c),
          );
        assert.equal(retired.status, 'fulfilled');
        assert.equal(
          validatePrivateOperationResolution(retired.value, {
            kind,
            original: c,
            tenantId: context.tenantId,
            actorId: context.actorId,
          }).outcome,
          'cancelled',
        );
        assert.equal(late.status, 'rejected');
        assert.equal(late.reason.code, '40001');
        assert.equal(
          (await database.transaction(context, (q) => resolve(q, c))).outcome,
          'cancelled',
        );
      },
    );
    await t.test(
      kind +
        ': a held applied write wins first; waiting resolution confirms it and cannot create a cancellation',
      async () => {
        const c = command(950 + index),
          [saved, resolved] = await pair(
            (q) => write(q, c),
            (q) => resolve(q, c),
          );
        assert.equal(saved.status, 'fulfilled');
        assert.equal(resolved.status, 'fulfilled');
        const result = validatePrivateOperationResolution(resolved.value, {
          kind,
          original: c,
          tenantId: context.tenantId,
          actorId: context.actorId,
        });
        assert.equal(result.outcome, 'completed');
        assert.deepEqual(result.receipt, saved.value);
        assert.equal(
          (
            await owner.query(
              'SELECT count(*)::int AS n FROM app_private.private_operation_cancellations WHERE tenant_id=$1 AND kind=$2 AND operation_id=$3',
              [context.tenantId, kind, c.operationId],
            )
          ).rows[0].n,
          0,
        );
      },
    );
  }
}
