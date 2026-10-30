import test from 'node:test';
import assert from 'node:assert/strict';
import {
  listingReportConfig,
  authorizeListingReport,
} from '../dist/tests/lib/listing-report-config.js';
const instance = '00000000-0000-4000-8000-000000000001';
const env = {
  NODE_ENV: 'development',
  WEB_REPORT_PREVIEW_MODE: 'synthetic-v1',
  WEB_CATALOGUE_MODE: 'connected',
  WEB_CATALOGUE_DATA: 'synthetic',
  TENANT_SLUG: 'realtime-estates',
  WEB_REPORT_API_ORIGIN: 'http://127.0.0.1:4100',
  API_ORIGIN: 'http://127.0.0.1:4100',
  WEB_REPORT_INSTANCE: instance,
};
test('report configuration binds explicit development instance to the same catalogue without staff identity', () => {
  const scope = listingReportConfig(env);
  assert.ok(Object.isFrozen(scope));
  assert.equal(Object.hasOwn(scope, 'bearerToken'), false);
  for (const patch of [
    { NODE_ENV: 'production' },
    { WEB_REPORT_PREVIEW_MODE: undefined },
    { WEB_CATALOGUE_MODE: 'demo' },
    { API_ORIGIN: 'http://127.0.0.1:4101' },
    { WEB_REPORT_API_ORIGIN: 'https://external.invalid' },
    { WEB_REPORT_INSTANCE: 'invalid' },
    { TENANT_SLUG: 'unknown' },
  ])
    assert.throws(() => listingReportConfig({ ...env, ...patch }));
});
test('report browser requests require same origin and current instance and reject cookie/authority forwarding', () => {
  const headers = {
    host: '127.0.0.1:3135',
    origin: 'http://127.0.0.1:3135',
    'x-preview-instance': instance,
  };
  const req = (patch) =>
    new Request('http://127.0.0.1:3135/api/listing-report', { headers: { ...headers, ...patch } });
  authorizeListingReport(req({}), instance);
  for (const patch of [
    { origin: 'https://external.invalid' },
    { 'x-preview-instance': 'old' },
    { cookie: 'session=ignored' },
    { authorization: 'Bearer ignored' },
    { 'x-tenant-id': instance },
    { 'sec-fetch-site': 'cross-site' },
  ])
    assert.throws(() => authorizeListingReport(req(patch), instance));
});
