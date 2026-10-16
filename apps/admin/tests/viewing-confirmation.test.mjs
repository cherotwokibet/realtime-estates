import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/viewings/[viewingId]/confirmations/route.js';
import { POST as recover } from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/viewings/[viewingId]/confirmations/recover/route.js';
import {
  createEnquiryPreviewClient,
  EnquiryPreviewError,
} from '../dist/tests/lib/enquiry-client.js';
import { prepareViewingConfirmationAttempt } from '../dist/tests/lib/viewing-confirmation-attempt.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1),
  instance = id(3),
  enquiry = id(5),
  viewing = id(7),
  operation = id(6),
  slot = {
    startAt: '2090-01-01T09:00:00.000Z',
    endAt: '2090-01-01T10:00:00.000Z',
    timeZone: 'Africa/Nairobi',
  };
const command = {
    operationId: operation,
    expectedVersion: '2',
    slot,
    channel: 'phone',
    agreedAt: '2026-10-14T07:00:00.000Z',
    notes: '  Private fictional agreement.\nKeep exact.  ',
  },
  wire = { ...command, expectedVersion: 2 };
const receipt = {
  operationId: operation,
  enquiryId: enquiry,
  viewingId: viewing,
  actorId: actor,
  kind: 'confirm',
  expectedVersion: '2',
  observedVersion: '2',
  request: { slot, channel: 'phone', agreedAt: command.agreedAt, notes: command.notes },
  outcome: 'applied',
  reason: null,
  result: {
    viewingId: viewing,
    enquiryId: enquiry,
    listingId: id(8),
    version: '3',
    status: 'confirmed',
    preferredSlots: [],
    proposedSlot: slot,
    agreement: { channel: 'phone', agreedAt: command.agreedAt, notes: command.notes },
  },
  completedAt: '2026-10-14T08:00:00.000Z',
};
const context = { params: Promise.resolve({ actor: 'admin', id: enquiry, viewingId: viewing }) };
const request = (suffix = '', body = JSON.stringify(wire), headers = {}) =>
  new Request(
    `http://127.0.0.1:3001/api/enquiry-preview/admin/enquiries/${enquiry}/viewings/${viewing}/confirmations${suffix}`,
    {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://127.0.0.1:3001',
        'sec-fetch-site': 'same-origin',
        'x-preview-instance': instance,
        'content-type': 'application/json',
        ...headers,
      },
      body,
    },
  );
test('phone confirmation BFF binds fixed authority and recovers originals by upstream read only', async (t) => {
  const oldEnv = { ...process.env },
    oldFetch = globalThis.fetch;
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_ENQUIRY_PREVIEW_MODE: 'synthetic-v1',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_ENQUIRY_ADMIN_TOKEN: 'admin.fixed.token',
    STAFF_ENQUIRY_ADMIN_ID: actor,
    STAFF_ENQUIRY_ADMIN_INSTANCE: instance,
    STAFF_ENQUIRY_AGENT_TOKEN: 'agent.fixed.token',
    STAFF_ENQUIRY_AGENT_ID: id(2),
    STAFF_ENQUIRY_AGENT_INSTANCE: id(4),
  });
  t.after(() => {
    globalThis.fetch = oldFetch;
    for (const key of Object.keys(process.env)) if (!(key in oldEnv)) delete process.env[key];
    Object.assign(process.env, oldEnv);
  });
  let calls = [];
  const mock = (value) => {
    calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (value instanceof Error) throw value;
      return Response.json(value, { headers: { 'X-Request-Id': id(9) } });
    };
  };
  await t.test(
    'original write uses server credentials once and recovery carries notes only in body',
    async () => {
      mock(receipt);
      assert.deepEqual(await (await POST(request(), context)).json(), receipt);
      assert.deepEqual(JSON.parse(calls[0].init.body), wire);
      assert.equal(
        new Headers(calls[0].init.headers).get('authorization'),
        'Bearer admin.fixed.token',
      );
      assert.equal(calls[0].init.method, 'POST');
      mock(receipt);
      assert.deepEqual(await (await recover(request('/recover'), context)).json(), receipt);
      assert.equal(calls.length, 1);
      assert.equal(calls[0].init.method, 'GET');
      assert.equal(calls[0].init.body, undefined);
      assert.equal(
        calls[0].url,
        `http://127.0.0.1:4101/v2/staff/enquiries/${enquiry}/viewing-operations/${operation}`,
      );
      assert.equal(calls[0].url.includes('Private'), false);
    },
  );
  await t.test(
    'authority,duplicate/rounded versions,wrong instance,query and oversize bodies fail before dispatch',
    async () => {
      mock(receipt);
      for (const body of [
        JSON.stringify({ ...wire, actorId: actor }),
        JSON.stringify({ ...wire, channel: 'email' }),
        JSON.stringify(wire).replace('"expectedVersion":2', '"expectedVersion":2e0'),
        JSON.stringify(wire).replace('"notes":', '"notes":"duplicate","notes":'),
        ' '.repeat(16385),
      ])
        assert.equal((await POST(request('', body), context)).status, 400);
      assert.equal((await POST(request('?limit=1'), context)).status, 400);
      assert.equal(
        (await POST(request('', undefined, { 'x-preview-instance': id(99) }), context)).status,
        403,
      );
      assert.equal(calls.length, 0);
    },
  );
  await t.test(
    'read failure stays read-only while failed writes and wrong-actor successful replies preserve uncertainty',
    async () => {
      mock(new Error('Synthetic loss'));
      assert.equal(
        (await (await recover(request('/recover'), context)).json()).submissionUncertain,
        false,
      );
      mock(new Error('Synthetic loss'));
      assert.equal((await (await POST(request(), context)).json()).submissionUncertain, true);
      mock({ ...receipt, actorId: id(99) });
      assert.equal((await (await POST(request(), context)).json()).submissionUncertain, true);
      assert.equal(
        (await (await recover(request('/recover'), context)).json()).submissionUncertain,
        false,
      );
    },
  );
});
const client = (fetch) =>
  createEnquiryPreviewClient({
    basePath: '/api/enquiry-preview/admin',
    instanceId: instance,
    fetch,
  });
