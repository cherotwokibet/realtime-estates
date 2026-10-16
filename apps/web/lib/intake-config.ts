import { resolveDemoTenantSlug } from '@realtor/demo';
export const SYNTHETIC_INTAKE_NOTICE = 'synthetic-staff-notice-v1';
/** Deployment settings only. No staff identity is needed or accepted by the public application. */
export function publicIntakeConfig(env: Readonly<Record<string, string | undefined>>) {
  if (env.NODE_ENV !== 'development' || env.WEB_ENQUIRY_PREVIEW_MODE !== 'synthetic-v1')
    throw new Error('Synthetic intake is unavailable.');
  const tenantSlug = resolveDemoTenantSlug(env.TENANT_SLUG);
  if (
    env.WEB_ENQUIRY_PROPERTY_MODE !== undefined &&
    env.WEB_ENQUIRY_PROPERTY_MODE !== '' &&
    env.WEB_ENQUIRY_PROPERTY_MODE !== 'synthetic-v1'
  )
    throw new Error('Invalid property enquiry mode.');
  const origin = new URL(env.WEB_ENQUIRY_API_ORIGIN ?? '');
  if (
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.pathname !== '/' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash
  )
    throw new Error('Invalid preview origin.');
  if (
    env.WEB_ENQUIRY_PROPERTY_MODE === 'synthetic-v1' &&
    (env.WEB_CATALOGUE_MODE !== 'connected' ||
      env.WEB_CATALOGUE_DATA !== 'synthetic' ||
      env.API_ORIGIN !== origin.origin)
  )
    throw new Error('Property enquiries require the same connected synthetic catalogue.');
  const instanceId = env.WEB_ENQUIRY_INSTANCE;
  if (
    !instanceId ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(instanceId)
  )
    throw new Error('Invalid preview instance.');
  return Object.freeze({
    apiOrigin: origin.origin,
    instanceId,
    tenantSlug,
    noticeVersion: SYNTHETIC_INTAKE_NOTICE,
    allowProperty: env.WEB_ENQUIRY_PROPERTY_MODE === 'synthetic-v1',
  });
}
export function authorizePublicIntake(request: Request, instanceId: string): void {
  const url = new URL(request.url),
    host = request.headers.get('host');
  if (
    url.protocol !== 'http:' ||
    !['127.0.0.1', 'localhost'].includes(url.hostname) ||
    host !== `127.0.0.1${url.port ? `:${url.port}` : ''}` ||
    request.headers.get('origin') !== `http://${host}` ||
    request.headers.get('x-preview-instance') !== instanceId ||
    request.headers.has('authorization')
  )
    throw new Error('Same-origin preview required.');
  const site = request.headers.get('sec-fetch-site');
  if (site && !['same-origin', 'none'].includes(site))
    throw new Error('Same-origin preview required.');
}
