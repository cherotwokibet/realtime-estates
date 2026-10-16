import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../dist/tests/app/api/enquiry-preview/[actor]/enquiries/[id]/activity/route.js';
import { createEnquiryPreviewClient } from '../dist/tests/lib/enquiry-client.js';
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const page = {
  items: [
    {
      eventId: id(5),
      kind: 'received',
      actorId: null,
      occurredAt: '2026-10-13T00:00:00.000Z',
      version: '1',
      status: 'new',
      assignedAgentId: null,
      nextActionAt: null,
    },
  ],
  limit: 50,
  truncated: false,
  coverage: 'capture-and-v2-operations',
  currentVersion: '1',
};
const env = {
  NODE_ENV: 'development',
  STAFF_ENQUIRY_PREVIEW_MODE: 'synthetic-v1',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_ENQUIRY_ADMIN_TOKEN: 'admin.fixed.token',
  STAFF_ENQUIRY_ADMIN_ID: id(1),
  STAFF_ENQUIRY_ADMIN_INSTANCE: id(3),
  STAFF_ENQUIRY_AGENT_TOKEN: 'agent.fixed.token',
  STAFF_ENQUIRY_AGENT_ID: id(2),
  STAFF_ENQUIRY_AGENT_INSTANCE: id(4),
};
const request = (suffix = '', headers = {}) =>
  new Request(
    'http://127.0.0.1:3001/api/enquiry-preview/admin/enquiries/' + id(5) + '/activity' + suffix,
    {
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://127.0.0.1:3001',
        'x-preview-instance': id(3),
        ...headers,
      },
    },
  );
const route = (r) => GET(r, { params: Promise.resolve({ actor: 'admin', id: id(5) }) });
test('activity proxy fixes server identity, rejects overrides and malformed history without mutation', async () => {
  const prior = { ...process.env },
    original = globalThis.fetch;
  Object.assign(process.env, env);
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return Response.json(page);
  };
  try {
    const saved = await route(request());
    assert.equal(saved.status, 200);
    assert.deepEqual(await saved.json(), page);
    assert.equal(
      calls[0].url,
      'http://127.0.0.1:4101/v2/staff/enquiries/' + id(5) + '/activity?limit=50',
    );
    assert.equal(calls[0].init.method, 'GET');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer admin.fixed.token');
    assert.match(saved.headers.get('cache-control'), /private, no-store/);
    for (const suffix of ['?tenantId=other', '?limit=0', '?limit=1&limit=2'])
      assert.equal((await route(request(suffix))).status, 400);
    for (const headers of [
      { authorization: 'Bearer forged' },
      { cookie: 'private=secret' },
      { 'x-preview-instance': id(90) },
    ])
      assert.ok((await route(request('', headers))).status >= 400);
    assert.equal(calls.length, 1);
    globalThis.fetch = async () => Response.json({ ...page, coverage: 'complete' });
    assert.equal((await route(request())).status, 502);
  } finally {
    globalThis.fetch = original;
    for (const key of Object.keys(process.env)) if (!(key in prior)) delete process.env[key];
    Object.assign(process.env, prior);
  }
});
test('browser activity read has no credentials/write body and rejects unsupported history', async () => {
  const calls = [],
    api = createEnquiryPreviewClient({
      basePath: '/api/enquiry-preview/agent',
      instanceId: id(4),
      fetch: async (path, init) => {
        calls.push({ path, init });
        return Response.json(page);
      },
    });
  assert.deepEqual(await api.activity(id(5)), page);
  assert.equal(
    calls[0].path,
    '/api/enquiry-preview/agent/enquiries/' + id(5) + '/activity?limit=50',
  );
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.body, undefined);
  assert.equal(calls[0].init.headers.Authorization, undefined);
  const bad = createEnquiryPreviewClient({
    basePath: '/api/enquiry-preview/agent',
    instanceId: id(4),
    fetch: async () => Response.json({ ...page, secret: 'private' }),
  });
  await assert.rejects(bad.activity(id(5)), (e) => e.kind === 'response' && !e.uncertain);
});
