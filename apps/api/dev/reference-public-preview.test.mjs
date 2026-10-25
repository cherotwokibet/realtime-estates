import test from 'node:test';
import assert from 'node:assert/strict';
import { RealtorApiClient } from '@realtor/api-client';
import { startStaffPreview } from './staff-preview.mjs';
import {
  referencePublicLaunchConfiguration,
  referencePublicWebEnvironment,
} from './reference-public-launch-config.mjs';
const modes = {
  referenceDraftMode: 'synthetic-reference-draft-v1',
  referenceModerationMode: 'synthetic-reference-transition-v1',
  referencePublicMode: 'synthetic-reference-public-v1',
};
const env = {
  NODE_ENV: 'development',
  WEB_CATALOGUE_REFERENCE: 'synthetic-reference-public-v1',
  REFERENCE_PUBLIC_UI_PORT: '3007',
};
test('public reference startup requires explicit compatible modes and an unambiguous separate UI port', async () => {
  for (const patch of [
    { referencePublicMode: 'live' },
    { referencePublicMode: modes.referencePublicMode },
    { ...modes, referenceModerationMode: undefined },
  ])
    await assert.rejects(() => startStaffPreview({ port: 0, ...patch }));
  for (const patch of [
    { NODE_ENV: 'production' },
    { WEB_CATALOGUE_REFERENCE: undefined },
    { WEB_CATALOGUE_REFERENCE: 'live' },
    ...['3000', '3001', '03007', '80', '65536'].map((REFERENCE_PUBLIC_UI_PORT) => ({
      REFERENCE_PUBLIC_UI_PORT,
    })),
  ])
    assert.throws(() => referencePublicLaunchConfiguration({ ...env, ...patch }));
});
test('public web child receives only public read configuration and no inherited staff bearer or enquiry write mode', () => {
  const source = {
    ...env,
    STAFF_PREVIEW_TOKEN: 'PRIVATE SENTINEL',
    STAFF_PREVIEW_API_ORIGIN: 'http://127.0.0.1:1',
    WEB_ENQUIRY_PREVIEW_MODE: 'synthetic-v1',
    WEB_ENQUIRY_PROPERTY_MODE: 'synthetic-v1',
    WEB_ENQUIRY_INSTANCE: 'private',
    WEB_ENQUIRY_API_ORIGIN: 'http://127.0.0.1:1',
  };
  const preview = {
    origin: 'http://127.0.0.1:4109',
    tenantSlug: 'realtime-estates',
    syntheticPublicReferences: true,
    bearerToken: 'ANOTHER PRIVATE SENTINEL',
  };
  const child = referencePublicWebEnvironment(source, preview);
  assert.equal(child.API_ORIGIN, preview.origin);
  assert.equal(child.WEB_CATALOGUE_MODE, 'connected');
  assert.equal(child.WEB_CATALOGUE_REFERENCE, modes.referencePublicMode);
  assert.equal(child.ALLOW_LOOPBACK_API, 'true');
  assert.ok(!JSON.stringify(child).includes('PRIVATE'));
  assert.equal(child.WEB_ENQUIRY_PREVIEW_MODE, undefined);
  assert.equal(source.STAFF_PREVIEW_TOKEN, 'PRIVATE SENTINEL');
  assert.throws(() =>
    referencePublicWebEnvironment(source, { ...preview, origin: 'https://outside.invalid' }),
  );
});

test('public journey launcher requires an exact fixture and matches its owned API before spawning the website', () => {
  const configured = { ...env, REFERENCE_PUBLIC_JOURNEY_FIXTURE: 'public-search-v1' };
  assert.equal(referencePublicLaunchConfiguration(configured).journeyFixture, 'public-search-v1');
  for (const value of ['', 'enquiry-queue-v1', 'Public-search-v1', 'public-search-v1 ', true])
    assert.throws(() =>
      referencePublicLaunchConfiguration({ ...env, REFERENCE_PUBLIC_JOURNEY_FIXTURE: value }),
    );
  const preview = {
    origin: 'http://127.0.0.1:4109',
    tenantSlug: 'realtime-estates',
    syntheticPublicReferences: true,
  };
  assert.throws(() => referencePublicWebEnvironment(configured, preview));
  const child = referencePublicWebEnvironment(configured, {
    ...preview,
    journeyFixture: { kind: 'public-search-v1' },
  });
  assert.equal(child.REFERENCE_PUBLIC_JOURNEY_FIXTURE, undefined);
  assert.equal(child.TENANT_SLUG, 'realtime-estates');
});
test('anonymous real HTTP public read exposes only approved historical reference facts and stays tenant isolated', async (t) => {
  const p = await startStaffPreview({ port: 0, ...modes });
  t.after(() => p.close());
  const calls = [],
    sdk = new RealtorApiClient({
      baseUrl: p.origin,
      privacyNoticeVersion: 'synthetic',
      allowLoopbackHttp: true,
      fetch: async (url, init) => {
        calls.push(init);
        return fetch(url, init);
      },
    });
  const page = await sdk.getSyntheticReferencePropertiesV3({ limit: 10 });
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0].id, p.referencePublicListingId);
  assert.equal(page.items[0].reference.revisionVersion, '5');
  assert.equal(page.items[0].reference.attributes.catalogueVersion, '1');
  assert.equal(
    page.items[0].reference.attributes.location.neighbourhood.label,
    'Synthetic preview block',
  );
  assert.equal(page.items[0].reference.attributes.amenities[0].label, 'Synthetic preview lift');
  assert.equal(page.items[0].amountMinor, 2000000);
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.ok(!JSON.stringify(page).includes('PRIVATE SYNTHETIC STAFF FIXTURE ADDRESS'));
  assert.ok(!JSON.stringify(page).includes('referenceCatalogue'));
  assert.ok(!JSON.stringify(p).includes(p.bearerToken));
  assert.equal(p.syntheticPublicReferences, true);
  const current = await sdk.getSyntheticReferenceCatalogueV3('current', {
    bearerToken: p.bearerToken,
  });
  assert.equal(current.version, '2');
  for (const [path, init, status] of [
    ['/v3/properties?tenant=2', {}, 400],
    ['/v3/properties?limit=01', {}, 400],
    ['/v3/properties', { method: 'POST' }, 405],
  ])
    assert.equal((await fetch(p.origin + path, init)).status, status);
  const other = await startStaffPreview({ port: 0, tenantSlug: 'sample-homes', ...modes });
  t.after(() => other.close());
  const rows = await new RealtorApiClient({
    baseUrl: other.origin,
    privacyNoticeVersion: 'synthetic',
    allowLoopbackHttp: true,
  }).getSyntheticReferencePropertiesV3({ limit: 10 });
  assert.equal(rows.items.length, 1);
  assert.equal(rows.items[0].id, other.referencePublicListingId);
  assert.notEqual(rows.items[0].id, page.items[0].id);
});
test('a moderation-only disposable preview never exposes the anonymous public relay', async (t) => {
  const p = await startStaffPreview({
    port: 0,
    referenceDraftMode: modes.referenceDraftMode,
    referenceModerationMode: modes.referenceModerationMode,
  });
  t.after(() => p.close());
  assert.equal(p.syntheticPublicReferences, false);
  assert.equal((await fetch(p.origin + '/v3/properties')).status, 404);
});
