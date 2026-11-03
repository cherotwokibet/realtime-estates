import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startAdminAuditPreview } from '../../api/dev/admin-audit-preview.mjs';
import { loadAdminAuditWorkspace } from '../dist/tests/lib/admin-audit-server.js';
const config = (fixture) => ({
  NODE_ENV: 'development',
  STAFF_PREVIEW_MODE: 'synthetic',
  STAFF_AUDIT_PREVIEW_MODE: 'synthetic-admin-audit-v1',
  STAFF_PREVIEW_API_ORIGIN: fixture.origin,
  STAFF_PREVIEW_TOKEN: fixture.token(),
  STAFF_PREVIEW_INSTANCE: randomUUID(),
});
test('signed audit screen loader traverses original events, filters and current revocation with no private summary', async () => {
  const fixture = await startAdminAuditPreview({ mode: 'synthetic-admin-audit-v1' });
  try {
    const env = config(fixture),
      first = await loadAdminAuditWorkspace({ limit: '5' }, env);
    assert.equal(first.page.items.length, 5);
    assert.equal(first.page.items[0].objectVersion, '26');
    assert.equal(first.page.items[0].action, 'company.settings.approved');
    const older = await loadAdminAuditWorkspace({ limit: '5', before: first.page.nextBefore }, env);
    assert.equal(older.page.items.length, 5);
    assert.equal(older.page.items[0].objectVersion, '21');
    assert.ok(!older.page.items.some((x) => first.page.items.some((y) => x.id === y.id)));
    const empty = await loadAdminAuditWorkspace(
      { actorId: '00000000-0000-4000-8000-000000000020' },
      env,
    );
    assert.deepEqual(empty.page.items, []);
    assert.doesNotMatch(
      JSON.stringify(first),
      /PRIVATE|SUMMARY|bearer|signature|operationId|correlation/,
    );
    await fixture.access(false);
    await assert.rejects(() => loadAdminAuditWorkspace({}, env));
    await fixture.access(true);
    assert.equal((await loadAdminAuditWorkspace({}, env)).page.items.length, 20);
  } finally {
    await fixture.close();
  }
});
test('second-company screen sees empty own history while fixture retains positive first-company history', async () => {
  const fixture = await startAdminAuditPreview({
    mode: 'synthetic-admin-audit-v1',
    company: 'sample-homes',
  });
  try {
    const result = await loadAdminAuditWorkspace({}, config(fixture));
    assert.equal(result.page.tenantId, '00000000-0000-4000-8000-000000000002');
    assert.deepEqual(result.page.items, []);
    assert.equal(result.page.nextBefore, null);
  } finally {
    await fixture.close();
  }
});
test('owned audit fixture refuses unsupported configuration before starting services', async () => {
  for (const config of [
    {},
    { mode: 'real' },
    { mode: 'synthetic-admin-audit-v1', company: 'foreign' },
  ])
    await assert.rejects(() => startAdminAuditPreview(config));
});
