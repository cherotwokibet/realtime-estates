import type { AdminAuditQuery } from '@realtor/domain';
export function adminAuditHref(query: AdminAuditQuery, before: string | null): string {
  const params = new URLSearchParams({ limit: String(query.limit) });
  if (query.actorId !== null) params.set('actorId', query.actorId);
  if (query.objectId !== null) params.set('objectId', query.objectId);
  if (before !== null) params.set('before', before);
  return '/audit?' + params.toString();
}
