import { resolveDemoTenantSlug } from '@realtor/demo';
import { authorizePublicIntake } from './intake-config.ts';
/** Explicit disposable mode only; public runtime never receives a staff credential. */
export function listingReportConfig(env: Readonly<Record<string, string | undefined>>) {
  if (
    env.NODE_ENV !== 'development' ||
    env.WEB_REPORT_PREVIEW_MODE !== 'synthetic-v1' ||
    env.WEB_CATALOGUE_MODE !== 'connected' ||
    env.WEB_CATALOGUE_DATA !== 'synthetic'
  )
    throw Error('Listing reports unavailable.');
  const tenantSlug = resolveDemoTenantSlug(env.TENANT_SLUG),
    origin = new URL(env.WEB_REPORT_API_ORIGIN ?? '');
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    !origin.port ||
    origin.pathname !== '/' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    env.API_ORIGIN !== origin.origin
  )
    throw Error('Reports require the same owned synthetic catalogue.');
  const instanceId = env.WEB_REPORT_INSTANCE;
  if (
    !instanceId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(instanceId)
  )
    throw Error('Report preview instance unavailable.');
  return Object.freeze({
    apiOrigin: origin.origin,
    instanceId,
    tenantSlug,
    noticeVersion: 'synthetic-staff-notice-v1',
  });
}
export function authorizeListingReport(request: Request, instanceId: string): void {
  // Browsers omit Origin on same-origin GET. Only a browser-declared same-origin
  // read with a matching referrer can use that alternative; writes still require Origin.
  let checked = request;
  if (request.method === 'GET' && !request.headers.has('origin')) {
    // Next's internal Request URL may use localhost while the browser Host is
    // 127.0.0.1. The shared boundary below validates the exact loopback Host.
    const origin = `http://${request.headers.get('host')}`;
    if (
      request.headers.get('sec-fetch-site') !== 'same-origin' ||
      new URL(request.headers.get('referer') ?? '').origin !== origin
    )
      throw Error('Same-origin report recovery required.');
    const headers = new Headers(request.headers);
    headers.set('origin', origin);
    checked = new Request(request, { headers });
  }
  authorizePublicIntake(checked, instanceId);
  if (
    request.headers.has('cookie') ||
    request.headers.has('x-tenant-id') ||
    request.headers.has('x-actor-id') ||
    request.headers.has('idempotency-key') ||
    request.headers.has('content-encoding')
  )
    throw Error('Report requests accept no caller authority.');
}
