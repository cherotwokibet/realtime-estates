import { resolveDemoTenantSlug } from '@realtor/demo';
import { journeyFixtureSelection } from './journey-fixtures.mjs';
export function referencePublicLaunchConfiguration(env) {
  if (
    env.NODE_ENV === 'production' ||
    env.WEB_CATALOGUE_REFERENCE !== 'synthetic-reference-public-v1'
  )
    throw Error('Public reference preview requires its explicit development mode.');
  const port = env.REFERENCE_PUBLIC_UI_PORT;
  if (
    typeof port !== 'string' ||
    !/^[1-9]\d{3,4}$/.test(port) ||
    Number(port) < 1024 ||
    Number(port) > 65535 ||
    ['3000', '3001'].includes(port)
  )
    throw Error('Choose an explicit separate public reference UI port.');
  const journeyFixture = journeyFixtureSelection(
    env.REFERENCE_PUBLIC_JOURNEY_FIXTURE,
    'public-search-v1',
  );
  return Object.freeze({
    port,
    tenantSlug: resolveDemoTenantSlug(env.TENANT_SLUG),
    ...(journeyFixture === undefined ? {} : { journeyFixture }),
  });
}
/** Public web reads receive the API origin but never the staff bearer or an enquiry-write configuration. */
export function referencePublicWebEnvironment(env, preview) {
  const config = referencePublicLaunchConfiguration(env),
    url = new URL(preview.origin);
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    preview.tenantSlug !== config.tenantSlug ||
    preview.journeyFixture?.kind !== config.journeyFixture ||
    preview.syntheticPublicReferences !== true
  )
    throw Error('An owned disposable public reference preview is required.');
  const child = {
    ...env,
    NODE_ENV: 'development',
    WEB_CATALOGUE_MODE: 'connected',
    WEB_CATALOGUE_DATA: 'synthetic',
    WEB_CATALOGUE_REFERENCE: 'synthetic-reference-public-v1',
    API_ORIGIN: url.origin,
    ALLOW_LOOPBACK_API: 'true',
    TENANT_SLUG: config.tenantSlug,
  };
  for (const key of [
    'STAFF_PREVIEW_TOKEN',
    'STAFF_PREVIEW_API_ORIGIN',
    'WEB_ENQUIRY_PREVIEW_MODE',
    'WEB_ENQUIRY_PROPERTY_MODE',
    'WEB_ENQUIRY_API_ORIGIN',
    'WEB_ENQUIRY_INSTANCE',
    'REFERENCE_PUBLIC_JOURNEY_FIXTURE',
  ])
    delete child[key];
  return child;
}
