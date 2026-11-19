import 'server-only';
import {
  createNativeCustomerGateway,
  readNativeCustomerGatewayEnvironment,
} from '@realtor/api/dist/native-customer-gateway.js';
import { configuredHostedApiTransport } from '@realtor/api/dist/cloud-run-invocation.js';
import { tenantManifest, tenantSlug } from './tenant';
let instance: ReturnType<typeof createNativeCustomerGateway> | undefined;
/** Explicit default-off native bearer ingress; never a preview/cookie-session fallback. */
export function nativeCustomerGateway() {
  const config = readNativeCustomerGatewayEnvironment(process.env);
  if (!config) return null;
  if (instance) return instance;
  const expected =
    tenantManifest.status === 'configured'
      ? tenantManifest.manifest.brand.tenantId
      : tenantSlug === 'sample-homes'
        ? '00000000-0000-4000-8000-000000000002'
        : '00000000-0000-4000-8000-000000000001';
  if (config.tenantId !== expected)
    throw Error('Native customer company does not match this site.');
  instance = createNativeCustomerGateway(config, {
    transport: configuredHostedApiTransport(process.env, config.apiOrigin, config.projectId),
  });
  return instance;
}
