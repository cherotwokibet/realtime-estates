import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { RealtorApiClient } from '@realtor/api-client';
import { startCustomerPreview } from './customer-preview.mjs';
import { prepareSyntheticMobileEnquiry } from '../../mobile/src/property-enquiry.ts';
import { requestSyntheticCustomerGrant } from '../../mobile/src/synthetic-customer-sign-in.ts';

test('a mobile viewing request hands off one enquiry to staff before a separate proposal for both brands', async () => {
  const original = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    for (const tenantSlug of ['realtime-estates', 'sample-homes']) {
      const preview = await startCustomerPreview({
        tenantSlug,
        mobileMode: 'synthetic-mobile-customer-v1',
        enquiryReplyFault: 'lost-first-enquiry-result-v1',
      });
      try {
        const config = {
          mode: 'synthetic-reference-public-v1',
          tenantSlug,
          apiOrigin: preview.origin,
          allowLoopbackHttp: true,
          customerMode: 'synthetic-mobile-customer-v1',
        };
        const attempt = prepareSyntheticMobileEnquiry(
          config,
          preview.listingId,
          'viewing',
          randomUUID(),
          fetch,
        );
        await assert.rejects(() => attempt.submit());
        assert.equal(attempt.state.status, 'uncertain');
        const { id } = await attempt.retryOriginal();
        assert.equal(await preview.enquiryCount(), 1);
        const api = new RealtorApiClient({
          baseUrl: preview.origin,
          allowLoopbackHttp: true,
          privacyNoticeVersion: 'synthetic-customer-preview-v1',
        });
        const staff = await preview.viewingStaff();
        assert.equal((await api.listStaffEnquiriesV2(staff.admin)).items[0].id, id);
        const enquiry = await api.getStaffEnquiryV2(id, staff.admin);
        assert.equal(enquiry.listingId, preview.listingId);
        assert.equal(enquiry.origin, 'mobile');
        assert.match(enquiry.message, /possible viewing/);
        assert.equal(enquiry.status, 'new');
        assert.deepEqual((await api.listViewingsV2(id, staff.admin)).items, []);
        const customer = await requestSyntheticCustomerGrant(
          preview.origin,
          preview.tenantId,
          'a',
          new AbortController().signal,
          fetch,
        );
        assert(customer);
        await assert.rejects(
          () => api.listViewingsV2(id, { bearerToken: customer.bearerToken }),
          (error) => error.status === 403,
        );
        const assignment = await api.applyEnquiryOperationV2(
          id,
          {
            operationId: randomUUID(),
            kind: 'assign',
            expectedVersion: enquiry.version,
            assignedAgentId: staff.agentId,
            status: null,
            nextActionAt: null,
            reason: null,
          },
          staff.admin,
        );
        assert.equal(assignment.outcome, 'applied');
        const command = {
          operationId: randomUUID(),
          expectedEnquiryVersion: assignment.result.version,
          listingId: preview.listingId,
          preferredSlots: [],
          notes: 'Synthetic mobile viewing follow-up.',
        };
        await assert.rejects(
          () => api.requestViewingV2(id, command, { bearerToken: customer.bearerToken }),
          (error) => error.status === 403,
        );
        assert.deepEqual((await api.listViewingsV2(id, staff.admin)).items, []);
        const requested = await api.requestViewingV2(id, command, staff.agent);
        assert.equal(requested.result.status, 'requested');
        assert.equal(requested.result.proposedSlot, null);
        assert.deepEqual(
          await api.getViewingReceiptV2(id, { kind: 'request', command }, staff.agent),
          requested,
        );
        const slot = {
          startAt: '2090-01-01T09:00:00.000Z',
          endAt: '2090-01-01T10:00:00.000Z',
          timeZone: 'Africa/Nairobi',
        };
        const proposed = await api.proposeViewingV2(
          id,
          requested.viewingId,
          {
            operationId: randomUUID(),
            expectedVersion: requested.result.version,
            slot,
          },
          staff.agent,
        );
        assert.equal(proposed.result.status, 'proposed');
        assert.deepEqual(proposed.result.proposedSlot, slot);
        const current = await api.getViewingV2(id, requested.viewingId, staff.agent);
        assert.equal(current.schedule.status, 'proposed');
        assert.equal(current.schedule.agreement ?? null, null);
      } finally {
        await preview.close();
      }
    }
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
});
