import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '@realtor/api-client';
import {
  publish,
  T,
  ADMIN,
  AGENT,
  LISTING,
} from '../../../database/tests/public-media-fixtures.mjs';
import { startAdminCommandFixture } from './admin-command-fixtures.mjs';
const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const version = async (db) =>
  (
    await db.query('SELECT version::text FROM app_private.listings WHERE tenant_id=$1 AND id=$2', [
      T,
      LISTING,
    ])
  ).rows[0].version;
const command = (v, op = 9200, publication = false) => ({
  listingId: LISTING,
  operationId: id(op),
  expectedListingVersion: v,
  ...(publication
    ? { kind: 'set_publication', publicationStatus: 'archived' }
    : { kind: 'confirm_availability', availability: 'reserved' }),
});
const http = (status) => (e) => e.kind === 'HTTP' && e.status === status;
async function setup() {
  const f = await startAdminCommandFixture();
  try {
    await publish(f.db);
    const trace = [];
    const clients = f.origins.map(
      (baseUrl) =>
        new RealtorApiClient({
          baseUrl,
          privacyNoticeVersion: 'listing-audit323',
          allowLoopbackHttp: true,
          fetch: async (url, init) => {
            const r = await fetch(url, init);
            trace.push({
              method: init.method,
              path: new URL(url).pathname,
              requestId: r.headers.get('x-request-id'),
            });
            return r;
          },
        }),
    );
    return { ...f, clients, trace, auth: { bearerToken: await f.token() } };
  } catch (e) {
    await f.close();
    throw e;
  }
}
async function state(db) {
  const result = {};
  for (const table of [
    'listings',
    'public_snapshots',
    'listing_control_requests',
    'listing_control_results',
    'audit_events',
  ])
    result[table] = (
      await db.query(
        'SELECT to_jsonb(t) AS row FROM app_private.' + table + ' t ORDER BY to_jsonb(t)::text',
      )
    ).rows;
  return result;
}

test('signed SDK availability/publication writes retain exact original audit facts and replay/conflict decisions', async () => {
  const f = await setup();
  try {
    const start = await version(f.db),
      auditStart = (
        await f.db.query('SELECT coalesce(max(id),0)::text AS id FROM app_private.audit_events')
      ).rows[0].id;
    const first = command(start),
      r1 = await f.clients[0].controlListingV2(first, f.auth),
      correlation1 = f.trace.at(-1).requestId;
    assert.equal(r1.decision.outcome, 'applied');
    assert.equal(r1.decision.result.listingVersion, String(BigInt(start) + 1n));
    const second = command(r1.decision.result.listingVersion, 9201, true),
      r2 = await f.clients[0].controlListingV2(second, f.auth),
      correlation2 = f.trace.at(-1).requestId;
    assert.equal(r2.decision.outcome, 'applied');
    for (const [c, r] of [
      [first, r1],
      [second, r2],
    ]) {
      assert.deepEqual(await f.clients[0].getListingControlReceiptV2(c, f.auth), r);
      assert.deepEqual(await f.clients[0].controlListingV2(c, f.auth), r);
    }
    const rows = (
      await f.db.query(
        'SELECT tenant_id,actor_id,action,object_type,object_id,object_version::text,correlation_id,summary FROM app_private.audit_events WHERE id>$1 ORDER BY id',
        [auditStart],
      )
    ).rows;
    assert.deepEqual(rows, [
      {
        tenant_id: T,
        actor_id: ADMIN,
        action: 'listing.availability_confirmed',
        object_type: 'listing',
        object_id: LISTING,
        object_version: r1.decision.result.listingVersion,
        correlation_id: correlation1,
        summary: { availability: 'reserved', operationId: first.operationId },
      },
      {
        tenant_id: T,
        actor_id: ADMIN,
        action: 'listing.publication_changed',
        object_type: 'listing',
        object_id: LISTING,
        object_version: r2.decision.result.listingVersion,
        correlation_id: correlation2,
        summary: { status: 'archived', operationId: second.operationId },
      },
    ]);
    await assert.rejects(
      () => f.clients[0].controlListingV2({ ...first, availability: 'sold' }, f.auth),
      http(409),
    );
    const stale = command(start, 9202),
      conflict = await f.clients[0].controlListingV2(stale, f.auth);
    assert.equal(conflict.decision.outcome, 'conflict');
    const next = command(await version(f.db), 9203);
    await f.clients[0].controlListingV2({ ...next, availability: 'available' }, f.auth);
    assert.deepEqual(await f.clients[0].controlListingV2(stale, f.auth), conflict);
    assert.deepEqual(await f.clients[0].getListingControlReceiptV2(stale, f.auth), conflict);
    assert.equal(
      (
        await f.db.query('SELECT count(*)::int n FROM app_private.audit_events WHERE id>$1', [
          auditStart,
        ])
      ).rows[0].n,
      3,
    );
  } finally {
    await f.close();
  }
});
test('signed listing controls deny wrong/current membership, company, assignment and original actor without mutation', async () => {
  const f = await setup();
  try {
    const c = command(await version(f.db), 9200, true),
      before = await state(f.db);
    for (const [subject, status] of [
      [AGENT, 403],
      [id(12), 404],
      [id(13), 403],
      [id(20), 403],
    ]) {
      const auth = { bearerToken: await f.token(subject) };
      await assert.rejects(() => f.clients[0].controlListingV2(c, auth), http(status));
    }
    await assert.rejects(() => f.clients[1].controlListingV2(c, f.auth), http(403));
    const other = { bearerToken: await f.token(id(20)) };
    await assert.rejects(() => f.clients[1].controlListingV2(c, other), http(404));
    await f.db.query(
      "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    await assert.rejects(() => f.clients[0].controlListingV2(c, f.auth), http(404));
    await f.db.query(
      "UPDATE app_private.memberships SET role='admin',active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2",
      [T, ADMIN],
    );
    await assert.rejects(() => f.clients[0].controlListingV2(c, f.auth), http(403));
    await f.db.query(
      'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
      [T, ADMIN],
    );
    await f.db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await assert.rejects(() => f.clients[0].controlListingV2(c, f.auth), http(403));
    assert.deepEqual(await state(f.db), before);
    await f.db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [T]);
    await f.clients[0].controlListingV2(c, f.auth);
    const applied = await state(f.db),
      peer = { bearerToken: await f.token(id(15)) };
    await assert.rejects(() => f.clients[0].getListingControlReceiptV2(c, peer), http(404));
    await assert.rejects(() => f.clients[0].controlListingV2(c, peer), http(404));
    assert.deepEqual(await state(f.db), applied);
  } finally {
    await f.close();
  }
});
test('actual HTTP/SDK control audit failure rolls back listing, original request/result and public facts atomically', async () => {
  const f = await setup();
  try {
    for (const publication of [false, true]) {
      const c = command(await version(f.db), 9200 + Number(publication), publication),
        before = await state(f.db);
      await f.db.exec(
        `CREATE FUNCTION app_private.synthetic_reject_control_audit() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'PRIVATE CONTROL AUDIT SENTINEL';END $$;CREATE TRIGGER synthetic_reject_control_audit BEFORE INSERT ON app_private.audit_events FOR EACH ROW EXECUTE FUNCTION app_private.synthetic_reject_control_audit();`,
      );
      await assert.rejects(
        () => f.clients[0].controlListingV2(c, f.auth),
        (e) =>
          e.kind === 'HTTP' &&
          e.status === 503 &&
          e.submissionUncertain === true &&
          !/PRIVATE|SENTINEL/.test(e.message),
      );
      assert.deepEqual(await state(f.db), before);
      await assert.rejects(() => f.clients[0].getListingControlReceiptV2(c, f.auth), http(404));
      await f.db.exec(
        'DROP TRIGGER synthetic_reject_control_audit ON app_private.audit_events;DROP FUNCTION app_private.synthetic_reject_control_audit();',
      );
      const applied = await f.clients[0].controlListingV2(c, f.auth);
      assert.equal(applied.decision.outcome, 'applied');
      assert.equal(
        (await f.db.query('SELECT count(*)::int n FROM app_private.listing_control_requests'))
          .rows[0].n,
        before.listing_control_requests.length + 1,
      );
    }
  } finally {
    await f.close();
  }
});

