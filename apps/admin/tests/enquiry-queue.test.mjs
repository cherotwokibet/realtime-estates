import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createEnquiryPreviewClient,
  EnquiryPreviewError,
} from '../dist/tests/lib/enquiry-client.js';
import { enquiryQueueSearch, parseEnquiryQueueSearch } from '../dist/tests/lib/enquiry-queue.js';
import { enquiryPreviewRequest } from '../dist/tests/lib/enquiry-preview-server.js';
import { GET, dynamic } from '../dist/tests/app/api/enquiry-preview/[actor]/queue/route.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = '2026-10-25T12:00:00.000Z',
  BEFORE = '2026-10-24T12:00:00.000Z';
const row = (n = 20) => ({
  id: id(n),
  listingId: null,
  contactedRevision: null,
  name: 'Synthetic older enquiry',
  origin: 'web',
  status: 'contacted',
  assignedAgentId: id(2),
  nextActionAt: BEFORE,
  version: '3',
  createdAt: BEFORE,
  updatedAt: BEFORE,
});
const page = (patch = {}) => ({
  policy: 'staff-enquiry-queue-v3',
  items: [row()],
  limit: 50,
  filter: 'all',
  after: null,
  hasMore: false,
  nextAfter: null,
  asOf: NOW,
  timeZone: 'Africa/Nairobi',
  ...patch,
});
const client = (fetch) =>
  createEnquiryPreviewClient({
    basePath: '/api/enquiry-preview/admin',
    instanceId: id(3),
    fetch,
  });

test('queue client captures explicit page/filter before transport and rejects authority/getters without I/O', async () => {
  const calls = [];
  const input = { limit: 1, filter: 'overdue', after: id(99) };
  const api = client(async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(
      page({ limit: 1, filter: 'overdue', after: id(99), hasMore: true, nextAfter: id(20) }),
    );
  });
  const result = api.queue(input);
  input.after = id(88);
  input.filter = 'today';
  const value = await result;
  assert.equal(
    calls[0].url,
    `/api/enquiry-preview/admin/queue?limit=1&filter=overdue&after=${id(99)}`,
  );
  assert.equal(calls[0].init.method, 'GET');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal(new Headers(calls[0].init.headers).get('authorization'), null);
  assert.equal(value.filter, 'overdue');
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.items[0]));
  let touched = false;
  const accessor = Object.defineProperty({}, 'filter', {
    enumerable: true,
    get() {
      touched = true;
      return 'all';
    },
  });
  for (const invalid of [
    { tenantId: id(1) },
    { actor: 'admin' },
    { limit: 101 },
    { after: '' },
    { filter: 'Overdue' },
    accessor,
  ])
    assert.throws(
      () => api.queue(invalid),
      (e) => e instanceof EnquiryPreviewError && e.kind === 'validation',
    );
  assert.equal(touched, false);
  assert.equal(calls.length, 1);
});

test('queue query and client reject duplicate/empty/unknown filters and dishonest continuation without broad fallback', async () => {
  assert.equal(enquiryQueueSearch(), 'limit=50&filter=all');
  for (const query of [
    'limit=0',
    'limit=01',
    'limit=101',
    'limit=1&limit=1',
    'filter=',
    'filter= all',
    'filter=all&filter=all',
    'after=',
    `tenant=${id(1)}`,
    'offset=50',
  ])
    assert.throws(() => parseEnquiryQueueSearch(new URLSearchParams(query)), query);
  for (const patch of [
    { nextAfter: id(20) },
    { hasMore: true },
    { hasMore: true, nextAfter: id(30) },
    { filter: 'open' },
    { after: id(99) },
    { items: [row(), row()] },
    { timeZone: 'UTC' },
    { asOf: '2026-10-25T12:00:00Z' },
  ]) {
    let calls = 0;
    const api = client(async () => {
      calls++;
      return Response.json(page(patch));
    });
    await assert.rejects(
      api.queue({}),
      (e) => e instanceof EnquiryPreviewError && e.kind === 'response' && !e.uncertain,
    );
    assert.equal(calls, 1);
  }
});

test('new queue BFF keeps exact fixed-role identity and leaves old list boundary unchanged', async (t) => {
  const priorEnv = { ...process.env },
    priorFetch = globalThis.fetch;
  Object.assign(process.env, {
    NODE_ENV: 'development',
    STAFF_ENQUIRY_PREVIEW_MODE: 'synthetic-v1',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
    STAFF_ENQUIRY_ADMIN_TOKEN: 'admin.fixed.token',
    STAFF_ENQUIRY_ADMIN_ID: id(1),
    STAFF_ENQUIRY_ADMIN_INSTANCE: id(3),
    STAFF_ENQUIRY_AGENT_TOKEN: 'agent.fixed.token',
    STAFF_ENQUIRY_AGENT_ID: id(2),
    STAFF_ENQUIRY_AGENT_INSTANCE: id(4),
  });
  t.after(() => {
    globalThis.fetch = priorFetch;
    for (const key of Object.keys(process.env))
      if (!Object.hasOwn(priorEnv, key)) delete process.env[key];
    Object.assign(process.env, priorEnv);
  });
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return Response.json(page({ limit: 1, filter: 'overdue', after: id(99) }), {
      headers: { 'X-Request-Id': id(8) },
    });
  };
  const request = (
    actor = 'admin',
    query = `limit=1&filter=overdue&after=${id(99)}`,
    headers = {},
    path = 'queue',
  ) =>
    new Request(`http://127.0.0.1:3005/api/enquiry-preview/${actor}/${path}?${query}`, {
      headers: {
        Host: '127.0.0.1:3005',
        Origin: 'http://127.0.0.1:3005',
        'Sec-Fetch-Site': 'same-origin',
        'X-Preview-Instance': actor === 'admin' ? id(3) : id(4),
        ...headers,
      },
    });
  assert.equal(dynamic, 'force-dynamic');
  for (const actor of ['admin', 'agent']) {
    const response = await GET(request(actor), { params: Promise.resolve({ actor }) });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
    assert.equal(
      calls.at(-1).url,
      `http://127.0.0.1:4101/v3/staff/enquiries?limit=1&filter=overdue&after=${id(99)}`,
    );
    assert.equal(
      new Headers(calls.at(-1).init.headers).get('authorization'),
      `Bearer ${actor}.fixed.token`,
    );
    assert.equal(JSON.stringify(await response.json()).includes('fixed.token'), false);
  }
  for (const query of [
    'filter=all&filter=all',
    'filter=',
    'limit=01',
    'after=bad',
    `tenantId=${id(1)}`,
    'limit=101',
    'offset=50',
  ]) {
    const response = await enquiryPreviewRequest(
      request('admin', query),
      { actor: 'admin' },
      'queue',
    );
    assert.equal(response.status, 400, query);
  }
  for (const headers of [
    { cookie: 'secret=x' },
    { 'x-tenant-id': id(1) },
    { 'x-preview-instance': id(4) },
    { origin: 'https://external.invalid' },
  ]) {
    const response = await enquiryPreviewRequest(
      request('admin', 'limit=1', headers),
      { actor: 'admin' },
      'queue',
    );
    assert.ok([400, 403].includes(response.status));
  }
  const old = await enquiryPreviewRequest(
    request('admin', 'filter=overdue', {}, 'enquiries'),
    { actor: 'admin' },
    'list',
  );
  assert.equal(old.status, 400);
  assert.equal(calls.length, 2);
});
