import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertPreviewRequest,
  previewConfiguration,
  upstreamFailureStatus,
} from '../dist/tests/lib/staff-preview-policy.js';
const instance = '00000000-0000-4000-8000-000000000001';
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'a.b.c',
  STAFF_PREVIEW_INSTANCE: instance,
};
test('synthetic identity is restricted to explicit development and an exact loopback origin', () => {
  assert.equal(previewConfiguration(env).origin, env.STAFF_PREVIEW_API_ORIGIN);
  for (const change of [
    { NODE_ENV: 'production' },
    { NODE_ENV: 'test' },
    { STAFF_PREVIEW_MODE: undefined },
    { STAFF_PREVIEW_API_ORIGIN: 'https://external.example' },
    { STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101/path' },
    { STAFF_PREVIEW_TOKEN: 'bad token' },
  ])
    assert.throws(() => previewConfiguration({ ...env, ...change }));
});
test('BFF rejects cross-origin writes, missing origin, selected client identity and rebinding hosts', () => {
  const url = 'http://127.0.0.1:3001/api/staff/drafts/id/1';
  const make = (headers = {}, method = 'PUT') =>
    new Request(url, {
      method,
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://127.0.0.1:3001',
        'content-type': 'application/json',
        'x-preview-instance': instance,
        ...headers,
      },
    });
  assert.doesNotThrow(() => assertPreviewRequest(make(), instance));
  assert.doesNotThrow(() => assertPreviewRequest(make({}, 'GET'), instance));
  assert.doesNotThrow(() =>
    assertPreviewRequest(
      new Request('http://localhost:3001/api', {
        method: 'PUT',
        headers: {
          host: '127.0.0.1:3001',
          origin: 'http://127.0.0.1:3001',
          'content-type': 'application/json',
          'x-preview-instance': instance,
        },
      }),
      instance,
    ),
  );
  for (const change of [
    { origin: 'https://external.example' },
    { origin: '' },
    { authorization: 'Bearer selected' },
    { host: 'external.example' },
    { 'content-type': 'text/plain' },
    { 'sec-fetch-site': 'cross-site' },
    { 'x-preview-instance': 'previous-preview' },
  ])
    assert.throws(() => assertPreviewRequest(make(change), instance));
  assert.throws(() =>
    assertPreviewRequest(
      new Request('http://external.example/api', { headers: { host: 'external.example' } }),
      instance,
    ),
  );
});
test('malformed upstream success becomes failure; real authorization/conflict statuses survive', () => {
  assert.equal(upstreamFailureStatus(200, 'INVALID_RESPONSE'), 502);
  assert.equal(upstreamFailureStatus(undefined, 'VALIDATION'), 400);
  assert.equal(upstreamFailureStatus(409, 'HTTP'), 409);
  assert.equal(upstreamFailureStatus(401, 'HTTP'), 401);
});

test('binary and empty photo commands retain loopback origin instance and credential boundaries', () => {
  const make = (type, patch = {}, body) =>
    new Request('http://127.0.0.1:3001/api/photo', {
      method: 'POST',
      headers: {
        host: '127.0.0.1:3001',
        origin: 'http://127.0.0.1:3001',
        'x-preview-instance': instance,
        ...(type ? { 'content-type': type } : {}),
        ...patch,
      },
      ...(body ? { body } : {}),
    });
  assert.doesNotThrow(() =>
    assertPreviewRequest(make('application/octet-stream'), instance, 'binary'),
  );
  assert.doesNotThrow(() => assertPreviewRequest(make(null), instance, 'empty'));
  assert.throws(() => assertPreviewRequest(make('application/json'), instance, 'binary'));
  assert.throws(() => assertPreviewRequest(make('application/octet-stream'), instance, 'empty'));
  assert.throws(() =>
    assertPreviewRequest(make(null, { 'content-length': '1' }), instance, 'empty'),
  );
  assert.doesNotThrow(() =>
    assertPreviewRequest(make(null, {}, new Uint8Array()), instance, 'empty'),
  );
  for (const patch of [
    { origin: 'http://elsewhere.invalid' },
    { 'x-preview-instance': 'old' },
    { authorization: 'Bearer selected' },
    { host: 'evil.invalid' },
    { 'sec-fetch-site': 'cross-site' },
  ])
    assert.throws(() =>
      assertPreviewRequest(make('application/octet-stream', patch), instance, 'binary'),
    );
});
