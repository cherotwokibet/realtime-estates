import assert from 'node:assert/strict';
import test from 'node:test';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';
import { createHash } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const T = id(1),
  OTHER = id(2),
  ADMIN = id(10),
  AGENT = id(11),
  PEER = id(12),
  CUSTOMER = id(13),
  OTHERADMIN = id(20);
const hash = (value) => createHash('sha256').update(String(value)).digest('hex');
const content = {
  title: 'Synthetic private preview apartment',
  description: 'SQL-only authorization and relational provenance; no image bytes exist.',
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
  privateAddress: 'PRIVATE SYNTHETIC ADDRESS',
};
const manifest = (n) => ({
  pipeline: 'synthetic-codec-v1',
  sourceFormat: 'png',
  inputSha256: hash(`input/${n}`),
  inputBytes: 100,
  format: 'webp',
  mimeType: 'image/webp',
  sha256: hash(`output/${n}`),
  width: 800,
  height: 600,
  bytes: 1000,
  encoder: { sharp: '0.35.5', vips: '8.18.7' },
  operations: [
    'auto-orient',
    'resize-inside-1920-without-enlargement',
    'strip-metadata',
    'webp-quality-82-effort-4',
  ],
});
async function scalar(db, sql, args = []) {
  return Object.values((await db.query(sql, args)).rows[0])[0];
}
const denied = (operation, code = 'P0002') =>
  assert.rejects(operation, (error) => error.code === code);