test('confirmation browser transport sends exact original facts through fixed same-origin paths without credentials', async () => {
  const calls = [],
    api = client(async (url, init) => {
      calls.push({ url, init });
      return Response.json(receipt);
    });
  assert.deepEqual(await api.confirmViewing(enquiry, viewing, command), receipt);
  assert.deepEqual(await api.recoverViewingConfirmation(enquiry, viewing, command), receipt);
  for (const call of calls) {
    assert.equal(call.init.method, 'POST');
    assert.deepEqual(JSON.parse(call.init.body), wire);
    assert.equal(new Headers(call.init.headers).get('authorization'), null);
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.redirect, 'error');
  }
  assert.ok(calls[0].url.endsWith(`/viewings/${viewing}/confirmations`));
  assert.ok(calls[1].url.endsWith('/confirmations/recover'));
});
test('confirmation browser malformed replies cannot establish success or turn a recovery read into a write', async () => {
  const altered = client(async () =>
    Response.json({ ...receipt, request: { ...receipt.request, notes: 'changed' } }),
  );
  await assert.rejects(
    () => altered.confirmViewing(enquiry, viewing, command),
    (e) => e.uncertain,
  );
  await assert.rejects(
    () => altered.recoverViewingConfirmation(enquiry, viewing, command),
    (e) => !e.uncertain,
  );
});
test('confirmation attempt freezes proposal/evidence and blocks concurrent sends', async () => {
  let finish,
    calls = 0;
  const raw = structuredClone(command),
    attempt = prepareViewingConfirmationAttempt(
      {
        confirmViewing: async (_id, _target, value) => {
          calls++;
          assert.deepEqual(value, command);
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
        recoverViewingConfirmation: async () => receipt,
      },
      enquiry,
      viewing,
      raw,
    );
  raw.notes = 'changed';
  raw.slot.startAt = 'changed';
  const pending = attempt.submit();
  assert.equal(attempt.status, 'sending');
  await assert.rejects(() => attempt.submit());
  await assert.rejects(() => attempt.recoverOriginal());
  assert.equal(calls, 1);
  finish(receipt);
  await pending;
  assert.equal(attempt.status, 'received');
  assert.deepEqual(attempt.original.command, command);
  assert.ok(Object.isFrozen(attempt.original.command.slot));
});
test('denied confirmation recovery retains uncertain original and explicit replay resends identical facts', async () => {
  let writes = 0;
  const attempt = prepareViewingConfirmationAttempt(
    {
      confirmViewing: async (_id, target, value) => {
        assert.equal(target, viewing);
        assert.deepEqual(value, command);
        if (++writes === 1) throw new EnquiryPreviewError('network', 0, true);
        return receipt;
      },
      recoverViewingConfirmation: async () => {
        throw new EnquiryPreviewError('http', 404, false);
      },
    },
    enquiry,
    viewing,
    command,
  );
  await assert.rejects(() => attempt.submit());
  await assert.rejects(() => attempt.recoverOriginal());
  assert.equal(attempt.status, 'uncertain');
  assert.equal(attempt.original.command.notes, command.notes);
  await attempt.replayOriginal();
  assert.equal(attempt.status, 'received');
  assert.equal(writes, 2);
});
test('confirmation conflict receipt is terminal while altered successful result remains uncertain', async () => {
  const conflict = {
      ...receipt,
      outcome: 'conflict',
      reason: 'VERSION_CONFLICT',
      observedVersion: '3',
      result: null,
    },
    attempt = prepareViewingConfirmationAttempt(
      { confirmViewing: async () => conflict, recoverViewingConfirmation: async () => conflict },
      enquiry,
      viewing,
      command,
    );
  await attempt.submit();
  assert.equal(attempt.status, 'received');
  assert.equal(attempt.receipt.result, null);
  await assert.rejects(() => attempt.replayOriginal());
  const invalid = prepareViewingConfirmationAttempt(
    {
      confirmViewing: async () => ({
        ...receipt,
        result: { ...receipt.result, agreement: { ...receipt.result.agreement, notes: 'changed' } },
      }),
      recoverViewingConfirmation: async () => receipt,
    },
    enquiry,
    viewing,
    command,
  );
  await assert.rejects(() => invalid.submit());
  assert.equal(invalid.status, 'uncertain');
});
