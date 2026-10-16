import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { startStaffPreview } from '../../../apps/api/dev/staff-preview.mjs';
import { RealtorApiClient, ApiClientError } from '../dist/index.js';
const slot = {
  startAt: '2090-01-01T09:00:00.000Z',
  endAt: '2090-01-01T10:00:00.000Z',
  timeZone: 'Africa/Nairobi',
};
const denied = (status) => (e) =>
  e instanceof ApiClientError && e.kind === 'HTTP' && e.status === status && !e.submissionUncertain;

test('signed rescheduling recovers a discarded commit,requires new agreements and retains repeated-cycle history through current access loss', async () => {
  const preview = await startStaffPreview({
    port: 0,
    enquiryPreview: 'synthetic-v1',
    enquiryCatalogue: 'synthetic-v1',
  });
  try {
    const make = (fetch) =>
        new RealtorApiClient({
          baseUrl: preview.origin,
          allowLoopbackHttp: true,
          privacyNoticeVersion: 'synthetic-staff-notice-v1',
          ...(fetch ? { fetch } : {}),
        }),
      api = make(),
      admin = { bearerToken: preview.enquiryStaff.admin.bearerToken },
      agent = { bearerToken: preview.enquiryStaff.agent.bearerToken },
      enquiry = preview.enquiryFixtures.assigned;
    const requested = await api.requestViewingV2(
        enquiry,
        {
          operationId: randomUUID(),
          expectedEnquiryVersion: '2',
          listingId: preview.listingId,
          preferredSlots: [],
          notes: 'Synthetic viewing before repeated reschedules.',
        },
        agent,
      ),
      viewing = requested.viewingId;
    const proposal = { operationId: randomUUID(), expectedVersion: '1', slot },
      proposed = await api.proposeViewingV2(enquiry, viewing, proposal, agent),
      phone = {
        operationId: randomUUID(),
        expectedVersion: '2',
        slot,
        channel: 'phone',
        agreedAt: proposed.completedAt,
        notes: 'Original first-slot agreement.',
      },
      first = await api.confirmViewingV2(enquiry, viewing, phone, agent);
    const secondSlot = {
        ...slot,
        startAt: '2090-01-02T09:00:00.000Z',
        endAt: '2090-01-02T10:00:00.000Z',
      },
      thirdSlot = {
        ...slot,
        startAt: '2090-01-03T09:00:00.000Z',
        endAt: '2090-01-03T10:00:00.000Z',
      },
      move = {
        operationId: randomUUID(),
        expectedVersion: '3',
        slot: secondSlot,
        reason: '  Synthetic time change.\nRetain exact original reason.  ',
      };
    let writes = 0;
    const lost = make(async (url, init) => {
      const response = await fetch(url, init);
      if (init.method === 'POST' && url.endsWith('/reschedules')) {
        writes++;
        assert.equal(response.status, 200);
        await response.arrayBuffer();
        throw new Error('Synthetic discarded committed reschedule reply');
      }
      return response;
    });
    await assert.rejects(
      () => lost.rescheduleViewingV2(enquiry, viewing, move, agent),
      (e) => e instanceof ApiClientError && e.kind === 'NETWORK' && e.submissionUncertain,
    );
    assert.equal(writes, 1);
    const second = await api.getViewingRescheduleReceiptV2(enquiry, viewing, move, agent);
    assert.equal(second.result.version, '4');
    assert.equal(second.result.cycle.number, '2');
    assert.equal(second.result.cycle.reason, move.reason);
    assert.equal(Object.hasOwn(second.result, 'agreement'), false);
    assert.equal(
      Object.hasOwn(await api.getViewingV2(enquiry, viewing, agent), 'confirmation'),
      false,
    );
    assert.deepEqual(
      await api.getViewingConfirmationReceiptV2(enquiry, viewing, phone, agent),
      first,
    );
    assert.deepEqual(
      await api.getViewingReceiptV2(
        enquiry,
        { kind: 'propose', viewingId: viewing, command: proposal },
        agent,
      ),
      proposed,
    );
    assert.equal((await api.getStaffEnquiryV2(enquiry, agent)).version, '2');
    const stale = await api.rescheduleViewingV2(
      enquiry,
      viewing,
      { ...move, operationId: randomUUID(), slot: thirdSlot },
      admin,
    );
    assert.equal(stale.outcome, 'conflict');
    assert.equal(stale.observedVersion, '4');
    const directory = await api.listEnquiryAssigneesV2(admin),
      peer = directory.items.find(
        (x) => x.role === 'agent' && x.userId !== preview.enquiryStaff.agent.actorId,
      ).userId;
    await api.applyEnquiryOperationV2(
      enquiry,
      {
        operationId: randomUUID(),
        kind: 'assign',
        expectedVersion: '2',
        assignedAgentId: peer,
        status: null,
        nextActionAt: null,
        reason: null,
      },
      admin,
    );
    await assert.rejects(
      () => api.getViewingRescheduleReceiptV2(enquiry, viewing, move, agent),
      denied(404),
    );
    await assert.rejects(() => api.getViewingHistoryV2(enquiry, viewing, agent), denied(404));
    await api.applyEnquiryOperationV2(
      enquiry,
      {
        operationId: randomUUID(),
        kind: 'assign',
        expectedVersion: '3',
        assignedAgentId: preview.enquiryStaff.agent.actorId,
        status: null,
        nextActionAt: null,
        reason: null,
      },
      admin,
    );
    assert.deepEqual(await api.rescheduleViewingV2(enquiry, viewing, move, agent), second);
    assert.deepEqual(await api.confirmViewingV2(enquiry, viewing, phone, agent), first);
    const wrong = await api.confirmViewingV2(
      enquiry,
      viewing,
      { ...phone, operationId: randomUUID(), expectedVersion: '4', agreedAt: second.completedAt },
      agent,
    );
    assert.equal(wrong.reason, 'PROPOSED_SLOT_MISMATCH');
    const secondPhone = {
        operationId: randomUUID(),
        expectedVersion: '4',
        slot: secondSlot,
        channel: 'phone',
        agreedAt: second.completedAt,
        notes: 'New agreement for second exact slot.',
      },
      secondConfirmed = await api.confirmViewingV2(enquiry, viewing, secondPhone, agent);
    assert.equal(secondConfirmed.result.version, '5');
    assert.equal(
      (await api.getViewingV2(enquiry, viewing, agent)).confirmation.proposedAt,
      second.completedAt,
    );
    const thirdMove = {
        operationId: randomUUID(),
        expectedVersion: '5',
        slot: thirdSlot,
        reason: 'Synthetic third proposal.',
      },
      third = await api.rescheduleViewingV2(enquiry, viewing, thirdMove, agent);
    assert.equal(third.result.version, '6');
    assert.equal(third.result.cycle.number, '3');
    assert.equal(Object.hasOwn(third.result, 'agreement'), false);
    const thirdConfirmed = await api.confirmViewingV2(
        enquiry,
        viewing,
        {
          operationId: randomUUID(),
          expectedVersion: '6',
          slot: thirdSlot,
          channel: 'phone',
          agreedAt: third.completedAt,
          notes: 'Separate agreement for third slot.',
        },
        agent,
      ),
      ended = await api.terminateViewingV2(
        enquiry,
        viewing,
        'cancel',
        {
          operationId: randomUUID(),
          expectedVersion: '7',
          reason: 'Synthetic final cancellation.',
        },
        agent,
      );
    assert.equal(thirdConfirmed.result.version, '7');
    assert.equal(ended.result.version, '8');
    const savedHistory = await api.getViewingHistoryV2(enquiry, viewing, admin);
    assert.deepEqual(
      savedHistory.items.map((x) => x.schedule.version),
      ['8', '7', '6', '5', '4', '3', '2', '1'],
    );
    assert.deepEqual(savedHistory.items[5].schedule.agreement, first.result.agreement);
    assert.deepEqual(savedHistory.items[3].schedule.agreement, secondConfirmed.result.agreement);
    assert.deepEqual(savedHistory.items[0].schedule.agreement, thirdConfirmed.result.agreement);
    assert.deepEqual(
      await api.getViewingRescheduleReceiptV2(enquiry, viewing, move, agent),
      second,
    );
    assert.deepEqual(await api.rescheduleViewingV2(enquiry, viewing, thirdMove, agent), third);
    assert.equal((await api.listViewingsV2(enquiry, agent)).items.length, 1);
    assert.equal((await api.getStaffEnquiryV2(enquiry, agent)).version, '4');
  } finally {
    await preview.close();
  }
});

