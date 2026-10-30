import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '../dist/index.js';
import { startStaffPreview } from '../../../apps/api/dev/staff-preview.mjs';
const modes = {
  port: 0,
  publicReportMode: 'synthetic-listing-report-v1',
  referenceDraftMode: 'synthetic-reference-draft-v1',
  referenceModerationMode: 'synthetic-reference-transition-v1',
  referencePublicMode: 'synthetic-reference-public-v1',
};
const client = (p) =>
  new RealtorApiClient({
    baseUrl: p.origin,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    allowLoopbackHttp: true,
  });
test('actual signed HTTP/restricted SQL captures anonymously then admin reviews once and recovers both originals', async () => {
  const p = await startStaffPreview({ ...modes, actor: 'admin' });
  try {
    const api = client(p),
      command = {
        policy: 'listing-report-command-v1',
        operationId: randomUUID(),
        listingId: p.referencePublicListingId,
        reason: 'other',
        details: 'Synthetic report integration only; no real accusation.',
      };
    const ack = await api.captureListingReport(command);
    assert.equal(ack.status, 'recorded');
    assert.deepEqual(
      await api.getListingReportReceipt(command.listingId, command.operationId),
      ack,
    );
    const auth = { bearerToken: p.bearerToken };
    const queue = await api.listListingReports({ limit: 2, status: 'new' }, auth);
    assert.equal(queue.items.length, 1);
    assert.equal(queue.items[0].details, command.details);
    const decision = {
      policy: 'listing-report-decision-command-v1',
      operationId: randomUUID(),
      reportId: queue.items[0].reportId,
      expectedVersion: '1',
      decision: 'reviewed',
      reason: 'Synthetic admin review only.',
    };
    const saved = await api.decideListingReport(decision, auth);
    assert.equal(saved.version, '2');
    assert.deepEqual(
      await api.getListingReportDecision(decision.reportId, decision.operationId, auth),
      saved,
    );
    assert.deepEqual(await api.decideListingReport(decision, auth), saved);
    assert.equal((await api.listListingReports({ status: 'new' }, auth)).items.length, 0);
    assert.equal((await api.listListingReports({ status: 'reviewed' }, auth)).items.length, 1);
    assert.deepEqual(
      await api.getListingReportReceipt(command.listingId, command.operationId),
      ack,
    );
  } finally {
    await p.close();
  }
});
test('actual signed agent cannot read/review reports; altered signature is refused and guest original remains minimal', async () => {
  const p = await startStaffPreview({ ...modes, actor: 'agent' });
  try {
    const api = client(p),
      command = {
        policy: 'listing-report-command-v1',
        operationId: randomUUID(),
        listingId: p.referencePublicListingId,
        reason: 'wrong_price',
        details: null,
      };
    const ack = await api.captureListingReport(command);
    assert.deepEqual(Object.keys(ack).sort(), [
      'listingId',
      'operationId',
      'policy',
      'recordedAt',
      'status',
    ]);
    await assert.rejects(
      () => api.listListingReports({}, { bearerToken: p.bearerToken }),
      (e) => e.status === 403,
    );
    await assert.rejects(
      () => api.listListingReports({}, { bearerToken: p.bearerToken + 'x' }),
      (e) => e.status === 401,
    );
    await assert.rejects(
      () =>
        api.decideListingReport(
          {
            policy: 'listing-report-decision-command-v1',
            operationId: randomUUID(),
            reportId: randomUUID(),
            expectedVersion: '1',
            decision: 'dismissed',
            reason: 'Synthetic unauthorized review.',
          },
          { bearerToken: p.bearerToken },
        ),
      (e) => e.status === 403,
    );
  } finally {
    await p.close();
  }
});
