import test from 'node:test';
import assert from 'node:assert/strict';
import {
  readApprovedCompany,
  approvedCompanyInfo,
  approvedPresentation,
} from '../dist/tests/lib/approved-company.js';
const id = '00000000-0000-4000-8000-000000000001';
const content = {
  companyName: 'Synthetic approved agency',
  summary: 'Approved summary.',
  about: 'Fictional verification only.',
  officeAddress: null,
  openingHours: 'Weekdays',
  colors: { primary: '#194d3e', secondary: '#5e0202', accent: '#b77b27', background: '#ffffff' },
};
const env = {
  NODE_ENV: 'development',
  TENANT_SLUG: 'realtime-estates',
  WEB_COMPANY_SETTINGS_MODE: 'synthetic-v1',
  WEB_COMPANY_SETTINGS_ORIGIN: 'http://127.0.0.1:4101',
};
test('approved public settings use fixed anonymous origin, current company, bounded plain projection and semantic preview', async () => {
  let calls = 0;
  const result = await readApprovedCompany(env, async (url, init) => {
    calls++;
    assert.equal(url, 'http://127.0.0.1:4101/v2/public/company-settings');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.redirect, 'error');
    assert.deepEqual(init.headers, { Accept: 'application/json' });
    return Response.json({ policy: 'public-company-settings-v1', tenantId: id, content });
  });
  assert.equal(calls, 1);
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.content, content);
  const info = approvedCompanyInfo(result, env);
  assert.equal(info.name, content.companyName);
  assert.equal(info.content.company.about, content.about);
  assert.equal(info.content.contact, undefined);
  assert.equal(info.advisors.length, 0);
  assert.equal(approvedPresentation(result).brand.primary, '#194d3e');
});
test('approved public settings fail closed on wrong company, malformed/oversized body, unavailable origin and production boundary', async () => {
  for (const source of [
    {
      policy: 'public-company-settings-v1',
      tenantId: id,
      content: { ...content, token: 'secret' },
    },
    { policy: 'public-company-settings-v1', tenantId: id.replace(/1$/, '2'), content },
    { policy: 'public-company-settings-v1', tenantId: id, content, actorId: 'private' },
  ])
    assert.equal(
      (await readApprovedCompany(env, async () => Response.json(source))).status,
      'unavailable',
    );
  for (const changed of [
    { NODE_ENV: 'production' },
    { WEB_COMPANY_SETTINGS_ORIGIN: 'https://example.test' },
    { WEB_COMPANY_SETTINGS_ORIGIN: 'http://127.0.0.1:4101/?company=other' },
    { TENANT_SLUG: 'foreign' },
  ])
    assert.equal(
      (
        await readApprovedCompany({ ...env, ...changed }, async () => {
          throw Error('Must not fetch');
        })
      ).status,
      'unavailable',
    );
  assert.equal(
    (
      await readApprovedCompany(
        env,
        async () =>
          new Response('x'.repeat(32769), { headers: { 'content-type': 'application/json' } }),
      )
    ).status,
    'unavailable',
  );
  assert.equal(
    (
      await readApprovedCompany(env, async () => {
        throw Error('Offline');
      })
    ).status,
    'unavailable',
  );
  const info = approvedCompanyInfo({ status: 'unavailable', content: null }, env);
  assert.equal(info.content, null);
  assert.equal(info.contentStatus, 'invalid');
  assert.equal(
    (
      await readApprovedCompany({}, async () => {
        throw Error('Disabled');
      })
    ).status,
    'absent',
  );
});
