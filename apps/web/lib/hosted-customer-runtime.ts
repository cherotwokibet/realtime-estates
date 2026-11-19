import 'server-only';
import { readFirebaseBrowserEnvironment } from '@realtor/api/dist/browser-identity-runtime.js';
import { createCustomerOriginals } from '@realtor/api/dist/customer-browser-originals.js';
import { createHostedCustomerBrowser } from '@realtor/api/dist/hosted-customer-browser.js';
import { hostedIdentity } from './hosted-identity';
import { loadProperty } from './catalogue-server';
import { tenantManifest, tenantSlug } from './tenant';

let instance: ReturnType<typeof createHostedCustomerBrowser> | undefined;
/** Explicit hosted configuration; the synthetic adapter remains unavailable in production. */
export function hostedCustomer() {
  if (process.env.HOSTED_CUSTOMER_API_ORIGIN === undefined) return null;
  if (instance) return instance;
  const settings = readFirebaseBrowserEnvironment(process.env);
  if (!settings) throw Error('Hosted customer identity is not configured.');
  const expectedTenant =
    tenantManifest.status === 'configured'
      ? tenantManifest.manifest.brand.tenantId
      : tenantSlug === 'sample-homes'
        ? '00000000-0000-4000-8000-000000000002'
        : '00000000-0000-4000-8000-000000000001';
  if (settings.config.tenantId !== expectedTenant)
    throw Error('Hosted customer company does not match this site.');
  const apiOrigin = new URL(process.env.HOSTED_CUSTOMER_API_ORIGIN);
  if (
    apiOrigin.protocol !== 'https:' ||
    apiOrigin.origin !== process.env.HOSTED_CUSTOMER_API_ORIGIN
  )
    throw Error('Hosted customer HTTPS API origin required.');
  instance = createHostedCustomerBrowser(
    {
      applicationOrigin: settings.config.applicationOrigin,
      tenantId: settings.config.tenantId,
      apiOrigin: apiOrigin.origin,
    },
    hostedIdentity,
    createCustomerOriginals(hostedIdentity.database, settings.encryptionKey),
    fetch,
    async (id) => {
      const r = await loadProperty(id);
      return r.mode !== 'error' && r.status === 'found'
        ? {
            title: r.property.title,
            priceMinor: r.property.priceMinor,
            purpose: r.property.purpose,
            rentalPeriod: r.property.rentalPeriod,
          }
        : null;
    },
  );
  return instance;
}
