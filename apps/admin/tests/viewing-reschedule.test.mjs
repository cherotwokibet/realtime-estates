import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/viewings/[viewingId]/reschedules/route.js';
import { POST as recover } from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/viewings/[viewingId]/reschedules/recover/route.js';
import {
  createEnquiryPreviewClient,
  EnquiryPreviewError,
} from '../dist/tests/lib/enquiry-client.js';
import { prepareViewingRescheduleAttempt } from '../dist/tests/lib/viewing-reschedule-attempt.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const enquiry = id(5),
  viewing = id(7),
  actor = id(1),
  instance = id(3),
  slot = {
    startAt: '2090-01-02T09:00:00.000Z',
    endAt: '2090-01-02T10:00:00.000Z',
    timeZone: 'Africa/Nairobi',
  };
const command = {
    operationId: id(6),
    expectedVersion: '3',
    slot,
    reason: '  New synthetic slot.\nKeep exact reason.  ',
  },
  wire = { ...command, expectedVersion: 3 },
  at = '2026-10-14T08:00:00.000Z';
const receipt = {
  operationId: id(6),
  enquiryId: enquiry,
  viewingId: viewing,
  actorId: actor,
  kind: 'reschedule',
  expectedVersion: '3',
  observedVersion: '3',
  request: { slot, reason: command.reason },
  outcome: 'applied',
  reason: null,
  result: {
    viewingId: viewing,
    enquiryId: enquiry,
    listingId: id(8),
    version: '4',
    status: 'proposed',
    preferredSlots: [],
    proposedSlot: slot,
    cycle: {
      number: '2',
      proposalVersion: '4',
      proposedAt: at,
      reason: command.reason,
      previousStatus: 'confirmed',
      previousUpdatedAt: '2026-10-14T07:00:00.000Z',
    },
  },
  completedAt: at,
};
const context = { params: Promise.resolve({ actor: 'admin', id: enquiry, viewingId: viewing }) };
const request = (suffix = '', body = JSON.stringify(wire), headers = {}) =>
  new Request(
    `http://127.0.0.1:3001/api/enquiry-preview/admin/enquiries/${enquiry}/viewings/${viewing}/reschedules${suffix}`,
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
test('reschedule BFF binds exact facts and fixed authority while original recovery performs only GET', async (t) => {
  const env = { ...process.env },
    fetch = globalThis.fetch;
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
    globalThis.fetch = fetch;
    for (const key of Object.keys(process.env)) if (!(key in env)) delete process.env[key];
    Object.assign(process.env, env);
  });
  let calls = [];
  const mock = (value) => {
    calls = [];
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), init });
      if (value instanceof Error) throw value;
      return Response.json(value);
    };
  };
  await t.test('one save and body-only original recovery with server credentials', async () => {
    mock(receipt);
    assert.deepEqual(await (await POST(request(), context)).json(), receipt);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].init.method, 'POST');
    assert.deepEqual(JSON.parse(calls[0].init.body), wire);
    assert.equal(
      new Headers(calls[0].init.headers).get('authorization'),
      'Bearer admin.fixed.token',
    );
    mock(receipt);
    assert.deepEqual(await (await recover(request('/recover'), context)).json(), receipt);
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.body, undefined);
    assert.equal(
      calls[0].url,
      `http://127.0.0.1:4101/v2/staff/enquiries/${enquiry}/viewing-operations/${command.operationId}`,
    );
  });
  await t.test(
    'authority, duplicate keys, rounded versions, bounds and route query fail before dispatch',
    async () => {
      mock(receipt);
      for (const body of [
        JSON.stringify({ ...wire, actorId: actor }),
        JSON.stringify({ ...wire, kind: 'reschedule' }),
        JSON.stringify(wire).replace('"expectedVersion":3', '"expectedVersion":3e0'),
        JSON.stringify(wire).replace('"reason":', '"reason":"duplicate","reason":'),
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
    'altered slot, reason, actor or transferred agreement cannot establish success',
    async () => {
      for (const value of [
        { ...receipt, actorId: id(99) },
        { ...receipt, request: { ...receipt.request, reason: 'changed' } },
        {
          ...receipt,
          result: {
            ...receipt.result,
            agreement: { channel: 'phone', agreedAt: at, notes: 'Old agreement' },
          },
        },
      ]) {
        mock(value);
        assert.equal((await (await POST(request(), context)).json()).submissionUncertain, true);
        assert.equal(
          (await (await recover(request('/recover'), context)).json()).submissionUncertain,
          false,
        );
      }
      mock(new Error('Synthetic failure'));
      assert.equal(
        (await (await recover(request('/recover'), context)).json()).submissionUncertain,
        false,
      );
      assert.equal(calls.length, 1);
    },
  );
});
test('reschedule browser transport uses same-origin body-only facts and validates both write and read receipts', async () => {
  const calls = [],
    api = createEnquiryPreviewClient({
      basePath: '/api/enquiry-preview/admin',
      instanceId: instance,
      fetch: async (url, init) => {
        calls.push({ url, init });
        return Response.json(receipt);
      },
    });
  assert.deepEqual(await api.rescheduleViewing(enquiry, viewing, command), receipt);
  assert.deepEqual(await api.recoverViewingReschedule(enquiry, viewing, command), receipt);
  for (const { url, init } of calls) {
    assert.equal(init.method, 'POST');
    assert.deepEqual(JSON.parse(init.body), wire);
    assert.equal(new Headers(init.headers).get('authorization'), null);
    assert.equal(init.credentials, 'omit');
    assert.equal(url.includes('New synthetic'), false);
  }
  assert.ok(calls[1].url.endsWith('/reschedules/recover'));
  const bad = createEnquiryPreviewClient({
    basePath: '/api/enquiry-preview/admin',
    instanceId: instance,
    fetch: async () => Response.json({ ...receipt, request: { slot, reason: 'changed' } }),
  });
  await assert.rejects(
    () => bad.rescheduleViewing(enquiry, viewing, command),
    (e) => e.uncertain,
  );
  await assert.rejects(
    () => bad.recoverViewingReschedule(enquiry, viewing, command),
    (e) => !e.uncertain,
  );
});
test('reschedule retained attempt detaches new slot and reason and blocks concurrent work', async () => {
  let finish;
  const raw = structuredClone(command),
    attempt = prepareViewingRescheduleAttempt(
      {
        rescheduleViewing: async (_id, target, input) => {
          assert.equal(target, viewing);
          assert.deepEqual(input, command);
          return new Promise((resolve) => (finish = resolve));
        },
        recoverViewingReschedule: async () => receipt,
      },
      enquiry,
      viewing,
      raw,
    );
  raw.slot.startAt = 'changed';
  raw.reason = 'changed';
  const pending = attempt.submit();
  await assert.rejects(() => attempt.submit());
  await assert.rejects(() => attempt.recoverOriginal());
  assert.equal(attempt.status, 'sending');
  finish(receipt);
  await pending;
  assert.equal(attempt.status, 'received');
  assert.ok(Object.isFrozen(attempt.original.command.slot));
});
test('reschedule uncertain original survives denied recovery and exact explicit replay without new facts', async () => {
  let writes = 0;
  const attempt = prepareViewingRescheduleAttempt(
    {
      rescheduleViewing: async (_id, target, input) => {
        assert.equal(target, viewing);
        assert.deepEqual(input, command);
        if (++writes === 1) throw new EnquiryPreviewError('network', 0, true);
        return receipt;
      },
      recoverViewingReschedule: async () => {
        throw new EnquiryPreviewError('http', 404);
      },
    },
    enquiry,
    viewing,
    command,
  );
  await assert.rejects(() => attempt.submit());
  await assert.rejects(() => attempt.recoverOriginal());
  assert.equal(attempt.status, 'uncertain');
  assert.deepEqual(attempt.original.command, command);
  await attempt.replayOriginal();
  assert.equal(attempt.status, 'received');
  assert.equal(writes, 2);
});
test('reschedule conflict is terminal and malformed applied result remains uncertain', async () => {
  const conflict = {
    ...receipt,
    outcome: 'conflict',
    reason: 'VERSION_CONFLICT',
    observedVersion: '4',
    result: null,
  };
  let attempt = prepareViewingRescheduleAttempt(
    { rescheduleViewing: async () => conflict, recoverViewingReschedule: async () => conflict },
    enquiry,
    viewing,
    command,
  );
  await attempt.submit();
  assert.equal(attempt.status, 'received');
  await assert.rejects(() => attempt.replayOriginal());
  attempt = prepareViewingRescheduleAttempt(
    {
      rescheduleViewing: async () => ({ ...receipt, result: { ...receipt.result, version: '5' } }),
      recoverViewingReschedule: async () => receipt,
    },
    enquiry,
    viewing,
    command,
  );
  await assert.rejects(() => attempt.submit());
  assert.equal(attempt.status, 'uncertain');
});
