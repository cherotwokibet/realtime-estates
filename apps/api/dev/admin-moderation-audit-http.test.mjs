import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '@realtor/api-client';
import {
  createDraft,
  seedMedia,
  asActor,
  T,
  ADMIN,
  AGENT,
  LISTING,
} from '../../../database/tests/public-media-fixtures.mjs';
import { startAdminCommandFixture } from './admin-command-fixtures.mjs';

const otherListing = '00000000-0000-4000-8000-000000000101';
const selfListing = '00000000-0000-4000-8000-000000000102';
const foreignAdmin = '00000000-0000-4000-8000-000000000020';

test('signed draft save, submission and both moderation decisions retain exact audit attribution', async () => {
  const fixture = await startAdminCommandFixture();
  try {
    const trace = [];
    const clients = fixture.origins.map(
      (baseUrl) =>
        new RealtorApiClient({
          baseUrl,
          privacyNoticeVersion: 'moderation-audit325',
          allowLoopbackHttp: true,
          fetch: async (url, init) => {
            const result = await fetch(url, init);
            trace.push(result.headers.get('x-request-id'));
            return result;
          },
        }),
    );
    const [client, foreignClient] = clients;
    const agent = { bearerToken: await fixture.token(AGENT) };
    const admin = { bearerToken: await fixture.token(ADMIN) };
    const foreign = { bearerToken: await fixture.token(foreignAdmin) };
    const audit = async (listingId) =>
      (
        await fixture.db.query(
          'SELECT tenant_id, actor_id, action, object_id, object_version::text, correlation_id, summary FROM app_private.audit_events WHERE object_id=$1 ORDER BY id',
          [listingId],
        )
      ).rows;
    const snapshot = async (listingId) => {
      const { rows } = await fixture.db.query(
        `SELECT to_jsonb(l) AS listing, to_jsonb(r) AS revision, to_jsonb(s) AS published
           FROM app_private.listings l
           JOIN app_private.listing_revisions r ON r.tenant_id=l.tenant_id AND r.listing_id=l.id AND r.revision_no=1
           LEFT JOIN app_private.public_snapshots s ON s.tenant_id=l.tenant_id AND s.listing_id=l.id
           WHERE l.tenant_id=$1 AND l.id=$2`,
        [T, listingId],
      );
      return rows[0];
    };

    for (const [listingId, decision, authorId] of [
      [LISTING, 'approve', AGENT],
      [otherListing, 'reject', AGENT],
      [selfListing, 'approve', ADMIN],
    ]) {
      const author = authorId === ADMIN ? admin : agent;
      await createDraft(fixture.db, listingId, authorId);
      await seedMedia(fixture.db, listingId);
      await asActor(fixture.db, T, authorId, () =>
        fixture.db.query("SELECT app_api.confirm_availability($1,1,'available')", [listingId]),
      );
      const baseline = await audit(listingId);
      const draft = await client.getStaffDraftV2(listingId, 1, author);
      const draftInput = {
        expectedVersion: draft.version,
        content: { ...draft.content, title: 'Synthetic signed moderation ' + decision },
      };
      const beforeSave = await snapshot(listingId);
      await assert.rejects(
        () => foreignClient.saveStaffDraftV2(listingId, 1, draftInput, foreign),
        (error) => error.status === 404,
      );
      assert.deepEqual(await snapshot(listingId), beforeSave);
      const saved = await client.saveStaffDraftV2(listingId, 1, draftInput, author);
      const saveId = trace.at(-1);
      const submitted = await client.submitStaffDraftV2(
        listingId,
        1,
        { expectedVersion: saved.version },
        author,
      );
      const submitId = trace.at(-1);
      const input = {
        expectedVersion: submitted.version,
        decision,
        reason: decision === 'reject' ? 'Synthetic review correction required.' : null,
      };
      const beforeDenials = await audit(listingId);
      const pendingState = await snapshot(listingId);
      await assert.rejects(
        () => client.decideReviewV2(listingId, 1, input, agent),
        (error) => error.status === 403,
      );
      await assert.rejects(
        () => foreignClient.decideReviewV2(listingId, 1, input, foreign),
        (error) => error.status === 404,
      );
      assert.deepEqual(await audit(listingId), beforeDenials);
      assert.deepEqual(await snapshot(listingId), pendingState);
      const decided = await client.decideReviewV2(listingId, 1, input, admin);
      const decisionId = trace.at(-1);
      assert.equal(decided.state, decision === 'approve' ? 'approved' : 'rejected');
      const decidedState = await snapshot(listingId);
      assert.equal(decidedState.revision.state, decided.state);
      assert.equal(decidedState.revision.decision_reason, input.reason);
      assert.equal(
        decidedState.published?.title ?? null,
        decision === 'approve' ? draftInput.content.title : null,
      );
      await assert.rejects(
        () => client.decideReviewV2(listingId, 1, input, admin),
        (error) => error.status === 409,
      );
      assert.deepEqual(await snapshot(listingId), decidedState);
      assert.deepEqual(
        (await audit(listingId)).slice(baseline.length),
        [
          [authorId, 'revision.saved', saved.version, saveId, { revision: 1, contract: 'v2' }],
          [authorId, 'revision.submitted', submitted.version, submitId, { revision: 1 }],
          [
            ADMIN,
            'revision.' + decided.state,
            decided.version,
            decisionId,
            { revision: 1, selfApproval: authorId === ADMIN },
          ],
        ].map(([actor_id, action, object_version, correlation_id, summary]) => ({
          tenant_id: T,
          actor_id,
          action,
          object_id: listingId,
          object_version,
          correlation_id,
          summary,
        })),
      );
    }
  } finally {
    await fixture.close();
  }
});
