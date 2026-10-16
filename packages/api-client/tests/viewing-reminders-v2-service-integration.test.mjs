import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createReminderAdmissionFixture } from '../../../database/test-helpers/reminder-admission-fixture.mjs';
import { createApiService } from '../../../apps/api/dist/service.js';
import { createDevelopmentServer } from '../../../apps/api/dist/http.js';
import { createIdentityVerifier, parseBearerHeader } from '../../../apps/api/dist/auth.js';
import { PostgresTransactionDatabase } from '../../../apps/api/dist/database.js';
import { RealtorApiClient, ApiClientError } from '../dist/index.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
  T = id(1),
  A = id(10),
  U = id(11),
  P = id(12),
  E = id(200);
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}
async function stop(server) {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
}
const denied = (status) => (error) =>
  error instanceof ApiClientError &&
  error.kind === 'HTTP' &&
  error.status === status &&
  !error.submissionUncertain;
test('signed capture-only reminder HTTP recovers discarded commits and preserves current-state suppression and original histories', async () => {
  const { db, viewing } = await createReminderAdmissionFixture();
  let keyServer, apiServer, database;
  try {
    const owner = (await db.query('SELECT session_user name')).rows[0].name,
      quoted = '"' + owner.replaceAll('"', '""') + '"';
    await db.exec(
      'CREATE ROLE reminder_sdk_login LOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;GRANT api_runtime TO reminder_sdk_login;SET SESSION AUTHORIZATION reminder_sdk_login;',
    );
    let tail = Promise.resolve();
    const pool = {
      async connect() {
        let unlock;
        const prior = tail;
        tail = new Promise((resolve) => (unlock = resolve));
        await prior;
        return {
          query: (sql, args) => db.query(sql, args ? [...args] : []),
          release() {
            unlock();
          },
        };
      },
    };
    database = new PostgresTransactionDatabase(pool);
    await database.checkConnection();
    const asOwner = async (work) => {
      await tail;
      await db.exec(`SET SESSION AUTHORIZATION ${quoted};RESET ROLE;`);
      try {
        return await work();
      } finally {
        await db.exec('SET SESSION AUTHORIZATION reminder_sdk_login;RESET ROLE;');
        await database.checkConnection();
      }
    };
    const keys = await generateKeyPair('RS256'),
      jwk = {
        ...(await exportJWK(keys.publicKey)),
        kid: 'synthetic-reminder-http',
        alg: 'RS256',
        use: 'sig',
      };
    keyServer = createServer((_, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ keys: [jwk] }));
    });
    const issuer = await listen(keyServer),
      verify = createIdentityVerifier({
        issuer,
        audience: 'synthetic-reminder-http',
        jwksUrl: issuer + '/jwks',
        allowLoopbackHttpForTests: true,
      });
    apiServer = createDevelopmentServer(
      createApiService({
        database,
        tenantId: T,
        privacyNoticeVersion: 'synthetic-v1',
        reminderCaptureMode: 'capture-only-v1',
        verifyAuthorization: (request) =>
          verify(parseBearerHeader(request.headers.get('authorization') ?? undefined)),
      }),
    );
    const origin = await listen(apiServer),
      make = (fetch) =>
        new RealtorApiClient({
          baseUrl: origin,
          allowLoopbackHttp: true,
          privacyNoticeVersion: 'synthetic-v1',
          ...(fetch ? { fetch } : {}),
        }),
      api = make();
    const token = (user) =>
        new SignJWT({})
          .setProtectedHeader({ alg: 'RS256', kid: jwk.kid })
          .setIssuer(issuer)
          .setAudience('synthetic-reminder-http')
          .setSubject(user)
          .setIssuedAt()
          .setExpirationTime('10m')
          .sign(keys.privateKey),
      agent = { bearerToken: await token(U) },
      admin = { bearerToken: await token(A) };
    const before = await api.getViewingV2(E, viewing, agent),
      command = {
        operationId: id(2000),
        expectedVersion: '3',
        dueAt: before.confirmation.recordedAt,
        expiresAt: before.schedule.proposedSlot.startAt,
      };
    let admissionWrites = 0;
    const lostAdmission = make(async (url, init) => {
      const response = await fetch(url, init);
      if (init.method === 'POST' && url.endsWith('/reminder-admissions')) {
        admissionWrites++;
        assert.equal(response.status, 200);
        assert.equal((await response.clone().json()).outcome, 'admitted');
        await response.arrayBuffer();
        throw new Error('Synthetic discarded committed admission reply');
      }
      return response;
    });
    await assert.rejects(
      () => lostAdmission.admitViewingReminderV2(E, viewing, command, agent),
      (error) => error.kind === 'NETWORK' && error.submissionUncertain,
    );
    assert.equal(admissionWrites, 1);
    const admission = await api.getViewingReminderAdmissionReceiptV2(E, viewing, command, agent);
    assert.equal(admission.outcome, 'admitted');
    assert.deepEqual(
      await api.getViewingReminderAdmissionSnapshotV2(E, command.operationId, agent),
      admission,
    );
    assert.deepEqual(await api.admitViewingReminderV2(E, viewing, command, agent), admission);
    const refused = await api.admitViewingReminderV2(
      E,
      viewing,
      { ...command, operationId: id(2001) },
      agent,
    );
    assert.equal(refused.reason, 'ALREADY_ADMITTED');
    await assert.rejects(
      () => api.captureViewingReminderV2(refused, { operationId: id(4999) }, agent),
      (error) => error.kind === 'VALIDATION' && !error.submissionUncertain,
    );
    const captureCommand = { operationId: id(4000) };
    let captureWrites = 0;
    const lostCapture = make(async (url, init) => {
      const response = await fetch(url, init);
      if (init.method === 'POST' && url.endsWith('/captures')) {
        captureWrites++;
        assert.equal(response.status, 200);
        assert.equal((await response.clone().json()).outcome, 'captured');
        await response.arrayBuffer();
        throw new Error('Synthetic discarded committed capture reply');
      }
      return response;
    });
    await assert.rejects(
      () => lostCapture.captureViewingReminderV2(admission, captureCommand, agent),
      (error) => error.kind === 'NETWORK' && error.submissionUncertain,
    );
    assert.equal(captureWrites, 1);
    const saved = await api.getViewingReminderCaptureReceiptV2(admission, captureCommand, agent);
    assert.equal(saved.outcome, 'captured');
    assert.equal(saved.mode, 'capture-only-v1');
    assert.deepEqual(await api.captureViewingReminderV2(admission, captureCommand, agent), saved);
    const duplicate = await api.captureViewingReminderV2(
      admission,
      { operationId: id(4001) },
      agent,
    );
    assert.equal(duplicate.outcome, 'duplicate');
    assert.deepEqual(duplicate.capture, saved.capture);
    assert.equal((await api.getStaffEnquiryV2(E, agent)).version, '1');
    assert.equal((await api.getViewingV2(E, viewing, agent)).schedule.version, '3');
    await assert.rejects(
      () => api.getViewingReminderAdmissionSnapshotV2(E, command.operationId, admin),
      denied(404),
    );
    await assert.rejects(
      () => api.captureViewingReminderV2(admission, { operationId: id(4998) }, admin),
      denied(404),
    );
    await assert.rejects(
      () => api.getViewingReminderCaptureReceiptV2(admission, captureCommand, admin),
      denied(404),
    );
    const assign = (operationId, expectedVersion, assignedAgentId) => ({
      operationId,
      kind: 'assign',
      expectedVersion,
      assignedAgentId,
      status: null,
      nextActionAt: null,
      reason: null,
    });
    await api.applyEnquiryOperationV2(E, assign(id(3000), '1', P), admin);
    await assert.rejects(
      () => api.getViewingReminderAdmissionReceiptV2(E, viewing, command, agent),
      denied(404),
    );
    await assert.rejects(
      () => api.getViewingReminderCaptureReceiptV2(admission, captureCommand, agent),
      denied(404),
    );
    await assert.rejects(
      () => api.captureViewingReminderV2(admission, { operationId: id(4002) }, agent),
      denied(404),
    );
    await api.applyEnquiryOperationV2(E, assign(id(3001), '2', U), admin);
    assert.deepEqual(
      await api.getViewingReminderCaptureReceiptV2(admission, captureCommand, agent),
      saved,
    );
    assert.deepEqual(await api.captureViewingReminderV2(admission, captureCommand, agent), saved);
    assert.equal(
      (await api.captureViewingReminderV2(admission, { operationId: id(4002) }, agent)).outcome,
      'duplicate',
    );
    const slot = {
        startAt: '2090-01-02T09:00:00.000Z',
        endAt: '2090-01-02T10:00:00.000Z',
        timeZone: 'Africa/Nairobi',
      },
      moved = await api.rescheduleViewingV2(
        E,
        viewing,
        {
          operationId: id(3100),
          expectedVersion: '3',
          slot,
          reason: 'Synthetic new cycle before a fresh capture.',
        },
        agent,
      );
    const proposedSuppression = await api.captureViewingReminderV2(
      admission,
      { operationId: id(4100) },
      agent,
    );
    assert.equal(proposedSuppression.reason, 'NOT_CONFIRMED');
    assert.equal(proposedSuppression.observedVersion, '4');
    const confirmed = await api.confirmViewingV2(
      E,
      viewing,
      {
        operationId: id(3101),
        expectedVersion: '4',
        slot,
        channel: 'phone',
        agreedAt: moved.completedAt,
        notes: 'Independent second-slot synthetic agreement.',
      },
      agent,
    );
    const confirmedSuppression = await api.captureViewingReminderV2(
      admission,
      { operationId: id(4101) },
      agent,
    );
    assert.equal(confirmedSuppression.reason, 'VERSION_CHANGED');
    assert.equal(confirmedSuppression.observedVersion, '5');
    assert.deepEqual(
      await api.captureViewingReminderV2(admission, { operationId: id(4100) }, agent),
      proposedSuppression,
    );
    assert.deepEqual(
      await api.getViewingReminderAdmissionReceiptV2(E, viewing, command, agent),
      admission,
    );
    const next = await api.admitViewingReminderV2(
      E,
      viewing,
      {
        operationId: id(2100),
        expectedVersion: '5',
        dueAt: confirmed.completedAt,
        expiresAt: slot.startAt,
      },
      agent,
    );
    assert.equal(next.candidate.cycleNumber, '2');
    const second = await api.captureViewingReminderV2(next, { operationId: id(2200) }, agent);
    assert.equal(second.outcome, 'captured');
    assert.equal(second.capture.viewingVersion, '5');
    const future = await api.admitViewingReminderV2(
        E,
        viewing,
        {
          operationId: id(2101),
          expectedVersion: '5',
          dueAt: '2090-01-02T08:00:00.000Z',
          expiresAt: slot.startAt,
        },
        agent,
      ),
      waiting = await api.captureViewingReminderV2(future, { operationId: id(2201) }, agent);
    assert.equal(waiting.outcome, 'waiting');
    assert.equal(waiting.reason, 'NOT_DUE');
    assert.equal(waiting.capture, null);
    await api.applyEnquiryOperationV2(
      E,
      {
        operationId: id(3200),
        kind: 'transition',
        expectedVersion: '3',
        assignedAgentId: null,
        status: 'closed_lost',
        nextActionAt: null,
        reason: 'Synthetic closure before capture cleanup.',
      },
      admin,
    );
    assert.equal(
      (await api.captureViewingReminderV2(future, { operationId: id(2202) }, agent)).reason,
      'ENQUIRY_CLOSED',
    );
    await api.terminateViewingV2(
      E,
      viewing,
      'cancel',
      { operationId: id(3201), expectedVersion: '5', reason: 'Synthetic ending after admission.' },
      agent,
    );
    assert.equal(
      (await api.captureViewingReminderV2(future, { operationId: id(2203) }, agent)).reason,
      'NOT_CONFIRMED',
    );
    assert.deepEqual(
      await api.getViewingReminderCaptureReceiptV2(future, { operationId: id(2201) }, agent),
      waiting,
    );
    assert.deepEqual(
      await api.captureViewingReminderV2(future, { operationId: id(2201) }, agent),
      waiting,
    );
    assert.deepEqual(
      await api.getViewingReminderCaptureReceiptV2(admission, captureCommand, agent),
      saved,
    );
    assert.deepEqual(await api.captureViewingReminderV2(admission, captureCommand, agent), saved);
    assert.deepEqual(
      await api.getViewingReminderCaptureReceiptV2(next, { operationId: id(2200) }, agent),
      second,
    );
    const history = await api.getViewingHistoryV2(E, viewing, agent);
    assert.equal(history.items.length, 6);
    assert.equal(admission.candidate.agreedAt, history.items[3].schedule.agreement.agreedAt);
    assert.equal(next.candidate.agreedAt, history.items[1].schedule.agreement.agreedAt);
    assert.notEqual(
      history.items[3].schedule.agreement.notes,
      history.items[1].schedule.agreement.notes,
    );
    assert.equal((await api.getStaffEnquiryV2(E, agent)).version, '4');
    const totals = await asOwner(
      async () =>
        (
          await db.query(
            "SELECT (SELECT count(*)::int FROM app_private.viewing_reminder_admissions) admissions,(SELECT count(*)::int FROM app_private.viewing_reminder_attempts) attempts,(SELECT count(*)::int FROM app_private.viewing_reminder_attempts WHERE receipt->>'outcome'='captured') captures,(SELECT count(*)::int FROM app_private.audit_events WHERE action='viewing.reminder_captured') audits",
          )
        ).rows[0],
    );
    assert.deepEqual(totals, { admissions: 4, attempts: 9, captures: 2, audits: 2 });
  } finally {
    await stop(apiServer);
    await stop(keyServer);
    if (database) await database.close();
    await db.close();
  }
});
