import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedSyntheticSealedMedia } from '../test-helpers/synthetic-sealed-media.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  OTHERADMIN = id(20);
const hash = (n) => createHash('sha256').update(String(n)).digest('hex');
const content = {
  title: 'Synthetic gallery apartment',
  description: 'Disposable SQL metadata only; no photo bytes or storage proof.',
  purpose: 'rent',
  propertyType: 'apartment',
  currency: 'KES',
  amountMinor: 2000000,
  rentPeriod: 'month',
  bedrooms: 2,
  privateBathrooms: 1,
  sharedBathrooms: null,
  country: 'KE',
  locality: 'Synthetic Nairobi',
  publicPrecision: 'area',
  latitude: null,
  longitude: null,
  privateAddress: 'PRIVATE SYNTHETIC',
};
async function scalar(db, sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
async function transaction(db, x, callback) {
  await db.exec('BEGIN;SET LOCAL ROLE api_runtime;');
  try {
    await db.query(
      `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),
      set_config('realtor.correlation_id','synthetic-gallery-policy',true)`,
      [x.tenant ?? T, x.actor ?? AGENT],
    );
    const result = await callback();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}
const deny = (callback, code) => assert.rejects(callback, (error) => error.code === code);
const remove = (db, x, operation, media, expected = x.version) =>
  transaction(db, x, () =>
    scalar(db, 'SELECT app_api.remove_draft_media($1,1,$2,$3,$4)', [
      x.listing,
      expected,
      operation,
      media,
    ]),
  );
const reorder = (db, x, operation, ordered, expected = x.version) =>
  transaction(db, x, () =>
    scalar(db, 'SELECT app_api.reorder_draft_media($1,1,$2,$3,$4::uuid[])', [
      x.listing,
      expected,
      operation,
      ordered === null ? null : `{${ordered.join(',')}}`,
    ]),
  );
const read = (db, x, operation) =>
  transaction(db, x, () => scalar(db, 'SELECT app_api.read_media_operation($1)', [operation]));
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  await db.query(
    `INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'gallery-a','Synthetic A'),($2,'gallery-b','Synthetic B')`,
    [T, OTHER],
  );
  for (const [tenant, user, role] of [
    [T, ADMIN, 'admin'],
    [T, AGENT, 'agent'],
    [T, PEER, 'agent'],
    [T, CUSTOMER, 'customer'],
    [OTHER, OTHERADMIN, 'admin'],
  ])
    await db.query('INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,$3)', [
      tenant,
      user,
      role,
    ]);
  return db;
}
async function listing(db, n, { tenant = T, actor = AGENT, version = 2 } = {}) {
  const x = { tenant, actor, listing: id(n), version };
  await transaction(db, x, () =>
    db.query('SELECT app_api.create_listing($1,$2)', [x.listing, `gallery-${n}`]),
  );
  if (version === 2)
    await transaction(db, x, () =>
      db.query('SELECT app_api.save_draft($1,1,0,$2::jsonb)', [x.listing, JSON.stringify(content)]),
    );
  else
    await db.query(
      'INSERT INTO app_private.listing_revisions(tenant_id,listing_id,revision_no,version) VALUES($1,$2,1,$3::bigint)',
      [tenant, x.listing, version],
    );
  return x;
}
async function legacy(db, x, n, positions = [0, 1, 2, 3]) {
  const ids = [];
  for (const [i, position] of positions.entries()) {
    const media = id(n * 100 + i);
    ids.push(media);
    await db.query(
      `INSERT INTO app_private.revision_media(tenant_id,listing_id,revision_no,id,public_object_key,content_type,bytes,
      width,height,sha256,alt_text,position,accepted) VALUES($1,$2,1,$3,$4,'image/webp',100,100,100,$5,'Legacy unverified fixture',$6,$7)`,
      [
        x.tenant,
        x.listing,
        media,
        `legacy-gallery/${media}.webp`,
        hash(media),
        position,
        i % 2 === 0,
      ],
    );
  }
  return ids;
}
async function order(db, x) {
  return (
    await db.query(
      'SELECT id,position FROM app_private.revision_media WHERE tenant_id=$1 AND listing_id=$2 AND revision_no=1 ORDER BY position',
      [x.tenant, x.listing],
    )
  ).rows;
}
async function version(db, x) {
  return scalar(
    db,
    'SELECT version::text FROM app_private.listing_revisions WHERE tenant_id=$1 AND listing_id=$2 AND revision_no=1',
    [x.tenant, x.listing],
  );
}
async function snapshot(db) {
  const out = {};
  for (const table of [
    'listings',
    'listing_revisions',
    'revision_media',
    'media_operations',
    'media_jobs',
    'media_input_captures',
    'media_processing_leases',
    'media_verified_outputs',
    'media_attach_intents',
    'media_attach_results',
    'media_attachments',
    'public_snapshots',
    'audit_events',
  ])
    out[table] = (
      await db.query(
        `SELECT to_jsonb(x) AS value FROM app_private.${table} x ORDER BY to_jsonb(x)::text`,
      )
    ).rows;
  return out;
}
function shape(
  receipt,
  {
    kind,
    operation,
    x,
    expected,
    version: resultVersion,
    outcome,
    reason = null,
    media = null,
    ordered,
  },
) {
  assert.deepEqual(Object.keys(receipt).sort(), [
    'completedAt',
    'expectedVersion',
    'kind',
    'listingId',
    'mediaId',
    'operationId',
    'orderedIds',
    'outcome',
    'reason',
    'revision',
    'version',
  ]);
  assert.deepEqual(
    { ...receipt, completedAt: undefined },
    {
      kind,
      operationId: operation,
      listingId: x.listing,
      revision: 1,
      expectedVersion: String(expected),
      version: String(resultVersion),
      outcome,
      reason,
      mediaId: media,
      orderedIds: ordered,
      completedAt: undefined,
    },
  );
  assert.match(receipt.completedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
}

// Serialized PGlite checks policy, transactional rollback and SQL-only relational
// fixtures. No decoder, storage deletion or independent-connection race is proved.
test('draft gallery commands preserve exact consent, contiguous positions and immutable operation history', async (t) => {
  const db = await fixture();
  try {
    await t.test(
      'middle/first/last removal compacts all associations and increments only one revision token per change',
      async () => {
        const x = await listing(db, 100),
          ids = await legacy(db, x, 100);
        const op = id(10100);
        const receipt = await remove(db, x, op, ids[1]);
        shape(receipt, {
          kind: 'remove_media',
          operation: op,
          x,
          expected: 2,
          version: 3,
          outcome: 'applied',
          media: ids[1],
          ordered: [ids[0], ids[2], ids[3]],
        });
        assert.deepEqual(await order(db, x), [
          { id: ids[0], position: 0 },
          { id: ids[2], position: 1 },
          { id: ids[3], position: 2 },
        ]);
        assert.equal(await version(db, x), '3');
        assert.equal(
          await scalar(db, 'SELECT version::text FROM app_private.listings WHERE id=$1', [
            x.listing,
          ]),
          '1',
        );
        const audit = (
          await db.query(
            "SELECT actor_id,tenant_id,object_version::text FROM app_private.audit_events WHERE object_id=$1 AND action='media.removed'",
            [x.listing],
          )
        ).rows;
        assert.deepEqual(audit, [{ actor_id: AGENT, tenant_id: T, object_version: '3' }]);
        const after = await snapshot(db);
        assert.deepEqual(await remove(db, x, op, ids[1]), receipt);
        assert.deepEqual(await read(db, x, op), receipt);
        assert.deepEqual(await snapshot(db), after);
        x.version = 3;
        const first = await remove(db, x, id(11100), ids[0]);
        assert.deepEqual(first.orderedIds, [ids[2], ids[3]]);
        assert.equal(first.version, '4');
        x.version = 4;
        const last = await remove(db, x, id(12100), ids[3]);
        assert.deepEqual(last.orderedIds, [ids[2]]);
        assert.equal(last.version, '5');
        x.version = 5;
        const empty = await remove(db, x, id(13100), ids[2]);
        assert.deepEqual(empty.orderedIds, []);
        assert.equal(empty.version, '6');
        assert.deepEqual(await order(db, x), []);
      },
    );

    await t.test(
      'range-safe swaps/arbitrary permutations include legacy unaccepted rows and explicit noop does not audit or touch tokens',
      async () => {
        const x = await listing(db, 101),
          ids = await legacy(db, x, 101),
          op = id(20101),
          requested = [ids[3], ids[1], ids[2], ids[0]];
        const swapped = await reorder(db, x, op, requested);
        shape(swapped, {
          kind: 'reorder_media',
          operation: op,
          x,
          expected: 2,
          version: 3,
          outcome: 'applied',
          ordered: requested,
        });
        assert.deepEqual(
          await order(db, x),
          requested.map((id, position) => ({ id, position })),
        );
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.revision_media WHERE listing_id=$1 AND NOT accepted',
            [x.listing],
          ),
          2,
        );
        const next = [ids[2], ids[0], ids[3], ids[1]];
        x.version = 3;
        assert.equal((await reorder(db, x, id(11101), next)).version, '4');
        x.version = 4;
        const before = await snapshot(db),
          noop = await reorder(db, x, id(12101), next);
        shape(noop, {
          kind: 'reorder_media',
          operation: id(12101),
          x,
          expected: 4,
          version: 4,
          outcome: 'noop',
          ordered: next,
        });
        const after = await snapshot(db);
        for (const table of Object.keys(before).filter((k) => k !== 'media_operations'))
          assert.deepEqual(after[table], before[table], table);
        assert.equal(after.media_operations.length, before.media_operations.length + 1);
        assert.deepEqual(await reorder(db, x, id(12101), next), noop);
        assert.equal(
          await scalar(
            db,
            "SELECT count(*)::integer FROM app_private.audit_events WHERE object_id=$1 AND action='media.reordered'",
            [x.listing],
          ),
          2,
        );
        const empty = await listing(db, 102);
        const emptyNoop = await reorder(db, empty, id(10102), []);
        assert.equal(emptyNoop.outcome, 'noop');
        assert.equal(emptyNoop.version, '2');
        const emptyMissing = await remove(db, empty, id(11102), id(999001));
        assert.equal(emptyMissing.reason, 'MEDIA_NOT_FOUND');
        assert.deepEqual(emptyMissing.orderedIds, []);
      },
    );

    await t.test(
      'valid full-set reordering repairs sparse positions while removal refuses an ambiguous sparse gallery',
      async () => {
        const x = await listing(db, 103),
          ids = await legacy(db, x, 103, [1, 4, 8]),
          op = id(10103);
        const rejected = await remove(db, x, op, ids[1]);
        assert.equal(rejected.reason, 'MEDIA_SET_CHANGED');
        assert.equal(rejected.version, '2');
        assert.deepEqual(rejected.orderedIds, ids);
        const repaired = await reorder(db, x, id(11103), ids);
        assert.equal(repaired.outcome, 'applied');
        assert.equal(repaired.version, '3');
        assert.deepEqual(
          await order(db, x),
          ids.map((id, position) => ({ id, position })),
        );
        assert.deepEqual(await remove(db, x, op, ids[1]), rejected);
        assert.equal((await reorder(db, x, id(12103), ids, 3)).outcome, 'noop');
      },
    );

    await t.test(
      'null, multidimensional, non-one-based, duplicate, NULL-element and oversized arrays fail before operation reservation',
      async () => {
        const x = await listing(db, 104),
          ids = await legacy(db, x, 104),
          before = await snapshot(db);
        const raw = [
          null,
          `{{${ids[0]},${ids[1]}},{${ids[2]},${ids[3]}}}`,
          `[0:1]={${ids[0]},${ids[1]}}`,
          `{${ids[0]},${ids[0]}}`,
          `{${ids[0]},NULL}`,
          `{${Array.from({ length: 13 }, (_, n) => id(990000 + n)).join(',')}}`,
        ];
        for (const array of raw)
          await deny(
            () =>
              transaction(db, x, () =>
                scalar(db, 'SELECT app_api.reorder_draft_media($1,1,2,$2,$3::uuid[])', [
                  x.listing,
                  id(10104),
                  array,
                ]),
              ),
            '23514',
          );
        for (const expected of [null, 0, -1, '9007199254740991'])
          await deny(() => reorder(db, x, id(10104), ids, expected), '23514');
        await deny(() => remove(db, x, id(10104), null), '23514');
        await deny(
          () =>
            transaction(db, x, () =>
              db.query("SELECT app_api.remove_draft_media($1,1,2,$2,'not-a-uuid'::uuid)", [
                x.listing,
                id(10104),
              ]),
            ),
          '22P02',
        );
        assert.deepEqual(await snapshot(db), before);
      },
    );

    await t.test(
      'partial, extra, foreign and empty requested sets persist immutable typed rejection with requested order',
      async () => {
        const x = await listing(db, 105),
          ids = await legacy(db, x, 105),
          foreign = await listing(db, 106),
          foreignIds = await legacy(db, foreign, 106);
        for (const [n, requested] of [
          [0, ids.slice(1)],
          [1, [...ids, id(999002)]],
          [2, [ids[0], ids[1], ids[2], foreignIds[3]]],
          [3, []],
        ]) {
          const op = id(10105 + n * 1000),
            beforeVersion = await version(db, x),
            receipt = await reorder(db, x, op, requested);
          shape(receipt, {
            kind: 'reorder_media',
            operation: op,
            x,
            expected: 2,
            version: 2,
            outcome: 'rejected',
            reason: 'MEDIA_SET_CHANGED',
            ordered: requested,
          });
          assert.deepEqual(await read(db, x, op), receipt);
          assert.deepEqual(await reorder(db, x, op, requested), receipt);
          assert.equal(await version(db, x), beforeVersion);
        }
        const missing = await remove(db, x, id(15105), foreignIds[0]);
        assert.equal(missing.reason, 'MEDIA_NOT_FOUND');
        assert.equal(missing.mediaId, foreignIds[0]);
        assert.deepEqual(missing.orderedIds, ids);
        assert.equal(missing.orderedIds.includes(missing.mediaId), false);
        assert.deepEqual(
          await order(db, x),
          ids.map((id, position) => ({ id, position })),
        );
      },
    );

    await t.test(
      'same UUID changed version/target/order/principal/tuple/kind conflicts before historical disclosure',
      async () => {
        const x = await listing(db, 107),
          ids = await legacy(db, x, 107),
          op = id(10107),
          receipt = await remove(db, x, op, ids[1]);
        const before = await snapshot(db);
        await deny(() => remove(db, x, op, ids[1], 3), '40001');
        await deny(() => remove(db, x, op, ids[2]), '40001');
        await deny(() => remove(db, { ...x, actor: ADMIN }, op, ids[1]), '40001');
        await deny(() => reorder(db, x, op, [ids[3], ids[2], ids[0]]), '40001');
        const other = await listing(db, 108),
          otherIds = await legacy(db, other, 108);
        const withOther = await snapshot(db);
        await deny(() => remove(db, other, op, otherIds[0]), '40001');
        assert.deepEqual(await snapshot(db), withOther);
        const reorderOp = id(11107),
          reordered = await reorder(db, x, reorderOp, [ids[3], ids[2], ids[0]], 3);
        await deny(() => reorder(db, x, reorderOp, [ids[0], ids[2], ids[3]], 3), '40001');
        assert.deepEqual(await read(db, x, op), receipt);
        assert.equal(reordered.version, '4');
        const resource = await scalar(
          db,
          'SELECT resource_id FROM app_private.media_operations WHERE tenant_id=$1 AND operation_id=$2',
          [T, op],
        );
        const currentBefore = await snapshot(db);
        await deny(() => remove(db, x, resource, ids[2], 4), '40001');
        await deny(() => remove(db, x, ids[2], ids[2], 4), '40001');
        await deny(() => reorder(db, x, ids[3], [ids[3], ids[2], ids[0]], 4), '40001');
        assert.deepEqual(await snapshot(db), currentBefore);
        assert.equal(before.media_operations.filter((r) => r.value.operation_id === op).length, 1);
      },
    );

    await t.test(
      'tenant namespace and current original principal authorization prevent guessed receipt leakage',
      async () => {
        const x = await listing(db, 109),
          ids = await legacy(db, x, 109),
          op = id(10109),
          receipt = await reorder(db, x, op, [...ids].reverse());
        await deny(() => read(db, { ...x, actor: ADMIN }, op), 'P0002');
        await deny(() => read(db, { ...x, actor: PEER }, op), 'P0002');
        await deny(() => remove(db, { ...x, actor: PEER }, id(11109), ids[0], 3), 'P0002');
        await deny(() => read(db, { ...x, actor: CUSTOMER }, op), '42501');
        const foreign = await listing(db, 110, { tenant: OTHER, actor: OTHERADMIN }),
          foreignIds = await legacy(db, foreign, 110);
        await deny(() => read(db, foreign, op), 'P0002');
        const foreignReceipt = await remove(db, foreign, op, foreignIds[0]);
        assert.equal(foreignReceipt.listingId, foreign.listing);
        assert.deepEqual(await read(db, x, op), receipt);
        assert.deepEqual(await read(db, foreign, op), foreignReceipt);
        await transaction(db, { ...x, actor: ADMIN }, () =>
          db.query('SELECT app_api.reassign_listing($1,1,$2)', [x.listing, PEER]),
        );
        const reassigned = await snapshot(db);
        await deny(() => read(db, x, op), 'P0002');
        await deny(() => reorder(db, x, op, [...ids].reverse()), 'P0002');
        assert.deepEqual(await snapshot(db), reassigned);
        await transaction(db, { ...x, actor: ADMIN }, () =>
          db.query('SELECT app_api.reassign_listing($1,2,$2)', [x.listing, AGENT]),
        );
        assert.deepEqual(await read(db, x, op), receipt);
        await db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
          [T, AGENT],
        );
        await deny(() => read(db, x, op), '42501');
        await db.query(
          'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
          [T, AGENT],
        );
        await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
        await deny(() => read(db, x, op), '42501');
        await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [T]);
        assert.deepEqual(await read(db, x, op), receipt);
        await deny(() => read(db, x, id(999003)), 'P0002');
      },
    );

    await t.test(
      'typed stale/state failures preserve media/token and state takes precedence; exact replay survives later saves and association changes',
      async () => {
        const x = await listing(db, 111),
          ids = await legacy(db, x, 111),
          op = id(10111),
          stale = await remove(db, x, op, ids[1], 1);
        shape(stale, {
          kind: 'remove_media',
          operation: op,
          x,
          expected: 1,
          version: 2,
          outcome: 'conflict',
          reason: 'VERSION_CONFLICT',
          media: ids[1],
          ordered: ids,
        });
        await transaction(db, x, () =>
          db.query('SELECT app_api.save_draft($1,1,2,$2::jsonb)', [
            x.listing,
            JSON.stringify({ ...content, title: 'Later save' }),
          ]),
        );
        assert.deepEqual(await remove(db, x, op, ids[1], 1), stale);
        assert.equal(await version(db, x), '3');
        const applied = await remove(db, x, id(11111), ids[0], 3);
        assert.equal(applied.version, '4');
        assert.deepEqual(await read(db, x, op), stale);
        await db.query(
          `UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=$2 WHERE listing_id=$1`,
          [x.listing, AGENT],
        );
        const pending = await remove(db, x, id(12111), id(999004), 1);
        assert.equal(pending.reason, 'REVISION_NOT_DRAFT');
        assert.equal(pending.outcome, 'rejected');
        assert.equal(pending.version, '5');
        const orderRejected = await reorder(db, x, id(13111), [], 4);
        assert.equal(orderRejected.reason, 'REVISION_NOT_DRAFT');
        assert.equal(orderRejected.version, '5');
        const before = await snapshot(db);
        assert.deepEqual(await remove(db, x, id(11111), ids[0], 3), applied);
        assert.deepEqual(await read(db, x, op), stale);
        assert.deepEqual(await snapshot(db), before);
      },
    );

    await t.test(
      'provenance/job/seal histories survive removal; approved snapshot remains exact during later draft gallery edits',
      async () => {
        const x = await listing(db, 112),
          photos = [];
        for (let p = 0; p < 4; p++)
          photos.push(
            await seedSyntheticSealedMedia(db, {
              tenantId: T,
              listingId: x.listing,
              position: p,
              mediaId: id(11200 + p),
            }),
          );
        // Labelled privileged helper fabricates relational facts without decoding,
        // stored bytes, token reset or proof that historical attach commands ran.
        const changed = [
            photos[3].mediaId,
            photos[0].mediaId,
            photos[1].mediaId,
            photos[2].mediaId,
          ],
          reordered = await reorder(db, x, id(10112), changed);
        assert.equal(reordered.version, '3');
        await transaction(db, x, () =>
          db.query('SELECT app_api.submit_revision($1,1,3)', [x.listing]),
        );
        await transaction(db, { ...x, actor: ADMIN }, () =>
          db.query("SELECT app_api.confirm_availability($1,1,'available')", [x.listing]),
        );
        await transaction(db, { ...x, actor: ADMIN }, () =>
          db.query('SELECT app_api.decide_revision($1,1,4,true)', [x.listing]),
        );
        const published = await scalar(
          db,
          'SELECT photo_refs FROM app_private.public_snapshots WHERE listing_id=$1',
          [x.listing],
        );
        assert.equal(published.length, 4);
        assert.deepEqual(await reorder(db, x, id(10112), changed), reordered);
        const rejected = await remove(db, x, id(11112), photos[0].mediaId, 5);
        assert.equal(rejected.reason, 'REVISION_NOT_DRAFT');
        assert.deepEqual(
          await scalar(
            db,
            'SELECT photo_refs FROM app_private.public_snapshots WHERE listing_id=$1',
            [x.listing],
          ),
          published,
        );
        await transaction(db, x, () =>
          db.query('SELECT app_api.save_draft($1,2,0,$2::jsonb)', [
            x.listing,
            JSON.stringify(content),
          ]),
        );
        const newPhoto = await seedSyntheticSealedMedia(db, {
          tenantId: T,
          listingId: x.listing,
          revision: 2,
          position: 0,
          mediaId: id(11210),
        });
        const retained = await snapshot(db);
        const removed = await transaction(db, x, () =>
          scalar(db, 'SELECT app_api.remove_draft_media($1,2,2,$2,$3)', [
            x.listing,
            id(12112),
            newPhoto.mediaId,
          ]),
        );
        assert.equal(removed.outcome, 'applied');
        assert.deepEqual(removed.orderedIds, []);
        const after = await snapshot(db);
        for (const table of [
          'media_jobs',
          'media_input_captures',
          'media_processing_leases',
          'media_verified_outputs',
          'media_attach_intents',
          'media_attach_results',
          'media_attachments',
          'public_snapshots',
        ])
          assert.deepEqual(after[table], retained[table], table);
        assert.deepEqual(
          await scalar(
            db,
            'SELECT photo_refs FROM app_private.public_snapshots WHERE listing_id=$1',
            [x.listing],
          ),
          published,
        );
        const known = await scalar(
          db,
          'SELECT receipt FROM app_private.media_operations WHERE tenant_id=$1 AND operation_id=$2',
          [T, newPhoto.operationId],
        );
        assert.equal(known.status, 'ready');
        const original = await transaction(db, x, () =>
          scalar(db, 'SELECT app_api.read_media_attach_intent($1)', [newPhoto.operationId]),
        );
        assert.equal(original.status, 'applied');
      },
    );

    await t.test(
      'shared upload/attach namespace and known pipeline identities cannot be repurposed as gallery operations',
      async () => {
        const x = await listing(db, 113),
          photo = await seedSyntheticSealedMedia(db, {
            tenantId: T,
            listingId: x.listing,
            position: 0,
            mediaId: id(11300),
          });
        const identities = (
          await db.query(
            `SELECT j.registration_id,j.id,j.quarantine_id,j.output_id,c.generation_id,l.claim_id,l.lease_nonce
        FROM app_private.media_jobs j JOIN app_private.media_input_captures c ON c.tenant_id=j.tenant_id AND c.job_id=j.id
        JOIN app_private.media_processing_leases l ON l.tenant_id=j.tenant_id AND l.job_id=j.id WHERE j.id=$1`,
            [photo.jobId],
          )
        ).rows[0];
        const before = await snapshot(db);
        for (const operation of [...Object.values(identities), photo.operationId, photo.mediaId])
          await deny(() => remove(db, x, operation, photo.mediaId), '40001');
        await deny(() => read(db, x, photo.operationId), 'P0002');
        await deny(() => read(db, x, identities.registration_id), 'P0002');
        assert.deepEqual(await snapshot(db), before);
      },
    );

    await t.test(
      'safe upper boundary stays exact while unsupported current versions abort without reservation or adoption',
      async () => {
        const x = await listing(db, 114, { version: '9007199254740990' }),
          ids = await legacy(db, x, 114, [0]);
        const receipt = await remove(db, x, id(10114), ids[0]);
        assert.equal(receipt.expectedVersion, '9007199254740990');
        assert.equal(receipt.version, '9007199254740991');
        const conflict = await reorder(db, x, id(11114), []);
        assert.equal(conflict.reason, 'VERSION_CONFLICT');
        assert.equal(conflict.version, '9007199254740991');
        const unsupported = await listing(db, 115, { version: '9007199254740992' }),
          unsupportedIds = await legacy(db, unsupported, 115, [0, 1]);
        const before = await snapshot(db);
        await deny(() => remove(db, unsupported, id(10115), unsupportedIds[0], 2), '23514');
        await deny(() => reorder(db, unsupported, id(11115), unsupportedIds, 2), '23514');
        assert.deepEqual(await snapshot(db), before);
      },
    );

    await t.test(
      'audit failure and terminal receipt failure roll back associations, positions, token and audit atomically',
      async () => {
        const x = await listing(db, 116),
          ids = await legacy(db, x, 116),
          op = id(10116);
        await db.exec(`CREATE FUNCTION app_private.test_fail_gallery() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN RAISE EXCEPTION 'Injected test failure' USING ERRCODE='23514';END $$;
        CREATE TRIGGER test_gallery_audit BEFORE INSERT ON app_private.audit_events FOR EACH ROW
          WHEN (NEW.action IN ('media.removed','media.reordered')) EXECUTE FUNCTION app_private.test_fail_gallery();`);
        const beforeAudit = await snapshot(db);
        await deny(() => remove(db, x, op, ids[1]), '23514');
        await deny(() => reorder(db, x, id(11116), [...ids].reverse()), '23514');
        assert.deepEqual(await snapshot(db), beforeAudit);
        await db.exec('DROP TRIGGER test_gallery_audit ON app_private.audit_events;');
        await db.exec(`CREATE TRIGGER zz_test_gallery_receipt BEFORE INSERT ON app_private.media_operations FOR EACH ROW
        WHEN (NEW.kind IN ('remove_media','reorder_media')) EXECUTE FUNCTION app_private.test_fail_gallery();`);
        const beforeReceipt = await snapshot(db);
        await deny(() => remove(db, x, op, ids[1]), '23514');
        await deny(() => reorder(db, x, id(11116), [...ids].reverse()), '23514');
        assert.deepEqual(await snapshot(db), beforeReceipt);
        await db.exec(
          'DROP TRIGGER zz_test_gallery_receipt ON app_private.media_operations;DROP FUNCTION app_private.test_fail_gallery();',
        );
        assert.equal((await reorder(db, x, id(11116), [...ids].reverse())).outcome, 'applied');
        assert.equal((await remove(db, x, op, ids[1], 3)).outcome, 'applied');
      },
    );

    await t.test(
      'position constraint is narrowly deferrable and exact operation records/functions remain private and immutable',
      async () => {
        const constraint = (
          await db.query(
            `SELECT condeferrable,condeferred FROM pg_constraint WHERE conrelid='app_private.revision_media'::regclass AND conname='revision_media_gallery_positions'`,
          )
        ).rows[0];
        assert.deepEqual(constraint, { condeferrable: true, condeferred: false });
        for (const signature of [
          'app_api.remove_draft_media(uuid,integer,bigint,uuid,uuid)',
          'app_api.reorder_draft_media(uuid,integer,bigint,uuid,uuid[])',
          'app_api.read_media_operation(uuid)',
        ]) {
          const row = (
            await db.query(
              `SELECT p.prosecdef,p.proconfig,r.rolname AS owner,
          has_function_privilege('api_runtime',p.oid,'EXECUTE') AS api_execute,
          has_function_privilege('media_coordinator',p.oid,'EXECUTE') AS coordinator_execute,
          EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
          FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=$1::regprocedure`,
              [signature],
            )
          ).rows[0];
          assert.deepEqual(row, {
            prosecdef: true,
            proconfig: ['search_path=pg_catalog'],
            owner: 'realtor_owner',
            api_execute: true,
            coordinator_execute: false,
            public_execute: false,
          });
        }
        for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
          assert.equal(
            await scalar(
              db,
              "SELECT has_table_privilege('api_runtime','app_private.media_operations',$1)",
              [privilege],
            ),
            false,
          );
        const x = await listing(db, 117),
          ids = await legacy(db, x, 117),
          op = id(10117);
        await reorder(db, x, op, [...ids].reverse());
        await deny(
          () =>
            db.query(
              'UPDATE app_private.media_operations SET receipt=receipt WHERE tenant_id=$1 AND operation_id=$2',
              [T, op],
            ),
          '23514',
        );
        await deny(
          () =>
            db.query(
              'DELETE FROM app_private.media_operations WHERE tenant_id=$1 AND operation_id=$2',
              [T, op],
            ),
          '23514',
        );
        await deny(
          () =>
            db.query(
              `INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,
        expected_version,resource_id,request_payload,request_sha256,receipt,created_at)
        SELECT tenant_id,$3,kind,listing_id,revision_no,requester_id,expected_version,gen_random_uuid(),request_payload,request_sha256,
          receipt||jsonb_build_object('operationId',$3::uuid,'version','99'),created_at FROM app_private.media_operations WHERE tenant_id=$1 AND operation_id=$2`,
              [T, op, id(11117)],
            ),
          '23514',
        );
        // All request/receipt fields and the digest are otherwise canonical. This
        // independently exercises the schema's missing-target exclusion rule.
        await deny(
          () =>
            db.query(
              `WITH source AS (SELECT x.*,jsonb_build_object('kind','remove_media','tenantId',tenant_id,
          'actorId',requester_id,'listingId',listing_id,'revision',revision_no,'expectedVersion',expected_version::text,
          'mediaId',$4::uuid) AS body FROM app_private.media_operations x WHERE tenant_id=$1 AND operation_id=$2)
        INSERT INTO app_private.media_operations(tenant_id,operation_id,kind,listing_id,revision_no,requester_id,expected_version,
          resource_id,request_payload,request_sha256,receipt,created_at)
        SELECT tenant_id,$3,'remove_media',listing_id,revision_no,requester_id,expected_version,gen_random_uuid(),body,
          encode(sha256(convert_to(body::text,'UTF8')),'hex'),jsonb_build_object('kind','remove_media','operationId',$3::uuid,
            'listingId',listing_id,'revision',revision_no,'expectedVersion',expected_version::text,'version',expected_version::text,
            'outcome','rejected','reason','MEDIA_NOT_FOUND','mediaId',$4::uuid,'orderedIds',receipt->'orderedIds',
            'completedAt',app_private.media_utc(created_at)),created_at FROM source`,
              [T, op, id(12117), ids[0]],
            ),
          '23514',
        );
        assert.equal(
          await scalar(
            db,
            'SELECT count(*)::integer FROM app_private.media_operations WHERE tenant_id=$1 AND operation_id=$2',
            [T, id(12117)],
          ),
          0,
        );
        assert.equal(
          await scalar(
            db,
            `SELECT count(*)::integer FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
        LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE n.nspname='app_private' AND a.grantee=0 AND a.privilege_type='EXECUTE'`,
          ),
          0,
        );
      },
    );
  } finally {
    await db.close();
  }
});
