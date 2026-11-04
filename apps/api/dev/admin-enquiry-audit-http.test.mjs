import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '@realtor/api-client';
import { T, ADMIN, AGENT } from '../../../database/tests/public-media-fixtures.mjs';
import { startAdminCommandFixture } from './admin-command-fixtures.mjs';

const id = (n) => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');

test('signed enquiry commands audit each applied mutation once with exact attribution', async () => {
  const fixture = await startAdminCommandFixture();
  try {
    const enquiry = id(9300);
    await fixture.db.query(
      `INSERT INTO app_private.enquiries
       (tenant_id,id,idempotency_key,contact_name,phone_e164,message,origin,notice_version,status)
       VALUES($1,$2,$2,'Synthetic Contact','+254700000001','Synthetic message','web','synthetic','new')`,
      [T, enquiry],
    );
    let requestId;
    const [client, foreignClient] = fixture.origins.map(
      (baseUrl) =>
        new RealtorApiClient({
          baseUrl,
          privacyNoticeVersion: 'settings-audit323',
          allowLoopbackHttp: true,
          fetch: async (url, init) => {
            const response = await fetch(url, init);
            requestId = response.headers.get('x-request-id');
            assert.ok(requestId);
            return response;
          },
        }),
    );
    const admin = { bearerToken: await fixture.token(ADMIN) };
    const agent = { bearerToken: await fixture.token(AGENT) };
    const foreign = { bearerToken: await fixture.token(id(20)) };
    const assignment = {
      operationId: id(9301),
      kind: 'assign',
      expectedVersion: '1',
      assignedAgentId: AGENT,
      status: null,
      nextActionAt: null,
      reason: null,
    };
    const contact = {
      operationId: id(9302),
      expectedVersion: '2',
      channel: 'call',
      outcome: 'connected',
      occurredAt: '2026-01-02T03:04:05.006Z',
      notes: 'Synthetic private contact note',
    };
    const transition = {
      operationId: id(9303),
      kind: 'transition',
      expectedVersion: '2',
      assignedAgentId: null,
      status: 'contacted',
      nextActionAt: '2026-10-12T00:00:00.000Z',
      reason: null,
    };
    const assigned = await client.applyEnquiryOperationV2(enquiry, assignment, admin);
    const assignmentRequest = requestId;
    assert.equal(assigned.result.version, '2');
    await assert.rejects(
      () => foreignClient.recordContactV2(enquiry, contact, foreign),
      (error) => error.status === 404,
    );
    const recorded = await client.recordContactV2(enquiry, contact, agent);
    const contactRequest = requestId;
    const moved = await client.applyEnquiryOperationV2(enquiry, transition, agent);
    const transitionRequest = requestId;
    assert.equal(moved.result.version, '3');
    assert.equal(moved.result.status, 'contacted');
    assert.deepEqual(await client.applyEnquiryOperationV2(enquiry, assignment, admin), assigned);
    assert.deepEqual(await client.recordContactV2(enquiry, contact, agent), recorded);
    assert.deepEqual(await client.getContactReceiptV2(enquiry, contact, agent), recorded);
    assert.deepEqual(await client.applyEnquiryOperationV2(enquiry, transition, agent), moved);
    const { rows } = await fixture.db.query(
      `SELECT tenant_id, actor_id, action, object_type, object_id, object_version::text,
              correlation_id, summary
       FROM app_private.audit_events WHERE object_id=$1 ORDER BY id`,
      [enquiry],
    );
    assert.deepEqual(
      rows,
      [
        [
          ADMIN,
          'enquiry.assign',
          '2',
          assignmentRequest,
          {
            operationId: assignment.operationId,
            kind: 'assign',
            status: 'assigned',
            assignedAgentId: AGENT,
          },
        ],
        [
          AGENT,
          'enquiry.contact_recorded',
          '2',
          contactRequest,
          { operationId: contact.operationId, channel: 'call', outcome: 'connected' },
        ],
        [
          AGENT,
          'enquiry.transition',
          '3',
          transitionRequest,
          {
            operationId: transition.operationId,
            kind: 'transition',
            status: 'contacted',
            assignedAgentId: AGENT,
          },
        ],
      ].map(([actor_id, action, object_version, correlation_id, summary]) => ({
        tenant_id: T,
        actor_id,
        action,
        object_type: 'enquiry',
        object_id: enquiry,
        object_version,
        correlation_id,
        summary,
      })),
    );
  } finally {
    await fixture.close();
  }
});
