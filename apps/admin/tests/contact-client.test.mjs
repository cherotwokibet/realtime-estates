import assert from 'node:assert/strict';
import test from 'node:test';
import { createEnquiryPreviewClient } from '../dist/tests/lib/enquiry-client.js';

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const enquiry = id(5),
  operation = id(6),
  actor = id(1),
  instance = id(3),
  now = '2026-10-12T12:00:00.000Z';
const command = {
  operationId: operation,
  expectedVersion: 1,
  channel: 'call',
  outcome: 'connected',
  occurredAt: now,
  notes: '  Private synthetic note.\nKeep spacing.  ',
};
const facts = {
  channel: command.channel,
  outcome: command.outcome,
  occurredAt: now,
  notes: command.notes,
};
const receipt = {
  operationId: operation,
  enquiryId: enquiry,
  actorId: actor,
  expectedVersion: '1',
  observedVersion: '1',
  request: facts,
  outcome: 'applied',
  reason: null,
  entry: { entryId: operation, actorId: actor, ...facts, recordedAt: now },
  completedAt: now,
};
const context = { params: Promise.resolve({ actor: 'admin', id: enquiry }) };
function request(method = 'POST', suffix = '', body = JSON.stringify(command), extra = {}) {
  return new Request(
    `http://127.0.0.1:3001/api/enquiry-preview/admin/enquiries/${enquiry}/contacts${suffix}`,
    {
      method,
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://127.0.0.1:3001',
        'sec-fetch-site': 'same-origin',
        'x-preview-instance': instance,
        ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
        ...extra,
      },
      ...(method === 'POST' ? { body } : {}),
    },
  );
}

test('browser contact client freezes validation and carries private original facts only in bodies', async () => {
  let calls = [];
  const client = createEnquiryPreviewClient({
    basePath: '/api/enquiry-preview/admin',
    instanceId: instance,
    fetch: async (path, init) => {
      calls.push({ path, init });
      return Response.json(
        path.endsWith('?limit=25') ? { items: [], limit: 25, truncated: false } : receipt,
      );
    },
  });
  const original = { ...command, expectedVersion: '1' };
  assert.deepEqual(await client.recordContact(enquiry, original), receipt);
  assert.deepEqual(await client.recoverContact(enquiry, original), receipt);
  assert.deepEqual(await client.contacts(enquiry), { items: [], limit: 25, truncated: false });
  assert.equal(calls.length, 3);
  assert.ok(calls[1].path.endsWith('/contacts/recover'));
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(JSON.parse(calls[1].init.body).notes, command.notes);
  for (const call of calls) {
    assert.equal(call.path.includes('Private'), false);
    assert.equal(call.init.credentials, 'omit');
    assert.equal(new Headers(call.init.headers).has('authorization'), false);
  }
  await assert.rejects(
    client.recordContact(enquiry, { ...original, actorId: actor }),
    (error) => error.kind === 'validation',
  );
  assert.equal(calls.length, 3);
});
test('browser contact recovery failures remain reads; write failures and altered successful facts remain uncertain', async () => {
  let count = 0;
  const client = createEnquiryPreviewClient({
      basePath: '/api/enquiry-preview/admin',
      instanceId: instance,
      fetch: async () => {
        count++;
        throw new Error('lost');
      },
    }),
    original = { ...command, expectedVersion: '1' };
  await assert.rejects(
    client.recoverContact(enquiry, original),
    (error) => error.kind === 'network' && !error.uncertain,
  );
  await assert.rejects(
    client.recordContact(enquiry, original),
    (error) => error.kind === 'network' && error.uncertain,
  );
  assert.equal(count, 2);
  const altered = createEnquiryPreviewClient({
    basePath: '/api/enquiry-preview/admin',
    instanceId: instance,
    fetch: async () => Response.json({ ...receipt, request: { ...facts, notes: 'changed' } }),
  });
  await assert.rejects(
    altered.recordContact(enquiry, original),
    (error) => error.kind === 'response' && error.uncertain,
  );
  await assert.rejects(
    altered.recoverContact(enquiry, original),
    (error) => error.kind === 'response' && !error.uncertain,
  );
});
