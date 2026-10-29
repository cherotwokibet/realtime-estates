import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCompanySettingsJson,
  validateCompanySettingsContent,
  validateCompanySettingsCommand,
  validateCompanySettingsRecord,
  validateCompanySettingsState,
} from '../dist/index.js';
const id = '00000000-0000-4000-8000-000000000100';
const content = {
  companyName: 'Fictional agency',
  summary: 'Fictional content.',
  about: 'Local test only.',
  officeAddress: null,
  openingHours: null,
  colors: { primary: '#5e0202', secondary: '#194d3e', accent: '#b77b27', background: '#ffffff' },
};
const cmd = {
  policy: 'company-settings-command-v1',
  operationId: id,
  expectedVersion: '0',
  content,
  approval: 'approved-for-publication',
};
test('settings JSON refuses duplicate/escaped approval and nested keys without confusing strings', () => {
  assert.deepEqual(parseCompanySettingsJson(JSON.stringify(cmd)), cmd);
  for (const source of [
    JSON.stringify(cmd).replace(
      '"expectedVersion":"0"',
      '"expectedVersion":"0","expectedVersion":"1"',
    ),
    JSON.stringify(cmd).replace(
      '"approval":"approved-for-publication"',
      '"approval":"approved-for-publication","\\u0061pproval":"pending"',
    ),
    JSON.stringify(cmd).replace(
      '"companyName":"Fictional agency"',
      '"companyName":"Fictional agency","companyName":"other"',
    ),
  ])
    assert.throws(() => parseCompanySettingsJson(source));
  const text = {
    ...cmd,
    content: { ...content, summary: 'Text says "approval": "pending" and is not a JSON field.' },
  };
  assert.deepEqual(parseCompanySettingsJson(JSON.stringify(text)), text);
});
test('settings contracts preserve public fields and exact original operation/version', () => {
  assert.deepEqual(validateCompanySettingsContent(content), content);
  assert.deepEqual(validateCompanySettingsCommand(cmd), cmd);
  const r = {
    version: '1',
    operationId: id,
    actorId: id,
    recordedAt: '2026-10-29T01:00:00.000Z',
    request: cmd,
  };
  assert.deepEqual(validateCompanySettingsRecord(r), r);
  assert.equal(
    validateCompanySettingsState({
      policy: 'company-settings-state-v1',
      version: '1',
      current: content,
      history: [r],
      hasMore: false,
    }).version,
    '1',
  );
  assert.equal(
    validateCompanySettingsState({
      policy: 'company-settings-state-v1',
      version: '0',
      current: null,
      history: [],
      hasMore: false,
    }).current,
    null,
  );
});
test('settings contracts reject authority, markup, getters, bad types and inconsistent receipts/state', () => {
  for (const c of [
    { ...content, tenantId: id },
    { ...content, companyName: '<img src=x>' },
    { ...content, about: ' ' },
    { ...content, summary: 'bad\u202e' },
    Object.defineProperty({ ...content }, 'about', {
      enumerable: true,
      get() {
        throw Error('Getter must not run');
      },
    }),
  ])
    assert.throws(() => validateCompanySettingsContent(c));
  for (const c of [
    { ...cmd, expectedVersion: 0 },
    { ...cmd, expectedVersion: '01' },
    { ...cmd, expectedVersion: '9007199254740992' },
    { ...cmd, approval: false },
    { ...cmd, companyId: id },
  ])
    assert.throws(() => validateCompanySettingsCommand(c));
  const r = {
    version: '1',
    operationId: id,
    actorId: id,
    recordedAt: '2026-10-29T01:00:00.000Z',
    request: cmd,
  };
  assert.throws(() => validateCompanySettingsRecord({ ...r, version: '2' }));
  for (const s of [
    { version: '2', current: content, history: [r], hasMore: false },
    { version: '0', current: content, history: [], hasMore: false },
    { version: '1', current: { ...content, companyName: 'Wrong' }, history: [r], hasMore: false },
    { version: '1', current: content, history: [r], hasMore: true },
  ])
    assert.throws(() =>
      validateCompanySettingsState({ policy: 'company-settings-state-v1', ...s }),
    );
});
