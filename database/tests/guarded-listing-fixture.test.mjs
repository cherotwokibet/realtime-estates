import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { applyTestMigrations } from '../test-helpers/migrations.mjs';
import { seedGuardedListingDraft } from '../test-helpers/guarded-listing-fixture.mjs';

test('preview seed uses authorized guarded creation with the proposed allocation restriction', async () => {
  const db = new PGlite();
  const tenant = '00000000-0000-4000-8000-000000000001';
  const agent = '00000000-0000-4000-8000-000000000011';
  const listing = '00000000-0000-4000-8000-000000000100';
  try {
    await applyTestMigrations(db);
    await db.exec(
      await readFile(
        new URL('../proposals/0024_guarded_draft_allocation.sql', import.meta.url),
        'utf8',
      ),
    );
    await db.query(
      "INSERT INTO app_private.tenants(id,slug,display_name) VALUES($1,'synthetic-guarded-seed','Synthetic guarded seed')",
      [tenant],
    );
    await db.query(
      "INSERT INTO app_private.memberships(tenant_id,user_id,role) VALUES($1,$2,'agent')",
      [tenant, agent],
    );
    await db.exec('BEGIN; SET LOCAL ROLE api_runtime');
    await db.query(
      "SELECT set_config('realtor.tenant_id',$1,true),set_config('realtor.actor_id',$2,true)",
      [tenant, agent],
    );
    const receipt = await seedGuardedListingDraft(db, {
      listingId: listing,
      slug: 'synthetic-guarded-seed',
      actorId: agent,
      content: {
        title: 'Synthetic seed',
        pricing: { declaration: 'not_declared', charges: [] },
        location: { county: null, town: null, area: null },
      },
    });
    assert.equal(receipt.outcome, 'created');
    assert.equal(receipt.actorId, agent);
    assert.equal(receipt.result.revisionVersion, '2');
    await db.exec('COMMIT');
    const row = (
      await db.query(
        'SELECT created_by_id,assigned_agent_id FROM app_private.listings WHERE id=$1',
        [listing],
      )
    ).rows[0];
    assert.deepEqual(row, { created_by_id: agent, assigned_agent_id: agent });
    assert.equal(
      (
        await db.query(
          'SELECT count(*)::integer AS count FROM app_private.listing_revisions WHERE listing_id=$1',
          [listing],
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});
