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
  const gateway = createNativeCustomerGateway(config, {
    transport: configuredHostedApiTransport(process.env, config.apiOrigin, config.projectId),
  });
  instance = async (request) => {
    // Next constructs request.url from its internal listener. Only the configured public Host
    // and the exact HTTPS edge protocol may supply the external origin; forwarded hosts
    // cannot choose a destination. Cloud Run edge/ingress assumptions still require live proof.
    const host = new URL(config.applicationOrigin).host;
    const forwardedHost = request.headers.get('x-forwarded-host');
    if (
      request.headers.get('host') !== host ||
      request.headers.get('x-forwarded-proto') !== 'https' ||
      (forwardedHost !== null && forwardedHost !== host)
    )
      return Response.json(
        { error: { code: 'CUSTOMER_REQUEST_UNAVAILABLE' } },
        {
          status: 403,
          headers: {
            'Cache-Control': 'no-store',
            Vary: 'Authorization',
            'X-Content-Type-Options': 'nosniff',
          },
        },
      );
    const internal = new URL(request.url);
    return gateway(
      new Request(config.applicationOrigin + internal.pathname + internal.search, request),
    );
  };
  return instance;
}
