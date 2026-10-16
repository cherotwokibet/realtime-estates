import { outcomeFixture } from '../../../packages/domain/test-helpers/viewing-outcome-fixtures.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { POST } from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/viewings/[viewingId]/completions/route.js';
import { POST as noShow } from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/viewings/[viewingId]/no-shows/route.js';
import { POST as noShowRecover } from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/viewings/[viewingId]/no-shows/recover/route.js';
import { POST as recover } from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/viewings/[viewingId]/completions/recover/route.js';
import {
  createEnquiryPreviewClient,
  EnquiryPreviewError,
} from '../dist/tests/lib/enquiry-client.js';
import { prepareViewingOutcomeAttempt } from '../dist/tests/lib/viewing-outcome-attempt.js';
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
const { command, receipt } = outcomeFixture({ enquiry, viewing, actor, operation });
const wire = { ...command, expectedVersion: Number(command.expectedVersion) };
const context = { params: Promise.resolve({ actor: 'admin', id: enquiry, viewingId: viewing }) };
const request = (suffix = '', body = JSON.stringify(wire), headers = {}) =>
  new Request(
    `http://127.0.0.1:3001/api/enquiry-preview/admin/enquiries/${enquiry}/viewings/${viewing}/completions${suffix}`,
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
test('completion and no-show BFF binds fixed authority and recovers originals by upstream read only', async (t) => {
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
    'original write uses server credentials once and recovery carries reason only in body',
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
    'no-show fixes its own route kind and preserves body-only original recovery',
    async () => {
      const value = outcomeFixture({ enquiry, viewing, actor, operation, kind: 'no_show' }).receipt;
      mock(value);
      const noShowRequest = (suffix) =>
        new Request(request(suffix).url.replace('/completions', '/no-shows'), request(suffix));
      assert.deepEqual(await (await noShow(noShowRequest(''), context)).json(), value);
      assert.ok(calls[0].url.endsWith('/no-shows'));
      mock(value);
      assert.deepEqual(
        await (await noShowRecover(noShowRequest('/recover'), context)).json(),
        value,
      );
      assert.equal(calls[0].init.method, 'GET');
      mock(receipt);
      assert.equal((await noShow(noShowRequest(''), context)).status, 502);
    },
  );
  await t.test(
    'authority,duplicate/rounded versions,wrong instance,query and oversize bodies fail before dispatch',
    async () => {
      mock(receipt);
      for (const body of [
        JSON.stringify({ ...wire, actorId: actor }),
        JSON.stringify({ ...wire, kind: 'no_show' }),
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
test('completion browser transport sends exact original facts through fixed same-origin paths without credentials', async () => {
  const calls = [],
    api = client(async (url, init) => {
      calls.push({ url, init });
      return Response.json(receipt);
    });
  assert.deepEqual(await api.recordViewingOutcome(enquiry, viewing, 'complete', command), receipt);
  assert.deepEqual(await api.recoverViewingOutcome(enquiry, viewing, 'complete', command), receipt);
  for (const call of calls) {
    assert.equal(call.init.method, 'POST');
    assert.deepEqual(JSON.parse(call.init.body), wire);
    assert.equal(new Headers(call.init.headers).get('authorization'), null);
    assert.equal(call.init.credentials, 'omit');
    assert.equal(call.init.redirect, 'error');
  }
  assert.ok(calls[0].url.endsWith(`/viewings/${viewing}/completions`));
  assert.ok(calls[1].url.endsWith('/completions/recover'));
});
test('completion browser malformed replies cannot establish success or turn a recovery read into a write', async () => {
  const altered = client(async () =>
    Response.json({ ...receipt, request: { ...receipt.request, reason: 'changed' } }),
  );
  await assert.rejects(
    () => altered.recordViewingOutcome(enquiry, viewing, 'complete', command),
    (e) => e.uncertain,
  );
  await assert.rejects(
    () => altered.recoverViewingOutcome(enquiry, viewing, 'complete', command),
    (e) => !e.uncertain,
  );
});
test('completion attempt freezes selected version/reason and blocks concurrent sends', async () => {
  let finish,
    calls = 0;
  const raw = structuredClone(command),
    attempt = prepareViewingOutcomeAttempt(
      {
        recordViewingOutcome: async (_id, _target, kind, value) => {
          calls++;
          assert.deepEqual(value, command);
          return new Promise((resolve) => {
            finish = resolve;
          });
        },
        recoverViewingOutcome: async () => receipt,
      },
      enquiry,
      viewing,
      'complete',
      raw,
    );
  raw.reason = 'changed';
  raw.occurredAt = '2020-01-01T11:00:00.000Z';
  const pending = attempt.submit();
  assert.equal(attempt.status, 'sending');
  await assert.rejects(() => attempt.submit());
  await assert.rejects(() => attempt.recoverOriginal());
  assert.equal(calls, 1);
  finish(receipt);
  await pending;
  assert.equal(attempt.status, 'received');
  assert.deepEqual(attempt.original.command, command);
  assert.ok(Object.isFrozen(attempt.original.command));
});
test('denied completion recovery retains uncertain original and explicit replay resends identical facts', async () => {
  let writes = 0;
  const attempt = prepareViewingOutcomeAttempt(
    {
      recordViewingOutcome: async (_id, target, kind, value) => {
        assert.equal(target, viewing);
        assert.deepEqual(value, command);
        if (++writes === 1) throw new EnquiryPreviewError('network', 0, true);
        return receipt;
      },
      recoverViewingOutcome: async () => {
        throw new EnquiryPreviewError('http', 404, false);
      },
    },
    enquiry,
    viewing,
    'complete',
    command,
  );
  await assert.rejects(() => attempt.submit());
  await assert.rejects(() => attempt.recoverOriginal());
  assert.equal(attempt.status, 'uncertain');
  assert.equal(attempt.original.command.reason, command.reason);
  await attempt.replayOriginal();
  assert.equal(attempt.status, 'received');
  assert.equal(writes, 2);
});
test('completion conflict receipt is terminal while altered successful result remains uncertain', async () => {
  const conflict = {
      ...receipt,
      outcome: 'conflict',
      reason: 'VERSION_CONFLICT',
      observedVersion: '4',
      result: null,
    },
    attempt = prepareViewingOutcomeAttempt(
      { recordViewingOutcome: async () => conflict, recoverViewingOutcome: async () => conflict },
      enquiry,
      viewing,
      'complete',
      command,
    );
  await attempt.submit();
  assert.equal(attempt.status, 'received');
  assert.equal(attempt.receipt.result, null);
  await assert.rejects(() => attempt.replayOriginal());
  const invalid = prepareViewingOutcomeAttempt(
    {
      recordViewingOutcome: async () => ({
        ...receipt,
        result: { ...receipt.result, outcome: { ...receipt.result.outcome, reason: 'changed' } },
      }),
      recoverViewingOutcome: async () => receipt,
    },
    enquiry,
    viewing,
    'complete',
    command,
  );
  await assert.rejects(() => invalid.submit());
  assert.equal(invalid.status, 'uncertain');
});