async function snapshot(db) {
  const result = {};
  for (const table of [
    'tenants',
    'memberships',
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
    'audit_events',
    'public_snapshots',
  ])
    result[table] = (
      await db.query(
        `SELECT to_jsonb(x) AS value FROM app_private.${table} x ORDER BY to_jsonb(x)::text`,
      )
    ).rows;
  return result;
}
async function fixture() {
  const db = new PGlite();
  await applyTestMigrations(db);
  // Allocation restriction is part of the normal reviewed migration order.
  const bootstrap = '"' + (await scalar(db, 'SELECT session_user')).replaceAll('"', '""') + '"';
  await db.query(
    `INSERT INTO app_private.tenants(id,slug,display_name) VALUES
    ($1,'private-preview-a','Synthetic A'),($2,'private-preview-b','Synthetic B')`,
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
  await db.exec(`CREATE ROLE synthetic_media_preview_api LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
    GRANT api_runtime TO synthetic_media_preview_api;
    CREATE ROLE synthetic_media_preview_coordinator LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
    GRANT media_coordinator TO synthetic_media_preview_coordinator;`);
  async function transaction(login, role, actor, operation, tenant = T) {
    await db.exec(`SET SESSION AUTHORIZATION ${login};BEGIN;SET LOCAL ROLE ${role};`);
    try {
      await db.query(
        `SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true),
        set_config('realtor.correlation_id','synthetic-private-preview',true)`,
        [tenant ?? '', actor ?? ''],
      );
      const result = await operation();
      await db.exec('COMMIT');
      return result;
    } catch (error) {
      await db.exec('ROLLBACK');
      throw error;
    } finally {
      await db.exec(`SET SESSION AUTHORIZATION ${bootstrap};RESET ROLE;`);
    }
  }
  const api = (actor, operation, tenant = T) =>
    transaction('synthetic_media_preview_api', 'api_runtime', actor, operation, tenant);
  // Wrong context deliberately cannot choose the coordinator's original job.
  const coordinator = (operation) =>
    transaction(
      'synthetic_media_preview_coordinator',
      'media_coordinator',
      OTHERADMIN,
      operation,
      OTHER,
    );
  async function listing(n, { actor = AGENT, tenant = T } = {}) {
    const x = { listing: id(n), actor, tenant, revision: 1, version: '2' };
    await api(
      actor,
      async () => {
        await seedGuardedListingDraft(db, {
          listingId: x.listing,
          slug: `synthetic-private-preview-${n}`,
          content: {
            ...content,
            pricing: { declaration: 'not_declared', charges: [] },
            location: { county: null, town: null, area: null },
          },
          actorId: actor,
        });
      },
      tenant,
    );
    return x;
  }
  async function attached(n, options = {}) {
    const x = await listing(n, options),
      value = manifest(n),
      operation = id(n + 4000),
      generation = id(n + 3000),
      claim = id(n + 2000);
    const registration = await api(
      x.actor,
      () =>
        scalar(db, 'SELECT app_api.register_media_upload($1,1,2,$2,$3)', [
          x.listing,
          id(n + 1000),
          'Synthetic SQL-only saved photo',
        ]),
      x.tenant,
    );
    const capture = await coordinator(() =>
      scalar(db, 'SELECT app_media.capture_input($1,$2,$3,$4)', [
        registration.jobId,
        generation,
        value.inputBytes,
        value.inputSha256,
      ]),
    );
    const lease = await coordinator(() =>
      scalar(db, 'SELECT app_media.claim_processing($1,$2)', [registration.jobId, claim]),
    );
    const verified = await coordinator(() =>
      scalar(db, 'SELECT app_media.seal_output($1,$2,$3,$4::jsonb)', [
        registration.jobId,
        lease.attempt,
        lease.leaseNonce,
        JSON.stringify(value),
      ]),
    );
    await api(
      x.actor,
      () =>
        scalar(db, 'SELECT app_api.create_media_attach_intent($1,1,2,$2,$3)', [
          x.listing,
          operation,
          registration.jobId,
        ]),
      x.tenant,
    );
    const finalized = await coordinator(() =>
      scalar(db, 'SELECT app_media.finalize_media($1)', [operation]),
    );
    assert.equal(finalized.status, 'applied');
    const result = finalized.receipt;
    assert.equal(result.outcome, 'applied');
    assert.equal(result.version, '3');
    return {
      ...x,
      version: result.version,
      media: result.mediaId,
      operation,
      job: registration.jobId,
      capture,
      lease,
      verified,
      registration,
    };
  }
  const preview = (
    x,
    {
      actor = x.actor,
      tenant = x.tenant,
      listing = x.listing,
      revision = x.revision,
      media = x.media,
      version = x.version,
    } = {},
  ) =>
    api(
      actor,
      () =>
        scalar(
          db,
          'SELECT app_api.read_private_media_preview($1::uuid,$2::integer,$3::uuid,$4::bigint)',
          [listing, revision, media, version],
        ),
      tenant,
    );
  return { db, api, coordinator, listing, attached, preview };
}

// Restricted-login, serialized local SQL policy evidence only. Fabricated hashes
// and coordinator attestations are not image decoding, native process, durable
// store, authenticated HTTP, independent-connection race, or delivery proof.
test('private saved-photo SQL reads bind current staff to immutable applied provenance without mutation', async (t) => {
  const f = await fixture(),
    { db, api, coordinator, listing, attached, preview } = f;
  try {
    await t.test(
      'restricted API returns exact internal envelope and authoritative SQL hash without paths or writes',
      async () => {
        const x = await attached(100),
          before = await snapshot(db),
          result = await preview(x);
        const context = await coordinator(() =>
          scalar(db, 'SELECT app_media.read_upload_context($1)', [x.job]),
        );
        assert.deepEqual(result, {
          kind: 'private_media_preview',
          tenantId: T,
          listingId: x.listing,
          revision: 1,
          version: '3',
          state: 'draft',
          mediaId: x.media,
          operationId: x.operation,
          assignedAgentId: AGENT,
          actorRole: 'agent',
          context: {
            jobId: x.job,
            quarantineId: x.lease.quarantineId,
            outputId: x.lease.outputId,
            expiresAt: context.expiresAt,
            pipeline: 'synthetic-codec-v1',
          },
          capture: x.capture,
          lease: x.lease,
          verified: x.verified,
        });
        assert.equal(
          result.verified.manifestSha256,
          await scalar(
            db,
            "SELECT encode(sha256(convert_to(manifest::text,'UTF8')),'hex') FROM app_private.media_verified_outputs WHERE job_id=$1",
            [x.job],
          ),
        );
        assert.notEqual(
          result.verified.manifestSha256,
          hash(JSON.stringify(result.verified.manifest)),
        );
        assert.equal(JSON.stringify(result).includes('synthetic/'), false);
        for (const forbidden of [
          'public_object_key',
          'publicObjectKey',
          'storeId',
          'rootDirectory',
          'requesterId',
        ])
          assert.equal(JSON.stringify(result).includes(forbidden), false);
        assert.deepEqual(await preview(x), result);
        assert.deepEqual(await snapshot(db), before);
      },
    );

    await t.test(
      'admin and reassigned agent retain viewing after uploader revocation while processing guard remains intact',
      async () => {
        const x = await attached(101),
          originalAdmin = await preview(x, { actor: ADMIN });
        await api(ADMIN, () =>
          db.query('SELECT app_api.reassign_listing($1,1,$2)', [x.listing, PEER]),
        );
        await db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
          [T, AGENT],
        );
        try {
          const before = await snapshot(db),
            admin = await preview(x, { actor: ADMIN }),
            peer = await preview(x, { actor: PEER });
          assert.equal(admin.assignedAgentId, PEER);
          assert.equal(admin.actorRole, 'admin');
          assert.equal(peer.actorRole, 'agent');
          assert.deepEqual({ ...admin, actorRole: 'agent' }, peer);
          assert.notDeepEqual(originalAdmin, admin);
          assert.deepEqual(admin.verified, x.verified);
          await denied(() => preview(x));
          await denied(() =>
            coordinator(() => scalar(db, 'SELECT app_media.read_processing($1)', [x.job])),
          );
          assert.deepEqual(await snapshot(db), before);
        } finally {
          await db.query(
            'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
            [T, AGENT],
          );
        }
      },
    );

    await t.test(
      'current role fingerprint changes even when the same viewer remains eligible',
      async () => {
        const x = await attached(102, { actor: ADMIN }),
          admin = await preview(x);
        await db.query(
          "UPDATE app_private.memberships SET role='agent' WHERE tenant_id=$1 AND user_id=$2",
          [T, ADMIN],
        );
        try {
          const before = await snapshot(db),
            agent = await preview(x);
          assert.equal(agent.actorRole, 'agent');
          assert.deepEqual({ ...admin, actorRole: 'agent' }, agent);
          assert.deepEqual(await snapshot(db), before);
        } finally {
          await db.query(
            "UPDATE app_private.memberships SET role='admin' WHERE tenant_id=$1 AND user_id=$2",
            [T, ADMIN],
          );
        }
      },
    );

    await t.test(
      'foreign, mixed tuples, customer, guest, unknown and unassigned viewers have identical unavailable errors',
      async () => {
        const x = await attached(103),
          other = await attached(104, { actor: OTHERADMIN, tenant: OTHER }),
          same = await attached(105),
          before = await snapshot(db);
        for (const options of [
          { actor: PEER },
          { actor: CUSTOMER },
          { actor: null },
          { actor: id(99900) },
          { actor: OTHERADMIN, tenant: OTHER },
          { actor: ADMIN, tenant: OTHER },
          { actor: ADMIN, media: other.media },
          { actor: ADMIN, media: same.media },
          { actor: ADMIN, listing: same.listing },
          { actor: ADMIN, revision: 2 },
          { actor: ADMIN, listing: id(99901) },
          { actor: ADMIN, media: id(99902) },
        ])
          await assert.rejects(
            () => preview(x, options),
            (error) => error.code === 'P0002' && error.message === 'Resource unavailable',
          );
        await denied(() => preview(other, { actor: ADMIN, tenant: T }));
        assert.deepEqual(await snapshot(db), before);
      },
    );

    await t.test(
      'current membership revocation and company disablement deny every read without changing history',
      async () => {
        const x = await attached(106);
        await db.query(
          'UPDATE app_private.memberships SET active=false,revoked_at=now() WHERE tenant_id=$1 AND user_id=$2',
          [T, AGENT],
        );
        try {
          const before = await snapshot(db);
          await denied(() => preview(x));
          assert.deepEqual(await snapshot(db), before);
        } finally {
          await db.query(
            'UPDATE app_private.memberships SET active=true,revoked_at=NULL WHERE tenant_id=$1 AND user_id=$2',
            [T, AGENT],
          );
        }
        await db.query('UPDATE app_private.tenants SET enabled=false WHERE id=$1', [T]);
        try {
          const before = await snapshot(db);
          await denied(() => preview(x));
          await denied(() => preview(x, { actor: ADMIN }));
          assert.deepEqual(await snapshot(db), before);
        } finally {
          await db.query('UPDATE app_private.tenants SET enabled=true WHERE id=$1', [T]);
        }
        assert.equal((await preview(x)).mediaId, x.media);
      },
    );

    await t.test(
      'accepted and unaccepted legacy metadata cannot become preview provenance',
      async () => {
        const x = await listing(107);
        for (const [position, accepted] of [
          [0, true],
          [1, false],
        ]) {
          const media = id(10700 + position);
          await db.query(
            `INSERT INTO app_private.revision_media(tenant_id,listing_id,revision_no,id,public_object_key,
          content_type,bytes,width,height,sha256,alt_text,position,accepted)
          VALUES($1,$2,1,$3,$4,'image/webp',100,100,100,$5,'Legacy metadata; no bytes',$6,$7)`,
            [T, x.listing, media, `legacy-preview/${media}.webp`, hash(media), position, accepted],
          );
          const before = await snapshot(db);
          await denied(() => preview({ ...x, media }));
          assert.deepEqual(await snapshot(db), before);
        }
      },
    );

    await t.test(
      'only eligible saved associations disclose stale versions and malformed arguments do not reserve anything',
      async () => {
        const x = await attached(108),
          before = await snapshot(db);
        for (const version of ['1', '2', '4', '9007199254740991'])
          await denied(() => preview(x, { version }), '40001');
        await denied(() => preview(x, { version: '1', actor: PEER }));
        await denied(() => preview(x, { version: '1', media: id(99903) }));
        for (const version of [null, '0', '-1', '9007199254740992', '9223372036854775807'])
          await denied(() => preview(x, { version }), '23514');
        for (const options of [
          { listing: null },
          { revision: null },
          { revision: 0 },
          { media: null },
        ])
          await denied(() => preview(x, options), '23514');
        assert.deepEqual(await snapshot(db), before);
      },
    );

    await t.test(
      'submitted photos remain unavailable through this draft-only boundary, including stale requests',
      async () => {
        const x = await attached(109);
        // Privileged workflow-state fixture only. This does not claim that the
        // four-photo submission gate or the normal submit command succeeded.
        await db.query(
          `UPDATE app_private.listing_revisions SET state='pending',submitted_at=now(),submitted_by=$2
        WHERE tenant_id=$3 AND listing_id=$1 AND revision_no=1`,
          [x.listing, AGENT, T],
        );
        const before = await snapshot(db);
        await denied(() => preview(x));
        await denied(() => preview(x, { version: '1', actor: ADMIN }));
        assert.deepEqual(await snapshot(db), before);
      },
    );

    await t.test(
      'removed association is denied while its applied history remains retained',
      async () => {
        const x = await attached(110),
          history = await snapshot(db);
        const removed = await api(AGENT, () =>
          scalar(db, 'SELECT app_api.remove_draft_media($1,1,$2,$3,$4)', [
            x.listing,
            x.version,
            id(6110),
            x.media,
          ]),
        );
        assert.equal(removed.outcome, 'applied');
        const before = await snapshot(db);
        await denied(() => preview(x));
        await denied(() => preview(x, { version: removed.version, actor: ADMIN }));
        assert.deepEqual(await snapshot(db), before);
        for (const table of [
          'media_jobs',
          'media_input_captures',
          'media_processing_leases',
          'media_verified_outputs',
          'media_attach_intents',
          'media_attach_results',
          'media_attachments',
        ])
          assert.deepEqual(before[table], history[table], table);
      },
    );

    await t.test(
      'missing or mismatched applied, capture, association and exact lease facts fail closed',
      async () => {
        const cases = [
          [
            'media_attach_results',
            'DELETE FROM app_private.media_attach_results WHERE operation_id=$1',
            (x) => [x.operation],
          ],
          [
            'revision_media',
            'UPDATE app_private.revision_media SET sealed_manifest_sha256=$2 WHERE id=$1',
            (x) => [x.media, 'f'.repeat(64)],
          ],
          [
            'revision_media',
            'UPDATE app_private.revision_media SET sealed_job_id=$2 WHERE id=$1',
            (x) => [x.media, id(99904)],
          ],
          [
            'media_input_captures',
            'UPDATE app_private.media_input_captures SET input_sha256=$2 WHERE job_id=$1',
            (x) => [x.job, 'e'.repeat(64)],
          ],
          [
            'media_input_captures',
            'DELETE FROM app_private.media_input_captures WHERE job_id=$1',
            (x) => [x.job],
          ],
          [
            'media_processing_leases',
            'UPDATE app_private.media_processing_leases SET lease_nonce=$2 WHERE job_id=$1',
            (x) => [x.job, id(99905)],
          ],
        ];
        for (const [index, [table, sql, args]] of cases.entries()) {
          const x = await attached(120 + index);
          await denied(
            () =>
              db.query('UPDATE app_private.revision_media SET sealed_job_id=$2 WHERE id=$1', [
                x.media,
                id(99906),
              ]),
            '23503',
          );
          // Deliberate bootstrap-only corruption attack. Ordinary constraints and
          // immutable triggers reject these states; this does not grant API DML.
          await db.exec(`ALTER TABLE app_private.${table} DISABLE TRIGGER ALL`);
          try {
            await db.query(sql, args(x));
          } finally {
            await db.exec(`ALTER TABLE app_private.${table} ENABLE TRIGGER ALL`);
          }
          const before = await snapshot(db);
          await denied(() => preview(x, { actor: ADMIN }));
          await denied(() => preview(x, { version: '1' }));
          assert.deepEqual(await snapshot(db), before);
        }
      },
    );

    await t.test(
      'read versions preserve the exact safe-integer boundary as a decimal string',
      async () => {
        const x = await attached(130);
        // Explicit bootstrap fixture, not a successful application save or token
        // adoption. The read contract uses a decimal string for every bigint.
        await db.exec('ALTER TABLE app_private.listing_revisions DISABLE TRIGGER touch_revision');
        try {
          await db.query(
            'UPDATE app_private.listing_revisions SET version=$2::bigint WHERE listing_id=$1',
            [x.listing, '9007199254740991'],
          );
        } finally {
          await db.exec('ALTER TABLE app_private.listing_revisions ENABLE TRIGGER touch_revision');
        }
        const before = await snapshot(db);
        assert.equal(
          (await preview(x, { version: '9007199254740991' })).version,
          '9007199254740991',
        );
        await denied(() => preview(x, { version: '9007199254740990' }), '40001');
        assert.deepEqual(await snapshot(db), before);
      },
    );

    await t.test(
      'only isolated API execution is granted, with fixed search path and no new private-table or worker authority',
      async () => {
        const signature = 'app_api.read_private_media_preview(uuid,integer,uuid,bigint)';
        const row = (
          await db.query(
            `SELECT p.prosecdef,p.provolatile,p.proconfig,r.rolname AS owner,
        has_function_privilege('api_runtime',p.oid,'EXECUTE') AS allowed,
        EXISTS(SELECT 1 FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') AS public_execute
        FROM pg_proc p JOIN pg_roles r ON r.oid=p.proowner WHERE p.oid=$1::regprocedure`,
            [signature],
          )
        ).rows[0];
        assert.deepEqual(row, {
          prosecdef: true,
          provolatile: 's',
          proconfig: ['search_path=pg_catalog'],
          owner: 'realtor_owner',
          allowed: true,
          public_execute: false,
        });
        assert.equal(
          await scalar(db, 'SELECT has_function_privilege($1,$2,$3)', [
            'media_coordinator',
            signature,
            'EXECUTE',
          ]),
          false,
        );
        assert.equal(
          await scalar(
            db,
            "SELECT pg_has_role('synthetic_media_preview_api','realtor_owner','MEMBER')",
          ),
          false,
        );
        assert.equal(
          await scalar(
            db,
            "SELECT pg_has_role('synthetic_media_preview_api','media_coordinator','MEMBER')",
          ),
          false,
        );
        for (const table of [
          'media_attach_intents',
          'media_attach_results',
          'media_attachments',
          'media_input_captures',
          'media_processing_leases',
          'media_verified_outputs',
        ])
          for (const privilege of ['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
            assert.equal(
              await scalar(db, 'SELECT has_table_privilege($1,$2,$3)', [
                'api_runtime',
                `app_private.${table}`,
                privilege,
              ]),
              false,
            );
        await denied(
          () => api(ADMIN, () => db.query('SELECT * FROM app_private.media_verified_outputs')),
          '42501',
        );
        await denied(() => api(ADMIN, () => db.exec('SET LOCAL ROLE realtor_owner')), '42501');
        await denied(
          () => api(ADMIN, () => db.query('SELECT app_media.read_processing($1)', [id(99907)])),
          '42501',
        );
        assert.equal(
          await scalar(db, "SELECT nullif(current_setting('realtor.actor_id',true),'')"),
          null,
        );
        assert.equal(
          await scalar(db, "SELECT nullif(current_setting('realtor.tenant_id',true),'')"),
          null,
        );
      },
    );
  } finally {
    await db.close();
  }
});
