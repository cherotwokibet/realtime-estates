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
const read = (db, key, { tenant = T, actor = null, listing = LISTING, revision = 1 } = {}) =>
  asActor(db, tenant, actor, () =>
    scalar(db, 'SELECT app_api.read_public_media_preview($1,$2,$3)', [listing, revision, key]),
  );
const keyFor = async (db) =>
  (
    await db.query(
      'SELECT photo_refs FROM app_private.public_snapshots WHERE tenant_id=$1 AND listing_id=$2',
      [T, LISTING],
    )
  ).rows[0].photo_refs[0].key;
const refused = (fn) => assert.rejects(fn, (e) => ['P0002', '23514', '42501'].includes(e.code));

test('current anonymous public image metadata binds approved snapshot and full sealed association without disclosure or mutation', async () => {
  const db = await fixture();
  try {
    await publish(db);
    const key = await keyFor(db);
    const before = (await db.query('SELECT count(*) FROM app_private.audit_events')).rows;
    const receipt = await read(db, key);
    assert.equal(receipt.kind, 'public_media_preview');
    assert.equal(receipt.state, 'approved');
    assert.equal(receipt.actorRole, 'guest');
    assert.equal(receipt.assignedAgentId, null);
    assert.equal(receipt.tenantId, T);
    assert.equal(`synthetic/${T}/${receipt.context.jobId}/${receipt.context.outputId}.webp`, key);
    assert.equal(
      receipt.verified.manifest.sha256,
      (
        await db.query(
          'SELECT sha256 FROM app_private.revision_media WHERE tenant_id=$1 AND id=$2',
          [T, receipt.mediaId],
        )
      ).rows[0].sha256,
    );
    assert.deepEqual(
      (await db.query('SELECT count(*) FROM app_private.audit_events')).rows,
      before,
    );
    for (const actor of [ADMIN, AGENT]) await refused(() => read(db, key, { actor }));
    await refused(() => read(db, key, { tenant: OTHER }));
    await refused(() => read(db, key, { revision: 2 }));
    await refused(() => read(db, key.replace('.webp', '/../private.webp')));
  } finally {
    await db.close();
  }
});
test('paused,archived,unavailable,stale,disabled or changed publication cannot authorize even valid sealed image metadata', async () => {
  const db = await fixture();
  try {
    await publish(db);
    const key = await keyFor(db);
    for (const change of [
      "publication_status='paused'",
      "publication_status='archived',archived_at=now()",
      "availability='rented'",
      "last_availability_confirmed_at=now()-interval '30 days'",
      'published_revision_no=NULL',
    ]) {
      await db.exec('BEGIN');
      try {
        await db.query(
          'UPDATE app_private.listings SET ' + change + ' WHERE tenant_id=$1 AND id=$2',
          [T, LISTING],
        );
        await db.exec('COMMIT');
        await refused(() => read(db, key));
      } catch (error) {
        await db.exec('ROLLBACK');
        throw error;
      } finally {
        await db.query(
          "UPDATE app_private.listings SET publication_status='published',archived_at=NULL,availability='available',last_availability_confirmed_at=now(),published_revision_no=1 WHERE tenant_id=$1 AND id=$2",
          [T, LISTING],
        );
      }
    }
    await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
    await refused(() => read(db, key));
  } finally {
    await db.close();
  }
});
test('unknown public key is refused and public SQL function keeps exact owner/search path/role restrictions', async () => {
  const db = await fixture();
  try {
    await publish(db);
    const key = await keyFor(db);
    await refused(() =>
      read(db, key.replace(/[^/]+\.webp$/, '00000000-0000-4000-8000-000000009999.webp')),
    );
    const permissions = await db.query(
      "SELECT pg_get_userbyid(proowner) owner,prosecdef,proconfig,has_function_privilege('api_runtime',oid,'EXECUTE') runtime,has_function_privilege('media_coordinator',oid,'EXECUTE') coordinator,EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public FROM pg_proc WHERE oid='app_api.read_public_media_preview(uuid,integer,text)'::regprocedure",
    );
    assert.deepEqual(permissions.rows, [
      {
        owner: 'realtor_owner',
        prosecdef: true,
        proconfig: ['search_path=pg_catalog'],
        runtime: true,
        coordinator: false,
        public: false,
      },
    ]);
    await asActor(db, T, null, () =>
      assert.rejects(
        () => db.query('SELECT * FROM app_private.media_attachments'),
        (e) => e.code === '42501',
      ),
    );
  } finally {
    await db.close();
  }
});
