import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTenantManifest } from '../dist/tests/lib/tenant-manifest.js';
import { publicCompanyInfo } from '../dist/tests/lib/public-company.js';

const companyContent = {
  policy: 'public-company-content-v1',
  companySlug: 'realtime-estates',
  company: { summary: 'Synthetic summary', about: 'Synthetic content for configuration tests.' },
  advisors: [
    { id: 'synthetic-advisor', name: 'Synthetic advisor', role: 'Example', bio: 'Test only.' },
  ],
  contact: { phone: '0700000000', email: 'test@example.invalid', whatsapp: true },
};
const manifest = (overrides = {}) => ({
  policy: 'realtor-tenant-manifest-v1',
  slug: 'realtime-estates',
  brand: {
    tenantId: 'synthetic-realtime-1',
    slug: 'realtime-estates',
    companyName: 'Synthetic Realtime Estates',
    colors: {
      primary: '#5e0202',
      secondary: '#194d3e',
      accent: '#b77b27',
      background: '#ffffff',
    },
    logo: { url: '/brands/synthetic/logo.svg', alt: 'Synthetic brand mark' },
    contact: { email: 'test@example.invalid', phone: '0700000000' },
    locale: 'en-KE',
    currency: 'KES',
    features: { viewings: false, customerAccounts: false },
  },
  features: { advisorProfiles: true, contactActions: true },
  companyContent,
  ...overrides,
});

test('tenant manifest binds theme, safe public content and UI-only feature flags to the configured company', () => {
  const result = resolveTenantManifest(JSON.stringify(manifest()), 'realtime-estates');
  assert.equal(result.status, 'configured');
  assert.equal(result.manifest.slug, 'realtime-estates');
  assert.equal(result.manifest.brand.companyName, 'Synthetic Realtime Estates');
  assert.equal(result.manifest.theme.colors.primary, '#5e0202');
  assert.equal(result.manifest.themeCss['--color-primary'], '#5e0202');
  assert.equal(result.manifest.companyContent.advisors[0].id, 'synthetic-advisor');
  assert.equal(Object.isFrozen(result.manifest), true);
  assert.equal(Object.isFrozen(result.manifest.features), true);
  assert.equal(Object.isFrozen(result.manifest.companyContent.advisors), true);
});

test('tenant manifest feature flags can hide public contacts and profiles but cannot enable enquiry intake', () => {
  const config = JSON.stringify(
    manifest({ features: { advisorProfiles: false, contactActions: false } }),
  );
  const info = publicCompanyInfo({ TENANT_MANIFEST_JSON: config });
  assert.equal(info.contentStatus, 'configured');
  assert.equal(info.name, 'Synthetic Realtime Estates');
  assert.deepEqual(info.advisors, []);
  assert.equal(Object.hasOwn(info.content, 'contact'), false);
  assert.equal(info.testEnquiry, false);
});

test('tenant manifest can expose only its validated same-tenant public content when flags allow it', () => {
  const info = publicCompanyInfo({ TENANT_MANIFEST_JSON: JSON.stringify(manifest()) });
  assert.equal(info.advisors.length, 1);
  assert.equal(info.advisors[0].source, 'configuration');
  assert.equal(info.content.contact.phone, '+254700000000');
  assert.equal(info.testEnquiry, false);
});

test('tenant manifest fails closed for unknown, mismatched, duplicate-key or invalid nested configuration', () => {
  const invalid = [
    JSON.stringify(manifest({ secret: 'never allowed' })),
    JSON.stringify(manifest({ slug: 'sample-homes' })),
    JSON.stringify(
      manifest({ features: { advisorProfiles: true, contactActions: true, payments: true } }),
    ),
    JSON.stringify(
      manifest({
        brand: { ...manifest().brand, colors: { ...manifest().brand.colors, primary: 'red' } },
      }),
    ),
    JSON.stringify(manifest({ brand: { ...manifest().brand, slug: 'sample-homes' } })),
    JSON.stringify(
      manifest({ companyContent: { ...companyContent, companySlug: 'sample-homes' } }),
    ),
    '{"policy":"realtor-tenant-manifest-v1","slug":"realtime-estates","slug":"sample-homes"}',
  ];
  for (const source of invalid) {
    assert.equal(resolveTenantManifest(source, 'realtime-estates').status, 'invalid');
    const info = publicCompanyInfo({ TENANT_MANIFEST_JSON: source });
    assert.equal(info.contentStatus, 'invalid');
    assert.equal(info.content, null);
    assert.deepEqual(info.advisors, []);
  }
});

test('tenant manifest distinguishes an absent opt-in from malformed or excessive input', () => {
  assert.equal(resolveTenantManifest(undefined, 'realtime-estates').status, 'absent');
  assert.equal(resolveTenantManifest('', 'realtime-estates').status, 'invalid');
  assert.equal(resolveTenantManifest(' '.repeat(65 * 1024), 'realtime-estates').status, 'invalid');
});
