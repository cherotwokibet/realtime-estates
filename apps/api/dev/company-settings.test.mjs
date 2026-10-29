import test from 'node:test';
import assert from 'node:assert/strict';
import { startStaffPreview } from './staff-preview.mjs';
const content = {
  companyName: 'Synthetic approved company',
  summary: 'Approved synthetic summary.',
  about: 'Fictional content. No provider or real company claim.',
  officeAddress: null,
  openingHours: 'Monday to Friday',
  colors: { primary: '#194d3e', secondary: '#5e0202', accent: '#b77b27', background: '#ffffff' },
};
test('lost approved HTTP reply recovers one immutable original without a second update', async () => {
  const p = await startStaffPreview({
    port: 0,
    actor: 'admin',
    settingsReplyFault: 'invalid-first-approved-v1',
  });
  const c = {
    policy: 'company-settings-command-v1',
    operationId: crypto.randomUUID(),
    expectedVersion: '0',
    content,
    approval: 'approved-for-publication',
  };
  const path = p.origin + '/v2/staff/company-settings/operations/' + c.operationId;
  const headers = { Authorization: 'Bearer ' + p.bearerToken };
  try {
    const first = await fetch(path, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(c),
    });
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), { syntheticReplyCorruption: true });
    const recovered = await fetch(path, { headers });
    const receipt = await recovered.json();
    assert.equal(receipt.version, '1');
    assert.deepEqual(receipt.request, c);
    const replay = await fetch(path, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(c),
    });
    assert.deepEqual(await replay.json(), receipt);
    const current = await fetch(p.origin + '/v2/staff/company-settings', { headers });
    assert.equal((await current.json()).history.length, 1);
  } finally {
    await p.close();
  }
});
test('actual signed HTTP settings approval/readback/original recovery and anonymous projection', async () => {
  const p = await startStaffPreview({ port: 0, actor: 'admin' });
  const base = '/v2/staff/company-settings';
  const call = (path, method = 'GET', body, headers = {}) =>
    fetch(p.origin + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + p.bearerToken,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      ...(body ? { body: typeof body === 'string' ? body : JSON.stringify(body) } : {}),
    });
  try {
    let response = await call(base);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).version, '0');
    const command = {
        policy: 'company-settings-command-v1',
        operationId: crypto.randomUUID(),
        expectedVersion: '0',
        content,
        approval: 'approved-for-publication',
      },
      path = base + '/operations/' + command.operationId;
    response = await call(path, 'POST', command);
    assert.equal(response.status, 200);
    const receipt = await response.json();
    assert.deepEqual(receipt.request, command);
    assert.equal(receipt.version, '1');
    response = await call(path);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), receipt);
    response = await call(path, 'POST', command);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), receipt);
    response = await fetch(p.origin + '/v2/public/company-settings');
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      policy: 'public-company-settings-v1',
      tenantId: '00000000-0000-4000-8000-000000000001',
      content,
    });
    response = await call(base);
    assert.equal((await response.json()).history.length, 1);
    assert.equal((await call(base + '?companyId=other')).status, 400);
    assert.equal((await call(base, 'GET', undefined, { 'x-company-id': 'foreign' })).status, 400);
    assert.equal(
      (
        await call(path, 'POST', {
          ...command,
          content: { ...content, companyName: 'Altered original' },
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await call(
          path,
          'POST',
          JSON.stringify(command).replace(
            '"expectedVersion":"0"',
            '"expectedVersion":"0","expectedVersion":"0"',
          ),
        )
      ).status,
      400,
    );
    assert.equal((await fetch(p.origin + base)).status, 401);
    assert.equal((await call('/v2/public/company-settings')).status, 400);
    assert.equal(
      (
        await fetch(p.origin + '/v2/public/company-settings', {
          headers: { 'x-company-id': 'foreign' },
        })
      ).status,
      400,
    );
  } finally {
    await p.close();
  }
});
test('actual agent identity cannot read or update company settings', async () => {
  const p = await startStaffPreview({ port: 0, actor: 'agent' });
  try {
    const r = await fetch(p.origin + '/v2/staff/company-settings', {
      headers: { Authorization: 'Bearer ' + p.bearerToken },
    });
    assert.equal(r.status, 403);
    assert.equal((await r.json()).error.code, 'FORBIDDEN');
  } finally {
    await p.close();
  }
});
