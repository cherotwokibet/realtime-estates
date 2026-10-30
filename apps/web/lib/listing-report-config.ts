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
  authorizePublicIntake(request, instanceId);
  if (
    request.headers.has('cookie') ||
    request.headers.has('x-tenant-id') ||
    request.headers.has('x-actor-id') ||
    request.headers.has('idempotency-key') ||
    request.headers.has('content-encoding')
  )
    throw Error('Report requests accept no caller authority.');
}
