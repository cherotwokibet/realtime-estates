import 'server-only';
import { RealtorApiClient } from '@realtor/api-client';
import { adminAuditQuery, type AdminAuditQuery } from '@realtor/domain';
import { previewConfiguration } from './staff-preview-policy.ts';

type Env = Readonly<Record<string, string | undefined>>;
export function adminAuditHostAllowed(host: string | null, env: Env): boolean {
  try {
    previewConfiguration(env);
    if (env.STAFF_AUDIT_PREVIEW_MODE !== 'synthetic-admin-audit-v1') return false;
    const url = new URL(env.STAFF_AUDIT_WEB_ORIGIN ?? '');
    return (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash &&
      !url.username &&
      !url.password &&
      host === url.host
    );
  } catch {
    return false;
  }
}
/** Next searchParams are untrusted input. Arrays/unknown authority selectors fail closed. */
export function adminAuditSearch(input: unknown): AdminAuditQuery {
  if (
    !input ||
    typeof input !== 'object' ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw Error('Invalid audit filters.');
  const params = new URLSearchParams();
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== 'string' || !['limit', 'before', 'actorId', 'objectId'].includes(key))
      throw Error('Invalid audit filters.');
    const descriptor = Object.getOwnPropertyDescriptor(input, key);
    if (
      !descriptor?.enumerable ||
      !Object.hasOwn(descriptor, 'value') ||
      typeof descriptor.value !== 'string'
    )
      throw Error('Invalid audit filters.');
    if (descriptor.value !== '') params.set(key, descriptor.value);
  }
  if (params.toString().length > 512) throw Error('Invalid audit filters.');
  return adminAuditQuery(params);
}
export function adminAuditHref(query: AdminAuditQuery, before: string | null): string {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.actorId !== null) params.set('actorId', query.actorId);
  if (query.objectId !== null) params.set('objectId', query.objectId);
  if (before !== null) params.set('before', before);
  return '/audit?' + params.toString();
}
export async function loadAdminAuditWorkspace(
  input: unknown,
  env: Env = process.env,
  fetcher: typeof fetch = fetch,
) {
  const config = previewConfiguration(env);
  if (env.STAFF_AUDIT_PREVIEW_MODE !== 'synthetic-admin-audit-v1')
    throw Error('Audit preview unavailable.');
  const query = adminAuditSearch(input);
  const api = new RealtorApiClient({
    baseUrl: config.origin,
    privacyNoticeVersion: 'synthetic-staff-notice-v1',
    allowLoopbackHttp: true,
    timeoutMs: 10000,
    fetch: fetcher,
  });
  const options = { bearerToken: config.bearerToken };
  const session = await api.getCurrentStaffSessionV2(options);
  // The event endpoint independently rechecks authority; session is not a permission lease.
  const page = await api.listAdminAuditEvents(session.tenantId, query, options);
  return { query, page };
}
