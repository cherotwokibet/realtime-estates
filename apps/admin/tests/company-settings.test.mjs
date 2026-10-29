import test from 'node:test';
import assert from 'node:assert/strict';
import {
  companySettingsBoundary,
  loadCompanySettings,
} from '../dist/tests/lib/company-settings-server.js';
const instance = '00000000-0000-4000-8000-000000000001';
const env = {
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:4101',
  STAFF_PREVIEW_TOKEN: 'synthetic.bearer.signature',
  STAFF_PREVIEW_INSTANCE: instance,
};
const empty = {
  policy: 'company-settings-state-v1',
  version: '0',
  current: null,
  history: [],
  hasMore: false,
};
test('settings BFF accepts the largest Unicode history page within its explicit byte bound', async () => {
  const old = globalThis.fetch;
  const content = {
    companyName: 'Synthetic Unicode',
    summary: '😀'.repeat(320),
    about: '😀'.repeat(4000),
    officeAddress: '😀'.repeat(320),
    openingHours: '😀'.repeat(320),
    colors: { primary: '#5e0202', secondary: '#194d3e', accent: '#b77b27', background: '#ffffff' },
  };
  const history = Array.from({ length: 20 }, (_, i) => {
    const version = 20 - i;
    const op = '00000000-0000-4000-8000-' + String(version).padStart(12, '0');
    return {
      version: String(version),
      operationId: op,
      actorId: instance,
      recordedAt: '2026-10-29T01:00:00.000Z',
      request: {
        policy: 'company-settings-command-v1',
        operationId: op,
        expectedVersion: String(version - 1),
        content,
        approval: 'approved-for-publication',
      },
    };
  });
  const state = {
    policy: 'company-settings-state-v1',
    version: '20',
    current: content,
    history,
    hasMore: false,
  };
  assert.ok(new TextEncoder().encode(JSON.stringify(state)).byteLength > 256 * 1024);
  try {
    globalThis.fetch = async () => Response.json(state);
    const result = await loadCompanySettings(env);
    assert.equal(result.state.history.length, 20);
  } finally {
    globalThis.fetch = old;
  }
});
const request = (path = '/api/company-settings', options = {}) =>
  new Request('http://127.0.0.1:3116' + path, {
    ...options,
    headers: { Host: '127.0.0.1:3116', 'x-preview-instance': instance, ...options.headers },
  });
test('settings BFF never forwards browser authority, host, cookies or instance to API', async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'http://127.0.0.1:4101/v2/staff/company-settings');
      assert.deepEqual(init.headers, {
        Authorization: 'Bearer synthetic.bearer.signature',
        Accept: 'application/json',
      });
      assert.equal(init.cache, 'no-store');
      assert.equal(init.redirect, 'error');
      return Response.json(empty);
    };
    const result = await loadCompanySettings(env);
    assert.deepEqual(result.state, empty);
    assert.equal(result.instanceId, instance);
    const response = await companySettingsBoundary(request(), null, env);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), empty);
    assert.match(response.headers.get('cache-control'), /no-store/);
  } finally {
    globalThis.fetch = old;
  }
});
test('settings BFF refuses production, stale instance, external host, query authority and duplicate command keys before transport', async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async () => {
      throw Error('No dispatch allowed');
    };
    assert.equal(
      (await companySettingsBoundary(request(), null, { ...env, NODE_ENV: 'production' })).status,
      403,
    );
    assert.equal(
      (
        await companySettingsBoundary(
          request('/api/company-settings', { headers: { 'x-preview-instance': 'stale' } }),
          null,
          env,
        )
      ).status,
      403,
    );
    assert.equal(
      (
        await companySettingsBoundary(
          request('/api/company-settings', { headers: { Host: 'evil.test' } }),
          null,
          env,
        )
      ).status,
      403,
    );
    assert.equal(
      (await companySettingsBoundary(request('/api/company-settings?tenant=foreign'), null, env))
        .status,
      400,
    );
    assert.equal(
      (
        await companySettingsBoundary(
          request('/api/company-settings', { headers: { cookie: 'session=caller' } }),
          null,
          env,
        )
      ).status,
      400,
    );
    const op = '00000000-0000-4000-8000-000000000100';
    const post = request('/api/company-settings/operations/' + op, {
      method: 'POST',
      headers: { Origin: 'http://127.0.0.1:3116', 'Content-Type': 'application/json' },
      body: '{"operationId":"' + op + '","operationId":"' + op + '"}',
    });
    assert.equal((await companySettingsBoundary(post, op, env)).status, 400);
  } finally {
    globalThis.fetch = old;
  }
});
test('settings BFF does not turn malformed success into a committed result or erase current denied authority', async () => {
  const old = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ ...empty, history: [{ private: 'invalid' }] });
    assert.equal((await companySettingsBoundary(request(), null, env)).status, 502);
    globalThis.fetch = async () => Response.json({ private: 'should not leak' }, { status: 403 });
    const response = await companySettingsBoundary(request(), null, env);
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'ACCESS_ENDED' });
  } finally {
    globalThis.fetch = old;
  }
});