test('signed terminal workflow recovers a discarded committed reply and retains original phone evidence through access loss', async () => {
  const preview = await startStaffPreview({
    port: 0,
    enquiryPreview: 'synthetic-v1',
    enquiryCatalogue: 'synthetic-v1',
  });
  try {
    const make = (fetch) =>
        new RealtorApiClient({
          baseUrl: preview.origin,
          allowLoopbackHttp: true,
          privacyNoticeVersion: 'synthetic-staff-notice-v1',
          ...(fetch ? { fetch } : {}),
        }),
      api = make(),
      admin = { bearerToken: preview.enquiryStaff.admin.bearerToken },
      agent = { bearerToken: preview.enquiryStaff.agent.bearerToken },
      enquiry = preview.enquiryFixtures.assigned;
    const request = {
        operationId: randomUUID(),
        expectedEnquiryVersion: '2',
        listingId: preview.listingId,
        preferredSlots: [],
        notes: 'Synthetic interest retained after cancellation.',
      },
      requested = await api.requestViewingV2(enquiry, request, agent);
    const proposal = { operationId: randomUUID(), expectedVersion: '1', slot },
      proposed = await api.proposeViewingV2(enquiry, requested.viewingId, proposal, agent);
    const phone = {
        operationId: randomUUID(),
        expectedVersion: '2',
        slot,
        channel: 'phone',
        agreedAt: proposed.completedAt,
        notes: '  Synthetic original phone agreement.  ',
      },
      confirmed = await api.confirmViewingV2(enquiry, requested.viewingId, phone, agent);
    const before = await api.getViewingV2(enquiry, requested.viewingId, agent),
      ending = {
        operationId: randomUUID(),
        expectedVersion: '3',
        reason: '  Synthetic customer cancellation.\nKeep exact reason.  ',
      };
    let writes = 0;
    const lost = make(async (url, init) => {
      const response = await fetch(url, init);
      if (init.method === 'POST' && url.endsWith('/cancellations')) {
        writes++;
        assert.equal(response.status, 200);
        await response.arrayBuffer();
        throw new Error('Synthetic discarded committed cancellation reply');
      }
      return response;
    });
    await assert.rejects(
      () => lost.terminateViewingV2(enquiry, requested.viewingId, 'cancel', ending, agent),
      (e) => e instanceof ApiClientError && e.kind === 'NETWORK' && e.submissionUncertain,
    );
    assert.equal(writes, 1);
    const original = await api.getViewingTerminationReceiptV2(
      enquiry,
      requested.viewingId,
      'cancel',
      ending,
      agent,
    );
    assert.equal(original.result.status, 'cancelled');
    assert.equal(original.result.version, '4');
    assert.equal(original.result.termination.reason, ending.reason);
    assert.deepEqual(original.result.agreement, confirmed.result.agreement);
    assert.deepEqual(
      await api.terminateViewingV2(enquiry, requested.viewingId, 'cancel', ending, agent),
      original,
    );
    const savedHistory = await api.getViewingHistoryV2(enquiry, requested.viewingId, admin);
    assert.equal(savedHistory.currentVersion, '4');
    assert.deepEqual(
      savedHistory.items.map((x) => x.kind),
      ['cancel', 'confirm', 'propose', 'request'],
    );
    assert.deepEqual(savedHistory.items[1].schedule.agreement, confirmed.result.agreement);
    assert.equal(JSON.stringify(savedHistory).includes(ending.operationId), false);
    const partial = await api.getViewingHistoryV2(enquiry, requested.viewingId, {
      ...admin,
      limit: 2,
    });
    assert.equal(partial.truncated, true);
    assert.deepEqual(
      partial.items.map((x) => x.schedule.version),
      ['4', '3'],
    );
    const after = await api.getViewingV2(enquiry, requested.viewingId, admin);
    assert.deepEqual(after.confirmation, before.confirmation);
    assert.equal(after.notes, before.notes);
    assert.equal(after.terminationRecord.recordedById, preview.enquiryStaff.agent.actorId);
    assert.equal((await api.listViewingsV2(enquiry, agent)).items.length, 1);
    assert.equal((await api.getStaffEnquiryV2(enquiry, admin)).version, '2');
    assert.deepEqual(
      await api.getViewingReceiptV2(enquiry, { kind: 'request', command: request }, agent),
      requested,
    );
    assert.deepEqual(
      await api.getViewingReceiptV2(
        enquiry,
        { kind: 'propose', viewingId: requested.viewingId, command: proposal },
        agent,
      ),
      proposed,
    );
    assert.deepEqual(
      await api.getViewingConfirmationReceiptV2(enquiry, requested.viewingId, phone, agent),
      confirmed,
    );
    await assert.rejects(
      () =>
        api.terminateViewingV2(
          enquiry,
          requested.viewingId,
          'cancel',
          { ...ending, reason: 'changed' },
          agent,
        ),
      denied(409),
    );
    await assert.rejects(
      () =>
        api.getViewingTerminationReceiptV2(enquiry, requested.viewingId, 'cancel', ending, admin),
      denied(404),
    );
    const directory = await api.listEnquiryAssigneesV2(admin),
      peer = directory.items.find(
        (x) => x.role === 'agent' && x.userId !== preview.enquiryStaff.agent.actorId,
      ).userId;
    await api.applyEnquiryOperationV2(
      enquiry,
      {
        operationId: randomUUID(),
        kind: 'assign',
        expectedVersion: '2',
        assignedAgentId: peer,
        status: null,
        nextActionAt: null,
        reason: null,
      },
      admin,
    );
    await assert.rejects(
      () =>
        api.getViewingTerminationReceiptV2(enquiry, requested.viewingId, 'cancel', ending, agent),
      denied(404),
    );
    await assert.rejects(
      () => api.getViewingHistoryV2(enquiry, requested.viewingId, agent),
      denied(404),
    );
    assert.equal(
      (await api.getViewingHistoryV2(enquiry, requested.viewingId, admin)).currentVersion,
      '4',
    );
    await api.applyEnquiryOperationV2(
      enquiry,
      {
        operationId: randomUUID(),
        kind: 'assign',
        expectedVersion: '3',
        assignedAgentId: preview.enquiryStaff.agent.actorId,
        status: null,
        nextActionAt: null,
        reason: null,
      },
      admin,
    );
    assert.deepEqual(
      await api.terminateViewingV2(enquiry, requested.viewingId, 'cancel', ending, agent),
      original,
    );
    assert.equal((await api.getStaffEnquiryV2(enquiry, agent)).version, '4');
    assert.equal((await api.listViewingsV2(enquiry, agent)).items.length, 1);
    const declined = await api.terminateViewingV2(
      enquiry,
      requested.viewingId,
      'decline',
      {
        operationId: randomUUID(),
        expectedVersion: '4',
        reason: 'Synthetic decline after ending.',
      },
      agent,
    );
    assert.equal(declined.outcome, 'refused');
    assert.equal(declined.reason, 'INVALID_STATE');
    assert.equal(
      (await api.getViewingV2(enquiry, requested.viewingId, agent)).schedule.status,
      'cancelled',
    );
    const nextRequest = { ...request, operationId: randomUUID(), expectedEnquiryVersion: '4' },
      next = await api.requestViewingV2(enquiry, nextRequest, agent),
      declineCommand = {
        operationId: randomUUID(),
        expectedVersion: '1',
        reason: 'Synthetic pre-proposal decline.',
      },
      decline = await api.terminateViewingV2(
        enquiry,
        next.viewingId,
        'decline',
        declineCommand,
        agent,
      );
    assert.equal(decline.result.status, 'declined');
    assert.equal(decline.result.version, '2');
    assert.deepEqual(
      await api.getViewingTerminationReceiptV2(
        enquiry,
        next.viewingId,
        'decline',
        declineCommand,
        agent,
      ),
      decline,
    );
  } finally {
    await preview.close();
  }
});
test('signed phone confirmation recovers a lost committed result and preserves historical proposals/current access', async () => {
  const preview = await startStaffPreview({
    port: 0,
    enquiryPreview: 'synthetic-v1',
    enquiryCatalogue: 'synthetic-v1',
  });
  try {
    const make = (fetch) =>
        new RealtorApiClient({
          baseUrl: preview.origin,
          allowLoopbackHttp: true,
          privacyNoticeVersion: 'synthetic-staff-notice-v1',
          ...(fetch ? { fetch } : {}),
        }),
      api = make(),
      admin = { bearerToken: preview.enquiryStaff.admin.bearerToken },
      agent = { bearerToken: preview.enquiryStaff.agent.bearerToken },
      enquiry = preview.enquiryFixtures.assigned;
    const request = {
        operationId: randomUUID(),
        expectedEnquiryVersion: '2',
        listingId: preview.listingId,
        preferredSlots: [],
        notes: 'Synthetic request before agreement.',
      },
      requested = await api.requestViewingV2(enquiry, request, agent);
    const proposal = { operationId: randomUUID(), expectedVersion: '1', slot },
      proposed = await api.proposeViewingV2(enquiry, requested.viewingId, proposal, agent);
    const command = {
      operationId: randomUUID(),
      expectedVersion: '2',
      slot,
      channel: 'phone',
      agreedAt: proposed.completedAt,
      notes: '  Fictional phone agreement.\nExact original evidence.  ',
    };
    let writes = 0;
    const lost = make(async (url, init) => {
      const response = await fetch(url, init);
      if (init.method === 'POST' && url.endsWith('/confirmations')) {
        writes++;
        assert.equal(response.status, 200);
        await response.arrayBuffer();
        throw new Error('Synthetic loss after committed confirmation');
      }
      return response;
    });
    await assert.rejects(
      () => lost.confirmViewingV2(enquiry, requested.viewingId, command, agent),
      (e) => e.submissionUncertain && e.kind === 'NETWORK',
    );
    assert.equal(writes, 1);
    const receipt = await api.getViewingConfirmationReceiptV2(
      enquiry,
      requested.viewingId,
      command,
      agent,
    );
    assert.equal(receipt.result.status, 'confirmed');
    assert.equal(receipt.result.version, '3');
    assert.equal(receipt.result.agreement.notes, command.notes);
    assert.deepEqual(
      await api.confirmViewingV2(enquiry, requested.viewingId, command, agent),
      receipt,
    );
    assert.deepEqual(
      await api.getViewingReceiptV2(enquiry, { kind: 'request', command: request }, agent),
      requested,
    );
    assert.deepEqual(
      await api.getViewingReceiptV2(
        enquiry,
        { kind: 'propose', viewingId: requested.viewingId, command: proposal },
        agent,
      ),
      proposed,
    );
    const detail = await api.getViewingV2(enquiry, requested.viewingId, admin);
    assert.equal(detail.confirmation.recordedById, preview.enquiryStaff.agent.actorId);
    assert.equal(detail.confirmation.proposedAt, proposed.completedAt);
    assert.equal((await api.listViewingsV2(enquiry, agent)).items.length, 1);
    assert.equal((await api.getStaffEnquiryV2(enquiry, admin)).version, '2');
    await assert.rejects(
      () =>
        api.confirmViewingV2(enquiry, requested.viewingId, { ...command, notes: 'changed' }, agent),
      denied(409),
    );
    await assert.rejects(
      () => api.getViewingConfirmationReceiptV2(enquiry, requested.viewingId, command, admin),
      denied(404),
    );
    const directory = await api.listEnquiryAssigneesV2(admin),
      peer = directory.items.find(
        (x) => x.role === 'agent' && x.userId !== preview.enquiryStaff.agent.actorId,
      ).userId;
    await api.applyEnquiryOperationV2(
      enquiry,
      {
        operationId: randomUUID(),
        kind: 'assign',
        expectedVersion: '2',
        assignedAgentId: peer,
        status: null,
        nextActionAt: null,
        reason: null,
      },
      admin,
    );
    await assert.rejects(
      () => api.getViewingConfirmationReceiptV2(enquiry, requested.viewingId, command, agent),
      denied(404),
    );
    await api.applyEnquiryOperationV2(
      enquiry,
      {
        operationId: randomUUID(),
        kind: 'assign',
        expectedVersion: '3',
        assignedAgentId: preview.enquiryStaff.agent.actorId,
        status: null,
        nextActionAt: null,
        reason: null,
      },
      admin,
    );
    assert.deepEqual(
      await api.confirmViewingV2(enquiry, requested.viewingId, command, agent),
      receipt,
    );
    assert.equal((await api.getStaffEnquiryV2(enquiry, agent)).version, '4');
    assert.equal((await api.listViewingsV2(enquiry, agent)).items.length, 1);
  } finally {
    await preview.close();
  }
});
test('signed viewing SDK preserves original committed receipts,replay and current assignment over real HTTP/restricted SQL', async () => {
  const preview = await startStaffPreview({
    port: 0,
    enquiryPreview: 'synthetic-v1',
    enquiryCatalogue: 'synthetic-v1',
    actor: 'other-company-admin',
  });
  try {
    const make = (fetch) =>
        new RealtorApiClient({
          baseUrl: preview.origin,
          allowLoopbackHttp: true,
          privacyNoticeVersion: 'synthetic-staff-notice-v1',
          ...(fetch ? { fetch } : {}),
        }),
      api = make();
    const admin = { bearerToken: preview.enquiryStaff.admin.bearerToken },
      agent = { bearerToken: preview.enquiryStaff.agent.bearerToken },
      enquiry = preview.enquiryFixtures.assigned;
    const command = {
      operationId: randomUUID(),
      expectedEnquiryVersion: '2',
      listingId: preview.listingId,
      preferredSlots: [slot],
      notes: '  Fictional signed viewing request.\nKeep original notes.  ',
    };
    let writes = 0;
    const lost = make(async (url, init) => {
      const response = await fetch(url, init);
      if (init.method === 'POST' && url.endsWith('/viewings')) {
        writes++;
        assert.equal(response.status, 200);
        await response.arrayBuffer();
        throw new Error('Synthetic loss after committed HTTP reply');
      }
      return response;
    });
    await assert.rejects(
      () => lost.requestViewingV2(enquiry, command, agent),
      (e) => e instanceof ApiClientError && e.kind === 'NETWORK' && e.submissionUncertain,
    );
    assert.equal(writes, 1);
    const original = { kind: 'request', command },
      receipt = await api.getViewingReceiptV2(enquiry, original, agent);
    assert.equal(receipt.outcome, 'applied');
    assert.equal(receipt.request.notes, command.notes);
    assert.equal(receipt.result.status, 'requested');
    assert.deepEqual(await api.requestViewingV2(enquiry, command, agent), receipt);
    assert.equal((await api.listViewingsV2(enquiry, agent)).items.length, 1);
    const proposal = { operationId: randomUUID(), expectedVersion: '1', slot },
      proposed = await api.proposeViewingV2(enquiry, receipt.viewingId, proposal, agent);
    assert.equal(proposed.result.status, 'proposed');
    assert.equal(proposed.result.version, '2');
    assert.deepEqual(await api.getViewingReceiptV2(enquiry, original, agent), receipt);
    assert.deepEqual(
      await api.proposeViewingV2(enquiry, receipt.viewingId, proposal, agent),
      proposed,
    );
    assert.equal((await api.getViewingV2(enquiry, receipt.viewingId, admin)).schedule.version, '2');
    assert.equal((await api.getStaffEnquiryV2(enquiry, admin)).version, '2');
    await assert.rejects(
      () => api.requestViewingV2(enquiry, { ...command, notes: 'changed' }, agent),
      denied(409),
    );
    await assert.rejects(() => api.getViewingReceiptV2(enquiry, original, admin), denied(404));
    await assert.rejects(
      () => api.listViewingsV2(enquiry, { bearerToken: preview.bearerToken }),
      denied(403),
    );
    const directory = await api.listEnquiryAssigneesV2(admin),
      peer = directory.items.find(
        (x) => x.role === 'agent' && x.userId !== preview.enquiryStaff.agent.actorId,
      ).userId;
    await api.applyEnquiryOperationV2(
      enquiry,
      {
        operationId: randomUUID(),
        kind: 'assign',
        expectedVersion: '2',
        assignedAgentId: peer,
        status: null,
        nextActionAt: null,
        reason: null,
      },
      admin,
    );
    await assert.rejects(() => api.getViewingReceiptV2(enquiry, original, agent), denied(404));
    await assert.rejects(() => api.listViewingsV2(enquiry, agent), denied(404));
    assert.equal((await api.listViewingsV2(enquiry, admin)).items[0].assignedAgentId, peer);
    const recoveredProposal = await api
      .getViewingReceiptV2(
        enquiry,
        { kind: 'propose', viewingId: receipt.viewingId, command: proposal },
        admin,
      )
      .then(
        () => null,
        (e) => e,
      );
    assert.ok(denied(404)(recoveredProposal));
    assert.equal(
      (
        await fetch(`${preview.origin}/v2/staff/enquiries/${enquiry}/viewings?limit=26`, {
          headers: { Authorization: `Bearer ${admin.bearerToken}` },
        })
      ).status,
      400,
    );
    assert.equal(
      (await fetch(`${preview.origin}/v2/staff/enquiries/${enquiry}/viewings`)).status,
      401,
    );
  } finally {
    await preview.close();
  }
});