test('all maintained availability and publication targets retain attributable audits and enforce the agent boundary', async () => {
  const f = await setup();
  try {
    const initial = (
      await f.db.query('SELECT coalesce(max(id),0)::text AS id FROM app_private.audit_events')
    ).rows[0].id;
    const agent = { bearerToken: await f.token(AGENT) },
      expected = [];
    let operation = 9400;
    async function apply(c, auth, actor) {
      const r = await f.clients[0].controlListingV2(c, auth),
        correlation = f.trace.at(-1).requestId;
      assert.equal(r.decision.outcome, 'applied');
      assert.deepEqual(await f.clients[0].getListingControlReceiptV2(c, auth), r);
      assert.deepEqual(await f.clients[0].controlListingV2(c, auth), r);
      expected.push({
        actor_id: actor,
        action:
          c.kind === 'confirm_availability'
            ? 'listing.availability_confirmed'
            : 'listing.publication_changed',
        object_version: r.decision.result.listingVersion,
        correlation_id: correlation,
        summary:
          c.kind === 'confirm_availability'
            ? { availability: c.availability, operationId: c.operationId }
            : { status: c.publicationStatus, operationId: c.operationId },
      });
    }
    for (const availability of ['reserved', 'rented', 'sold', 'withdrawn', 'available'])
      await apply({ ...command(await version(f.db), operation++), availability }, agent, AGENT);
    await apply(
      { ...command(await version(f.db), operation++, true), publicationStatus: 'paused' },
      agent,
      AGENT,
    );
    const forbidden = {
        ...command(await version(f.db), operation++, true),
        publicationStatus: 'published',
      },
      before = await state(f.db);
    await assert.rejects(() => f.clients[0].controlListingV2(forbidden, agent), http(403));
    assert.deepEqual(await state(f.db), before);
    for (const publicationStatus of ['published', 'paused', 'archived'])
      await apply(
        { ...command(await version(f.db), operation++, true), publicationStatus },
        f.auth,
        ADMIN,
      );
    const archived = await state(f.db);
    const archivedPause = {
      ...command(await version(f.db), operation++, true),
      publicationStatus: 'paused',
    };
    await assert.rejects(() => f.clients[0].controlListingV2(archivedPause, agent), http(403));
    assert.deepEqual(await state(f.db), archived);
    assert.deepEqual(
      (
        await f.db.query(
          'SELECT actor_id,action,object_version::text,correlation_id,summary FROM app_private.audit_events WHERE id>$1 ORDER BY id',
          [initial],
        )
      ).rows,
      expected,
    );
  } finally {
    await f.close();
  }
});
